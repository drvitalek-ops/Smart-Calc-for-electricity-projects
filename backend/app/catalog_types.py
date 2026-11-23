"""Optional public nomenclature, compatible with existing catalogue databases."""
from sqlalchemy import select
from fastapi import HTTPException
from .models import ElementType


def untyped_kind(kind):
    return bool(kind and ((kind.seed_key or '').startswith('catalog-untyped:') or kind.defaults.get('_catalog_untyped') is True))


def product_type_id(db,product):
    return None if untyped_kind(db.get(ElementType,product.type_id)) else product.type_id


def catalog_type(db,type_id,unit):
    if type_id is not None:
        kind=db.get(ElementType,type_id)
        if kind is None:raise HTTPException(404,'Номенклатура не найдена')
        return kind
    key='catalog-untyped:'+unit
    kind=db.scalar(select(ElementType).where(ElementType.seed_key==key))
    if kind is None:
        kind=next((item for item in db.scalars(select(ElementType).where(ElementType.unit==unit)) if untyped_kind(item)),None)
        if kind:kind.seed_key=key
    if kind is None:
        kind=ElementType(name='Без номенклатуры · '+unit,category='Прочее',unit=unit,color='#64748b',defaults={'_catalog_untyped':True},active=True,seed_key=key)
        db.add(kind);db.flush()
    return kind
