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
    assert wb['Общая ведомость'].cell(2,8).value==3.5
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
    assert [r['quantity'] for r in rows]==[7]

def test_calibrated_geometry_catalog_and_plan_export(client):
    pid,body=setup(client)
    page_id=body['page_id']
    calibration=client.post(f'/api/pages/{page_id}/calibrate',json={
        'x1':0,'y1':0,'x2':1,'y2':0,'real_length_m':10,
    })
    assert calibration.status_code==200
    manufacturer=client.post('/api/manufacturers',json={'name':'Test Factory'}).json()
    supplier=client.post('/api/suppliers',json={'name':'Test Supply','contact':'test@example.com'}).json()
    product=client.post('/api/products',json={
        'name':'LED комплект','manufacturer_id':manufacturer['id'],
        'supplier_id':supplier['id'],'type_id':body['type_id'],'sku':'LED-01',
        'unit':'м','price':1200,'currency':'RUB','parameters':{'power':12},
    })
    assert product.status_code==201
    body.update({
        'product_id':product.json()['id'],'x':.1,'y':.2,
        'geometry':{'points':[{'x':.1,'y':.2},{'x':.4,'y':.2},{'x':.2,'y':.2}]},
        'parameters':{'ip':65},
    })
    element=client.post(f'/api/projects/{pid}/elements',json=body)
    assert element.status_code==201
    assert element.json()['parameters']['length']==5
    report=client.get(f'/api/projects/{pid}/report').json()
    assert report['rows'][0]['product']=='LED комплект'
    assert report['rows'][0]['manufacturer']=='Test Factory'
    assert report['rows'][0]['total']==6000
    assert report['totals']=={'RUB':6000}
    body['geometry']['points'][1]['x']=.6
    edited=client.put(f"/api/elements/{element.json()['id']}",json=body)
    assert edited.status_code==200 and edited.json()['parameters']['length']==9
    plan=client.get(f'/api/projects/{pid}/pages/{page_id}/export.pdf')
    assert plan.status_code==200 and plan.content.startswith(b'%PDF')

def test_geometry_requires_calibration(client):
    pid,body=setup(client)
    body['geometry']={'points':[{'x':.1,'y':.2},{'x':.6,'y':.2}]}
    response=client.post(f'/api/projects/{pid}/elements',json=body)
    assert response.status_code==422
    assert 'масштаб' in response.json()['detail']

def test_catalog_csv_import_create_and_update(client):
    template=client.get('/api/catalog/import-template.csv')
    assert template.status_code==200 and template.content.startswith(b'\xef\xbb\xbf')
    content=(
        'name;sku;type;manufacturer;supplier;price;currency;active\n'
        'Розетка белая;R-01;Розетка одинарная;Фабрика;Склад;1250,50;RUB;true\n'
    ).encode()
    created=client.post('/api/catalog/import',files={'file':('price.csv',content,'text/csv')})
    assert created.status_code==201
    assert created.json()=={'created':1,'updated':0,'total':1}
    product=client.get('/api/catalog').json()['products'][0]
    assert product['price']==1250.5 and product['supplier']=='Склад'
    assert client.put(f"/api/manufacturers/{product['manufacturer_id']}",json={'name':'Новая фабрика'}).status_code==200
    assert client.put(f"/api/suppliers/{product['supplier_id']}",json={'name':'Новый склад','contact':'mail@example.com'}).status_code==200
    product=client.get('/api/catalog').json()['products'][0]
    assert product['manufacturer']=='Новая фабрика' and product['supplier']=='Новый склад'
    content=content.replace('Фабрика'.encode(),'Новая фабрика'.encode())
    content=content.replace(b'1250,50',b'1400')
    updated=client.post('/api/catalog/import',files={'file':('price.csv',content,'text/csv')})
    assert updated.status_code==201
    assert updated.json()=={'created':0,'updated':1,'total':1}
    assert client.get('/api/catalog').json()['products'][0]['price']==1400

def test_catalog_csv_import_is_atomic(client):
    content=(
        'name;sku;type;manufacturer;price\n'
        'Розетка;R-01;Розетка одинарная;Фабрика;100\n'
        'Ошибка;X-01;Несуществующий тип;Фабрика;200\n'
    ).encode()
    response=client.post('/api/catalog/import',files={'file':('price.csv',content,'text/csv')})
    assert response.status_code==422 and 'строка 3' in response.json()['detail']
    catalog=client.get('/api/catalog').json()
    assert catalog['products']==[] and catalog['manufacturers']==[]
