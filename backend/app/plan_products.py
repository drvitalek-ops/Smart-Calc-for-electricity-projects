"""Atomic catalogue creation/binding and non-financial plan-to-quote metadata."""
import hashlib
from decimal import Decimal,ROUND_HALF_UP
from fastapi import APIRouter,Depends,HTTPException
from pydantic import BaseModel,Field,model_validator
from sqlalchemy import select
from .db import session
from .models import Project,Element,ElementType,Layer,Product,Quotation
from .numbers import RussianDecimal
from .shared_catalog import catalogue_write_guard,resolve_manufacturer,guard_product_duplicate,metadata,propagate_metadata

from .catalog_types import catalog_type,product_type_id

router=APIRouter()

class PlanProductCreate(BaseModel):
    existing_product_id:int|None=Field(default=None,gt=0)
    name:str=Field(min_length=1,max_length=500)
    manufacturer:str=Field(min_length=1,max_length=500)
    sku:str=Field(default='',max_length=200)
    type_id:int|None=Field(default=None,gt=0)
    unit_price:RussianDecimal=Field(ge=0,le=1000000000,decimal_places=2,allow_inf_nan=False)
    currency:str=Field(default='RUB',pattern='^[A-Z]{3}$')
    image:str=Field(default='',max_length=300000)
    allow_duplicate:bool=False

class PlanProductBinding(BaseModel):
    element_ids:list[int]=Field(min_length=1,max_length=5000)
    product_id:int|None=Field(default=None,gt=0)
    create:PlanProductCreate|None=None

    @model_validator(mode='after')
    def one_action(self):
        if self.create is not None and self.product_id is not None:raise ValueError('Выберите существующий товар или создание нового')
        return self


def sync_plan_products(db,pid,quote,bindings=None):
    """Return metadata from current plan links without rewriting agreed money.

    Reads remain reversible: plan undo restores the previous product metadata,
    including after saving a quotation. Partial assignments split rows by product
    while retaining per-unit prices, discounts, comments and manual overrides.
    """
    from .quotations import source_key
    from .report_export import parameters_text
    bindings=bindings or {}
    elements={item.id:item for item in db.scalars(select(Element).where(Element.project_id==pid))}
    products={};kinds={};output=[];report_parameters=None
    for original in quote.lines:
        if not original.source_key or not original.source_ids:output.append(original);continue
        groups={}
        for eid in original.source_ids:
            item=elements.get(eid)
            if item is not None:groups.setdefault(bindings.get(eid,item.product_id),[]).append(item)
        if not groups:output.append(original);continue
        if len(groups)>1 and original.quantity_override is not None:
            if set(bindings).intersection(original.source_ids):raise HTTPException(409,'Строка КП с ручным количеством разделится на разные товары. Снимите галочку «Вручную» или назначьте товар всем объектам этой строки.')
            output.append(original);continue
        ordered=sorted(groups,key=lambda key:(key!=original.product_id,min(item.id for item in groups[key])))
        start=len(output)
        for index,product_id in enumerate(ordered):
            members=groups[product_id];line=original.model_copy(deep=True)
            if len(groups)>1:
                if index:line.id=hashlib.sha256(f'{original.id}:plan-product:{product_id}'.encode()).hexdigest()[:40]
                line.source_ids=sorted(item.id for item in members);line.source_key=source_key({'element_ids':line.source_ids});line.source_signature=''
                key='length' if line.unit=='м' else 'quantity'
                amount=sum((Decimal(str(item.parameters.get(key,0 if key=='length' else 1))) for item in members),Decimal(0)).quantize(Decimal('.001'),rounding=ROUND_HALF_UP)
                line.quantity=line.calculated_quantity=amount
            if product_id!=original.product_id:
                item=members[0]
                if item.type_id not in kinds:kinds[item.type_id]=db.get(ElementType,item.type_id)
                kind=kinds[item.type_id]
                if product_id not in products:products[product_id]=db.get(Product,product_id) if product_id is not None else None
                product=products[product_id]
                if report_parameters is None:
                    from .main import report_rows
                    report_parameters={eid:row['parameters'] for row in report_rows(db,pid)['rows'] for eid in row.get('element_ids',[])}
                base={'name':str(item.parameters.get('display_name') or (kind.name if kind else line.name)),'sku':'','manufacturer':'','image':'','ip':str(item.parameters.get('ip','')),'description':parameters_text(report_parameters.get(item.id,'{}'))[:2000]}
                if product is not None:
                    values=metadata(db,product)
                    base.update({key:value for key,value in values.items() if key not in ('ip','description')})
                    if values['ip']:base['ip']=values['ip']
                    base['description']='\n'.join(dict.fromkeys(filter(None,[base['description'],values['description']])))[:2000]
                    if item.parameters.get('display_name'):base['name']=str(item.parameters['display_name'])
                line.product_id=product_id
                for key,value in base.items():
                    if key not in line.overrides:setattr(line,key,value)
            output.append(line)
        if len(groups)>1:
            from .quotations import totals
            before=quote.model_copy(update={'lines':[original]})
            after=quote.model_copy(update={'lines':output[start:]})
            if any(totals(before,mode)['totals']!=totals(after,mode)['totals'] for mode in ('client','partner')):
                del output[start:]
                if set(bindings).intersection(original.source_ids):raise HTTPException(409,'Разделение строки КП изменит итог из-за округления. Назначьте товар всем объектам этой строки или измените разбивку КП вручную.')
                output.append(original)
    if len(output)>5000:raise HTTPException(422,'Назначение товара создаст больше 5000 строк КП. Сначала сократите число позиций.')
    quote.lines=output
    return quote


@router.post('/api/projects/{pid}/elements/product',status_code=201)
def assign_plan_product(pid:int,body:PlanProductBinding,db=Depends(session),_catalogue=Depends(catalogue_write_guard)):
    from .main import require,remember_elements,catalog_product
    from .quotations import get_quote,validate_image
    require(db,Project,pid)
    items=[require(db,Element,eid) for eid in dict.fromkeys(body.element_ids)]
    if any(item.project_id!=pid for item in items):raise HTTPException(422,'Объект принадлежит другому проекту')
    if any(require(db,Layer,item.layer_id).locked for item in items):raise HTTPException(409,'Слой выбранного объекта заблокирован. Разблокируйте все выбранные объекты перед назначением товара.')
    type_ids={item.type_id for item in items}
    if (body.create or body.product_id) and len(type_ids)!=1:raise HTTPException(422,'Выбраны разные объекты. Один товар можно назначить объектам одной номенклатуры. Уточните выделение.')
    product=None;changes={}
    if body.create is not None:
        draft=body.create;selected_kind=require(db,ElementType,next(iter(type_ids)));typ=catalog_type(db,draft.type_id,selected_kind.unit)
        if not typ.active:raise HTTPException(409,'Сначала восстановите номенклатуру в каталоге')
        if draft.type_id is not None and type_ids!={typ.id}:raise HTTPException(422,'Товар не соответствует номенклатуре выбранных объектов')
        try:validate_image(draft.image)
        except ValueError:raise HTTPException(422,'Не удалось прочитать фотографию. Используйте PNG, JPEG или WebP.')
        name=' '.join(draft.name.split())
        if not name:raise HTTPException(422,'Укажите название товара')
        maker=resolve_manufacturer(db,draft.manufacturer)
        values=dict(name=name,manufacturer_id=maker.id,type_id=typ.id,sku=draft.sku.strip(),price=float(draft.unit_price),currency=draft.currency,unit=typ.unit,active=True)
        product=require(db,Product,draft.existing_product_id) if draft.existing_product_id else None
        if product is not None and (product.type_id!=typ.id or product.unit!=typ.unit):raise HTTPException(422,'Номенклатуру существующего товара нельзя заменить при назначении на план')
        guard_product_duplicate(db,values,product,allow_duplicate=draft.allow_duplicate)
        if product is None:
            product=Product(**values,parameters={'image':draft.image} if draft.image else {});db.add(product);db.flush()
        else:
            before=metadata(db,product)
            for key,value in values.items():setattr(product,key,value)
            product.parameters={**product.parameters,'image':draft.image}
            changes[product.id]=(before,metadata(db,product))
    elif body.product_id is not None:
        product=require(db,Product,body.product_id)
        if not product.active:raise HTTPException(409,'Товар находится в архиве. Сначала восстановите его в каталоге.')
        typ=require(db,ElementType,next(iter(type_ids)))
        if product_type_id(db,product) not in (None,typ.id) or product.unit!=typ.unit:raise HTTPException(422,'Тип и единица товара должны соответствовать выбранным объектам')
    product_id=product.id if product else None
    if db.get(Quotation,pid) is not None:sync_plan_products(db,pid,get_quote(db,pid),{item.id:product_id for item in items})
    propagate_metadata(db,changes)
    if any(item.product_id!=product_id for item in items):
        remember_elements(db,pid)
        for item in items:
            if item.product_id!=product_id:item.parameters={key:value for key,value in item.parameters.items() if key!='_quotation'}
            item.product_id=product_id
    db.commit()
    return {'updated':len(items),'product':catalog_product(db,product) if product else None}
