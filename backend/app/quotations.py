"""Saved quotations, catalogue binding and exact decimal price calculations."""
import copy
import base64
import hashlib
import io
import uuid
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, UploadFile, Request
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession
from .db import session
from .models import Project, Quotation, StandaloneQuotation, Element, ElementType, Product, Manufacturer, Layer

router=APIRouter()
CENT=Decimal('0.01')


def money(value):
    return Decimal(str(value)).quantize(CENT,rounding=ROUND_HALF_UP)


class QuoteLine(BaseModel):
    model_config=ConfigDict(validate_default=True)
    id: str = Field(min_length=1,max_length=80)
    source_key: str = Field(default='',max_length=2000)
    source_ids: list[int] = Field(default_factory=list,max_length=100000)
    type_id: int | None = Field(default=None,gt=0)
    product_id: int | None = Field(default=None,gt=0)
    name: str = Field(min_length=1,max_length=500)
    sku: str = Field(default='',max_length=200)
    manufacturer: str = Field(default='',max_length=500)
    room: str = Field(default='',max_length=500)
    description: str = Field(default='',max_length=2000)
    quantity: Decimal = Field(default=1,gt=0,le=1000000,max_digits=10,decimal_places=3,allow_inf_nan=False)
    quantity_override: Decimal | None = Field(default=None,gt=0,le=1000000,max_digits=10,decimal_places=3,allow_inf_nan=False)
    calculated_quantity: Decimal | None = Field(default=None,gt=0,le=1000000,max_digits=10,decimal_places=3,allow_inf_nan=False)
    overrides: list[Literal['name','sku','manufacturer','room','description','unit_price','currency','image']] = Field(default_factory=list,max_length=8)
    unit: Literal['шт','м'] = 'шт'
    unit_price: Decimal = Field(default=0,ge=0,le=1000000000,max_digits=12,decimal_places=2,allow_inf_nan=False)
    currency: str = Field(default='RUB',pattern='^[A-Z]{3}$')
    image: str = Field(default='',max_length=300000)
    discount: Decimal | None = Field(default=None,ge=0,le=100,max_digits=5,decimal_places=2,allow_inf_nan=False)

    @model_validator(mode='after')
    def manual_quantity(self):
        if self.source_key and self.quantity_override is not None: self.quantity=self.quantity_override
        if not self.source_key:
            self.quantity_override=None;self.calculated_quantity=None;self.overrides=[]
        return self


class Benefit(BaseModel):
    title: str = Field(max_length=80)
    text: str = Field(default='',max_length=160)


def validate_image(value):
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


class QuoteInput(BaseModel):
    model_config=ConfigDict(validate_default=True)
    revision: int = Field(default=0,ge=0)
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
    global_discount: Decimal = Field(default=0,ge=0,le=100,max_digits=5,decimal_places=2,allow_inf_nan=False)
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
    line_id: str
    type_id: int | None = Field(default=None,gt=0)
    image: str = Field(default='',max_length=300000)
    name: str = Field(min_length=1,max_length=500)
    manufacturer: str = Field(min_length=1,max_length=500)
    sku: str = Field(default='',max_length=200)
    unit_price: Decimal = Field(ge=0,le=1000000000,decimal_places=2,allow_inf_nan=False)
    currency: str = Field(default='RUB',pattern='^[A-Z]{3}$')


def require_project(db,pid):
    project=db.get(Project,pid)
    if project is None: raise HTTPException(404,'Проект не найден')
    return project


def get_quote(db,pid,standalone=False):
    if standalone:
        stored=db.get(StandaloneQuotation,pid)
        if stored is None: raise HTTPException(404,'Самостоятельное КП не найдено')
        return QuoteInput.model_validate({**stored.content,'revision':stored.revision})
    project=require_project(db,pid)
    stored=db.get(Quotation,pid)
    if stored is None:
        return QuoteInput(number=str(pid),title='Коммерческое предложение',customer=project.name)
    return QuoteInput.model_validate({**stored.content,'revision':stored.revision})


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


def present(quote):
    return {**quote.model_dump(mode='json'),'client':totals(quote,'client'),'partner':totals(quote,'partner')}


def product_snapshot(db,line,product):
    line.product_id=product.id
    line.type_id=product.type_id
    line.name=product.name;line.sku=product.sku
    line.manufacturer=db.get(Manufacturer,product.manufacturer_id).name
    line.unit_price=money(product.price);line.currency=product.currency
    image=product.parameters.get('image','')
    if not isinstance(image,str): image=''
    try: validate_image(image)
    except (TypeError,ValueError): image=''
    line.image=image
    description=product.parameters.get('description','')
    if isinstance(description,str) and description.strip():
        line.description='\n'.join(dict.fromkeys(filter(None,[line.description,description.strip()])))[:2000]


def source_key(row):
    if row.get('element_ids'): return 'elements:'+hashlib.sha256(','.join(map(str,sorted(row['element_ids']))).encode()).hexdigest()
    return 'frame:'+row['room']+':'+row['name']


def import_lines(db,pid,quote):
    from .main import report_rows
    from .report_export import parameters_text
    previous={line.source_key:line for line in quote.lines if line.source_key}
    used_ids=set()
    lines=[]
    calculated=[row for row in report_rows(db,pid)['rows'] if row['quantity']>0]
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
                fields=set(field for candidate in matches for field in candidate.overrides)
                if fields:
                    if any(any(getattr(candidate,field)!=getattr(matches[0],field) for candidate in matches[1:]) for field in fields):
                        raise HTTPException(409,'Объединяются строки с разными ручными правками. Укажите одинаковые значения в этих строках перед обновлением: '+row['name'][:100])
                    old=matches[0].model_copy(deep=True)
                    old.overrides=sorted(fields)
        line_id=old.id if old is not None and old.id not in used_ids else uuid.uuid4().hex
        used_ids.add(line_id)
        line=QuoteLine(id=line_id,source_key=key,
            source_ids=row.get('element_ids',[]),type_id=row.get('type_id'),
            name=row['product'] or row['name'],room=row['room'],
            quantity=str(row['quantity']),calculated_quantity=str(row['quantity']),quantity_override=old.quantity_override if old else None,overrides=old.overrides if old else [],unit=row['unit'],unit_price=str(money(row['unit_price'])),
            product_id=row['product_id'],sku=row['sku'],manufacturer=row['manufacturer'],
            description=parameters_text(row['parameters'])[:2000],currency=row['currency'],
            discount=old.discount if old else None)
        if row['product_id']:
            product_snapshot(db,line,db.get(Product,row['product_id']))
        elif old:
            # Keep manually entered prices and a product chosen for a calculated frame.
            for field in ('product_id','name','sku','manufacturer','unit_price','currency','type_id','image'):
                setattr(line,field,getattr(old,field))
        if row.get('custom_name'): line.name=row['name']
        if old:
            for field in old.overrides: setattr(line,field,getattr(old,field))
        lines.append(line)
    lines.extend(line for line in quote.lines if not line.source_key)
    if len(lines)>5000: raise HTTPException(422,'В КП больше 5000 строк')
    quote.lines=lines
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
    line.overrides=[]
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
    return present(body)


@router.post('/api/quotations/{qid}/preview')
@router.post('/api/projects/{pid}/quotation/preview')
def preview_quote(body:QuoteInput,db:DbSession=Depends(session),scope:tuple=Depends(quote_scope)):
    pid,standalone=scope
    get_quote(db,pid,standalone)
    if standalone: validate_standalone(body)
    return present(body)


@router.post('/api/projects/{pid}/quotation/import')
def import_quote(pid:int,body:QuoteRevision,db:DbSession=Depends(session)):
    quote=check_revision(db,pid,body.revision)
    import_lines(db,pid,quote)
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
def create_quote_product(body:QuoteProduct,db:DbSession=Depends(session),scope:tuple=Depends(quote_scope)):
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
    manufacturer=db.scalar(select(Manufacturer).where(Manufacturer.name==manufacturer_name).limit(1))
    if manufacturer is None:
        manufacturer=Manufacturer(name=manufacturer_name);db.add(manufacturer);db.flush()
    try: validate_image(body.image)
    except ValueError as exc: raise HTTPException(422,str(exc)) from exc
    product=Product(type_id=typ.id,manufacturer_id=manufacturer.id,name=name,sku=body.sku,
        unit=typ.unit,price=float(body.unit_price),currency=body.currency,active=True,parameters={'image':body.image} if body.image else {})
    db.add(product);db.flush()
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
    from .quotation_pdf import export_quotation
    return StreamingResponse(io.BytesIO(export_quotation(body,mode)),media_type='application/pdf',
        headers={'Cache-Control':'no-store'})


@router.post('/api/quotations/{qid}/preview.png')
@router.post('/api/projects/{pid}/quotation/preview.png')
def preview_page(body:QuoteInput,mode:Literal['client','partner']='client',page:int=1,db:DbSession=Depends(session),scope:tuple=Depends(quote_scope)):
    pid,standalone=scope
    if db.get(StandaloneQuotation if standalone else Project,pid) is None: raise HTTPException(404,'КП или проект не найден')
    if standalone: validate_standalone(body)
    import pymupdf
    from .quotation_pdf import export_quotation
    with pymupdf.open(stream=export_quotation(body,mode),filetype='pdf') as pdf:
        if page<1 or page>len(pdf): raise HTTPException(422,'Страница вне диапазона')
        image=pdf[page-1].get_pixmap(matrix=pymupdf.Matrix(2,2),alpha=False).tobytes('png')
        return Response(image,media_type='image/png',headers={'X-Preview-Pages':str(len(pdf)),'Cache-Control':'no-store'})


@router.get('/api/quotations/{qid}/export.pdf')
@router.get('/api/projects/{pid}/quotation/export.pdf')
def export_quote(mode:Literal['client','partner']='client',db:DbSession=Depends(session),scope:tuple=Depends(quote_scope)):
    pid,standalone=scope
    from .quotation_pdf import export_quotation
    quote=get_quote(db,pid,standalone)
    if not quote.lines: raise HTTPException(422,'Добавьте позиции в КП')
    document=export_quotation(quote,mode)
    return StreamingResponse(io.BytesIO(document),media_type='application/pdf',
        headers={'Content-Disposition':f'attachment; filename="quotation-{pid}-{mode}.pdf"'})


def backup_quote(db,pid):
    stored=db.get(Quotation,pid)
    return copy.deepcopy(stored.content) if stored else None


def restore_quote(db,pid,payload,type_map,product_map,element_map):
    quote=QuoteInput.model_validate({**payload,'revision':0})
    for line in quote.lines:
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
    except ValueError as exc: raise HTTPException(422,str(exc)) from exc
