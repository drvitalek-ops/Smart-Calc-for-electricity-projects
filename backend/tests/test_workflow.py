import io
import pytest
import pymupdf
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from app.db import Base, engine
from app.main import app

@pytest.fixture()
def client():
    assert engine.url.database == 'smart_calc_test', 'Tests require isolated smart_calc_test database'
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with TestClient(app) as c:
        yield c
    Base.metadata.drop_all(engine)

def setup(c):
    pid=c.post('/api/projects',json={'name':'Тестовый дом'}).json()['id']
    doc=pymupdf.open();doc.new_page();doc.new_page()
    response=c.post(f'/api/projects/{pid}/pdf',files={'file':('plan.pdf',doc.tobytes(),'application/pdf')})
    assert response.status_code==201
    pages=response.json()
    assert len(pages)==2
    assert c.get(f"/api/pages/{pages[0]['id']}/image").content.startswith(b'\x89PNG')
    project=c.get(f'/api/projects/{pid}').json()
    typ=next(t for t in c.get('/api/types').json() if t['name']=='LED-линия')
    room=c.post(f'/api/projects/{pid}/rooms',json={'name':'Ванная','wet':True}).json()
    body={'page_id':pages[0]['id'],'layer_id':project['layers'][2]['id'],'type_id':typ['id'],'room_id':room['id'],'x':.2,'y':.4,'parameters':{'length':3.5,'ip':20}}
    return pid,body

def test_full_workflow_and_exports(client):
    pid,body=setup(client)
    r=client.post(f'/api/projects/{pid}/elements',json=body)
    assert r.status_code==201
    eid=r.json()['id']
    report=client.get(f'/api/projects/{pid}/report').json()
    assert report['rows'][0]['quantity']==3.5
    assert report['rows'][0]['unit']=='м'
    assert len(report['warnings'])==1
    response=client.get(f'/api/projects/{pid}/export/xlsx')
    assert response.status_code==200
    wb=load_workbook(io.BytesIO(response.content))
    assert wb.active.cell(2,4).value==3.5
    pdf=client.get(f'/api/projects/{pid}/export/pdf')
    assert pdf.status_code==200 and pdf.content.startswith(b'%PDF')
    body['x']=.8;body['parameters']={'length':5,'ip':67}
    assert client.put(f'/api/elements/{eid}',json=body).status_code==200
    report=client.get(f'/api/projects/{pid}/report').json()
    assert report['rows'][0]['quantity']==5 and report['warnings']==[]
    assert client.get(f'/api/projects/{pid}').json()['elements'][0]['x']==.8
    assert client.delete(f'/api/elements/{eid}').status_code==204
    assert client.get(f'/api/projects/{pid}/report').json()['rows']==[]

def test_layer_lock_and_export(client):
    pid,body=setup(client)
    lid=body['layer_id']
    eid=client.post(f'/api/projects/{pid}/elements',json=body).json()['id']
    client.patch(f'/api/layers/{lid}',json={'locked':True})
    assert client.post(f'/api/projects/{pid}/elements',json=body).status_code==409
    assert client.put(f'/api/elements/{eid}',json=body).status_code==409
    assert client.delete(f'/api/elements/{eid}').status_code==409
    client.patch(f'/api/layers/{lid}',json={'export':False})
    assert client.get(f'/api/projects/{pid}/report').json()['rows']==[]

def test_cross_project_and_validation(client):
    pid,body=setup(client)
    other=client.post('/api/projects',json={'name':'Другой'}).json()['id']
    assert client.post(f'/api/projects/{other}/elements',json=body).status_code==422
    body['x']=2
    assert client.post(f'/api/projects/{pid}/elements',json=body).status_code==422
    body['x']=.2;body['parameters']={'length':-1}
    assert client.post(f'/api/projects/{pid}/elements',json=body).status_code==422
    assert client.post(f'/api/projects/{pid}/pdf',files={'file':('bad.pdf',b'bad')}).status_code==422

def test_extensible_catalog_and_parameter_grouping(client):
    pid,body=setup(client)
    t=client.post('/api/types',json={'name':'Новый элемент','category':'Новая категория','unit':'м','defaults':{'length':2}})
    assert t.status_code==201
    body['type_id']=t.json()['id']
    for length in (2,2,3):
        body['parameters']={'length':length}
        assert client.post(f'/api/projects/{pid}/elements',json=body).status_code==201
    rows=client.get(f'/api/projects/{pid}/report').json()['rows']
    assert sorted(r['quantity'] for r in rows)==[3,4]
