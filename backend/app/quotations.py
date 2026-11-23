"""Saved quotations, catalogue binding and exact decimal price calculations."""
import copy
import base64
import hashlib
import io
import json
import uuid
from pathlib import Path
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal, Annotated
from fastapi import APIRouter, Depends, HTTPException, UploadFile, Request, Query
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, model_validator, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession
from .db import session
from .models import Project, Quotation, StandaloneQuotation, Element, ElementType, Product, Manufacturer, Layer

router=APIRouter()
from .shared_catalog import catalogue_write_guard, resolve_manufacturer, guard_product_duplicate, metadata, propagate_metadata, product_is_used, synchronize_quote_metadata
from .numbers import RussianDecimal
from .errors import exception_message

CENT=Decimal('0.01')


def money(value):
    return Decimal(str(value)).quantize(CENT,rounding=ROUND_HALF_UP)


class PriceLine(BaseModel):
    id:str=Field(min_length=1,max_length=80)
    quantity:RussianDecimal=Field(default=1,gt=0,le=1000000,max_digits=10,decimal_places=3,allow_inf_nan=False)
    unit_price:RussianDecimal=Field(default=0,ge=0,le=1000000000,max_digits=12,decimal_places=2,allow_inf_nan=False)
    currency:str=Field(default='RUB',pattern='^[A-Z]{3}$')
    discount:RussianDecimal|None=Field(default=None,ge=0,le=100,max_digits=5,decimal_places=2,allow_inf_nan=False)


class PriceInput(BaseModel):
    global_discount:RussianDecimal=Field(default=0,ge=0,le=100,max_digits=5,decimal_places=2,allow_inf_nan=False)
    lines:list[PriceLine]=Field(default_factory=list,max_length=5000)

    @model_validator(mode='after')
    def unique_ids(self):
        if len({line.id for line in self.lines})!=len(self.lines):raise ValueError('Повторяющийся идентификатор строки КП')
        return self


class QuoteLine(BaseModel):
    model_config=ConfigDict(validate_default=True)
    id: str = Field(min_length=1,max_length=80)
    source_key: str = Field(default='',max_length=2000)
    source_signature: str = Field(default='',max_length=64)
    source_ids: list[int] = Field(default_factory=list,max_length=100000)
    type_id: int | None = Field(default=None,gt=0)
    product_id: int | None = Field(default=None,gt=0)
    name: str = Field(min_length=1,max_length=500)
    sku: str = Field(default='',max_length=200)
    ip: str = Field(default='',max_length=16)
    manufacturer: str = Field(default='',max_length=500)
    room: str = Field(default='',max_length=500)
    description: str = Field(default='',max_length=2000)
    comment: str = Field(default='',max_length=2000)
    quantity: RussianDecimal = Field(default=1,gt=0,le=1000000,max_digits=10,decimal_places=3,allow_inf_nan=False)
    quantity_override: RussianDecimal | None = Field(default=None,gt=0,le=1000000,max_digits=10,decimal_places=3,allow_inf_nan=False)
    calculated_quantity: RussianDecimal | None = Field(default=None,gt=0,le=1000000,max_digits=10,decimal_places=3,allow_inf_nan=False)
    overrides: list[Literal['name','sku','manufacturer','room','description','ip','unit_price','currency','image']] = Field(default_factory=list,max_length=9)
    unit: Literal['шт','м'] = 'шт'
    unit_price: RussianDecimal = Field(default=0,ge=0,le=1000000000,max_digits=12,decimal_places=2,allow_inf_nan=False)
    currency: str = Field(default='RUB',pattern='^[A-Z]{3}$')
    image: str = Field(default='',max_length=300000)
    discount: RussianDecimal | None = Field(default=None,ge=0,le=100,max_digits=5,decimal_places=2,allow_inf_nan=False)

    @model_validator(mode='after')
    def manual_quantity(self):
        if self.source_key and self.quantity_override is not None: self.quantity=self.quantity_override
        if not self.source_key:
            self.quantity_override=None;self.calculated_quantity=None
            if self.product_id is None:self.overrides=[]
        return self


class Benefit(BaseModel):
    title: str = Field(max_length=80)
    text: str = Field(default='',max_length=160)


def _validate_image(value):
    if not value: return
    import pymupdf
    try:
        header,encoded=value.split(',',1)
        if header not in ('data:image/png;base64','data:image/jpeg;base64'):
            raise ValueError('Нужен PNG или JPEG')
        raw=base64.b64decode(encoded,validate=True)
        if not (raw.startswith(b'\x89PNG\r\n\x1a\n') or raw.startswith(b'\xff\xd8')):
            raise ValueError('Неверный формат изображения')
        # Inspect dimensions before decoding to bound image allocation.
        if raw.startswith(b'\x89PNG'):
            width=int.from_bytes(raw[16:20],'big');height=int.from_bytes(raw[20:24],'big')
        else:
            position=2;width=height=0
            while position<len(raw):
                if raw[position]!=255: raise ValueError('Неверная структура JPEG')
                while position<len(raw) and raw[position]==255: position+=1
                marker=raw[position];position+=1
                if marker in (0xD9,0xDA): break
                if marker==0x01 or 0xD0<=marker<=0xD7: continue
                length=int.from_bytes(raw[position:position+2],'big')
                if length<2 or position+length>len(raw): raise ValueError('Неверная длина JPEG')
                if 0xC0<=marker<=0xCF and marker not in (0xC4,0xC8,0xCC):
                    height=int.from_bytes(raw[position+3:position+5],'big')
                    width=int.from_bytes(raw[position+5:position+7],'big')
                    break
                position+=length
        if width<=0 or height<=0 or width*height>4000000:
            raise ValueError('Слишком большое изображение')
        pixmap=pymupdf.Pixmap(raw)
        if pixmap.width!=width or pixmap.height!=height: raise ValueError('Размер изображения не совпадает с заголовком')
    except Exception as exc:
        raise ValueError('Некорректное изображение PNG/JPEG') from exc


from .quotation_cache import RenderCache,RENDER_LOCK
_VALID_IMAGES=RenderCache(max_bytes=1024*1024,max_items=4096,ttl=600)


def validate_image(value):
    if not value:return
    digest=hashlib.sha256(value.encode('utf-8')).digest()
    def check():
        with RENDER_LOCK:_validate_image(value)
        return b'ok'
    _VALID_IMAGES.get_or_create(digest,check)


class QuoteStyle(BaseModel):
    font:Literal['Golos','DejaVuSans','DejaVuSerif']='Golos'
    table_scale:float=Field(default=1,ge=.8,le=1.3,allow_inf_nan=False)
    colors:dict[str,str]=Field(default_factory=dict,max_length=50)

    @field_validator('colors')
    @classmethod
    def validate_colors(cls,value):
        import re
        allowed={entry['key'] for entry in json.loads((Path(__file__).parent/'assets/quotation-theme.json').read_text(encoding='utf-8'))}
        if any(key not in allowed or not re.fullmatch(r'#[0-9a-fA-F]{6}',color) for key,color in value.items()):
            raise ValueError('Выберите допустимый элемент оформления и цвет в формате #RRGGBB')
        return value


class QuoteInput(BaseModel):
    _merged_line_ids:dict[str,str]=PrivateAttr(default_factory=dict)
    model_config=ConfigDict(validate_default=True)
    style:QuoteStyle=Field(default_factory=QuoteStyle)
    revision: int = Field(default=0,ge=0)
    room_layout:Literal['combined','rooms','legacy']='combined'
    plan_sync:bool|None=None
    plan_snapshot_ids:list[Annotated[int,Field(gt=0)]]|None=Field(default=None,max_length=100000)
    excluded_plan_ids:list[Annotated[int,Field(gt=0)]]=Field(default_factory=list,max_length=100000)
    number: str = Field(default='',max_length=100)
    date: str = Field(default_factory=lambda:date.today().isoformat(),pattern=r'^\d{4}-\d{2}-\d{2}$')
    title: str = Field(default='Коммерческое предложение',min_length=1,max_length=300)
    seller: str = Field(default='ЛЭД-ПРОФИ',max_length=4000)
    city: str = Field(default='Санкт-Петербург',max_length=200)
    phone: str = Field(default='+7 (812) 385-52-00',max_length=200)
    email: str = Field(default='sale@led-profi.ru',max_length=200)
    website: str = Field(default='led-profi.ru',max_length=300)
    address: str = Field(default='',max_length=1000)
    slogan: str = Field(default='ПРОФЕССИОНАЛЬНЫЙ СВЕТ ДЛЯ ВАШИХ ПРОЕКТОВ',max_length=200)
    valid_days: int = Field(default=30,ge=1,le=365)
    tax_note: str = Field(default='Включая НДС',max_length=300)
    logo: str = Field(default='',max_length=300000)
    benefits: list[Benefit] = Field(default_factory=lambda:[
        Benefit(title='ГАРАНТИЯ ДО 5 ЛЕТ',text='Официальная продукция'),
        Benefit(title='ПРОВЕРЕННОЕ КАЧЕСТВО',text='Надёжные бренды'),
        Benefit(title='ПОДБОР ПОД ПРОЕКТ',text='Световые решения'),
        Benefit(title='ТЕХПОДДЕРЖКА',text='Помогаем на каждом этапе'),
    ],max_length=4)
    customer: str = Field(default='',max_length=2000)
    contact: str = Field(default='',max_length=2000)
    terms: str = Field(default='',max_length=10000)
    global_discount: RussianDecimal = Field(default=0,ge=0,le=100,max_digits=5,decimal_places=2,allow_inf_nan=False)
    lines: list[QuoteLine] = Field(default_factory=list,max_length=5000)

    @model_validator(mode='after')
    def unique_rows(self):
        if len({line.id for line in self.lines})!=len(self.lines):
            raise ValueError('Повторяющийся идентификатор строки КП')
        validate_image(self.logo)
        if len(self.logo)+sum(len(line.image) for line in self.lines)>20000000:
            raise ValueError('Фотографии КП занимают больше 20 МБ')
        seen=set()
        for line in self.lines:
            validate_image(line.image)
            if len(set(line.source_ids))!=len(line.source_ids) or seen.intersection(line.source_ids):
                raise ValueError('Одна позиция плана включена в несколько строк КП')
            seen.update(line.source_ids)
        try: date.fromisoformat(self.date)
        except ValueError: raise ValueError('Некорректная дата КП')
        return self


class QuoteRevision(BaseModel):
    revision: int = Field(ge=0)


class QuoteBinding(QuoteRevision):
    line_id: str
    product_id: int | None = Field(default=None,gt=0)


class QuoteProduct(QuoteRevision):
    existing_product_id:int|None=Field(default=None,gt=0)
    allow_duplicate:bool=False
    line_id: str
    type_id: int | None = Field(default=None,gt=0)
    image: str = Field(default='',max_length=300000)
    name: str = Field(min_length=1,max_length=500)
    manufacturer: str = Field(min_length=1,max_length=500)
    sku: str = Field(default='',max_length=200)
    unit_price: RussianDecimal = Field(ge=0,le=1000000000,decimal_places=2,allow_inf_nan=False)
    currency: str = Field(default='RUB',pattern='^[A-Z]{3}$')


def require_project(db,pid):
    project=db.get(Project,pid)
    if project is None: raise HTTPException(404,'Проект не найден')
    return project


def get_quote(db,pid,standalone=False):
    if standalone:
        stored=db.get(StandaloneQuotation,pid)
        if stored is None: raise HTTPException(404,'Самостоятельное КП не найдено')
        from .quotation_prices import inherit_prices
        from .quotation_grouping import merge_identical_lines
        return merge_identical_lines(inherit_prices(QuoteInput.model_validate({'room_layout':'legacy',**stored.content,'revision':stored.revision})))
    project=require_project(db,pid)
    stored=db.get(Quotation,pid)
    if stored is None:
        return QuoteInput(number=str(pid),title='Коммерческое предложение',customer=project.name)
    from .quotation_prices import inherit_prices
    from .quotation_grouping import merge_identical_lines
    return merge_identical_lines(inherit_prices(sync_plan_quantities(db,pid,QuoteInput.model_validate({'room_layout':'legacy',**stored.content,'revision':stored.revision}))))


def check_revision(db,pid,revision,standalone=False):
    quote=get_quote(db,pid,standalone)
    if quote.revision!=revision:
        raise HTTPException(409,'КП изменилось в другом окне. Загрузите сохранённую версию перед продолжением.')
    return quote


def persist_quote(db,pid,quote,standalone=False):
    # Conditional update protects against overwriting a concurrent editor.
    from sqlalchemy import update
    model=StandaloneQuotation if standalone else Quotation
    primary_key=StandaloneQuotation.id if standalone else Quotation.project_id
    stored=db.get(model,pid)
    if not standalone:sync_plan_quantities(db,pid,quote,update_signatures=True)
    from .quotation_prices import inherit_prices
    inherit_prices(quote)
    from .quotation_grouping import merge_identical_lines
    merge_identical_lines(quote)
    payload=quote.model_dump(mode='json',exclude={'revision'})
    if stored is None:
        if standalone: raise HTTPException(409,'Самостоятельное КП было удалено')
        stored=Quotation(project_id=pid,revision=1,content=payload)
        db.add(stored); db.flush()
        quote.revision=1
    else:
        result=db.execute(update(model).where(primary_key==pid,model.revision==quote.revision)
            .values(content=payload,revision=quote.revision+1).execution_options(synchronize_session=False))
        if result.rowcount!=1: raise HTTPException(409,'КП уже изменено в другом окне')
        quote.revision+=1
        db.expire(stored)
    return quote


def quote_scope(request:Request):
    standalone='qid' in request.path_params
    try:
        identifier=int(request.path_params['qid' if standalone else 'pid'])
        if identifier<1: raise ValueError()
    except (ValueError,TypeError):
        raise HTTPException(422,'Некорректный идентификатор КП')
    return identifier,standalone


def validate_standalone(quote):
    quote.plan_sync=False;quote.plan_snapshot_ids=[];quote.excluded_plan_ids=[]
    if any(line.source_ids or line.source_key for line in quote.lines):
        raise HTTPException(422,'Самостоятельное КП не может содержать привязки к плану')


def new_standalone(db,quote):
    validate_standalone(quote)
    row=StandaloneQuotation(revision=1,content={});db.add(row);db.flush()
    if not quote.number: quote.number='С-'+str(row.id)
    quote.revision=1
    row.content=quote.model_dump(mode='json',exclude={'revision'})
    return row


class QuoteAttachment(QuoteRevision):
    project_id: int = Field(gt=0)
    project_revision: int = Field(ge=0)


@router.get('/api/quotations/project-options')
def quote_project_options(db:DbSession=Depends(session)):
    return [{'id':project.id,'name':project.name,'quote_revision':stored.revision if stored else 0}
            for project,stored in db.execute(select(Project,Quotation).outerjoin(Quotation,Quotation.project_id==Project.id).order_by(Project.id.desc()))]


@router.get('/api/quotations')
def list_quotations(db:DbSession=Depends(session)):
    drafts=[]
    for item in db.scalars(select(StandaloneQuotation).order_by(StandaloneQuotation.id.desc())):
        content=item.content
        drafts.append({'id':item.id,'revision':item.revision,'number':content.get('number',''),
            'customer':content.get('customer',''),'date':content.get('date',''),'lines_count':len(content.get('lines',[]))})
    projects=[{'project_id':project.id,'name':project.name,'number':stored.content.get('number',''),
              'customer':stored.content.get('customer',''),'lines_count':len(stored.content.get('lines',[]))}
        for project,stored in db.execute(select(Project,Quotation).join(Quotation,Quotation.project_id==Project.id).order_by(Project.id.desc()))]
    return {'standalone':drafts,'projects':projects}


@router.post('/api/quotations',status_code=201)
def create_standalone(body:QuoteInput|None=None,db:DbSession=Depends(session)):
    quote=body if body is not None else QuoteInput()
    row=new_standalone(db,quote);db.commit()
    return {'id':row.id,'quotation':present(quote)}


@router.delete('/api/quotations/{qid}',status_code=204)
def delete_standalone(qid:int,body:QuoteRevision,db:DbSession=Depends(session)):
    from sqlalchemy import delete
    check_revision(db,qid,body.revision,standalone=True)
    result=db.execute(delete(StandaloneQuotation).where(StandaloneQuotation.id==qid,StandaloneQuotation.revision==body.revision))
    if result.rowcount!=1: raise HTTPException(409,'КП уже изменено в другом окне')
    db.commit()


@router.post('/api/quotations/{qid}/attach')
def attach_standalone(qid:int,body:QuoteAttachment,db:DbSession=Depends(session)):
    from sqlalchemy import delete
    from sqlalchemy.exc import IntegrityError
    quote=check_revision(db,qid,body.revision,standalone=True)
    validate_standalone(quote)
    previous=check_revision(db,body.project_id,body.project_revision)
    archived_id=None
    if previous.revision:
        detached=previous.model_copy(deep=True)
        for line in detached.lines: line.source_ids=[];line.source_key=''
        archived_id=new_standalone(db,detached).id
    quote.revision=previous.revision
    try:
        persist_quote(db,body.project_id,quote)
        result=db.execute(delete(StandaloneQuotation).where(StandaloneQuotation.id==qid,StandaloneQuotation.revision==body.revision))
        if result.rowcount!=1: raise HTTPException(409,'Самостоятельное КП уже изменено в другом окне')
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409,'КП проекта изменилось. Обновите список проектов и повторите привязку.') from exc
    return {'project_id':body.project_id,'archived_quotation_id':archived_id,'quotation':present(quote)}


def totals(quote,mode):
    rows=[]
    currencies={}
    for line in quote.lines:
        base=money(line.quantity*line.unit_price)
        percent=(line.discount if line.discount is not None else quote.global_discount) if mode=='partner' else Decimal(0)
        reduction=money(base*percent/100)
        total=base-reduction
        rows.append({**line.model_dump(mode='json'),'effective_discount':str(percent),
                     'base_total':str(base),'discount_amount':str(reduction),'total':str(total)})
        sums=currencies.setdefault(line.currency,{'base':Decimal(0),'discount':Decimal(0),'total':Decimal(0)})
        sums['base']+=base;sums['discount']+=reduction;sums['total']+=total
    return {'lines':rows,'totals':{code:{key:str(value) for key,value in sums.items()} for code,sums in currencies.items()}}


def present(quote,*,with_aliases=False):
    from .quotation_prices import inherit_prices
    inherit_prices(quote)
    result={**quote.model_dump(mode='json'),'client':totals(quote,'client'),'partner':totals(quote,'partner')}
    if with_aliases and quote._merged_line_ids:result['merged_line_ids']=quote._merged_line_ids
    return result


def product_snapshot(db,line,product):
    line.product_id=product.id
    line.type_id=product.type_id
    line.name=product.name;line.sku=product.sku
    line.manufacturer=db.get(Manufacturer,product.manufacturer_id).name
    line.unit_price=money(product.price);line.currency=product.currency
    if product.parameters.get('ip') not in (None,''):line.ip=str(product.parameters['ip'])
    image=product.parameters.get('image','')
    if not isinstance(image,str): image=''
    try: validate_image(image)
    except (TypeError,ValueError): image=''
    line.image=image
    description=product.parameters.get('description','')
    if isinstance(description,str) and description.strip():
        line.description='\n'.join(dict.fromkeys(filter(None,[line.description,description.strip()])))[:2000]


def source_signature(row):
    # Quantities, IDs and catalogue prices may change independently of a plan group.
    fields={key:row.get(key) for key in ('room','category','name','unit','parameters','product_id','type_id')}
    return hashlib.sha256(json.dumps(fields,ensure_ascii=False,sort_keys=True).encode()).hexdigest()


def source_key(row):
    if row.get('element_ids'): return 'elements:'+hashlib.sha256(','.join(map(str,sorted(row['element_ids']))).encode()).hexdigest()
    return 'frame:'+row['room']+':'+row['name']


def import_lines(db,pid,quote):
    from .report_export import parameters_text
    previous={line.source_key:line for line in quote.lines if line.source_key}
    previous_order={line.id:index for index,line in enumerate(quote.lines)}
    order_hints={}
    used_ids=set()
    lines=[]
    from .quotation_rooms import calculated_rows
    calculated=calculated_rows(db,pid,quote.room_layout)
    for candidate in previous.values():
        if candidate.quantity_override is None or not candidate.source_ids: continue
        matching=[row for row in calculated if set(candidate.source_ids).intersection(row.get('element_ids',[]))]
        if len(matching)>1:
            raise HTTPException(409,'Позиция с ручным количеством разделилась на несколько строк. Снимите галочку «Вручную» у этой позиции и повторите обновление: '+candidate.name[:100])
    for row in calculated:
        key=source_key(row)
        old=previous.get(key)
        if old is None and row.get('element_ids'):
            current_ids=set(row['element_ids'])
            matches=[candidate for candidate in previous.values() if current_ids.intersection(candidate.source_ids)]
            if len(matches)==1: old=matches[0]
            elif len(matches)>1:
                if any(candidate.quantity_override is not None for candidate in matches):
                    raise HTTPException(409,'Позиции с ручным количеством объединяются. Снимите галочки «Вручную» перед обновлением: '+row['name'][:100])
                if len({(candidate.unit_price,candidate.currency) for candidate in matches})>1:
                    raise HTTPException(409,'Объединяются строки с разными ценами или валютами. Укажите одинаковые условия перед обновлением КП.')
                if len({candidate.discount for candidate in matches})>1:
                    raise HTTPException(409,'Объединяются строки с разными скидками. Укажите одинаковые скидки перед обновлением КП.')
                old=matches[0].model_copy(deep=True)
                comments=list(dict.fromkeys(candidate.comment for candidate in matches if candidate.comment))
                old.comment='\n'.join(comments)
                if len(old.comment)>2000:
                    raise HTTPException(409,'Комментарии объединяемых строк превышают 2000 символов. Сократите их перед обновлением КП.')
                fields=set(field for candidate in matches for field in candidate.overrides)
                if fields:
                    if any(any(getattr(candidate,field)!=getattr(matches[0],field) for candidate in matches[1:]) for field in fields):
                        raise HTTPException(409,'Объединяются строки с разными ручными правками. Укажите одинаковые значения в этих строках перед обновлением: '+row['name'][:100])
                old.overrides=sorted(fields)
        line_id=old.id if old is not None and old.id not in used_ids else uuid.uuid4().hex
        used_ids.add(line_id)
        order_hints[line_id]=previous_order[old.id] if old else len(quote.lines)+len(lines)
        line=QuoteLine(id=line_id,source_key=key,source_signature=source_signature(row),
            source_ids=row.get('element_ids',[]),type_id=row.get('type_id'),
            name=row['product'] or row['name'],room=row['room'],ip=str(json.loads(row['parameters']).get('ip','')),
            quantity=str(row['quantity']),calculated_quantity=str(row['quantity']),quantity_override=old.quantity_override if old else None,overrides=old.overrides if old else [],unit=row['unit'],unit_price=str(money(row['unit_price'])),
            product_id=row['product_id'],sku=row['sku'],manufacturer=row['manufacturer'],
            description=parameters_text(row['parameters'])[:2000],currency=row['currency'],
            comment=old.comment if old else '',
            discount=old.discount if old else None)
        if row['product_id']:
            product_snapshot(db,line,db.get(Product,row['product_id']))
        elif old:
            # Keep manually entered prices and a product chosen for a calculated frame.
            for field in ('product_id','name','sku','manufacturer','unit_price','currency','type_id','image'):
                setattr(line,field,getattr(old,field))
        if row.get('custom_name'): line.name=row['name']
        if old:
            if old.unit==line.unit:line.unit_price=old.unit_price;line.currency=old.currency
            for field in old.overrides: setattr(line,field,getattr(old,field))
        lines.append(line)
    lines.extend(line for line in quote.lines if not line.source_key)
    lines.sort(key=lambda line:order_hints.get(line.id,previous_order.get(line.id,len(quote.lines))))
    if len(lines)>5000: raise HTTPException(422,'В КП больше 5000 строк')
    quote.lines=lines
    quote.plan_sync=True;quote.excluded_plan_ids=[]
    quote.plan_snapshot_ids=sorted({eid for line in lines for eid in line.source_ids})
    return quote


def _new_plan_line(db,pid,row,ids,quantity,used):
    from .report_export import parameters_text
    signature=source_signature(row);seed=f'{pid}:{signature}';nonce=0
    line_id='plan-'+hashlib.sha256(seed.encode()).hexdigest()
    while line_id in used:
        nonce+=1;line_id='plan-'+hashlib.sha256(f'{seed}:{nonce}:{ids}'.encode()).hexdigest()
    used.add(line_id)
    line=QuoteLine(id=line_id,source_key=source_key({'element_ids':ids}),source_signature=signature,
        source_ids=ids,type_id=row.get('type_id'),name=row['product'] or row['name'],room=row['room'],
        ip=str(json.loads(row['parameters']).get('ip','')),quantity=quantity,calculated_quantity=quantity,
        unit=row['unit'],unit_price=money(row['unit_price']),product_id=row['product_id'],sku=row['sku'],
        manufacturer=row['manufacturer'],description=parameters_text(row['parameters'])[:2000],currency=row['currency'])
    if row['product_id']:product_snapshot(db,line,db.get(Product,row['product_id']))
    if row.get('custom_name'):line.name=row['name']
    return line


def sync_plan_quantities(db,pid,quote,*,update_signatures=False,coalesce=True):
    """Follow existing sources and add new plan objects without replacing terms.

    A snapshot of sources actually shown to the editor distinguishes deliberate
    row removal from a stale editor that has never seen newly placed objects.
    Reads remain derived, so plan undo can restore saved commercial conditions.
    """
    if quote.plan_snapshot_ids is None:
        stored=db.get(Quotation,pid)
        if stored:
            previous=stored.content
            quote.plan_snapshot_ids=previous.get('plan_snapshot_ids')
            if quote.plan_snapshot_ids is None:quote.plan_snapshot_ids=sorted({eid for line in previous.get('lines',[]) for eid in line.get('source_ids',[])})
            quote.excluded_plan_ids=sorted(set(quote.excluded_plan_ids)|set(previous.get('excluded_plan_ids',[])))
            if quote.plan_sync is None:quote.plan_sync=previous.get('plan_sync')
    linked=[line for line in quote.lines if line.source_key]
    if quote.plan_sync is None:quote.plan_sync=bool(linked) or not quote.lines
    if not quote.plan_sync:return quote
    represented={eid for line in linked for eid in line.source_ids}
    excluded=set(quote.excluded_plan_ids)
    if quote.plan_snapshot_ids is not None:excluded.update(set(quote.plan_snapshot_ids)-represented)
    excluded.difference_update(represented);quote.excluded_plan_ids=sorted(excluded)
    from .quotation_rooms import calculated_rows
    rows=calculated_rows(db,pid,quote.room_layout)
    elements={item.id:item for item in db.scalars(select(Element).where(Element.project_id==pid))}
    owners={eid:line for line in linked for eid in line.source_ids}
    frames={line.source_key:line for line in linked if not line.source_ids}
    signatures={}
    for line in linked:
        if line.source_signature:signatures.setdefault(line.source_signature,[]).append(line)
    quantities={};sources={};current_signatures={};new_rows=[]
    def add(line,value,ids,signature):
        quantities[line.id]=quantities.get(line.id,Decimal(0))+value
        sources.setdefault(line.id,[]).extend(ids)
        current_signatures.setdefault(line.id,set()).add(signature)
    def amount(ids,unit):
        key='length' if unit=='м' else 'quantity'
        return sum((Decimal(str(elements[eid].parameters.get(key,0 if key=='length' else 1))) for eid in ids),Decimal(0)).quantize(Decimal('.001'),rounding=ROUND_HALF_UP)
    for row in rows:
        signature=source_signature(row)
        if not row.get('element_ids'):
            # Frame rows retain their existing explicit import/removal behavior.
            old=frames.get(source_key(row))
            if old:add(old,Decimal(str(row['quantity'])),[],signature)
            continue
        ids=[eid for eid in row['element_ids'] if eid not in excluded]
        if not ids:continue
        matches={owners[eid].id:owners[eid] for eid in ids if eid in owners and owners[eid].unit==row['unit'] and owners[eid].type_id in (None,row['type_id'])}
        if not matches and len(signatures.get(signature,[]))==1:
            old=signatures[signature][0];matches[old.id]=old
        partitions={};unassigned=[]
        for eid in ids:
            owner=owners.get(eid)
            if owner and owner.id not in matches:owner=None
            if owner is None and len(matches)==1:owner=next(iter(matches.values()))
            if owner is not None:partitions.setdefault(owner.id,[]).append(eid)
            else:unassigned.append(eid)
        for line_id,part in partitions.items():add(matches[line_id],amount(part,row['unit']),part,signature)
        if unassigned:new_rows.append((row,unassigned,amount(unassigned,row['unit'])))
    updated=[]
    for original in quote.lines:
        if not original.source_key:updated.append(original);continue
        quantity=quantities.get(original.id,Decimal(0))
        if quantity<=0:continue
        line=original.model_copy(deep=True)
        line.source_ids=sorted(sources[line.id])
        if line.source_ids:line.source_key=source_key({'element_ids':line.source_ids})
        if (update_signatures or not line.source_signature) and len(current_signatures[line.id])==1:line.source_signature=next(iter(current_signatures[line.id]))
        if line.calculated_quantity!=quantity:line.calculated_quantity=Decimal(str(float(quantity)))
        effective=line.quantity_override if line.quantity_override is not None else quantity
        if line.quantity!=effective:line.quantity=Decimal(str(float(effective)))
        updated.append(line)
    used={line.id for line in updated}
    for row,ids,quantity in new_rows:
        if quantity>0:updated.append(_new_plan_line(db,pid,row,ids,quantity,used))
    if len(updated)>5000:raise HTTPException(422,'В КП больше 5000 строк')
    quote.lines=updated
    from .quotation_prices import inherit_prices
    inherit_prices(quote)
    from .plan_products import sync_plan_products
    sync_plan_products(db,pid,quote)
    if coalesce:
        from .quotation_grouping import merge_identical_lines
        merge_identical_lines(quote)
    quote.plan_snapshot_ids=sorted({eid for line in quote.lines for eid in line.source_ids})
    return quote


def bind_product(db,pid,quote,line_id,product):
    line=next((line for line in quote.lines if line.id==line_id),None)
    if line is None: raise HTTPException(404,'Строка КП не найдена')
    if not product.active: raise HTTPException(409,'Товар находится в архиве')
    if product.unit!=line.unit or line.source_ids and line.type_id is not None and product.type_id!=line.type_id:
        raise HTTPException(422,'Тип и единица товара должны соответствовать позиции')
    elements=[]
    for eid in line.source_ids:
        element=db.get(Element,eid)
        if element is None or element.project_id!=pid or element.type_id!=product.type_id:
            raise HTTPException(409,'Позиции плана изменились. Обновите КП из расчёта.')
        if db.get(Layer,element.layer_id).locked:
            raise HTTPException(409,'Слой позиции заблокирован. Разблокируйте его перед привязкой товара.')
        elements.append(element)
    if elements:
        from .main import remember_elements
        remember_elements(db,pid)
        for element in elements: element.product_id=product.id
    # Product metadata follows the catalogue; the editor's room grouping stays manual.
    line.overrides=[field for field in line.overrides if field=='room']
    product_snapshot(db,line,product)


@router.get('/api/quotations/{qid}')
@router.get('/api/projects/{pid}/quotation')
def read_quote(db:DbSession=Depends(session),scope:tuple=Depends(quote_scope)):
    pid,standalone=scope
    quote=get_quote(db,pid,standalone)
    if quote.revision==0:
        import_lines(db,pid,quote)
        from sqlalchemy.exc import IntegrityError
        try:
            persist_quote(db,pid,quote,standalone);db.commit()
        except (IntegrityError,HTTPException) as exc:
            if isinstance(exc,HTTPException) and exc.status_code!=409: raise
            db.rollback()
            quote=get_quote(db,pid,standalone)
            if quote.revision==0: raise
    return present(quote)


@router.put('/api/quotations/{qid}')
@router.put('/api/projects/{pid}/quotation')
def save_quote(body:QuoteInput,db:DbSession=Depends(session),scope:tuple=Depends(quote_scope)):
    pid,standalone=scope
    check_revision(db,pid,body.revision,standalone)
    if standalone: validate_standalone(body)
    for line in body.lines:
        if line.type_id is not None and db.get(ElementType,line.type_id) is None:
            raise HTTPException(422,'Номенклатура строки не найдена')
        if line.product_id is not None:
            product=db.get(Product,line.product_id)
            if product is None or product.unit!=line.unit or line.type_id!=product.type_id:
                raise HTTPException(422,'Товар строки не соответствует номенклатуре или единице')
    persist_quote(db,pid,body,standalone);db.commit()
    return present(body,with_aliases=True)


@router.post('/api/quotations/{qid}/calculate')
@router.post('/api/projects/{pid}/quotation/calculate')
def calculate_quote(body:PriceInput,db:DbSession=Depends(session),scope:tuple=Depends(quote_scope)):
    pid,standalone=scope
    if db.get(StandaloneQuotation if standalone else Project,pid) is None:raise HTTPException(404,'КП или проект не найден')
    return {'client':totals(body,'client'),'partner':totals(body,'partner')}


@router.post('/api/quotations/{qid}/preview')
@router.post('/api/projects/{pid}/quotation/preview')
def preview_quote(body:QuoteInput,db:DbSession=Depends(session),scope:tuple=Depends(quote_scope)):
    pid,standalone=scope
    get_quote(db,pid,standalone)
    if standalone: validate_standalone(body)
    from .quotation_grouping import merge_identical_lines
    merge_identical_lines(body)
    return present(body)


@router.post('/api/projects/{pid}/quotation/import')
def import_quote(pid:int,body:QuoteRevision,db:DbSession=Depends(session)):
    quote=check_revision(db,pid,body.revision)
    import_lines(db,pid,quote)
    persist_quote(db,pid,quote);db.commit()
    return present(quote)


class QuoteRoomLayout(QuoteRevision):
    layout:Literal['combined','rooms']


@router.post('/api/projects/{pid}/quotation/room-layout')
def change_room_layout(pid:int,body:QuoteRoomLayout,db:DbSession=Depends(session)):
    from .quotation_rooms import regroup_quote
    quote=check_revision(db,pid,body.revision)
    quote=regroup_quote(db,pid,quote,body.layout)
    persist_quote(db,pid,quote);db.commit()
    return present(quote)


@router.post('/api/quotations/{qid}/bind')
@router.post('/api/projects/{pid}/quotation/bind')
def bind_quote(body:QuoteBinding,db:DbSession=Depends(session),scope:tuple=Depends(quote_scope)):
    pid,standalone=scope
    quote=check_revision(db,pid,body.revision,standalone)
    if body.product_id is None:
        line=next((line for line in quote.lines if line.id==body.line_id),None)
        if line is None: raise HTTPException(404,'Строка КП не найдена')
        elements=[]
        for eid in line.source_ids:
            element=db.get(Element,eid)
            if element is None or element.project_id!=pid: raise HTTPException(409,'Позиции плана изменились')
            if db.get(Layer,element.layer_id).locked: raise HTTPException(409,'Слой позиции заблокирован')
            elements.append(element)
        if elements:
            from .main import remember_elements
            remember_elements(db,pid)
            for element in elements: element.product_id=None
        line.product_id=None
    else:
        product=db.get(Product,body.product_id)
        if product is None: raise HTTPException(404,'Товар не найден')
        bind_product(db,pid,quote,body.line_id,product)
    persist_quote(db,pid,quote,standalone);db.commit()
    return present(quote)


@router.post('/api/quotations/{qid}/product',status_code=201)
@router.post('/api/projects/{pid}/quotation/product',status_code=201)
def create_quote_product(body:QuoteProduct,db:DbSession=Depends(session),scope:tuple=Depends(quote_scope), _catalogue=Depends(catalogue_write_guard)):
    pid,standalone=scope
    quote=check_revision(db,pid,body.revision,standalone)
    line=next((line for line in quote.lines if line.id==body.line_id),None)
    if line is None: raise HTTPException(404,'Строка КП не найдена')
    typ=db.get(ElementType,body.type_id) if body.type_id else None
    if typ is None and body.type_id is None and line.source_key.startswith('frame:'):
        typ=db.scalar(select(ElementType).where(ElementType.category=='Рамки',ElementType.name==line.name,ElementType.unit=='шт').limit(1))
        if typ is None:
            typ=ElementType(category='Рамки',name=line.name,unit='шт',color='#64748b',defaults={'quantity':1},active=True)
            db.add(typ);db.flush()
    if typ is None or not typ.active: raise HTTPException(422,'Выберите действующую номенклатуру')
    name=body.name.strip();manufacturer_name=body.manufacturer.strip()
    if not name or not manufacturer_name: raise HTTPException(422,'Укажите название и производителя')
    manufacturer=resolve_manufacturer(db,manufacturer_name)
    try: validate_image(body.image)
    except ValueError as exc: raise HTTPException(422,exception_message(exc,'Не удалось прочитать данные файла. Проверьте его формат.')) from exc
    values=dict(type_id=typ.id,manufacturer_id=manufacturer.id,name=name,sku=body.sku.strip(),
        unit=typ.unit,price=float(body.unit_price),currency=body.currency,active=True)
    product=db.get(Product,body.existing_product_id) if body.existing_product_id else None
    if body.existing_product_id and product is None:raise HTTPException(404,'Товар не найден')
    if product is not None and (product.type_id!=typ.id or product.unit!=typ.unit) and product_is_used(db,product.id):
        raise HTTPException(409,'Тип и единица измерения используемого товара защищены')
    guard_product_duplicate(db,values,product,body.allow_duplicate)
    if product is None:
        product=Product(**values,parameters={'image':body.image} if body.image else {});db.add(product);db.flush()
    else:
        before=metadata(db,product)
        for key,value in values.items():setattr(product,key,value)
        product.parameters={**product.parameters,'image':body.image}
        # Persist this quote below using its existing revision; update other quotes separately.
        changes={product.id:(before,metadata(db,product))}
        synchronize_quote_metadata(quote,changes)
        propagate_metadata(db,changes,exclude=(pid,standalone))
    if line.product_id!=product.id:
        bind_product(db,pid,quote,body.line_id,product)
    persist_quote(db,pid,quote,standalone);db.commit()
    return present(quote)


@router.post('/api/quotations/{qid}/preview.pdf')
@router.post('/api/projects/{pid}/quotation/preview.pdf')
def preview_document(body:QuoteInput,mode:Literal['client','partner']='client',db:DbSession=Depends(session),scope:tuple=Depends(quote_scope)):
    pid,standalone=scope
    # Resolve access without creating or changing the saved quotation.
    if db.get(StandaloneQuotation if standalone else Project,pid) is None: raise HTTPException(404,"КП или проект не найден")
    if standalone: validate_standalone(body)
    else:sync_plan_quantities(db,pid,body)
    from .quotation_grouping import merge_identical_lines
    merge_identical_lines(body)
    from .quotation_prices import inherit_prices
    inherit_prices(body)
    from .quotation_cache import quotation_pdf
    return StreamingResponse(io.BytesIO(quotation_pdf(body,mode,scope)),media_type='application/pdf',
        headers={'Cache-Control':'no-store'})


@router.post('/api/quotations/{qid}/preview.png')
@router.post('/api/projects/{pid}/quotation/preview.png')
def preview_page(body:QuoteInput,mode:Literal['client','partner']='client',page:int=Query(default=1,ge=1),db:DbSession=Depends(session),scope:tuple=Depends(quote_scope)):
    pid,standalone=scope
    if db.get(StandaloneQuotation if standalone else Project,pid) is None: raise HTTPException(404,'КП или проект не найден')
    if standalone: validate_standalone(body)
    else:sync_plan_quantities(db,pid,body)
    from .quotation_grouping import merge_identical_lines
    merge_identical_lines(body)
    from .quotation_prices import inherit_prices
    inherit_prices(body)
    from .quotation_cache import quotation_page
    pages,image=quotation_page(body,mode,page,scope)
    return Response(image,media_type='image/png',headers={'X-Preview-Pages':str(pages),'Cache-Control':'no-store'})


class SkuLine(BaseModel):
    room:str=Field(default='',max_length=500)
    manufacturer:str=Field(default='',max_length=500)
    id:str=Field(min_length=1,max_length=80)
    name:str=Field(min_length=1,max_length=500)
    quantity:RussianDecimal=Field(gt=0,le=1000000,max_digits=10,decimal_places=3,allow_inf_nan=False)
    unit:Literal['шт','м']='шт'
    type_id:int|None=Field(default=None,gt=0)
    source_key:str=Field(default='',max_length=2000)
    source_signature:str=Field(default='',max_length=64)
    source_ids:list[int]=Field(default_factory=list,max_length=100000)
    quantity_override:RussianDecimal|None=Field(default=None,gt=0,le=1000000,max_digits=10,decimal_places=3,allow_inf_nan=False)


    @field_validator('name')
    @classmethod
    def named_position(cls,value):
        if not value.strip():raise ValueError('Укажите наименование позиции')
        return value


class SkuInput(BaseModel):
    plan_sync:bool|None=None
    plan_snapshot_ids:list[Annotated[int,Field(gt=0)]]|None=Field(default=None,max_length=100000)
    excluded_plan_ids:list[Annotated[int,Field(gt=0)]]=Field(default_factory=list,max_length=100000)
    room_layout:Literal['combined','rooms','legacy']|None=None
    number:str=Field(default='',max_length=100)
    lines:list[SkuLine]=Field(min_length=1,max_length=5000)


def sku_file(quote):
    from .sku_docx import export_sku
    if not quote.lines:raise HTTPException(422,'Добавьте позиции для выгрузки в Word')
    return StreamingResponse(io.BytesIO(export_sku(quote)),
        media_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        headers={'Content-Disposition':'attachment; filename="SKU.docx"','Cache-Control':'no-store'})


@router.get('/api/quotations/{qid}/sku.docx')
@router.get('/api/projects/{pid}/quotation/sku.docx')
def saved_sku(db:DbSession=Depends(session),scope:tuple=Depends(quote_scope)):
    pid,standalone=scope
    return sku_file(get_quote(db,pid,standalone))


@router.post('/api/quotations/{qid}/sku.docx')
@router.post('/api/projects/{pid}/quotation/sku.docx')
def draft_sku(body:SkuInput,db:DbSession=Depends(session),scope:tuple=Depends(quote_scope)):
    pid,standalone=scope
    if db.get(StandaloneQuotation if standalone else Project,pid) is None:raise HTTPException(404,'КП или проект не найден')
    # Build a price-free document: financial fields and images are never read.
    stored=db.get(StandaloneQuotation if standalone else Quotation,pid)
    layout=body.room_layout or (stored.content.get('room_layout','legacy') if stored else 'combined')
    quote=QuoteInput(number=body.number,room_layout=layout,plan_sync=body.plan_sync,plan_snapshot_ids=body.plan_snapshot_ids,excluded_plan_ids=body.excluded_plan_ids,lines=[QuoteLine.model_validate(line.model_dump()) for line in body.lines])
    if standalone:validate_standalone(quote)
    else:sync_plan_quantities(db,pid,quote,coalesce=False)
    return sku_file(quote)


@router.get('/api/quotations/{qid}/export.pdf')
@router.get('/api/projects/{pid}/quotation/export.pdf')
def export_quote(mode:Literal['client','partner']='client',db:DbSession=Depends(session),scope:tuple=Depends(quote_scope)):
    pid,standalone=scope
    from .quotation_cache import quotation_pdf
    quote=get_quote(db,pid,standalone)
    if not quote.lines: raise HTTPException(422,'Добавьте позиции в КП')
    document=quotation_pdf(quote,mode,scope)
    return StreamingResponse(io.BytesIO(document),media_type='application/pdf',
        headers={'Content-Disposition':f'attachment; filename="quotation-{pid}-{mode}.pdf"'})


def backup_quote(db,pid):
    stored=db.get(Quotation,pid)
    return get_quote(db,pid).model_dump(mode='json',exclude={'revision'}) if stored else None


def restore_quote(db,pid,payload,type_map,product_map,element_map):
    quote=QuoteInput.model_validate({'room_layout':'legacy',**payload,'revision':0})
    if quote.plan_snapshot_ids is not None:quote.plan_snapshot_ids=sorted({element_map[eid].id for eid in quote.plan_snapshot_ids if eid in element_map})
    quote.excluded_plan_ids=sorted({element_map[eid].id for eid in quote.excluded_plan_ids if eid in element_map})
    for line in quote.lines:
        # Partial project imports remap type/product IDs used in the signature.
        line.source_signature=''
        line.type_id=type_map[line.type_id].id if line.type_id is not None else None
        line.product_id=product_map[line.product_id].id if line.product_id is not None else None
        line.source_ids=[element_map[eid].id for eid in line.source_ids if eid in element_map]
        if line.source_key.startswith('elements:'):
            line.source_key=source_key({'element_ids':line.source_ids}) if line.source_ids else ''
    persist_quote(db,pid,quote)

@router.post('/api/quotations/{qid}/import-file')
@router.post('/api/projects/{pid}/quotation/import-file')
async def import_quote_file(file:UploadFile,db:DbSession=Depends(session),scope:tuple=Depends(quote_scope)):
    pid,standalone=scope
    from .quotation_import import parse_quote_file
    get_quote(db,pid,standalone)
    raw=await file.read(20*1024*1024+1)
    if len(raw)>20*1024*1024: raise HTTPException(413,'Файл больше 20 МБ')
    try: return parse_quote_file(raw,file.filename or '')
    except ValueError as exc: raise HTTPException(422,exception_message(exc,'Не удалось прочитать данные файла. Проверьте его формат.')) from exc
