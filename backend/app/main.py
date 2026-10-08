import io
import csv
import json
import math
import os
import uuid
from pathlib import Path
from contextlib import asynccontextmanager
from collections import defaultdict
import pymupdf
from fastapi import FastAPI, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession
from .db import session, Session
from .models import (
    Project, Page, Room, Layer, Element, ElementType, Manufacturer, Supplier,
    Product, Report,
)
from .catalog import LAYERS, seed

STORAGE = Path(os.getenv('STORAGE_DIR', 'storage')).resolve()
STORAGE.mkdir(parents=True, exist_ok=True)

PDF_FONT_CANDIDATES = [
    os.getenv('PDF_FONT_PATH'),
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/dejavu/DejaVuSans.ttf',
    'C:/Windows/Fonts/arial.ttf',
    '/Library/Fonts/Arial Unicode.ttf',
]

def pdf_font_path():
    for candidate in PDF_FONT_CANDIDATES:
        if candidate and Path(candidate).is_file():
            return Path(candidate)
    raise HTTPException(
        500,
        'Не найден шрифт с поддержкой кириллицы. Укажите PDF_FONT_PATH.',
    )

@asynccontextmanager
async def lifespan(app):
    with Session() as db:
        seed(db)
    yield

app = FastAPI(title='Smart Home Calc', version='0.1.0', lifespan=lifespan)

def require(db, model, id):
    obj = db.get(model, id)
    if obj is None:
        raise HTTPException(404, 'Объект не найден')
    return obj

def data(obj):
    return {c.name: getattr(obj, c.name) for c in obj.__table__.columns if c.name not in ('pdf_path','image_path')}

class NameInput(BaseModel):
    name: str = Field(min_length=1, max_length=200)

class RoomInput(NameInput):
    wet: bool = False

class LayerInput(BaseModel):
    visible: bool | None = None
    locked: bool | None = None
    export: bool | None = None

class PageInput(BaseModel):
    name: str | None = Field(default=None, max_length=200)

class CalibrationInput(BaseModel):
    x1: float = Field(ge=0, le=1)
    y1: float = Field(ge=0, le=1)
    x2: float = Field(ge=0, le=1)
    y2: float = Field(ge=0, le=1)
    real_length_m: float = Field(gt=0, le=10000)

class TypeInput(NameInput):
    category: str = Field(min_length=1, max_length=200)
    unit: str = Field(default='шт', pattern='^(шт|м)$')
    color: str = Field(default='#38bdf8', pattern='^#[0-9a-fA-F]{6}$')
    defaults: dict = Field(default_factory=dict)
    wet_min_ip: int | None = Field(default=None, ge=0, le=69)

class ElementInput(BaseModel):
    page_id: int
    layer_id: int
    type_id: int
    product_id: int | None = None
    room_id: int | None = None
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    parameters: dict = Field(default_factory=dict)
    geometry: dict = Field(default_factory=dict)
    comment: str = Field(default='', max_length=2000)

class ManufacturerInput(NameInput):
    pass

class SupplierInput(NameInput):
    contact: str = Field(default='', max_length=500)

class ProductInput(NameInput):
    manufacturer_id: int
    supplier_id: int | None = None
    type_id: int
    sku: str = Field(default='', max_length=200)
    unit: str = Field(default='шт', pattern='^(шт|м)$')
    price: float = Field(default=0, ge=0, le=1000000000)
    currency: str = Field(default='RUB', pattern='^[A-Z]{3}$')
    active: bool = True
    parameters: dict = Field(default_factory=dict)

def catalog_product(db, product):
    row=data(product)
    row['manufacturer']=db.get(Manufacturer,product.manufacturer_id).name
    row['supplier']=db.get(Supplier,product.supplier_id).name if product.supplier_id else ''
    return row

def geometry_points(geometry):
    points = geometry.get('points', []) if isinstance(geometry, dict) else []
    if not isinstance(points, list) or len(points) > 1000:
        raise HTTPException(422, 'Некорректная геометрия')
    result=[]
    for point in points:
        if not isinstance(point, dict):
            raise HTTPException(422, 'Некорректная геометрия')
        try:
            x=float(point['x']); y=float(point['y'])
        except (KeyError,TypeError,ValueError):
            raise HTTPException(422, 'Некорректная геометрия')
        if not 0 <= x <= 1 or not 0 <= y <= 1:
            raise HTTPException(422, 'Координаты линии выходят за границы листа')
        result.append({'x':x,'y':y})
    return result

def validate_element(db, project_id, body):
    for model, id in [(Page,body.page_id),(Layer,body.layer_id),(Room,body.room_id)]:
        if id is not None:
            obj = require(db, model, id)
            if obj.project_id != project_id:
                raise HTTPException(422, 'Объект принадлежит другому проекту')
    layer = require(db,Layer,body.layer_id)
    if layer.locked:
        raise HTTPException(409, 'Слой заблокирован')
    typ = require(db,ElementType,body.type_id)
    if body.product_id is not None:
        product=require(db,Product,body.product_id)
        if product.type_id != typ.id or not product.active:
            raise HTTPException(422, 'Товар не соответствует типу элемента')
    parameters = {**typ.defaults, **body.parameters}
    points=geometry_points(body.geometry)
    if points:
        if len(points)<2:
            raise HTTPException(422, 'Для линии нужны минимум две точки')
        page=require(db,Page,body.page_id)
        if not page.meters_per_point:
            raise HTTPException(422, 'Сначала откалибруйте масштаб листа')
        length=0.0
        for first,second in zip(points,points[1:]):
            length += math.hypot(
                (second['x']-first['x'])*page.width,
                (second['y']-first['y'])*page.height,
            )*page.meters_per_point
        parameters['length']=round(length,3)
    for key in ('length','quantity','connectors','end_caps'):
        if key in parameters:
            try:
                value = float(parameters[key])
                if not 0 <= value <= 1000000 or (key in ('quantity','connectors','end_caps') and not value.is_integer()):
                    raise ValueError()
            except (ValueError,TypeError):
                raise HTTPException(422, f'Некорректный параметр: {key}')
    if 'ip' in parameters:
        try:
            if not 0 <= int(parameters['ip']) <= 69:
                raise ValueError()
        except (ValueError,TypeError):
            raise HTTPException(422,'Некорректная степень IP')
    return parameters

@app.get('/api/health')
def health(db: DbSession = Depends(session)):
    db.execute(select(1))
    return {'status':'ok'}

@app.get('/api/projects')
def projects(db: DbSession = Depends(session)):
    return [data(p) for p in db.scalars(select(Project).order_by(Project.id.desc()))]

@app.post('/api/projects', status_code=201)
def create_project(body: NameInput, db: DbSession = Depends(session)):
    p = Project(name=body.name)
    db.add(p); db.flush()
    for name in LAYERS:
        db.add(Layer(project_id=p.id,name=name))
    db.commit()
    return data(p)

@app.get('/api/types')
def types(db: DbSession = Depends(session)):
    return [data(t) for t in db.scalars(select(ElementType).order_by(ElementType.id))]

@app.post('/api/types',status_code=201)
def add_type(body: TypeInput, db: DbSession = Depends(session)):
    t=ElementType(**body.model_dump()); db.add(t); db.commit()
    return data(t)

@app.get('/api/catalog')
def catalog(db: DbSession = Depends(session)):
    manufacturers=[data(item) for item in db.scalars(select(Manufacturer).order_by(Manufacturer.name))]
    suppliers=[data(item) for item in db.scalars(select(Supplier).order_by(Supplier.name))]
    products=[]
    for product in db.scalars(select(Product).order_by(Product.name)):
        products.append(catalog_product(db,product))
    return {'manufacturers':manufacturers,'suppliers':suppliers,'products':products}

@app.post('/api/manufacturers',status_code=201)
def add_manufacturer(body: ManufacturerInput, db: DbSession = Depends(session)):
    item=Manufacturer(name=body.name); db.add(item); db.commit(); return data(item)

@app.put('/api/manufacturers/{item_id}')
def edit_manufacturer(item_id: int, body: ManufacturerInput, db: DbSession = Depends(session)):
    item=require(db,Manufacturer,item_id); item.name=body.name; db.commit(); return data(item)

@app.post('/api/suppliers',status_code=201)
def add_supplier(body: SupplierInput, db: DbSession = Depends(session)):
    item=Supplier(**body.model_dump()); db.add(item); db.commit(); return data(item)

@app.put('/api/suppliers/{item_id}')
def edit_supplier(item_id: int, body: SupplierInput, db: DbSession = Depends(session)):
    item=require(db,Supplier,item_id)
    for key,value in body.model_dump().items(): setattr(item,key,value)
    db.commit(); return data(item)

@app.post('/api/products',status_code=201)
def add_product(body: ProductInput, db: DbSession = Depends(session)):
    require(db,Manufacturer,body.manufacturer_id)
    typ=require(db,ElementType,body.type_id)
    if body.unit != typ.unit: raise HTTPException(422,'Единица товара должна совпадать с типом элемента')
    if body.supplier_id is not None: require(db,Supplier,body.supplier_id)
    item=Product(**body.model_dump()); db.add(item); db.commit(); return catalog_product(db,item)

@app.put('/api/products/{product_id}')
def edit_product(product_id: int, body: ProductInput, db: DbSession = Depends(session)):
    item=require(db,Product,product_id)
    require(db,Manufacturer,body.manufacturer_id)
    typ=require(db,ElementType,body.type_id)
    if body.unit != typ.unit: raise HTTPException(422,'Единица товара должна совпадать с типом элемента')
    if body.supplier_id is not None: require(db,Supplier,body.supplier_id)
    for key,value in body.model_dump().items(): setattr(item,key,value)
    db.commit(); return catalog_product(db,item)

@app.get('/api/catalog/import-template.csv')
def catalog_import_template():
    content=(
        '\ufeffname;sku;type;manufacturer;supplier;price;currency;active\n'
        'Розетка demo;DEMO-01;Розетка одинарная;Demo Factory;Demo Supply;1250.00;RUB;true\n'
    )
    return StreamingResponse(
        io.BytesIO(content.encode('utf-8')),media_type='text/csv; charset=utf-8',
        headers={'Content-Disposition':'attachment; filename="smart-calc-price-template.csv"'},
    )

@app.post('/api/catalog/import',status_code=201)
async def import_catalog(file: UploadFile, db: DbSession = Depends(session)):
    raw=await file.read(2_000_001)
    if len(raw)>2_000_000:
        raise HTTPException(413,'Прайс-лист больше 2 МБ')
    try:
        text=raw.decode('utf-8-sig')
    except UnicodeDecodeError:
        raise HTTPException(422,'CSV должен быть сохранён в UTF-8')
    try:
        dialect=csv.Sniffer().sniff(text[:4096],delimiters=',;\t')
        rows=list(csv.DictReader(io.StringIO(text),dialect=dialect))
    except csv.Error:
        raise HTTPException(422,'Не удалось распознать CSV')
    if not rows or len(rows)>5000:
        raise HTTPException(422,'CSV должен содержать от 1 до 5000 товаров')
    headers={str(header).strip().lower() for header in (rows[0].keys() if rows else []) if header}
    required={'name','type','manufacturer','price'}
    if not required.issubset(headers):
        raise HTTPException(422,'Обязательные столбцы: name, type, manufacturer, price')
    types_by_name={item.name.strip().casefold():item for item in db.scalars(select(ElementType))}
    manufacturers={item.name.strip().casefold():item for item in db.scalars(select(Manufacturer))}
    suppliers={item.name.strip().casefold():item for item in db.scalars(select(Supplier))}
    created=updated=0
    try:
        for index,source in enumerate(rows,2):
            row={str(key).strip().lower():str(value or '').strip() for key,value in source.items() if key}
            name=row.get('name',''); type_name=row.get('type',''); manufacturer_name=row.get('manufacturer','')
            if not name or not type_name or not manufacturer_name:
                raise ValueError(f'строка {index}: пустое обязательное поле')
            typ=types_by_name.get(type_name.casefold())
            if typ is None:
                raise ValueError(f'строка {index}: неизвестный тип «{type_name}»')
            manufacturer=manufacturers.get(manufacturer_name.casefold())
            if manufacturer is None:
                manufacturer=Manufacturer(name=manufacturer_name); db.add(manufacturer); db.flush()
                manufacturers[manufacturer_name.casefold()]=manufacturer
            supplier=None; supplier_name=row.get('supplier','')
            if supplier_name:
                supplier=suppliers.get(supplier_name.casefold())
                if supplier is None:
                    supplier=Supplier(name=supplier_name,contact=''); db.add(supplier); db.flush()
                    suppliers[supplier_name.casefold()]=supplier
            try:
                price=float(row.get('price','').replace(' ','').replace(',','.'))
            except ValueError:
                raise ValueError(f'строка {index}: некорректная цена')
            if not 0<=price<=1_000_000_000:
                raise ValueError(f'строка {index}: цена вне допустимого диапазона')
            currency=(row.get('currency') or 'RUB').upper()
            if len(currency)!=3 or not currency.isalpha():
                raise ValueError(f'строка {index}: валюта должна состоять из трёх букв')
            active_value=(row.get('active') or 'true').casefold()
            if active_value not in {'true','false','1','0','да','нет','yes','no'}:
                raise ValueError(f'строка {index}: active должен быть true или false')
            active=active_value in {'true','1','да','yes'}
            sku=row.get('sku','')
            query=select(Product).where(Product.manufacturer_id==manufacturer.id)
            query=query.where(Product.sku==sku) if sku else query.where(Product.type_id==typ.id,Product.name==name)
            product=db.scalar(query)
            values=dict(
                name=name,sku=sku,type_id=typ.id,manufacturer_id=manufacturer.id,
                supplier_id=supplier.id if supplier else None,unit=typ.unit,price=price,
                currency=currency,active=active,
            )
            if product:
                for key,value in values.items(): setattr(product,key,value)
                updated+=1
            else:
                db.add(Product(**values,parameters={})); created+=1
        db.commit()
    except ValueError as exc:
        db.rollback(); raise HTTPException(422,str(exc))
    return {'created':created,'updated':updated,'total':created+updated}

@app.get('/api/projects/{pid}')
def project(pid: int, db: DbSession = Depends(session)):
    p = data(require(db,Project,pid))
    for key, model in [('pages',Page),('rooms',Room),('layers',Layer),('elements',Element)]:
        p[key] = [data(x) for x in db.scalars(select(model).where(model.project_id==pid).order_by(model.id))]
    return p

@app.post('/api/projects/{pid}/rooms',status_code=201)
def add_room(pid: int, body: RoomInput, db: DbSession = Depends(session)):
    require(db,Project,pid)
    r=Room(project_id=pid,**body.model_dump()); db.add(r); db.commit()
    return data(r)

@app.post('/api/projects/{pid}/layers',status_code=201)
def add_layer(pid: int, body: NameInput, db: DbSession = Depends(session)):
    require(db,Project,pid)
    layer=Layer(project_id=pid,name=body.name); db.add(layer); db.commit()
    return data(layer)

@app.patch('/api/layers/{lid}')
def edit_layer(lid: int, body: LayerInput, db: DbSession = Depends(session)):
    layer=require(db,Layer,lid)
    for key,value in body.model_dump(exclude_none=True).items():
        setattr(layer,key,value)
    db.commit(); return data(layer)

@app.patch('/api/pages/{page_id}')
def edit_page(page_id: int, body: PageInput, db: DbSession = Depends(session)):
    page=require(db,Page,page_id)
    page.name=body.name.strip() if body.name and body.name.strip() else None
    db.commit(); return data(page)

@app.post('/api/pages/{page_id}/calibrate')
def calibrate_page(page_id: int, body: CalibrationInput, db: DbSession = Depends(session)):
    page=require(db,Page,page_id)
    distance=math.hypot((body.x2-body.x1)*page.width,(body.y2-body.y1)*page.height)
    if distance < 1:
        raise HTTPException(422,'Точки калибровки расположены слишком близко')
    page.meters_per_point=body.real_length_m/distance
    db.commit()
    result=data(page)
    result['calibration_length_m']=body.real_length_m
    return result

@app.post('/api/projects/{pid}/pdf',status_code=201)
async def upload(pid: int, file: UploadFile, db: DbSession = Depends(session)):
    require(db,Project,pid)
    content=await file.read(20*1024*1024+1)
    if len(content)>20*1024*1024:
        raise HTTPException(413,'Максимальный размер PDF — 20 МБ')
    paths=[]
    try:
        doc=pymupdf.open(stream=content,filetype='pdf')
        if doc.needs_pass or not 1<=len(doc)<=100:
            raise ValueError('Нужен PDF без пароля, от 1 до 100 страниц')
        token=uuid.uuid4().hex
        pdf=STORAGE/f'{token}.pdf'; pdf.write_bytes(content); paths.append(pdf)
        number=max((p.number for p in db.scalars(select(Page).where(Page.project_id==pid))),default=0)
        pages=[]
        for i, page in enumerate(doc):
            scale=min(1.5,2000/max(page.rect.width,page.rect.height))
            image=STORAGE/f'{token}-{i}.png'
            page.get_pixmap(matrix=pymupdf.Matrix(scale,scale)).save(image); paths.append(image)
            obj=Page(
                project_id=pid,number=number+i+1,name=None,source_index=i,
                meters_per_point=None,width=page.rect.width,height=page.rect.height,
                pdf_path=str(pdf),image_path=str(image),
            )
            db.add(obj); db.flush(); pages.append(data(obj))
        doc.close(); db.commit(); return pages
    except Exception as exc:
        db.rollback()
        for path in paths:
            path.unlink(missing_ok=True)
        raise HTTPException(422,'Не удалось прочитать PDF') from exc

@app.get('/api/pages/{page_id}/image')
def page_image(page_id: int, db: DbSession = Depends(session)):
    return FileResponse(require(db,Page,page_id).image_path,media_type='image/png')

@app.post('/api/projects/{pid}/elements',status_code=201)
def add_element(pid: int, body: ElementInput, db: DbSession = Depends(session)):
    require(db,Project,pid)
    values=body.model_dump(); values['parameters']=validate_element(db,pid,body)
    e=Element(project_id=pid,**values); db.add(e); db.commit(); return data(e)

@app.put('/api/elements/{eid}')
def edit_element(eid: int, body: ElementInput, db: DbSession = Depends(session)):
    e=require(db,Element,eid)
    if require(db,Layer,e.layer_id).locked:
        raise HTTPException(409,'Слой заблокирован')
    values=body.model_dump(); values['parameters']=validate_element(db,e.project_id,body)
    for key,value in values.items(): setattr(e,key,value)
    db.commit(); return data(e)

@app.delete('/api/elements/{eid}',status_code=204)
def remove_element(eid: int, db: DbSession = Depends(session)):
    e=require(db,Element,eid)
    if require(db,Layer,e.layer_id).locked:
        raise HTTPException(409,'Слой заблокирован')
    db.delete(e); db.commit()

def report_rows(db,pid):
    require(db,Project,pid)
    groups=defaultdict(float)
    warnings=[]
    for e,t,l in db.execute(select(Element,ElementType,Layer).join(ElementType,Element.type_id==ElementType.id).join(Layer,Element.layer_id==Layer.id).where(Element.project_id==pid)):
        if not l.export: continue
        room=db.get(Room,e.room_id) if e.room_id else None
        product=db.get(Product,e.product_id) if e.product_id else None
        manufacturer=db.get(Manufacturer,product.manufacturer_id) if product else None
        supplier=db.get(Supplier,product.supplier_id) if product and product.supplier_id else None
        group_parameters={k:v for k,v in e.parameters.items() if k not in ('length','quantity')}
        key=(
            room.name if room else 'Без помещения',t.category,t.name,t.unit,
            json.dumps(group_parameters,ensure_ascii=False,sort_keys=True),
            product.id if product else None,
            product.name if product else '', product.sku if product else '',
            manufacturer.name if manufacturer else '', supplier.name if supplier else '',
            float(product.price) if product else 0, product.currency if product else 'RUB',
        )
        groups[key]+=float(e.parameters.get('length',0) if t.unit=='м' else e.parameters.get('quantity',1))
        if room and room.wet and t.wet_min_ip and int(e.parameters.get('ip',0))<t.wet_min_ip:
            warnings.append(f'{room.name}: {t.name} №{e.id} — рекомендуется IP{t.wet_min_ip} или выше')
    rows=[]
    for key,value in sorted(groups.items(),key=lambda item:(item[0][0],item[0][1],item[0][2],item[0][6])):
        quantity=round(value,3); price=key[10]
        rows.append(dict(
            room=key[0],category=key[1],name=key[2],unit=key[3],
            parameters=key[4],product_id=key[5],product=key[6],sku=key[7],
            manufacturer=key[8],supplier=key[9],unit_price=price,
            currency=key[11],quantity=quantity,total=round(quantity*price,2),
        ))
    totals=defaultdict(float)
    for row in rows: totals[row['currency']]+=row['total']
    return {'rows':rows,'warnings':warnings,'totals':dict(totals)}

@app.get('/api/projects/{pid}/report')
def report(pid: int, db: DbSession = Depends(session)):
    return report_rows(db,pid)

@app.get('/api/projects/{pid}/pages/{page_id}/export.pdf')
def export_plan(pid: int, page_id: int, db: DbSession = Depends(session)):
    page=require(db,Page,page_id)
    if page.project_id != pid: raise HTTPException(422,'Лист принадлежит другому проекту')
    source=pymupdf.open(page.pdf_path)
    if page.source_index >= len(source):
        source.close(); raise HTTPException(500,'Исходная страница PDF не найдена')
    document=pymupdf.open(); document.insert_pdf(source,from_page=page.source_index,to_page=page.source_index)
    source.close(); sheet=document[0]
    sheet.insert_font(fontname='CalcPlan',fontfile=str(pdf_font_path()))
    query=(select(Element,ElementType,Layer).join(ElementType,Element.type_id==ElementType.id)
           .join(Layer,Element.layer_id==Layer.id).where(Element.page_id==page_id,Layer.export.is_(True)))
    for element,typ,layer in db.execute(query):
        color=tuple(int(typ.color[index:index+2],16)/255 for index in (1,3,5))
        points=geometry_points(element.geometry or {})
        if points:
            pdf_points=[pymupdf.Point(point['x']*page.width,point['y']*page.height) for point in points]
            sheet.draw_polyline(pdf_points,color=color,width=2)
            for point in pdf_points: sheet.draw_circle(point,3,color=color,fill=color)
            anchor=pdf_points[0]
        else:
            anchor=pymupdf.Point(element.x*page.width,element.y*page.height)
            sheet.draw_circle(anchor,5,color=color,fill=color)
        sheet.insert_text((anchor.x+7,anchor.y-4),f'{typ.name} #{element.id}',fontsize=7,fontname='CalcPlan',color=color)
    content=document.tobytes(deflate=True); document.close()
    return StreamingResponse(
        io.BytesIO(content),media_type='application/pdf',
        headers={'Content-Disposition':f'attachment; filename="plan-{pid}-{page_id}.pdf"'},
    )

@app.get('/api/projects/{pid}/export/{format}')
def export(pid: int, format: str, db: DbSession = Depends(session)):
    if format not in ('xlsx','pdf'): raise HTTPException(422,'Формат: xlsx или pdf')
    result=report_rows(db,pid)
    output=io.BytesIO()
    headers=['Помещение','Категория','Элемент','Товар','Артикул','Производитель','Поставщик','Количество','Ед.','Цена','Валюта','Сумма','Параметры']
    rows=[[
        r['room'],r['category'],r['name'],r['product'],r['sku'],r['manufacturer'],
        r['supplier'],r['quantity'],r['unit'],r['unit_price'],r['currency'],r['total'],r['parameters'],
    ] for r in result['rows']]
    if format=='xlsx':
        from openpyxl import Workbook
        from openpyxl.styles import Font
        wb=Workbook(); wb.remove(wb.active)
        def safe(value):
            return "'"+value if isinstance(value,str) and value.startswith(('=','+','-','@')) else value
        def add_sheet(name,selected_rows):
            ws=wb.create_sheet(name[:31]); ws.append(headers)
            for cell in ws[1]: cell.font=Font(bold=True)
            for row in selected_rows: ws.append([safe(value) for value in row])
            ws.freeze_panes='A2'; ws.auto_filter.ref=ws.dimensions
            widths=[22,20,27,27,16,20,20,12,8,13,10,13,55]
            for index,width in enumerate(widths,1): ws.column_dimensions[chr(64+index)].width=width
            return ws
        add_sheet('Общая ведомость',rows)
        for category in sorted({r['category'] for r in result['rows']}):
            add_sheet(category,[row for row,item in zip(rows,result['rows']) if item['category']==category])
        add_sheet('По помещениям',sorted(rows,key=lambda row:(row[0],row[1],row[2])))
        totals=wb.create_sheet('Итоги')
        totals.append(['Валюта','Сумма'])
        for currency,total in result['totals'].items(): totals.append([currency,total])
        notes=wb.create_sheet('Проверки IP')
        for warning in result['warnings']:
            notes.append([safe(warning)])
        wb.save(output)
        media='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    else:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
        from reportlab.lib.styles import ParagraphStyle
        from xml.sax.saxutils import escape
        font=pdf_font_path()
        pdfmetrics.registerFont(TTFont('Calc',str(font)))
        style=ParagraphStyle('Calc',fontName='Calc',fontSize=9,leading=14)
        title=ParagraphStyle('Title',parent=style,fontSize=15,leading=19,spaceAfter=12)
        heading=ParagraphStyle('Heading',parent=style,fontSize=12,leading=16,spaceBefore=12,spaceAfter=6)
        story=[Paragraph(escape(require(db,Project,pid).name),title)]
        for category in sorted({r['category'] for r in result['rows']}):
            story.append(Paragraph(escape(category),heading))
            for r in (item for item in result['rows'] if item['category']==category):
                product=f" · {r['manufacturer']} {r['product']} {r['sku']}" if r['product'] else ''
                price=f" · {r['total']:.2f} {r['currency']}" if r['unit_price'] else ''
                story.append(Paragraph(escape(f"{r['room']} · {r['name']}{product}: {r['quantity']} {r['unit']}{price} | {r['parameters']}"),style))
                story.append(Spacer(1,6))
        if result['totals']:
            story.append(Paragraph('Итоги',heading))
            for currency,total in result['totals'].items(): story.append(Paragraph(escape(f'{total:.2f} {currency}'),style))
        for warning in result['warnings']: story.append(Paragraph(escape(warning),style))
        SimpleDocTemplate(output).build(story); media='application/pdf'
    db.add(Report(project_id=pid,format=format)); db.commit()
    output.seek(0)
    return StreamingResponse(output,media_type=media,headers={'Content-Disposition':f'attachment; filename="smart-home-{pid}.{format}"'})
