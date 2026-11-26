"""Shared catalogue identity, duplicate review and non-financial quote updates."""
import copy
import re
import unicodedata
from difflib import SequenceMatcher
from fastapi import Depends,HTTPException
from sqlalchemy import select, update, text
from .db import session
from .models import Manufacturer, Product, Element, Quotation, StandaloneQuotation


def catalogue_write_guard(db=Depends(session)):
    """Serialize the read/check/write transaction across windows and workers."""
    if db.bind.dialect.name=='postgresql':
        db.execute(text('SELECT pg_advisory_xact_lock(:key)'),{'key':0x534843414C43})
    elif db.bind.dialect.name=='sqlite':
        connection=db.connection()
        if not connection.connection.driver_connection.in_transaction:
            connection.exec_driver_sql('BEGIN IMMEDIATE')
    yield


def identity(value):
    return ' '.join(unicodedata.normalize('NFKC',str(value or '')).casefold().replace('ё','е').split())


def manufacturer_named(db,name):
    name=identity(name)
    matches=[item for item in db.scalars(select(Manufacturer).order_by(Manufacturer.id)) if identity(item.name)==name]
    return next((item for item in matches if item.active),matches[0] if matches else None)


def manufacturer_index(db):
    result={}
    for item in db.scalars(select(Manufacturer).order_by(Manufacturer.id)):
        key=identity(item.name)
        if key not in result or not result[key].active and item.active:result[key]=item
    return result


def resolve_manufacturer(db,name,cache=None):
    clean=' '.join(name.split())
    if not clean:raise HTTPException(422,'Укажите название производителя')
    item=manufacturer_named(db,clean) if cache is None else cache.get(identity(clean))
    if item is not None:
        if not item.active:raise HTTPException(409,'Производитель находится в архиве. Сначала восстановите его в каталоге.')
        return item
    item=Manufacturer(name=clean,active=True);db.add(item);db.flush()
    if cache is not None:cache[identity(clean)]=item
    return item


class CatalogDuplicate(HTTPException):
    def __init__(self,matches):
        super().__init__(409,'Найдены похожие товары. Отредактировать выбранную позицию?')
        self.matches=matches


def product_matches(db,values,exclude_id=None):
    from .catalog_types import product_type_id
    name=identity(values.get('name'));sku=identity(values.get('sku'))
    maker_id=values.get('manufacturer_id');matches=[]
    maker=db.get(Manufacturer,maker_id)
    maker_ids=[item.id for item in db.scalars(select(Manufacturer)) if maker and identity(item.name)==identity(maker.name)]
    normalized=re.sub(r'[^\w]+',' ',name).strip()
    for item in db.scalars(select(Product).where(Product.manufacturer_id.in_(maker_ids))):
        if item.id==exclude_id:continue
        other=identity(item.name);other_normalized=re.sub(r'[^\w]+',' ',other).strip()
        same_sku=bool(sku and sku==identity(item.sku))
        same_name=bool(normalized and normalized==other_normalized)
        ratio=SequenceMatcher(None,normalized[:500],other_normalized[:500]).ratio() if item.type_id==values.get('type_id') else 0
        if not same_sku and not same_name and (len(normalized)<5 or ratio<.84):continue
        matches.append({'id':item.id,'name':item.name,'sku':item.sku,'manufacturer_id':item.manufacturer_id,
            'type_id':product_type_id(db,item),'unit':item.unit,'price':item.price,'currency':item.currency,'active':item.active,
            'reason':'Совпадает артикул' if same_sku else 'Совпадает название' if same_name else 'Похожее название',
            '_score':2 if same_sku else 1 if same_name else ratio})
    return [{k:v for k,v in item.items() if k!='_score'} for item in sorted(matches,key=lambda row:(-row['_score'],row['id']))[:8]]


def guard_product_duplicate(db,values,item=None,allow_duplicate=False):
    keys=('name','sku','manufacturer_id','type_id')
    if item is not None and all(identity(values.get(key))==identity(getattr(item,key)) for key in keys):return
    if not allow_duplicate:
        matches=product_matches(db,values,item.id if item else None)
        if matches:raise CatalogDuplicate(matches)


def product_is_used(db,product_id):
    if db.scalar(select(Element.id).where((Element.product_id==product_id)|(Element.parameters['frame_product_id'].as_integer()==product_id)).limit(1)) is not None:return True
    return any(any(line.get('product_id')==product_id for line in item.content.get('lines',[]))
        for model in (Quotation,StandaloneQuotation) for item in db.scalars(select(model)))


def metadata(db,item):
    from .quotations import validate_image
    maker=db.get(Manufacturer,item.manufacturer_id)
    image=item.parameters.get('image','')
    try:validate_image(image)
    except (ValueError,TypeError,AttributeError):image=''
    return {'name':item.name,'sku':item.sku,'manufacturer':maker.name if maker else '',
        'image':image,'ip':str(item.parameters.get('ip') or '')[:16],
        'description':item.parameters.get('description','')[:2000] if isinstance(item.parameters.get('description',''),str) else ''}


def metadata_patch(line,before,after):
    overrides=set(line.get('overrides',[]))
    return {key:after[key] for key in before if key not in overrides and before[key]!=after[key] and line.get(key,'')==before[key]}


def synchronize_quote_metadata(quote,changes):
    for line in quote.lines:
        pair=changes.get(line.product_id)
        if pair:
            for key,value in metadata_patch(line.model_dump(),*pair).items():setattr(line,key,value)


def propagate_metadata(db,changes,exclude=None):
    """Prices, currency, quantities, discounts and user overrides are snapshots.

    Compare against the old catalogue value, so legacy quotations also retain
    manual text without needing a new snapshot format or migration.
    """
    if not changes:return
    for model in (Quotation,StandaloneQuotation):
        primary=model.project_id if model is Quotation else model.id
        for stored in db.scalars(select(model)):
            item_id=stored.project_id if model is Quotation else stored.id
            if exclude==(item_id,model is StandaloneQuotation):continue
            content=None
            for index,line in enumerate(stored.content.get('lines',[])):
                pair=changes.get(line.get('product_id'))
                if not pair:continue
                patch=metadata_patch(line,*pair)
                if not patch:continue
                if content is None:content=copy.deepcopy(stored.content)
                content['lines'][index].update(patch)
            if content is None:continue
            item_id=stored.project_id if model is Quotation else stored.id
            result=db.execute(update(model).where(primary==item_id,model.revision==stored.revision)
                .values(content=content,revision=stored.revision+1).execution_options(synchronize_session=False))
            if result.rowcount!=1:raise HTTPException(409,'КП изменилось в другом окне. Повторите изменение товара.')
            db.expire(stored)
