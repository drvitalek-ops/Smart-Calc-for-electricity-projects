import io
import csv
import json
import math
import os
import sys
import uuid
import zipfile
from pathlib import Path
from typing import Literal
from contextlib import asynccontextmanager
from collections import defaultdict
import pymupdf
from fastapi import FastAPI, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session as DbSession
from .db import Base, engine, session, Session
from .models import (
    Project, Page, Room, Layer, Element, ElementType, Manufacturer, Supplier,
    Product, Report,
)
from .catalog import LAYERS, seed

STORAGE = Path(os.getenv('STORAGE_DIR', 'storage')).resolve()
STORAGE.mkdir(parents=True, exist_ok=True)
PDF_MAX_MB = 500
PDF_MAX_BYTES = PDF_MAX_MB * 1024 * 1024
UPLOAD_CHUNK_BYTES = 1024 * 1024

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
    if os.getenv('AUTO_CREATE_SCHEMA') == '1':
        Base.metadata.create_all(engine)
        if 'opacity' not in {column['name'] for column in inspect(engine).get_columns('layers')}:
            with engine.begin() as connection:
                connection.execute(text('ALTER TABLE layers ADD COLUMN opacity FLOAT NOT NULL DEFAULT 1'))
        page_columns={column['name'] for column in inspect(engine).get_columns('pages')}
        page_upgrades={
            'overlay_visible':'BOOLEAN NOT NULL DEFAULT 0',
            'opacity':'FLOAT NOT NULL DEFAULT 1',
            'offset_x':'FLOAT NOT NULL DEFAULT 0',
            'offset_y':'FLOAT NOT NULL DEFAULT 0',
            'scale':'FLOAT NOT NULL DEFAULT 1',
        }
        with engine.begin() as connection:
            for column,definition in page_upgrades.items():
                if column not in page_columns:
                    connection.execute(text(f'ALTER TABLE pages ADD COLUMN {column} {definition}'))
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
    opacity: float | None = Field(default=None, ge=0.05, le=1)

class PageInput(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    overlay_visible: bool | None = None
    opacity: float | None = Field(default=None, ge=0.05, le=1)
    offset_x: float | None = Field(default=None, ge=-1, le=1)
    offset_y: float | None = Field(default=None, ge=-1, le=1)
    scale: float | None = Field(default=None, ge=0.5, le=2)

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

class BackupLayer(BaseModel):
    backup_id: int
    name: str = Field(min_length=1,max_length=200)
    visible: bool
    locked: bool
    export: bool
    opacity: float = Field(default=1, ge=0.05, le=1)

class FrameAssignment(BaseModel):
    element_ids: list[int] = Field(min_length=1, max_length=100)
    posts: int = Field(ge=1, le=6)

class ElementSelection(BaseModel):
    element_ids: list[int] = Field(min_length=1, max_length=100)

class BackupRoom(BaseModel):
    backup_id: int
    name: str = Field(min_length=1,max_length=200)
    wet: bool

class BackupType(BaseModel):
    backup_id: int
    name: str = Field(min_length=1,max_length=200)
    category: str = Field(min_length=1,max_length=200)
    unit: str = Field(pattern='^(шт|м)$')
    color: str = Field(pattern='^#[0-9a-fA-F]{6}$')
    defaults: dict
    wet_min_ip: int | None = Field(default=None,ge=0,le=69)

class BackupProduct(BaseModel):
    backup_id: int
    type_backup_id: int
    name: str = Field(min_length=1,max_length=500)
    sku: str = Field(max_length=200)
    manufacturer: str = Field(min_length=1,max_length=500)
    supplier: str = Field(default='',max_length=500)
    supplier_contact: str = Field(default='',max_length=500)
    unit: str = Field(pattern='^(шт|м)$')
    price: float = Field(ge=0,le=1_000_000_000)
    currency: str = Field(pattern='^[A-Z]{3}$')
    active: bool
    parameters: dict

class BackupPage(BaseModel):
    backup_id: int
    number: int = Field(ge=1,le=10000)
    name: str | None = Field(default=None,max_length=200)
    source_index: int = Field(ge=0,le=999)
    meters_per_point: float | None = Field(default=None,gt=0,le=10000)
    overlay_visible: bool = False
    opacity: float = Field(default=1,ge=0.05,le=1)
    offset_x: float = Field(default=0,ge=-1,le=1)
    offset_y: float = Field(default=0,ge=-1,le=1)
    scale: float = Field(default=1,ge=0.5,le=2)
    pdf_file: str = Field(min_length=5,max_length=200)

class BackupElement(BaseModel):
    page_backup_id: int
    layer_backup_id: int
    type_backup_id: int
    product_backup_id: int | None = None
    room_backup_id: int | None = None
    x: float = Field(ge=0,le=1)
    y: float = Field(ge=0,le=1)
    parameters: dict
    geometry: dict
    comment: str = Field(default='',max_length=2000)

class BackupManifest(BaseModel):
    version: Literal[1]
    project_name: str = Field(min_length=1,max_length=200)
    layers: list[BackupLayer] = Field(max_length=500)
    rooms: list[BackupRoom] = Field(max_length=5000)
    types: list[BackupType] = Field(max_length=5000)
    products: list[BackupProduct] = Field(max_length=10000)
    pages: list[BackupPage] = Field(max_length=1000)
    elements: list[BackupElement] = Field(max_length=100000)

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
    for key in ('length','quantity','connectors','end_caps','frame_posts'):
        if key in parameters:
            try:
                value = float(parameters[key])
                if not 0 <= value <= 1000000 or (key in ('quantity','connectors','end_caps','frame_posts') and not value.is_integer()):
                    raise ValueError()
                if key == 'frame_posts' and not 1 <= value <= 6:
                    raise ValueError()
            except (ValueError,TypeError):
                raise HTTPException(422, f'Некорректный параметр: {key}')
    if 'ip' in parameters:
        try:
            if not 0 <= int(parameters['ip']) <= 69:
                raise ValueError()
        except (ValueError,TypeError):
            raise HTTPException(422,'Некорректная степень IP')
    if 'plan_icon' in parameters and (not isinstance(parameters['plan_icon'],str) or len(parameters['plan_icon'])>4):
        raise HTTPException(422,'Иконка на плане должна содержать не более 4 символов')
    if 'frame_group' in parameters and (not isinstance(parameters['frame_group'],str) or len(parameters['frame_group'])>64):
        raise HTTPException(422,'Некорректная группа рамки')
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

@app.get('/api/projects/{pid}/backup')
def backup_project(pid: int, db: DbSession = Depends(session)):
    project=require(db,Project,pid)
    pages=list(db.scalars(select(Page).where(Page.project_id==pid).order_by(Page.id)))
    rooms=list(db.scalars(select(Room).where(Room.project_id==pid).order_by(Room.id)))
    layers=list(db.scalars(select(Layer).where(Layer.project_id==pid).order_by(Layer.id)))
    elements=list(db.scalars(select(Element).where(Element.project_id==pid).order_by(Element.id)))
    type_ids={item.type_id for item in elements}
    product_ids={item.product_id for item in elements if item.product_id is not None}
    types=[require(db,ElementType,item_id) for item_id in sorted(type_ids)]
    products=[require(db,Product,item_id) for item_id in sorted(product_ids)]
    pdf_files={}
    total_size=0
    for page in pages:
        path=Path(page.pdf_path)
        if not path.is_file():
            raise HTTPException(500,f'Исходный PDF листа {page.number} не найден')
        if str(path) not in pdf_files:
            total_size+=path.stat().st_size
            if total_size>90*1024*1024:
                raise HTTPException(413,'Суммарный размер PDF проекта превышает 90 МБ')
            pdf_files[str(path)]=f'pdf/{len(pdf_files)+1}.pdf'
    manifest=BackupManifest(
        version=1,project_name=project.name,
        layers=[BackupLayer(backup_id=item.id,name=item.name,visible=item.visible,locked=item.locked,export=item.export,opacity=item.opacity) for item in layers],
        rooms=[BackupRoom(backup_id=item.id,name=item.name,wet=item.wet) for item in rooms],
        types=[BackupType(backup_id=item.id,name=item.name,category=item.category,unit=item.unit,color=item.color,defaults=item.defaults,wet_min_ip=item.wet_min_ip) for item in types],
        products=[BackupProduct(
            backup_id=item.id,type_backup_id=item.type_id,name=item.name,sku=item.sku,
            manufacturer=require(db,Manufacturer,item.manufacturer_id).name,
            supplier=require(db,Supplier,item.supplier_id).name if item.supplier_id else '',
            supplier_contact=require(db,Supplier,item.supplier_id).contact if item.supplier_id else '',
            unit=item.unit,price=item.price,currency=item.currency,active=item.active,parameters=item.parameters,
        ) for item in products],
        pages=[BackupPage(
            backup_id=item.id,number=item.number,name=item.name,source_index=item.source_index,
            meters_per_point=item.meters_per_point,overlay_visible=item.overlay_visible,
            opacity=item.opacity,offset_x=item.offset_x,offset_y=item.offset_y,scale=item.scale,
            pdf_file=pdf_files[item.pdf_path],
        ) for item in pages],
        elements=[BackupElement(
            page_backup_id=item.page_id,layer_backup_id=item.layer_id,type_backup_id=item.type_id,
            product_backup_id=item.product_id,room_backup_id=item.room_id,x=item.x,y=item.y,
            parameters=item.parameters,geometry=item.geometry or {},comment=item.comment,
        ) for item in elements],
    )
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
        archive.writestr('manifest.json',manifest.model_dump_json(indent=2))
        for source,name in pdf_files.items(): archive.write(source,name)
    output.seek(0)
    return StreamingResponse(
        output,media_type='application/zip',
        headers={'Content-Disposition':f'attachment; filename="smart-home-calc-project-{pid}.zip"'},
    )

def backup_id_map(items):
    result={}
    for item in items:
        if item.backup_id in result:
            raise ValueError('Повторяющийся идентификатор в manifest.json')
        result[item.backup_id]=item
    return result

@app.post('/api/projects/import',status_code=201)
async def restore_project(file: UploadFile, db: DbSession = Depends(session)):
    raw=await file.read(100*1024*1024+1)
    if len(raw)>100*1024*1024:
        raise HTTPException(413,'Архив резервной копии больше 100 МБ')
    try:
        archive=zipfile.ZipFile(io.BytesIO(raw))
        infos=archive.infolist()
        names=[item.filename for item in infos]
        if len(names)!=len(set(names)) or len(names)>1100:
            raise ValueError('Некорректный список файлов архива')
        if any(item.flag_bits&1 for item in infos):
            raise ValueError('Зашифрованные архивы не поддерживаются')
        if any(Path(name).is_absolute() or '..' in Path(name).parts for name in names):
            raise ValueError('Некорректный путь внутри архива')
        if sum(item.file_size for item in infos)>250*1024*1024:
            raise ValueError('Распакованный архив больше 250 МБ')
        manifest_info=archive.getinfo('manifest.json')
        if manifest_info.file_size>5*1024*1024:
            raise ValueError('manifest.json больше 5 МБ')
        manifest=BackupManifest.model_validate_json(archive.read(manifest_info))
        page_specs=backup_id_map(manifest.pages)
        layer_specs=backup_id_map(manifest.layers)
        room_specs=backup_id_map(manifest.rooms)
        type_specs=backup_id_map(manifest.types)
        product_specs=backup_id_map(manifest.products)
        pdf_names={item.pdf_file for item in manifest.pages}
        if any(name not in names or not name.startswith('pdf/') or not name.endswith('.pdf') for name in pdf_names):
            raise ValueError('В архиве отсутствует PDF из manifest.json')
        pdf_contents={}
        for name in pdf_names:
            info=archive.getinfo(name)
            if info.file_size>20*1024*1024:
                raise ValueError(f'PDF {name} больше 20 МБ')
            content=archive.read(info)
            document=pymupdf.open(stream=content,filetype='pdf')
            try:
                if document.needs_pass or not 1<=len(document)<=100:
                    raise ValueError(f'Некорректный PDF {name}')
                for page in manifest.pages:
                    if page.pdf_file==name and page.source_index>=len(document):
                        raise ValueError(f'В PDF {name} отсутствует страница {page.source_index+1}')
            finally:
                document.close()
            pdf_contents[name]=content
        for element in manifest.elements:
            if element.page_backup_id not in page_specs or element.layer_backup_id not in layer_specs or element.type_backup_id not in type_specs:
                raise ValueError('Объект ссылается на отсутствующий лист, слой или тип')
            if element.room_backup_id is not None and element.room_backup_id not in room_specs:
                raise ValueError('Объект ссылается на отсутствующее помещение')
            if element.product_backup_id is not None and element.product_backup_id not in product_specs:
                raise ValueError('Объект ссылается на отсутствующий товар')
            points=geometry_points(element.geometry)
            if points and not page_specs[element.page_backup_id].meters_per_point:
                raise ValueError('Для линейного объекта отсутствует масштаб листа')
        if any(product.type_backup_id not in type_specs for product in manifest.products):
            raise ValueError('Товар ссылается на отсутствующий тип')
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(422,f'Некорректная резервная копия: {exc}') from exc
    finally:
        if 'archive' in locals(): archive.close()
    paths=[]
    try:
        project=Project(name=manifest.project_name); db.add(project); db.flush()
        layer_map={}
        for item in manifest.layers:
            obj=Layer(project_id=project.id,name=item.name,visible=item.visible,locked=item.locked,export=item.export,opacity=item.opacity)
            db.add(obj); db.flush(); layer_map[item.backup_id]=obj
        room_map={}
        for item in manifest.rooms:
            obj=Room(project_id=project.id,name=item.name,wet=item.wet)
            db.add(obj); db.flush(); room_map[item.backup_id]=obj
        type_map={}
        for item in manifest.types:
            candidates=db.scalars(select(ElementType).where(ElementType.name==item.name,ElementType.category==item.category,ElementType.unit==item.unit))
            obj=next((candidate for candidate in candidates if candidate.color==item.color and candidate.defaults==item.defaults and candidate.wet_min_ip==item.wet_min_ip),None)
            if obj is None:
                obj=ElementType(name=item.name,category=item.category,unit=item.unit,color=item.color,defaults=item.defaults,wet_min_ip=item.wet_min_ip)
                db.add(obj); db.flush()
            type_map[item.backup_id]=obj
        product_map={}
        for item in manifest.products:
            manufacturer=db.scalar(select(Manufacturer).where(Manufacturer.name==item.manufacturer).limit(1))
            if manufacturer is None:
                manufacturer=Manufacturer(name=item.manufacturer); db.add(manufacturer); db.flush()
            supplier=None
            if item.supplier:
                supplier=db.scalar(select(Supplier).where(Supplier.name==item.supplier).limit(1))
                if supplier is None:
                    supplier=Supplier(name=item.supplier,contact=item.supplier_contact); db.add(supplier); db.flush()
            typ=type_map[item.type_backup_id]
            candidates=db.scalars(select(Product).where(Product.manufacturer_id==manufacturer.id,Product.type_id==typ.id,Product.name==item.name))
            obj=next((candidate for candidate in candidates if candidate.sku==item.sku and candidate.supplier_id==(supplier.id if supplier else None) and candidate.price==item.price and candidate.currency==item.currency and candidate.active==item.active and candidate.parameters==item.parameters),None)
            if obj is None:
                obj=Product(
                    manufacturer_id=manufacturer.id,supplier_id=supplier.id if supplier else None,type_id=typ.id,
                    name=item.name,sku=item.sku,unit=item.unit,price=item.price,currency=item.currency,
                    active=item.active,parameters=item.parameters,
                ); db.add(obj); db.flush()
            product_map[item.backup_id]=obj
        stored_pdfs={}
        for name,content in pdf_contents.items():
            path=STORAGE/f'{uuid.uuid4().hex}.pdf'; path.write_bytes(content); paths.append(path); stored_pdfs[name]=path
        page_map={}
        for item in sorted(manifest.pages,key=lambda value:(value.number,value.backup_id)):
            document=pymupdf.open(stream=pdf_contents[item.pdf_file],filetype='pdf')
            source=document[item.source_index]
            token=uuid.uuid4().hex; image=STORAGE/f'{token}.png'
            scale=min(1.5,2000/max(source.rect.width,source.rect.height))
            source.get_pixmap(matrix=pymupdf.Matrix(scale,scale)).save(image); paths.append(image)
            obj=Page(
                project_id=project.id,number=item.number,name=item.name,source_index=item.source_index,
                meters_per_point=item.meters_per_point,width=source.rect.width,height=source.rect.height,
                overlay_visible=item.overlay_visible,opacity=item.opacity,
                offset_x=item.offset_x,offset_y=item.offset_y,scale=item.scale,
                pdf_path=str(stored_pdfs[item.pdf_file]),image_path=str(image),
            )
            document.close(); db.add(obj); db.flush(); page_map[item.backup_id]=obj
        for item in manifest.elements:
            product=product_map.get(item.product_backup_id) if item.product_backup_id is not None else None
            typ=type_map[item.type_backup_id]
            if product and product.type_id!=typ.id:
                raise ValueError('Товар не соответствует типу элемента')
            db.add(Element(
                project_id=project.id,page_id=page_map[item.page_backup_id].id,
                layer_id=layer_map[item.layer_backup_id].id,type_id=typ.id,
                product_id=product.id if product else None,
                room_id=room_map[item.room_backup_id].id if item.room_backup_id is not None else None,
                x=item.x,y=item.y,parameters=item.parameters,geometry=item.geometry,comment=item.comment,
            ))
        db.commit()
        result=data(project); result['pages']=len(page_map); result['elements']=len(manifest.elements)
        return result
    except Exception as exc:
        db.rollback()
        for path in paths: path.unlink(missing_ok=True)
        if isinstance(exc,HTTPException): raise
        raise HTTPException(422,f'Не удалось восстановить проект: {exc}') from exc

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
    for key,value in body.model_dump(exclude_unset=True).items():
        if key=='name': value=value.strip() if value and value.strip() else None
        setattr(page,key,value)
    db.commit(); return data(page)

@app.delete('/api/pages/{page_id}',status_code=204)
def remove_page(page_id: int, db: DbSession = Depends(session)):
    page=require(db,Page,page_id)
    elements=list(db.scalars(select(Element).where(Element.page_id==page.id)))
    protected=[]
    for element in elements:
        typ=require(db,ElementType,element.type_id)
        if typ.category in ('Электроустановки','Освещение','LED-подсветка'):
            protected.append(typ.name)
    if protected:
        raise HTTPException(409,'Нельзя удалить страницу: на ней есть электроустановки или освещение')
    image_path=Path(page.image_path)
    pdf_path=Path(page.pdf_path)
    project_id=page.project_id
    for element in elements: db.delete(element)
    db.delete(page); db.flush()
    remaining=list(db.scalars(select(Page).where(Page.project_id==project_id).order_by(Page.number,Page.id)))
    for number,item in enumerate(remaining,1): item.number=number
    pdf_in_use=db.scalar(select(Page.id).where(Page.pdf_path==str(pdf_path)).limit(1))
    db.commit()
    image_path.unlink(missing_ok=True)
    if not pdf_in_use: pdf_path.unlink(missing_ok=True)

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
    token=uuid.uuid4().hex
    pdf=STORAGE/f'{token}.pdf'
    paths=[pdf]
    doc=None
    try:
        size=0
        with pdf.open('wb') as destination:
            while chunk:=await file.read(UPLOAD_CHUNK_BYTES):
                size+=len(chunk)
                if size>PDF_MAX_BYTES:
                    raise HTTPException(413,f'Максимальный размер PDF — {PDF_MAX_MB} МБ')
                destination.write(chunk)
        doc=pymupdf.open(pdf)
        if doc.needs_pass or not 1<=len(doc)<=100:
            raise ValueError('Нужен PDF без пароля, от 1 до 100 страниц')
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
        doc.close(); doc=None; db.commit(); return pages
    except HTTPException:
        if doc is not None: doc.close()
        db.rollback()
        for path in paths:
            path.unlink(missing_ok=True)
        raise
    except Exception as exc:
        if doc is not None: doc.close()
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
    group=e.parameters.get('frame_group')
    if group:
        for member in db.scalars(select(Element).where(Element.project_id==e.project_id)):
            if member.parameters.get('frame_group')==group:
                member.parameters={key:value for key,value in member.parameters.items() if key not in ('frame_group','frame_posts')}
    db.delete(e); db.commit()

def frame_elements(db, pid, element_ids):
    require(db,Project,pid)
    ids=list(dict.fromkeys(element_ids))
    elements=list(db.scalars(select(Element).where(Element.project_id==pid,Element.id.in_(ids))))
    if len(elements)!=len(ids):
        raise HTTPException(404,'Один или несколько элементов не найдены')
    types={item.id:require(db,ElementType,item.type_id) for item in elements}
    if any(types[item.id].category!='Электроустановки' for item in elements):
        raise HTTPException(422,'Рамку можно назначить только электроустановкам')
    if len({item.room_id for item in elements})!=1:
        raise HTTPException(422,'Элементы рамки должны находиться в одном помещении')
    if any(require(db,Layer,item.layer_id).locked for item in elements):
        raise HTTPException(409,'Слой заблокирован')
    return elements

def clear_frame_groups(db, pid, groups):
    if not groups:
        return
    for member in db.scalars(select(Element).where(Element.project_id==pid)):
        if member.parameters.get('frame_group') in groups:
            member.parameters={key:value for key,value in member.parameters.items() if key not in ('frame_group','frame_posts')}

@app.post('/api/projects/{pid}/frames')
def assign_frame(pid: int, body: FrameAssignment, db: DbSession = Depends(session)):
    if len(set(body.element_ids))!=body.posts:
        raise HTTPException(422,'Количество выделенных электроустановок не соответствует количеству постов в рамке')
    elements=frame_elements(db,pid,body.element_ids)
    old_groups={item.parameters.get('frame_group') for item in elements if item.parameters.get('frame_group')}
    clear_frame_groups(db,pid,old_groups)
    group=uuid.uuid4().hex
    for item in elements:
        item.parameters={**item.parameters,'frame_group':group,'frame_posts':body.posts}
    db.commit()
    return {'frame_group':group,'posts':body.posts,'element_ids':[item.id for item in elements]}

@app.post('/api/projects/{pid}/frames/remove')
def remove_frames(pid: int, body: ElementSelection, db: DbSession = Depends(session)):
    elements=frame_elements(db,pid,body.element_ids)
    groups={item.parameters.get('frame_group') for item in elements if item.parameters.get('frame_group')}
    clear_frame_groups(db,pid,groups)
    for item in elements:
        item.parameters={key:value for key,value in item.parameters.items() if key not in ('frame_group','frame_posts')}
    db.commit()
    return {'element_ids':[item.id for item in elements]}

def report_rows(db,pid):
    require(db,Project,pid)
    groups=defaultdict(float)
    frame_groups=defaultdict(float)
    frame_members=defaultdict(list)
    warnings=[]
    for e,t,l in db.execute(select(Element,ElementType,Layer).join(ElementType,Element.type_id==ElementType.id).join(Layer,Element.layer_id==Layer.id).where(Element.project_id==pid)):
        if not l.export: continue
        room=db.get(Room,e.room_id) if e.room_id else None
        product=db.get(Product,e.product_id) if e.product_id else None
        manufacturer=db.get(Manufacturer,product.manufacturer_id) if product else None
        supplier=db.get(Supplier,product.supplier_id) if product and product.supplier_id else None
        group_parameters={k:v for k,v in e.parameters.items() if k not in ('length','quantity','frame_posts','frame_group','plan_icon')}
        key=(
            room.name if room else 'Без помещения',t.category,t.name,t.unit,
            json.dumps(group_parameters,ensure_ascii=False,sort_keys=True),
            product.id if product else None,
            product.name if product else '', product.sku if product else '',
            manufacturer.name if manufacturer else '', supplier.name if supplier else '',
            float(product.price) if product else 0, product.currency if product else 'RUB',
        )
        groups[key]+=float(e.parameters.get('length',0) if t.unit=='м' else e.parameters.get('quantity',1))
        frame_group=e.parameters.get('frame_group')
        if t.category=='Электроустановки' and frame_group:
            frame_members[frame_group].append((e,room.name if room else 'Без помещения'))
        if room and room.wet and t.wet_min_ip and int(e.parameters.get('ip',0))<t.wet_min_ip:
            warnings.append(f'{room.name}: {t.name} №{e.id} — рекомендуется IP{t.wet_min_ip} или выше')
    for group,members in frame_members.items():
        posts={int(item.parameters.get('frame_posts',0)) for item,_ in members}
        rooms={room for _,room in members}
        expected=next(iter(posts)) if len(posts)==1 else 0
        if expected<1 or expected>6 or len(members)!=expected or len(rooms)!=1:
            warnings.append(f'Рамка {group[:8]}: количество выделенных электроустановок не соответствует количеству постов')
            continue
        frame_groups[(next(iter(rooms)),expected)]+=1
    rows=[]
    for key,value in sorted(groups.items(),key=lambda item:(item[0][0],item[0][1],item[0][2],item[0][6])):
        quantity=round(value,3); price=key[10]
        rows.append(dict(
            room=key[0],category=key[1],name=key[2],unit=key[3],
            parameters=key[4],product_id=key[5],product=key[6],sku=key[7],
            manufacturer=key[8],supplier=key[9],unit_price=price,
            currency=key[11],quantity=quantity,total=round(quantity*price,2),
        ))
    for (room,posts),quantity in frame_groups.items():
        ending='пост' if posts==1 else 'поста' if posts < 5 else 'постов'
        rows.append(dict(
            room=room,category='Рамки',name=f'Рамка на {posts} {ending}',unit='шт',
            parameters=json.dumps({'frame_posts':posts},ensure_ascii=False),product_id=None,
            product='',sku='',manufacturer='',supplier='',unit_price=0,currency='RUB',
            quantity=quantity,total=0,
        ))
    rows.sort(key=lambda row:(row['room'],row['category'],row['name'],row['product']))
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

STATIC_DIR = Path(os.getenv(
    'STATIC_DIR',
    Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parents[2])) / 'frontend',
))
if STATIC_DIR.is_dir():
    app.mount('/', StaticFiles(directory=STATIC_DIR, html=True), name='frontend')
