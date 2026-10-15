import io
import json
import zipfile
import pytest
import pymupdf
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from app.db import Base, engine
from app.main import app
from app import main as main_module

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

def test_health_identifies_desktop_backend(client,monkeypatch):
    monkeypatch.setenv('SMART_HOME_CALC_INSTANCE_TOKEN','test-instance')
    health=client.get('/api/health')
    assert health.status_code==200
    assert health.json()=={
        'status':'ok','version':'1.0.22','instance':'test-instance',
    }

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
    project=client.get(f'/api/projects/{pid}').json()
    lid=body['layer_id']
    eid=client.post(f'/api/projects/{pid}/elements',json=body).json()['id']
    client.patch(f'/api/layers/{lid}',json={'locked':True})
    assert client.post(f'/api/projects/{pid}/elements',json=body).status_code==409
    assert client.put(f'/api/elements/{eid}',json=body).status_code==409
    assert client.delete(f'/api/elements/{eid}').status_code==409
    client.patch(f'/api/layers/{lid}',json={'export':False})
    assert client.get(f'/api/projects/{pid}/report').json()['rows']==[]
    opacity=client.patch(f'/api/layers/{lid}',json={'opacity':.35})
    assert opacity.status_code==200 and opacity.json()['opacity']==.35
    assert client.patch(f'/api/layers/{lid}',json={'opacity':1.1}).status_code==422
    overlay=client.patch(f"/api/pages/{body['page_id']}",json={
        'overlay_visible':True,'opacity':.4,'offset_x':.12,'offset_y':-.08,'scale':1.2,
    })
    assert overlay.status_code==200
    assert overlay.json()['opacity']==.4 and overlay.json()['scale']==1.2
    expanded=client.patch(f"/api/pages/{body['page_id']}",json={
        'offset_x':1.5,'offset_y':-1.5,'scale':4,
    })
    assert expanded.status_code==200
    assert expanded.json()['offset_x']==1.5 and expanded.json()['scale']==4
    assert client.delete(f"/api/pages/{body['page_id']}").status_code==409
    empty_page=next(page for page in project['pages'] if page['id']!=body['page_id'])
    assert client.delete(f"/api/pages/{empty_page['id']}").status_code==204
    assert len(client.get(f'/api/projects/{pid}').json()['pages'])==1

def test_smart_device_catalog_and_layer(client):
    expected={
        'Zigbee диммер','Zigbee реле одноканальное',
        'Zigbee реле двухканальное','Zigbee реле трехканальное',
        'Zigbee лампочка','Zigbee контроллер для ленты',
        'Zigbee электрокарниз','Zigbee терморегулятор',
    }
    smart={
        item['name'] for item in client.get('/api/types').json()
        if item['category']=='Умные устройства'
    }
    assert expected <= smart
    project=client.post('/api/projects',json={'name':'Умный дом'}).json()
    assert 'Умные устройства' in {
        layer['name'] for layer in client.get(f"/api/projects/{project['id']}").json()['layers']
    }

def test_bulk_page_deletion_is_atomic_and_renumbers_pages(client):
    pid,body=setup(client)
    protected_page_id=body['page_id']
    assert client.post(f'/api/projects/{pid}/elements',json=body).status_code==201
    document=pymupdf.open();document.new_page();document.new_page()
    uploaded=client.post(
        f'/api/projects/{pid}/pdf',
        files={'file':('extra.pdf',document.tobytes(),'application/pdf')},
    ).json()
    project=client.get(f'/api/projects/{pid}').json()
    assert len(project['pages'])==4
    empty_page_id=uploaded[0]['id']
    blocked=client.post(f'/api/projects/{pid}/pages/delete',json={
        'page_ids':[protected_page_id,empty_page_id],
    })
    assert blocked.status_code==409
    assert len(client.get(f'/api/projects/{pid}').json()['pages'])==4
    deleted=client.post(f'/api/projects/{pid}/pages/delete',json={
        'page_ids':[page['id'] for page in uploaded],
    })
    assert deleted.status_code==200
    assert deleted.json()['deleted']==2
    remaining=client.get(f'/api/projects/{pid}').json()['pages']
    assert len(remaining)==2
    assert [page['number'] for page in remaining]==[1,2]

def test_polygon_room_assigns_existing_and_new_elements(client):
    pid,body=setup(client)
    existing=client.post(f'/api/projects/{pid}/elements',json=body).json()
    room=client.post(f'/api/projects/{pid}/rooms',json={
        'name':'Кухня','wet':False,'page_id':body['page_id'],
        'polygon':[{'x':.1,'y':.3},{'x':.5,'y':.3},{'x':.5,'y':.7},{'x':.1,'y':.7}],
    })
    assert room.status_code==201
    room_id=room.json()['id']
    project=client.get(f'/api/projects/{pid}').json()
    assert next(item for item in project['elements'] if item['id']==existing['id'])['room_id']==room_id
    body['x']=.3;body['y']=.5;body['room_id']=None
    added=client.post(f'/api/projects/{pid}/elements',json=body)
    assert added.status_code==201 and added.json()['room_id']==room_id
    moved=client.put(f"/api/elements/{added.json()['id']}",json={**body,'x':.8})
    assert moved.status_code==200 and moved.json()['room_id'] is None
    renamed=client.put(f'/api/rooms/{room_id}',json={
        'name':'Кухня-гостиная','wet':False,'page_id':body['page_id'],
        'polygon':[{'x':.6,'y':.3},{'x':.9,'y':.3},{'x':.9,'y':.7},{'x':.6,'y':.7}],
    })
    assert renamed.status_code==200
    project=client.get(f'/api/projects/{pid}').json()
    assert next(item for item in project['elements'] if item['id']==existing['id'])['room_id'] is None
    assert next(item for item in project['elements'] if item['id']==added.json()['id'])['room_id']==room_id
    archive=client.get(f'/api/projects/{pid}/backup')
    restored=client.post('/api/projects/import',files={
        'file':('project.zip',archive.content,'application/zip'),
    })
    assert restored.status_code==201
    restored_project=client.get(f"/api/projects/{restored.json()['id']}").json()
    restored_room=next(item for item in restored_project['rooms'] if item['polygon'])
    assert restored_room['name']=='Кухня-гостиная'
    assert len(restored_room['polygon'])==4
    assert client.delete(f'/api/rooms/{room_id}').status_code==204
    assert all(item['room_id'] is None for item in client.get(f'/api/projects/{pid}').json()['elements'])

def test_cross_project_and_validation(client):
    pid,body=setup(client)
    other=client.post('/api/projects',json={'name':'Другой'}).json()['id']
    assert client.post(f'/api/projects/{other}/elements',json=body).status_code==422
    body['x']=2
    assert client.post(f'/api/projects/{pid}/elements',json=body).status_code==422
    body['x']=.2;body['parameters']={'length':-1}
    assert client.post(f'/api/projects/{pid}/elements',json=body).status_code==422
    assert client.post(f'/api/projects/{pid}/pdf',files={'file':('bad.pdf',b'bad')}).status_code==422

def test_pdf_upload_limit_is_500_mb_and_enforced_while_streaming(client,monkeypatch):
    assert main_module.PDF_MAX_BYTES==500*1024*1024
    pid=client.post('/api/projects',json={'name':'Большой PDF'}).json()['id']
    monkeypatch.setattr(main_module,'PDF_MAX_BYTES',10)
    response=client.post(f'/api/projects/{pid}/pdf',files={'file':('large.pdf',b'x'*11,'application/pdf')})
    assert response.status_code==413
    assert '500 МБ' in response.json()['detail']

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

def test_frames_are_assigned_to_selected_electrical_installations(client):
    pid,body=setup(client)
    types=client.get('/api/types').json()
    names=['Розетка одинарная','Выключатель','HDMI-розетка']
    selected=[]
    project=client.get(f'/api/projects/{pid}').json()
    body['layer_id']=project['layers'][0]['id']
    body['parameters']={'quantity':1,'ip':20,'plan_icon':'R'}
    for index,name in enumerate(names):
        body['type_id']=next(t['id'] for t in types if t['name']==name)
        body['page_id']=project['pages'][index%2]['id']
        body['x']=.2+index*.1
        response=client.post(f'/api/projects/{pid}/elements',json=body)
        assert response.status_code==201
        selected.append(response.json()['id'])
    rows=client.get(f'/api/projects/{pid}/report').json()['rows']
    assert not any(row['category']=='Рамки' for row in rows)
    mismatch=client.post(f'/api/projects/{pid}/frames',json={'element_ids':selected,'posts':2})
    assert mismatch.status_code==422
    assert 'не соответствует количеству постов' in mismatch.json()['detail']
    assigned=client.post(f'/api/projects/{pid}/frames',json={'element_ids':selected,'posts':3})
    assert assigned.status_code==200
    elements=client.get(f'/api/projects/{pid}').json()['elements']
    assert len({item['parameters']['frame_group'] for item in elements})==1
    assert all(item['parameters']['frame_posts']==3 for item in elements)
    report=client.get(f'/api/projects/{pid}/report').json()
    rows=report['rows']
    frame=next(row for row in rows if row['category']=='Рамки')
    assert frame['name']=='Рамка на 3 поста' and frame['quantity']==1
    room_rows=[row for row in rows if row['room']=='Ванная']
    assert [row['category'] for row in room_rows][-1]=='Рамки'
    assert report['summary']['electrical_total']==3
    assert report['summary']['frame_total']==1
    assert report['summary']['post_total']==3
    assert sum(item['quantity'] for item in report['summary']['electrical'])==3
    removed=client.post(f'/api/projects/{pid}/frames/remove',json={'element_ids':[selected[0]]})
    assert removed.status_code==200
    elements=client.get(f'/api/projects/{pid}').json()['elements']
    assert all('frame_group' not in item['parameters'] for item in elements)
    assert not any(row['category']=='Рамки' for row in client.get(f'/api/projects/{pid}/report').json()['rows'])

def test_switch_catalog_has_distinct_default_colors_and_custom_point_color(client):
    pid,body=setup(client)
    types=client.get('/api/types').json()
    categories=[item['category'] for item in types]
    assert categories[0]=='Электроустановки'
    assert categories.count('Электроустановки')==categories.index('Освещение')
    electrical=[item['name'] for item in types if item['category']=='Электроустановки']
    first_switch=next(index for index,name in enumerate(electrical) if 'выключатель' in name.casefold())
    assert all('выключатель' not in name.casefold() for name in electrical[:first_switch])
    assert all('выключатель' in name.casefold() for name in electrical[first_switch:])
    thermostat=next(item for item in types if item['name']=='Терморегулятор')
    assert thermostat['category']=='Электроустановки'
    assert thermostat['color']=='#be123c'
    assert thermostat['defaults']=={'quantity':1,'ip':20}
    switch_names={
        'Двойной выключатель','Двойной перекрестный выключатель',
        'Двойной проходной выключатель','Тройной выключатель',
        'Одинарный проходной выключатель','Одинарный перекрестный выключатель',
    }
    switches=[item for item in types if item['name'] in switch_names]
    assert {item['name'] for item in switches}==switch_names
    assert len({item['color'] for item in switches})==len(switch_names)
    project=client.get(f'/api/projects/{pid}').json()
    body.update({
        'layer_id':project['layers'][0]['id'],'type_id':switches[0]['id'],
        'parameters':{'quantity':1,'ip':20,'plan_color':'#123abc'},
    })
    created=client.post(f'/api/projects/{pid}/elements',json=body)
    assert created.status_code==201 and created.json()['parameters']['plan_color']=='#123abc'
    replacement=switches[1]
    body['type_id']=replacement['id']
    changed=client.put(f"/api/elements/{created.json()['id']}",json=body)
    assert changed.status_code==200 and changed.json()['type_id']==replacement['id']
    assert changed.json()['x']==body['x'] and changed.json()['room_id']==body['room_id']
    assert any(row['name']==replacement['name'] for row in client.get(f'/api/projects/{pid}/report').json()['rows'])
    body['parameters']['plan_color']='orange'
    assert client.post(f'/api/projects/{pid}/elements',json=body).status_code==422

def test_element_actions_can_be_undone_in_order(client):
    pid,body=setup(client)
    created=client.post(f'/api/projects/{pid}/elements',json=body).json()
    original_x=created['x']
    body['x']=.73
    edited=client.put(f"/api/elements/{created['id']}",json=body).json()
    assert edited['x']==.73
    assert client.delete(f"/api/elements/{created['id']}").status_code==204
    assert client.get(f'/api/projects/{pid}').json()['elements']==[]

    restored_delete=client.post(f'/api/projects/{pid}/elements/undo').json()
    assert restored_delete=={'undone':True,'elements':1}
    restored=client.get(f'/api/projects/{pid}').json()['elements'][0]
    assert restored['id']==created['id'] and restored['x']==.73

    assert client.post(f'/api/projects/{pid}/elements/undo').json()['undone'] is True
    assert client.get(f'/api/projects/{pid}').json()['elements'][0]['x']==original_x
    assert client.post(f'/api/projects/{pid}/elements/undo').json()['undone'] is True
    assert client.get(f'/api/projects/{pid}').json()['elements']==[]
    assert client.post(f'/api/projects/{pid}/elements/undo').json()=={'undone':False}

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

def test_project_backup_restore_round_trip(client):
    pid,body=setup(client)
    page_id=body['page_id']
    assert client.patch(f'/api/pages/{page_id}',json={
        'name':'План первого этажа','overlay_visible':True,'opacity':.45,
        'offset_x':.1,'offset_y':-.05,'scale':1.15,
    }).status_code==200
    assert client.post(f'/api/pages/{page_id}/calibrate',json={
        'x1':0,'y1':0,'x2':1,'y2':0,'real_length_m':10,
    }).status_code==200
    manufacturer=client.post('/api/manufacturers',json={'name':'Backup Factory'}).json()
    product=client.post('/api/products',json={
        'name':'Резервный комплект','manufacturer_id':manufacturer['id'],'supplier_id':None,
        'type_id':body['type_id'],'sku':'BACKUP-1','unit':'м','price':100,
        'currency':'RUB','active':True,'parameters':{},
    }).json()
    body.update({
        'product_id':product['id'],'geometry':{'points':[
            {'x':.1,'y':.2},{'x':.4,'y':.2},{'x':.2,'y':.2},
        ]},'parameters':{'ip':65},'comment':'Проверка архива',
    })
    assert client.post(f'/api/projects/{pid}/elements',json=body).status_code==201
    assert client.patch(f"/api/layers/{body['layer_id']}",json={'locked':True}).status_code==200
    backup=client.get(f'/api/projects/{pid}/backup')
    assert backup.status_code==200 and backup.content.startswith(b'PK')
    with zipfile.ZipFile(io.BytesIO(backup.content)) as archive:
        manifest=json.loads(archive.read('manifest.json'))
        assert manifest['version']==1 and len(manifest['pages'])==2
        assert len(manifest['products'])==1 and manifest['elements'][0]['comment']=='Проверка архива'
    restored=client.post('/api/projects/import',files={
        'file':('project.zip',backup.content,'application/zip'),
    })
    assert restored.status_code==201
    restored_id=restored.json()['id']
    assert restored_id!=pid and restored.json()['pages']==2 and restored.json()['elements']==1
    project=client.get(f'/api/projects/{restored_id}').json()
    assert project['name']=='Тестовый дом'
    assert project['pages'][0]['name']=='План первого этажа'
    assert project['pages'][0]['meters_per_point'] is not None
    assert project['pages'][0]['overlay_visible'] is True
    assert project['pages'][0]['opacity']==.45 and project['pages'][0]['scale']==1.15
    assert project['pages'][0]['offset_x']==.1 and project['pages'][0]['offset_y']==-.05
    assert project['elements'][0]['comment']=='Проверка архива'
    assert next(layer for layer in project['layers'] if layer['name']=='LED-подсветка')['locked'] is True
    assert client.get(f"/api/pages/{project['pages'][0]['id']}/image").content.startswith(b'\x89PNG')
    report=client.get(f'/api/projects/{restored_id}/report').json()
    assert report['rows'][0]['quantity']==5 and report['rows'][0]['total']==500

def test_invalid_project_backup_does_not_create_project(client):
    before=len(client.get('/api/projects').json())
    response=client.post('/api/projects/import',files={
        'file':('broken.zip',b'not a zip','application/zip'),
    })
    assert response.status_code==422
    assert len(client.get('/api/projects').json())==before
