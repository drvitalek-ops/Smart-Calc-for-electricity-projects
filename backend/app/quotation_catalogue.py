"""Recover authored quotation goods as catalogue records and real plan links.

Only exact manufacturer/SKU identities may be reused automatically. Commercial
terms remain snapshots in each quotation; loose name matching never picks goods.
"""
import logging
from contextlib import contextmanager
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import load_only

from .catalog_types import catalog_type, product_type_id
from .models import Element, ElementType, Layer, Manufacturer, Product, Quotation
from .shared_catalog import identity, resolve_manufacturer, catalogue_write_guard

VERSION=1


def authored_identity(line):
    return tuple(identity(getattr(line,key)) for key in ('name','sku','manufacturer'))


def eligible(line):
    return line.product_id is None and all(authored_identity(line))


def materialize(db,pid,quote,baseline=None,*,force=False):
    """Prepare catalogue IDs; apply_quote_changes owns atomic plan changes/undo."""
    previous={line.id:line for line in baseline.lines} if baseline else {}
    legacy=baseline is None or baseline.catalog_links_version<VERSION
    candidates=[];issues={};created=matched=0;line_ids=[]
    for line in quote.lines:
        if not eligible(line):continue
        old=previous.get(line.id)
        if force or legacy or old is None or authored_identity(old)!=authored_identity(line):candidates.append(line)
        elif line.id in quote.catalog_link_issues:issues[line.id]=quote.catalog_link_issues[line.id]
    if not candidates:
        quote.catalog_link_issues=issues;quote.catalog_links_version=VERSION
        return {'created':0,'matched':0,'issues':issues,'line_ids':[]}
    elements={item.id:item for item in db.scalars(select(Element).where(Element.project_id==pid))}
    layers={item.id:item for item in db.scalars(select(Layer).where(Layer.project_id==pid))}
    # Catalogue images are quote-independent and may occupy hundreds of MB.
    # Identity matching needs only these small columns, never every photograph.
    products=list(db.scalars(select(Product).options(load_only(Product.id,Product.manufacturer_id,Product.sku,Product.type_id,Product.unit,Product.active))))
    makers={item.id:identity(item.name) for item in db.scalars(select(Manufacturer))}
    product_index={};frame_index={}
    for product in products:product_index.setdefault((makers.get(product.manufacturer_id),identity(product.sku)),[]).append(product)
    for item in elements.values():
        if item.parameters.get('frame_group'):frame_index.setdefault(item.parameters['frame_group'],[]).append(item)
    for line in candidates:
        try:
            with db.begin_nested():
                members=[elements[eid] for eid in line.source_ids if eid in elements]
                frame_members=[item for gid in line.source_frame_ids for item in frame_index.get(gid,[])]
                if len(members)!=len(line.source_ids):raise HTTPException(409,'Объекты плана изменились. Обновите КП из расчёта.')
                if any(layers[item.layer_id].locked for item in members+frame_members):raise HTTPException(409,'Слой связанных объектов заблокирован. Разблокируйте его и повторите привязку.')
                kinds={item.type_id for item in members}
                if len(kinds)>1:raise HTTPException(409,'В строке смешаны разные номенклатуры. Разделите позиции перед привязкой товара.')
                type_id=next(iter(kinds),line.type_id)
                frame_posts={int(item.parameters.get('frame_posts',0)) for item in frame_members}
                if line.source_frame_ids:
                    if len(frame_posts)!=1:raise HTTPException(409,'У рамок разное число постов. Разделите строку КП.')
                    from .frame_goods import base_name,pending_properties
                    posts=next(iter(frame_posts))
                    kind=db.scalar(select(ElementType).where(ElementType.category=='Рамки',ElementType.name==base_name(posts),ElementType.unit=='шт').limit(1))
                    if kind is None:
                        kind=ElementType(category='Рамки',name=base_name(posts),unit='шт',color='#64748b',defaults={'quantity':1,'frame_posts':posts},active=True)
                        db.add(kind);db.flush()
                    type_id=kind.id
                kind=catalog_type(db,type_id,line.unit)
                if not kind.active:raise HTTPException(409,'Номенклатура находится в архиве. Сначала восстановите её.')
                same=product_index.get((identity(line.manufacturer),identity(line.sku)),[])
                compatible=[p for p in same if p.active and p.unit==line.unit and (type_id is None or product_type_id(db,p) in (None,kind.id))]
                if len(compatible)>1:raise HTTPException(409,'В базе несколько товаров с этим производителем и артикулом. Выберите нужный товар вручную.')
                if same and not compatible:raise HTTPException(409,'Товар с этим артикулом имеет другую номенклатуру, единицу или находится в архиве. Проверьте товар в базе.')
                product=compatible[0] if compatible else None
                is_new=product is None
                if is_new:
                    maker=resolve_manufacturer(db,line.manufacturer)
                    values=dict(type_id=kind.id,manufacturer_id=maker.id,name=line.name.strip(),sku=line.sku.strip(),unit=line.unit,price=float(line.unit_price),currency=line.currency,active=True)
                    parameters={key:getattr(line,key) for key in ('image','ip') if getattr(line,key)}
                    if line.description and (not line.source_ids or 'description' in line.overrides):parameters['description']=line.description
                    if frame_posts:parameters['frame_posts']=next(iter(frame_posts))
                    product=Product(**values,parameters=parameters);db.add(product);db.flush()
                if line.source_frame_ids:
                    # Validate complete frames and locks before a plan/history mutation.
                    pending_properties(db,pid,line.source_frame_ids,{'frame_product_id':product.id})
            if is_new:
                product_index.setdefault((identity(line.manufacturer),identity(line.sku)),[]).append(product);created+=1
            else:matched+=1
            line_ids.append(line.id)
            line.product_id=product.id
            line.type_id=type_id if line.source_ids else product_type_id(db,product)
            if line.source_frame_ids:line.frame_variant='product:'+str(product.id)
            # Keep the existing PDF and negotiated terms, even when a catalogue
            # match has a different current price, text or photograph.
            fields=['name','sku','manufacturer','image','ip','unit_price','currency']
            if not line.source_ids:fields.append('description')
            line.overrides=list(dict.fromkeys([*line.overrides,*fields]))
        except HTTPException as error:
            issues[line.id]=str(error.detail)
    quote.catalog_link_issues=issues
    quote.catalog_links_version=VERSION
    return {'created':created,'matched':matched,'issues':issues,'line_ids':line_ids}


def needs_recovery(stored):
    return stored.content.get('catalog_links_version',0)<VERSION and any(
        isinstance(line,dict) and line.get('product_id') is None and all(isinstance(line.get(key),str) and line[key].strip() for key in ('name','sku','manufacturer'))
        for line in stored.content.get('lines',[]))


def recover_project(db,pid,*,force=False):
    from .quotations import get_quote,persist_quote
    from .quote_to_plan import apply_quote_changes
    stored=db.get(Quotation,pid)
    if stored is None or not force and not needs_recovery(stored):return None
    baseline=get_quote(db,pid);quote=baseline.model_copy(deep=True)
    result=materialize(db,pid,quote,baseline,force=force)
    apply_quote_changes(db,pid,quote,baseline,force_product_lines=set(result['line_ids']))
    persist_quote(db,pid,quote)
    return result


def recover_projects(db):
    """One-time, idempotent upgrade of every existing project quotation."""
    with contextmanager(catalogue_write_guard)(db):
        ids=[item.project_id for item in db.scalars(select(Quotation)) if needs_recovery(item)]
        for pid in ids:
            try:
                with db.begin_nested():recover_project(db,pid)
            except Exception:
                # A damaged legacy quotation must not prevent other projects or
                # the application interface from opening. Its transaction is intact.
                logging.exception('Не удалось восстановить привязки товаров КП проекта %s',pid)
