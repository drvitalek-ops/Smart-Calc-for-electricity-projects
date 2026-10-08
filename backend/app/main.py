import io
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
from .models import Project, Page, Room, Layer, Element, ElementType, Report
from .catalog import LAYERS, seed

STORAGE = Path(os.getenv('STORAGE_DIR', 'storage')).resolve()
STORAGE.mkdir(parents=True, exist_ok=True)

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
    room_id: int | None = None
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    parameters: dict = Field(default_factory=dict)
    comment: str = Field(default='', max_length=2000)

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
    parameters = {**typ.defaults, **body.parameters}
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
            obj=Page(project_id=pid,number=number+i+1,width=page.rect.width,height=page.rect.height,pdf_path=str(pdf),image_path=str(image))
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
        # Parameters remain part of the grouping: different equipment must not merge.
        import json
        key=(room.name if room else 'Без помещения',t.category,t.name,t.unit,json.dumps(e.parameters,ensure_ascii=False,sort_keys=True))
        groups[key]+=float(e.parameters.get('length',0) if t.unit=='м' else e.parameters.get('quantity',1))
        if room and room.wet and t.wet_min_ip and int(e.parameters.get('ip',0))<t.wet_min_ip:
            warnings.append(f'{room.name}: {t.name} №{e.id} — рекомендуется IP{t.wet_min_ip} или выше')
    rows=[dict(room=k[0],category=k[1],name=k[2],unit=k[3],parameters=k[4],quantity=round(v,3)) for k,v in sorted(groups.items())]
    return {'rows':rows,'warnings':warnings}

@app.get('/api/projects/{pid}/report')
def report(pid: int, db: DbSession = Depends(session)):
    return report_rows(db,pid)

@app.get('/api/projects/{pid}/export/{format}')
def export(pid: int, format: str, db: DbSession = Depends(session)):
    if format not in ('xlsx','pdf'): raise HTTPException(422,'Формат: xlsx или pdf')
    result=report_rows(db,pid)
    output=io.BytesIO()
    headers=['Помещение','Категория','Элемент','Количество','Ед.','Параметры']
    rows=[[r['room'],r['category'],r['name'],r['quantity'],r['unit'],r['parameters']] for r in result['rows']]
    if format=='xlsx':
        from openpyxl import Workbook
        from openpyxl.styles import Font
        wb=Workbook(); ws=wb.active; ws.title='Ведомость'
        ws.append(headers)
        for cell in ws[1]: cell.font=Font(bold=True)
        for row in rows:
            ws.append(row)
            for cell in ws[ws.max_row]:
                if cell.data_type=='f': cell.data_type='s'
        ws.freeze_panes='A2'; ws.auto_filter.ref=ws.dimensions
        for column,width in [('A',25),('B',25),('C',30),('D',15),('E',10),('F',70)]: ws.column_dimensions[column].width=width
        notes=wb.create_sheet('Проверки IP')
        for warning in result['warnings']:
            notes.append([warning]); notes.cell(notes.max_row,1).data_type='s'
        wb.save(output)
        media='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    else:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
        from reportlab.lib.styles import ParagraphStyle
        from xml.sax.saxutils import escape
        font=Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
        pdfmetrics.registerFont(TTFont('Calc',str(font)))
        style=ParagraphStyle('Calc',fontName='Calc',fontSize=9,leading=14)
        story=[Paragraph(escape(require(db,Project,pid).name),style),Spacer(1,15)]
        for r in result['rows']:
            story.append(Paragraph(escape(f"{r['room']} · {r['category']} · {r['name']}: {r['quantity']} {r['unit']} | {r['parameters']}"),style))
            story.append(Spacer(1,8))
        for warning in result['warnings']: story.append(Paragraph(escape(warning),style))
        SimpleDocTemplate(output).build(story); media='application/pdf'
    db.add(Report(project_id=pid,format=format)); db.commit()
    output.seek(0)
    return StreamingResponse(output,media_type=media,headers={'Content-Disposition':f'attachment; filename="smart-home-{pid}.{format}"'})
