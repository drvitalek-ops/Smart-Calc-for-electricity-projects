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
        'status':'ok','version':'1.0.54','instance':'test-instance',
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
    assert wb['Общая ведомость'].cell(6,8).value==3.5
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
        'Zigbee диммер','Zigbee диммер двухканальный','Zigbee диммер трехканальный',
        'Zigbee реле одноканальное',
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
    # New types are also seeded into an existing database without duplicates.
    with main_module.Session() as db:
        main_module.seed(db)
    catalog=client.get('/api/types').json()
    names=['Zigbee диммер двухканальный','Zigbee диммер трехканальный']
    for name in names:
        assert sum(item['name']==name and item['category']=='Умные устройства' for item in catalog)==1
    document=pymupdf.open(); document.new_page()
    pages=client.post(f"/api/projects/{project['id']}/pdf",files={
        'file':('plan.pdf',document.tobytes(),'application/pdf'),
    }).json()
    document.close()
    layer=next(item for item in client.get(f"/api/projects/{project['id']}").json()['layers'] if item['name']=='Умные устройства')
    for quantity,name in enumerate(names,2):
        kind=next(item for item in catalog if item['name']==name)
        assert client.post(f"/api/projects/{project['id']}/elements",json={
            'page_id':pages[0]['id'],'layer_id':layer['id'],'type_id':kind['id'],
            'x':.2*quantity,'y':.3,'parameters':{'quantity':quantity,'ip':20},
        }).status_code==201
    rows=client.get(f"/api/projects/{project['id']}/report").json()['rows']
    assert {row['name']:row['quantity'] for row in rows}==dict(zip(names,[2,3]))
    assert all(row['category']=='Умные устройства' and row['unit']=='шт' for row in rows)
    excel=client.get(f"/api/projects/{project['id']}/export/xlsx")
    workbook=load_workbook(io.BytesIO(excel.content))
    sheet=workbook['Умные устройства']
    assert {row[2]:row[7] for row in sheet.iter_rows(min_row=6,values_only=True)}==dict(zip(names,[2,3]))
    pdf=client.get(f"/api/projects/{project['id']}/export/pdf")
    with pymupdf.open(stream=pdf.content,filetype='pdf') as document:
        text=' '.join(' '.join(page.get_text() for page in document).split())
        assert all(name in text for name in names)

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
    switches=[index for index,name in enumerate(electrical) if 'выключатель' in name.casefold()]
    assert switches==list(range(min(switches),max(switches)+1))
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
    assert client.post(f'/api/projects/{pid}/elements/undo').json()['undone'] is True
    assert client.get(f'/api/projects/{pid}').json()['rooms']==[]
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


def test_adaptive_pdf_image_quality_and_cache(client, monkeypatch):
    pid,body=setup(client)
    page_id=body['page_id']
    url=f'/api/pages/{page_id}/image'
    low=client.get(url+'?edge=1024')
    high=client.get(url+'?edge=2048')
    assert low.status_code==high.status_code==200
    low_pix=pymupdf.Pixmap(low.content)
    high_pix=pymupdf.Pixmap(high.content)
    assert max(low_pix.width,low_pix.height)==1024
    assert max(high_pix.width,high_pix.height)==2048
    assert high_pix.width>low_pix.width
    # Requests in one quality level reuse the existing render.
    def unexpected_render(*args, **kwargs):
        raise AssertionError('Cached image should not reopen PDF')
    with monkeypatch.context() as patch:
        patch.setattr(main_module.pymupdf,'open',unexpected_render)
        assert client.get(url+'?edge=1800').content==high.content
    for edge in ('0','8193','nan','inf','-1'):
        assert client.get(url+'?edge='+edge).status_code==422
    assert client.get('/api/pages/999999/image?edge=2048').status_code==404
    assert client.get(url).content.startswith(b'\x89PNG')
    # Even at the highest level, raster memory stays bounded.
    capped=client.get(url+'?edge=8192')
    pix=pymupdf.Pixmap(capped.content)
    assert pix.width*pix.height < main_module.PDF_IMAGE_MAX_PIXELS+16384
    assert max(pix.width,pix.height)<=8192
    assert capped.headers['cache-control']=='private, max-age=86400'
    paths=list(main_module.STORAGE.glob('*-q*.png'))
    assert paths
    assert client.post(f'/api/projects/{pid}/pages/delete',json={'page_ids':[page_id]}).status_code==200
    assert not any(path.exists() for path in paths)


def test_millimeter_calibration_recalculates_existing_lines_in_meters(client):
    pid,body=setup(client)
    page_id=body['page_id']
    url=f'/api/pages/{page_id}/calibrate'
    calibration={'x1':0,'y1':0,'x2':1,'y2':0,'real_length_mm':5000}
    response=client.post(url,json=calibration)
    assert response.status_code==200
    assert response.json()['calibration_length_mm']==5000
    assert response.json()['calibration_length_m']==5
    body['geometry']={'points':[{'x':0,'y':0},{'x':1,'y':0}]}
    body['parameters']={'ip':65}
    led=client.post(f'/api/projects/{pid}/elements',json=body).json()
    assert led['parameters']['length']==5
    manual=client.post(f'/api/projects/{pid}/elements',json={
        **body,'geometry':{},'parameters':{'length':2,'ip':65},
    }).json()
    project=client.get(f'/api/projects/{pid}').json()
    track_type=next(kind for kind in client.get('/api/types').json() if kind['name']=='Трек')
    track_layer=next(layer for layer in project['layers'] if layer['name']=='Освещение')
    track=client.post(f'/api/projects/{pid}/elements',json={
        **body,'type_id':track_type['id'],'layer_id':track_layer['id'],
        'geometry':{'points':[{'x':0,'y':0},{'x':.5,'y':0}]},
    }).json()
    assert track['parameters']['length']==2.5
    client.patch(f"/api/layers/{body['layer_id']}",json={'locked':True})
    calibration['real_length_mm']=2500
    recalibrated=client.post(url,json=calibration)
    assert recalibrated.status_code==200
    assert recalibrated.json()['recalculated_lines']==2
    elements={item['id']:item for item in client.get(f'/api/projects/{pid}').json()['elements']}
    assert elements[led['id']]['parameters']['length']==2.5
    assert elements[track['id']]['parameters']['length']==1.25
    assert elements[manual['id']]['parameters']['length']==2
    report=client.get(f'/api/projects/{pid}/report').json()
    assert all(row['unit']=='м' for row in report['rows'])
    assert next(row for row in report['rows'] if row['name']=='LED-линия')['quantity']==4.5
    # Calibration and cached lengths are restored together, then can be reapplied.
    assert client.post(f'/api/projects/{pid}/elements/undo').json()['undone'] is True
    before=client.get(f'/api/projects/{pid}').json()
    assert before['pages'][0]['meters_per_point']==pytest.approx(5/before['pages'][0]['width'])
    assert next(row for row in client.get(f'/api/projects/{pid}/report').json()['rows'] if row['name']=='LED-линия')['quantity']==7
    assert client.post(f'/api/projects/{pid}/elements/redo').json()['undone'] is True
    assert next(row for row in client.get(f'/api/projects/{pid}/report').json()['rows'] if row['name']=='LED-линия')['quantity']==4.5
    for value in (0,-1,10_000_001,'NaN','Infinity'):
        assert client.post(url,json={**calibration,'real_length_mm':value}).status_code==422
    assert client.post(url,json={**calibration,'real_length_m':2.5}).status_code==422
    missing={key:value for key,value in calibration.items() if key!='real_length_mm'}
    assert client.post(url,json=missing).status_code==422


def test_startup_recalculates_all_projects_without_changing_meter_scales(client):
    expected={}
    pages_and_scales={}
    for index in range(2):
        pid,body=setup(client)
        page_id=body['page_id']
        calibration=client.post(f'/api/pages/{page_id}/calibrate',json={
            'x1':0,'y1':0,'x2':1,'y2':0,'real_length_m':5,
        }).json()
        body['geometry']={'points':[{'x':0,'y':0},{'x':1,'y':0}]}
        body['parameters']={'ip':65}
        line=client.post(f'/api/projects/{pid}/elements',json=body).json()
        assert line['parameters']['length']==5
        manual=client.post(f'/api/projects/{pid}/elements',json={
            **body,'geometry':{},'parameters':{'length':3.5,'ip':65},
        }).json()
        # Reproduce the old version: scale changed, cached line length did not.
        with main_module.Session() as db:
            page=db.get(main_module.Page,page_id)
            page.meters_per_point=(8+index*2)/page.width
            pages_and_scales[page_id]=page.meters_per_point
            db.commit()
        expected[pid]={line['id']:8+index*2,manual['id']:3.5}
    # Opening the new application checks every project, including closed ones.
    for _ in range(2):
        with TestClient(app) as reopened:
            for pid,lengths in expected.items():
                project=reopened.get(f'/api/projects/{pid}').json()
                assert {item['id']:item['parameters']['length'] for item in project['elements']}==lengths
                for page in project['pages']:
                    if page['id'] in pages_and_scales:
                        assert page['meters_per_point']==pages_and_scales[page['id']]
                report=reopened.get(f'/api/projects/{pid}/report').json()
                assert all(row['unit']=='м' for row in report['rows'])
                assert sum(row['quantity'] for row in report['rows'])==sum(lengths.values())


def test_nomenclature_is_grouped_and_momentary_switches_export_as_devices(client):
    pid,body=setup(client)
    with main_module.Session() as db:
        main_module.seed(db)  # Updating an existing catalogue must not duplicate types.
    kinds=client.get('/api/types').json()
    from app.catalog import MOMENTARY_SWITCH_DEFAULTS
    assert len(MOMENTARY_SWITCH_DEFAULTS)==10
    for name,defaults in MOMENTARY_SWITCH_DEFAULTS.items():
        matches=[item for item in kinds if item['name']==name and item['category']=='Электроустановки']
        assert len(matches)==1 and matches[0]['unit']=='шт'
        assert matches[0]['defaults']['switch_action']=='Самовозвратный'
        assert all(matches[0]['defaults'][key]==value for key,value in defaults.items())
    for category in ('Электроустановки','Умные устройства'):
        names=[item['name'] for item in kinds if item['category']==category]
        indices=[index for index,name in enumerate(names) if 'диммер' in name.casefold()]
        assert indices==list(range(min(indices),max(indices)+1))
        indices=[index for index,name in enumerate(names) if 'выключател' in name.casefold()]
        assert indices==list(range(min(indices),max(indices)+1))
    smart=[item['name'] for item in kinds if item['category']=='Умные устройства']
    assert [name for name in smart if 'диммер' in name]==[
        'Zigbee диммер','Zigbee диммер двухканальный','Zigbee диммер трехканальный']
    assert [name for name in smart if 'реле' in name]==[
        'Zigbee реле одноканальное','Zigbee реле двухканальное','Zigbee реле трехканальное']
    for count in (3,2,1):
        assert client.post('/api/types',json={
            'name':f'Выключатель тест {count}-клавишный','category':'Электроустановки',
            'unit':'шт','color':'#22c55e','defaults':{'quantity':1},
        }).status_code==201
    ordered=[item['name'] for item in client.get('/api/types').json()]
    assert ordered.index('Выключатель тест 1-клавишный')<ordered.index('Выключатель тест 2-клавишный')<ordered.index('Выключатель тест 3-клавишный')
    selected=next(item for item in kinds if item['name']=='Звонковый выключатель трехклавишный')
    project=client.get(f'/api/projects/{pid}').json()
    body.update(type_id=selected['id'],layer_id=project['layers'][0]['id'],parameters={'quantity':2,'ip':44})
    response=client.post(f'/api/projects/{pid}/elements',json=body)
    assert response.status_code==201
    rows=client.get(f'/api/projects/{pid}/report').json()['rows']
    assert len(rows)==1 and rows[0]['name']==selected['name'] and rows[0]['quantity']==2
    xlsx=load_workbook(io.BytesIO(client.get(f'/api/projects/{pid}/export/xlsx').content))
    assert xlsx['Электроустановки']['H6'].value==2
    assert 'Механизм: Самовозвратный' in xlsx['Электроустановки']['M6'].value
    with pymupdf.open(stream=client.get(f'/api/projects/{pid}/export/pdf').content,filetype='pdf') as pdf:
        content=' '.join(' '.join(page.get_text() for page in pdf).split())
        assert 'Самовозвратный' in content and 'НО/НЗ' not in content


def test_concave_room_contours_and_invalid_polygons_are_validated(client):
    pid,body=setup(client)
    points=lambda values:[dict(x=x,y=y) for x,y in values]
    contour=points([(.1,.1),(.6,.1),(.6,.6),(.4,.6),(.4,.3),(.1,.3)])
    response=client.post(f'/api/projects/{pid}/rooms',json={
        'name':'Г-образное помещение','page_id':body['page_id'],'polygon':contour,
    })
    assert response.status_code==201 and response.json()['polygon']==contour
    # Extra collinear vertices are permitted when tracing straight wall sections.
    segmented=points([(.1,.1),(.3,.1),(.6,.1),(.6,.6),(.4,.6),(.4,.3),(.1,.3)])
    edited=client.put(f"/api/rooms/{response.json()['id']}",json={
        'name':'Г-образное помещение','page_id':body['page_id'],'polygon':segmented,
    })
    assert edited.status_code==200 and len(edited.json()['polygon'])==7
    invalid=[[(.1,.1),(.5,.5),(.1,.5),(.5,.1)],  # Crossing edges.
             [(.1,.1),(.2,.2),(.3,.3)],  # No surface area.
             [(.1,.1),(.5,.1),(.3,.1),(.5,.5),(.1,.5)],  # A wall doubles back.
             [(.1,.1),(.5,.1),(.5,.5),(.1,.1)]]  # Repeated vertex.
    for values in invalid:
        rejected=client.post(f'/api/projects/{pid}/rooms',json={
            'name':'Некорректный контур','page_id':body['page_id'],'polygon':points(values),
        })
        assert rejected.status_code==422
    rooms=client.get(f'/api/projects/{pid}').json()['rooms']
    assert not any(room['name']=='Некорректный контур' for room in rooms)


def test_power_supplies_link_validation_optional_watts_exports_and_backup(client):
    pid,body=setup(client)
    strip=client.post(f'/api/projects/{pid}/elements',json=body).json()
    kinds=client.get('/api/types').json()
    supply_type=next(kind for kind in kinds if kind['name']=='Блок питания LED-ленты')
    supply_body={**body,'type_id':supply_type['id'],'parameters':{'led_strip_id':strip['id']},'x':.65}
    supply=client.post(f'/api/projects/{pid}/elements',json=supply_body)
    assert supply.status_code==201
    supply=supply.json()
    assert 'power_watts' not in supply['parameters']
    for params in ({},{'led_strip_id':str(strip['id'])},{'led_strip_id':supply['id']},{'led_strip_id':strip['id'],'power_watts':0},{'led_strip_id':strip['id'],'power_watts':'NaN'}):
        assert client.post(f'/api/projects/{pid}/elements',json={**supply_body,'parameters':params}).status_code==422
    foreign_pid,foreign_body=setup(client)
    foreign_strip=client.post(f'/api/projects/{foreign_pid}/elements',json=foreign_body).json()
    assert client.post(f'/api/projects/{pid}/elements',json={**supply_body,'parameters':{'led_strip_id':foreign_strip['id']}}).status_code==422
    supply_body['parameters']['power_watts']=120
    edited=client.put(f"/api/elements/{supply['id']}",json=supply_body)
    assert edited.status_code==200 and edited.json()['parameters']['power_watts']==120
    row=next(row for row in client.get(f'/api/projects/{pid}/report').json()['rows'] if row['name']==supply_type['name'])
    params=json.loads(row['parameters'])
    assert params['power_watts']==120 and f"№{strip['id']}" in params['led_strip'] and 'Ванная' in params['led_strip']
    assert 'led_strip_id' not in params and row['unit']=='шт' and row['quantity']==1
    xlsx=load_workbook(io.BytesIO(client.get(f'/api/projects/{pid}/export/xlsx').content))
    text=' '.join(str(cell.value) for sheet in xlsx for row in sheet for cell in row if cell.value)
    assert 'Мощность, Вт: 120' in text and 'Питает ленты: LED-линия' in text
    plan=client.get(f"/api/projects/{pid}/pages/{body['page_id']}/export.pdf")
    with pymupdf.open(stream=plan.content,filetype='pdf') as document:
        assert any(item[0]=='re' for drawing in document[0].get_drawings() for item in drawing['items'])
        assert '120 Вт' in document[0].get_text()
    assert client.delete(f"/api/elements/{strip['id']}").status_code==409
    socket=next(kind for kind in kinds if kind['name']=='Розетка одинарная')
    assert client.put(f"/api/elements/{strip['id']}",json={**body,'type_id':socket['id']}).status_code==409
    client.patch(f"/api/layers/{body['layer_id']}",json={'locked':True})
    backup=client.get(f'/api/projects/{pid}/backup')
    restored=client.post('/api/projects/import',files={'file':('project.zip',backup.content,'application/zip')})
    assert restored.status_code==201,restored.text
    restored_project=client.get(f"/api/projects/{restored.json()['id']}").json()
    new_strip=next(item for item in restored_project['elements'] if item['type_id']==strip['type_id'])
    new_supply=next(item for item in restored_project['elements'] if item['type_id']==supply_type['id'])
    assert new_strip['id']!=strip['id']
    assert new_supply['parameters']['led_strip_ids']==[new_strip['id']] and new_supply['parameters']['power_watts']==120


def test_undo_redo_room_changes_restores_assignments_and_new_action_clears_redo(client):
    pid,body=setup(client)
    element=client.post(f'/api/projects/{pid}/elements',json=body).json()
    room_body={'name':'Контур','page_id':body['page_id'],'polygon':[{'x':0,'y':0},{'x':.5,'y':0},{'x':.5,'y':.8},{'x':0,'y':.8}]}
    room=client.post(f'/api/projects/{pid}/rooms',json=room_body).json()
    assert client.get(f'/api/projects/{pid}').json()['elements'][0]['room_id']==room['id']
    assert client.post(f'/api/projects/{pid}/elements/undo').json()['undone']
    project=client.get(f'/api/projects/{pid}').json()
    assert len(project['rooms'])==1 and project['elements'][0]['room_id']==element['room_id']
    assert client.post(f'/api/projects/{pid}/elements/redo').json()['undone']
    assert len(client.get(f'/api/projects/{pid}').json()['rooms'])==2
    assert client.delete(f"/api/rooms/{room['id']}").status_code==204
    assert client.post(f'/api/projects/{pid}/elements/undo').json()['undone']
    project=client.get(f'/api/projects/{pid}').json()
    assert project['elements'][0]['room_id']==room['id']
    assert client.put(f"/api/rooms/{room['id']}",json={**room_body,'name':'Новое имя'}).status_code==200
    assert client.post(f'/api/projects/{pid}/elements/redo').json()=={'undone':False}
    assert client.post(f'/api/projects/{pid}/elements/undo').json()['undone']
    assert any(item['name']=='Контур' for item in client.get(f'/api/projects/{pid}').json()['rooms'])


def test_usb_socket_order_and_nomenclature_crud_persist_without_losing_objects(client):
    pid,body=setup(client)
    kinds=client.get('/api/types').json()
    names=[item['name'] for item in kinds if item['category']=='Электроустановки']
    assert names.index('Розетка двойная')<names.index('Розетка с USB (2 в 1)')<names.index('USB')<names.index('Диммер')
    usb=next(item for item in kinds if item['name']=='Розетка с USB (2 в 1)')
    body.update(type_id=usb['id'],parameters={'quantity':1,'ip':44})
    element=client.post(f'/api/projects/{pid}/elements',json=body).json()
    changed={**usb,'name':'Розетка с USB-C (2 в 1)','color':'#112233','defaults':{'quantity':1,'ip':44}}
    assert client.put(f"/api/types/{usb['id']}",json=changed).status_code==200
    assert client.put(f"/api/types/{usb['id']}",json={**changed,'unit':'м'}).status_code==409
    assert client.delete(f"/api/types/{usb['id']}").status_code==200
    assert usb['id'] not in [item['id'] for item in client.get('/api/types').json()]
    assert client.post(f'/api/projects/{pid}/elements',json=body).status_code==409
    assert client.put(f"/api/elements/{element['id']}",json={**body,'x':.75}).status_code==200
    for _ in range(2):
        with main_module.Session() as db: main_module.seed(db)
    hidden=next(item for item in client.get('/api/types?include_inactive=true').json() if item['id']==usb['id'])
    assert hidden['name']==changed['name'] and hidden['color']=='#112233' and hidden['active'] is False
    assert not any(item['name']=='Розетка с USB (2 в 1)' for item in client.get('/api/types').json())
    report=client.get(f'/api/projects/{pid}/report').json()
    assert report['rows'][0]['name']==changed['name'] and report['rows'][0]['quantity']==1
    backup=client.get(f'/api/projects/{pid}/backup').content
    restored=client.post('/api/projects/import',files={'file':('backup.zip',backup,'application/zip')})
    assert restored.status_code==201
    assert client.get(f"/api/projects/{restored.json()['id']}/report").json()['rows'][0]['name']==changed['name']
    assert client.put(f"/api/types/{usb['id']}",json={**hidden,'active':True}).status_code==200
    assert any(item['id']==usb['id'] for item in client.get('/api/types').json())
    custom=client.post('/api/types',json={'name':'  Розетка тестовая  ','category':'Электроустановки','defaults':{'quantity':1}})
    assert custom.status_code==201 and custom.json()['name']=='Розетка тестовая'
    assert client.post('/api/types',json={'name':'розетка тестовая','category':'Электроустановки'}).status_code==409
    assert client.post('/api/types',json={'name':'  ','category':'Электроустановки'}).status_code==422
    assert client.delete(f"/api/types/{custom.json()['id']}").status_code==200
    # Even a deliberately chosen legacy colour must survive later starts.
    assert client.put(f"/api/types/{usb['id']}",json={**hidden,'active':True,'color':'#fb923c'}).status_code==200
    with main_module.Session() as db: main_module.seed(db)
    assert next(item for item in client.get('/api/types').json() if item['id']==usb['id'])['color']=='#fb923c'


def test_legacy_contact_variants_merge_preserving_placement_products_and_frames(client):
    pid,body=setup(client)
    category='Электроустановки'
    manufacturer=client.post('/api/manufacturers',json={'name':'Legacy'}).json()
    legacy_ids=[]
    for index,contact in enumerate(('НО','НЗ','НО/НЗ')):
        typ=client.post('/api/types',json={'name':f'Звонковый выключатель одноклавишный ({contact})','category':category,'defaults':{'quantity':1,'keys':1,'contact_type':contact,'switch_action':'Самовозвратный'}}).json()
        legacy_ids.append(typ['id'])
        product=client.post('/api/products',json={'name':f'Звонковый {index}','manufacturer_id':manufacturer['id'],'type_id':typ['id'],'unit':'шт','price':100}).json()
        created=client.post(f'/api/projects/{pid}/elements',json={**body,'type_id':typ['id'],'product_id':product['id'],'x':.1+index*.1,'parameters':{'quantity':1,'ip':44,'contact_type':contact,'frame_group':'legacy-frame','frame_posts':3}})
        assert created.status_code==201
    before=client.get(f'/api/projects/{pid}').json()['elements']
    for _ in range(2):
        with main_module.Session() as db: main_module.seed(db)
    kinds=client.get('/api/types').json()
    assert not any('(НО' in item['name'] or '(НЗ' in item['name'] for item in kinds)
    canonical=next(item for item in kinds if item['name']=='Звонковый выключатель одноклавишный')
    after=client.get(f'/api/projects/{pid}').json()['elements']
    assert [(item['id'],item['x'],item['room_id']) for item in after]==[(item['id'],item['x'],item['room_id']) for item in before]
    assert all(item['type_id']==canonical['id'] and 'contact_type' not in item['parameters'] and item['parameters']['frame_group']=='legacy-frame' for item in after)
    assert all(item['type_id']==canonical['id'] for item in client.get('/api/catalog').json()['products'])
    rows=client.get(f'/api/projects/{pid}/report').json()['rows']
    assert sum(row['quantity'] for row in rows if row['category']==category)==3
    assert next(row for row in rows if row['category']=='Рамки')['quantity']==1


def test_removed_product_keeps_assigned_cost_and_renamed_power_supply_keeps_shape_in_backup(client):
    pid,body=setup(client)
    strip=client.post(f'/api/projects/{pid}/elements',json=body).json()
    typ=next(item for item in client.get('/api/types').json() if item['name']=='Блок питания LED-ленты')
    manufacturer=client.post('/api/manufacturers',json={'name':'Источник'}).json()
    product=client.post('/api/products',json={'name':'БП 100 Вт','manufacturer_id':manufacturer['id'],'type_id':typ['id'],'unit':'шт','price':1250}).json()
    power_body={**body,'type_id':typ['id'],'product_id':product['id'],'parameters':{'led_strip_id':strip['id'],'power_watts':100}}
    power=client.post(f'/api/projects/{pid}/elements',json=power_body).json()
    assert client.delete(f"/api/products/{product['id']}").status_code==200
    assert client.put(f"/api/elements/{power['id']}",json={**power_body,'x':.6}).status_code==200
    assert client.post(f'/api/projects/{pid}/elements',json=power_body).status_code==422
    assert client.put(f"/api/types/{typ['id']}",json={**typ,'name':'Источник питания LED'}).status_code==200
    assert client.delete(f"/api/types/{typ['id']}").status_code==200
    assert client.get(f'/api/projects/{pid}/report').json()['totals']['RUB']==1250
    backup=client.get(f'/api/projects/{pid}/backup').content
    # Import under a different type name to force creation instead of global type reuse.
    with zipfile.ZipFile(io.BytesIO(backup)) as archive:
        files={name:archive.read(name) for name in archive.namelist()}
    manifest=json.loads(files['manifest.json'])
    next(item for item in manifest['types'] if item['backup_id']==typ['id'])['name']='Силовой источник LED'
    files['manifest.json']=json.dumps(manifest,ensure_ascii=False).encode()
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w') as archive:
        for name,content in files.items(): archive.writestr(name,content)
    restored=client.post('/api/projects/import',files={'file':('backup.zip',output.getvalue(),'application/zip')})
    assert restored.status_code==201,restored.text
    project=client.get(f"/api/projects/{restored.json()['id']}").json()
    with pymupdf.open(stream=client.get(f"/api/projects/{project['id']}/pages/{project['pages'][0]['id']}/export.pdf").content,filetype='pdf') as document:
        assert any(item[0]=='re' for drawing in document[0].get_drawings() for item in drawing['items'])
    assert client.get(f"/api/projects/{project['id']}/report").json()['totals']['RUB']==1250


def test_pdf_creates_named_project_with_all_pages_atomically(client,monkeypatch):
    document=pymupdf.open();document.new_page();document.new_page()
    pdf=document.tobytes();document.close()
    response=client.post('/api/projects/from-pdf',data={'name':'  Квартира из PDF  '},files={'file':('План.PDF',pdf,'application/pdf')})
    assert response.status_code==201,response.text
    project=client.get(f"/api/projects/{response.json()['id']}").json()
    assert project['name']=='Квартира из PDF'
    assert len(project['pages'])==2 and [item['number'] for item in project['pages']]==[1,2]
    assert len(project['layers'])==7 and 'Профиль' in {layer['name'] for layer in project['layers']}
    assert client.get(f"/api/pages/{project['pages'][0]['id']}/image").content.startswith(b'\x89PNG')
    projects_before=client.get('/api/projects').json()
    files_before=set(main_module.STORAGE.iterdir())
    pixmap=pymupdf.Pixmap(pymupdf.csRGB,(0,0,10,10),False)
    invalid_files=[b'not a PDF',pixmap.tobytes('png')]
    encrypted=pymupdf.open();encrypted.new_page()
    invalid_files.append(encrypted.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256,owner_pw='owner',user_pw='secret'));encrypted.close()
    for content in invalid_files:
        result=client.post('/api/projects/from-pdf',data={'name':'Не должен сохраниться'},files={'file':('bad.pdf',content,'application/pdf')})
        assert result.status_code==422
        assert client.get('/api/projects').json()==projects_before
        assert set(main_module.STORAGE.iterdir())==files_before
    assert client.post('/api/projects/from-pdf',data={'name':'  '},files={'file':('plan.pdf',pdf,'application/pdf')}).status_code==422
    monkeypatch.setattr(main_module,'PDF_MAX_BYTES',10)
    assert client.post('/api/projects/from-pdf',data={'name':'Большой'},files={'file':('plan.pdf',pdf,'application/pdf')}).status_code==413
    assert client.get('/api/projects').json()==projects_before
    assert set(main_module.STORAGE.iterdir())==files_before


def test_pdf_with_too_many_pages_does_not_create_project(client):
    document=pymupdf.open()
    for _ in range(101): document.new_page()
    response=client.post('/api/projects/from-pdf',data={'name':'101 страница'},files={'file':('plan.pdf',document.tobytes(),'application/pdf')})
    document.close()
    assert response.status_code==422
    assert client.get('/api/projects').json()==[]


def test_settings_open_only_desktop_data_directory_with_matching_instance(client,monkeypatch,tmp_path):
    from app import desktop_settings as integration
    from types import SimpleNamespace
    opened=[]
    monkeypatch.delenv('SMART_HOME_CALC_DATA_DIR',raising=False)
    assert client.get('/api/settings').json()['can_open_data_folder'] is False
    assert client.post('/api/settings/open-data-folder',json={'instance':'test-instance'}).status_code==409
    directory=tmp_path/'Все проекты'/'data';directory.mkdir(parents=True)
    (directory/'storage').mkdir();(directory/'smart-home-calc.db').write_bytes(b'original database')
    monkeypatch.setenv('SMART_HOME_CALC_DATA_DIR',str(directory))
    monkeypatch.setenv('SMART_HOME_CALC_INSTANCE_TOKEN','local-desktop-instance')
    monkeypatch.setattr(integration,'sys',SimpleNamespace(platform='win32'))
    monkeypatch.setattr(integration.os,'startfile',lambda path,operation:opened.append((path,operation)),raising=False)
    info=client.get('/api/settings').json()
    assert info['can_open_data_folder'] is True and info['data_directory']==str(directory.resolve())
    assert client.post('/api/settings/open-data-folder',json={'instance':'wrong-instance'}).status_code==403
    assert client.post('/api/settings/open-data-folder',json={'instance':'неверный ключ'}).status_code==403
    assert client.post('/api/settings/open-data-folder',headers={'Origin':'https://another-site.example'},json={'instance':info['instance']}).status_code==403
    assert client.post('/api/settings/open-data-folder',json={'instance':info['instance'],'path':'C:/other-folder'}).status_code==422
    assert opened==[]
    response=client.post('/api/settings/open-data-folder',headers={'Origin':'http://testserver'},json={'instance':info['instance']})
    assert response.status_code==200 and response.json()['opened'] is True
    assert opened==[(str(directory.resolve()),'explore')]
    assert (directory/'smart-home-calc.db').read_bytes()==b'original database'
    def unavailable(path,operation): raise OSError('Explorer unavailable')
    monkeypatch.setattr(integration.os,'startfile',unavailable)
    assert client.post('/api/settings/open-data-folder',json={'instance':info['instance']}).status_code==500


def test_power_supply_can_feed_multiple_strips_and_restore_all_links(client):
    pid,body=setup(client)
    first=client.post(f'/api/projects/{pid}/elements',json=body).json()
    second_page=client.get(f'/api/projects/{pid}').json()['pages'][1]['id']
    second=client.post(f'/api/projects/{pid}/elements',json={**body,'page_id':second_page,'x':.7,'parameters':{'length':4,'ip':65}}).json()
    typ=next(item for item in client.get('/api/types').json() if item['name']=='Блок питания LED-ленты')
    power_body={**body,'type_id':typ['id'],'parameters':{'led_strip_ids':[first['id'],second['id'],first['id']],'power_watts':200}}
    power=client.post(f'/api/projects/{pid}/elements',json=power_body)
    assert power.status_code==201,power.text
    power=power.json()
    assert power['parameters']['led_strip_ids']==[first['id'],second['id']]
    assert 'led_strip_id' not in power['parameters']
    for invalid in ([],[True],[str(first['id'])],[first['id'],power['id']]):
        assert client.put(f"/api/elements/{power['id']}",json={**power_body,'parameters':{'led_strip_ids':invalid}}).status_code==422
    for strip in (first,second): assert client.delete(f"/api/elements/{strip['id']}").status_code==409
    assert client.delete(f'/api/pages/{second_page}').status_code==409
    assert client.put(f"/api/elements/{second['id']}",json={**body,'x':second['x'],'parameters':{'length':4,'ip':65,'power_watts':80}}).status_code==200
    report=client.get(f'/api/projects/{pid}/report').json()
    row=next(row for row in report['rows'] if row['name']==typ['name'])
    assert f"№{first['id']}" in json.loads(row['parameters'])['led_strip']
    assert f"№{second['id']}" in json.loads(row['parameters'])['led_strip']
    assert any(json.loads(row['parameters']).get('power_watts')==80 for row in report['rows'] if row['name']=='LED-линия')
    backup=client.get(f'/api/projects/{pid}/backup').content
    restored=client.post('/api/projects/import',files={'file':('backup.zip',backup,'application/zip')})
    assert restored.status_code==201,restored.text
    project=client.get(f"/api/projects/{restored.json()['id']}").json()
    new_power=next(item for item in project['elements'] if item['type_id']==typ['id'])
    strips=[item for item in project['elements'] if item['type_id']==body['type_id']]
    assert set(new_power['parameters']['led_strip_ids'])=={item['id'] for item in strips}
    assert not set(new_power['parameters']['led_strip_ids']) & {first['id'],second['id']}
    changed=client.put(f"/api/elements/{power['id']}",json={**power_body,'parameters':{'led_strip_ids':[first['id']]}})
    assert changed.status_code==200
    assert client.delete(f"/api/elements/{second['id']}").status_code==204
    assert client.post(f'/api/projects/{pid}/elements/undo').json()['undone']
    assert client.post(f'/api/projects/{pid}/elements/undo').json()['undone']
    current=client.get(f'/api/projects/{pid}').json()
    assert next(item for item in current['elements'] if item['id']==power['id'])['parameters']['led_strip_ids']==[first['id'],second['id']]


def test_existing_single_strip_link_migrates_on_startup_and_legacy_backup_still_imports(client):
    pid,body=setup(client)
    strip=client.post(f'/api/projects/{pid}/elements',json=body).json()
    typ=next(item for item in client.get('/api/types').json() if item['name']=='Блок питания LED-ленты')
    power=client.post(f'/api/projects/{pid}/elements',json={**body,'type_id':typ['id'],'parameters':{'led_strip_id':strip['id'],'power_watts':120}}).json()
    with main_module.Session() as db:
        row=db.get(main_module.Element,power['id'])
        row.parameters={**row.parameters,'led_strip_id':strip['id']}
        del row.parameters['led_strip_ids']
        # Assign a fresh dict so JSON persistence sees the legacy shape.
        row.parameters={key:value for key,value in row.parameters.items() if key!='led_strip_ids'}
        db.commit()
    for _ in range(2):
        with TestClient(app) as reopened:
            element=next(item for item in reopened.get(f'/api/projects/{pid}').json()['elements'] if item['id']==power['id'])
            assert element['parameters']['led_strip_ids']==[strip['id']] and 'led_strip_id' not in element['parameters']
            assert element['parameters']['power_watts']==120
    backup=client.get(f'/api/projects/{pid}/backup').content
    with zipfile.ZipFile(io.BytesIO(backup)) as archive: files={name:archive.read(name) for name in archive.namelist()}
    manifest=json.loads(files['manifest.json'])
    element=next(item for item in manifest['elements'] if item['type_backup_id']==typ['id'])
    element['parameters']['led_strip_id']=element['parameters'].pop('led_strip_ids')[0]
    files['manifest.json']=json.dumps(manifest).encode()
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w') as archive:
        for name,content in files.items(): archive.writestr(name,content)
    restored=client.post('/api/projects/import',files={'file':('legacy.zip',output.getvalue(),'application/zip')})
    assert restored.status_code==201,restored.text
    elements=client.get(f"/api/projects/{restored.json()['id']}").json()['elements']
    assert next(item for item in elements if item['type_id']==typ['id'])['parameters']['led_strip_ids']==[next(item for item in elements if item['type_id']==body['type_id'])['id']]


def test_delete_completed_project_and_its_files(client,monkeypatch,tmp_path):
    from pathlib import Path
    from sqlalchemy import select
    from app.models import Project,Page,Element,Room,Layer,Report
    monkeypatch.setattr(main_module,'STORAGE',tmp_path)
    pid,body=setup(client)
    strip=client.post(f'/api/projects/{pid}/elements',json=body).json()
    supply_type=next(kind for kind in client.get('/api/types').json() if kind['name']=='Блок питания LED-ленты')
    power=client.post(f'/api/projects/{pid}/elements',json={**body,'type_id':supply_type['id'],'parameters':{'led_strip_ids':[strip['id']],'power_watts':100}})
    assert power.status_code==201
    client.patch(f"/api/layers/{body['layer_id']}",json={'locked':True})
    client.patch(f"/api/layers/{body['layer_id']}",json={'opacity':.5})
    assert client.get(f'/api/projects/{pid}/export/pdf').status_code==200
    assert client.get(f"/api/pages/{body['page_id']}/image?edge=1024").status_code==200
    other,_=setup(client)
    # Exercise undo and redo cleanup while retaining another project's history.
    assert client.post(f'/api/projects/{pid}/elements/undo').status_code==200
    assert pid in main_module.ELEMENT_REDO and other in main_module.ELEMENT_HISTORY
    current=client.get(f'/api/projects/{pid}').json()
    assert next(layer for layer in current['layers'] if layer['id']==body['layer_id'])['locked']
    assert len(current['elements'])==2
    before_other=client.get(f'/api/projects/{other}').json()
    before_catalog=client.get('/api/catalog').json()
    before_types=client.get('/api/types?include_inactive=true').json()
    with main_module.Session() as db:
        removed_files={Path(p.pdf_path) for p in db.scalars(select(Page).where(Page.project_id==pid))}
        removed_files.update(Path(p.image_path) for p in db.scalars(select(Page).where(Page.project_id==pid)))
        preserved_files={Path(p.pdf_path) for p in db.scalars(select(Page).where(Page.project_id==other))}
        preserved_files.update(Path(p.image_path) for p in db.scalars(select(Page).where(Page.project_id==other)))
    caches=set(tmp_path.glob('*-q*.png'))
    response=client.delete(f'/api/projects/{pid}')
    assert response.status_code==200 and response.json()=={'deleted':pid,'cleanup_failed':False}
    assert all(not path.exists() for path in removed_files|caches)
    assert all(path.exists() for path in preserved_files)
    assert client.get(f'/api/projects/{pid}').status_code==404
    assert client.get(f"/api/pages/{body['page_id']}/image").status_code==404
    assert client.get(f'/api/projects/{other}').json()==before_other
    assert client.get('/api/catalog').json()==before_catalog
    assert client.get('/api/types?include_inactive=true').json()==before_types
    assert pid not in main_module.ELEMENT_HISTORY and pid not in main_module.ELEMENT_REDO
    assert other in main_module.ELEMENT_HISTORY
    with main_module.Session() as db:
        assert db.get(Project,pid) is None
        for model in (Page,Element,Room,Layer,Report):
            assert db.scalar(select(model.id).where(model.project_id==pid)) is None
    assert client.post(f'/api/projects/{pid}/elements/undo').status_code==404
    assert client.delete(f'/api/projects/{pid}').status_code==404


def test_delete_project_preserves_shared_and_external_files(client,monkeypatch,tmp_path):
    from pathlib import Path
    from sqlalchemy import select
    from app.models import Page
    managed=tmp_path/'managed';managed.mkdir()
    monkeypatch.setattr(main_module,'STORAGE',managed)
    pid,_=setup(client)
    other,_=setup(client)
    external=tmp_path/'original.pdf';external.write_bytes(b'original outside storage')
    external_image=tmp_path/'original.png';external_image.write_bytes(b'original image')
    with main_module.Session() as db:
        pages=list(db.scalars(select(Page).where(Page.project_id==pid).order_by(Page.id)))
        shared=db.scalar(select(Page).where(Page.project_id==other).order_by(Page.id))
        shared.pdf_path=pages[0].pdf_path;shared.image_path=pages[0].image_path
        paths={Path(shared.pdf_path),Path(shared.image_path)}
        cache=Path(shared.image_path).with_name(f'{Path(shared.image_path).stem}-q2048.png')
        cache.write_bytes(b'shared cache');paths.add(cache)
        pages[1].pdf_path=str(external);pages[1].image_path=str(external_image)
        db.commit()
    assert client.delete(f'/api/projects/{pid}').status_code==200
    assert all(path.exists() for path in paths|{external,external_image})
    assert client.get(f'/api/projects/{other}').status_code==200


def test_delete_empty_project_and_last_project(client):
    first=client.post('/api/projects',json={'name':'Дубль'}).json()['id']
    second=client.post('/api/projects',json={'name':'Дубль'}).json()['id']
    assert client.delete(f'/api/projects/{first}').status_code==200
    assert [p['id'] for p in client.get('/api/projects').json()]==[second]
    assert client.delete(f'/api/projects/{second}').status_code==200
    assert client.get('/api/projects').json()==[]
    assert client.delete('/api/projects/999999').status_code==404


def test_delete_project_reports_file_in_use_without_false_failure(client,monkeypatch,tmp_path):
    from pathlib import Path
    from sqlalchemy import select
    from app.models import Page
    monkeypatch.setattr(main_module,'STORAGE',tmp_path)
    pid,_=setup(client)
    with main_module.Session() as db:
        blocked=Path(db.scalar(select(Page).where(Page.project_id==pid)).pdf_path)
    unlink=Path.unlink
    def file_in_use(path,*args,**kwargs):
        if path==blocked: raise PermissionError('File in use')
        return unlink(path,*args,**kwargs)
    monkeypatch.setattr(Path,'unlink',file_in_use)
    response=client.delete(f'/api/projects/{pid}')
    assert response.status_code==200 and response.json()['cleanup_failed'] is True
    assert client.get(f'/api/projects/{pid}').status_code==404
    assert blocked.exists()


def test_electrical_library_subgroups_and_custom_names(client):
    kinds=client.get('/api/types').json()
    expected={
        'Розетка одинарная':'Розетки','Розетка с USB (2 в 1)':'Розетки',
        'USB':'Розетки слаботочные','TV':'Розетки слаботочные',
        'RJ45':'Розетки слаботочные','HDMI-розетка':'Розетки слаботочные',
        'Выключатель':'Выключатели','Одинарный проходной выключатель':'Выключатели проходные',
        'Двойной перекрестный выключатель':'Выключатели перекрёстные',
        'Звонковый выключатель двухклавишный':'Выключатели звонковые',
        'Выключатель самовозвратный для жалюзи, двухклавишный':'Выключатели звонковые',
        'Диммер':'Диммеры','Терморегулятор':'Терморегуляторы',
        'Сценарная кнопка':'Сценарные кнопки','Заглушка':'Заглушки','Вывод кабеля':'Выводы кабеля',
    }
    for name,group in expected.items():
        kind=next(item for item in kinds if item['name']==name)
        assert kind['group']==group and kind['category']=='Электроустановки'
    electrical=[item for item in kinds if item['category']=='Электроустановки']
    groups=list(dict.fromkeys(item['group'] for item in electrical))
    assert groups==['Розетки','Розетки слаботочные','Выключатели','Выключатели проходные',
                    'Выключатели перекрёстные','Выключатели звонковые','Диммеры','Терморегуляторы',
                    'Сценарные кнопки','Заглушки','Выводы кабеля']
    for item in kinds:
        if item['category']!='Электроустановки': assert item['group']==item['category']
    for name,group in [('TV-розетка заказная','Розетки слаботочные'),
                       ('Проходной выключатель 4-клавишный','Выключатели проходные'),
                       ('Кабельный вывод круглый','Выводы кабеля')]:
        response=client.post('/api/types',json={'name':name,'category':'Электроустановки'})
        assert response.status_code==201 and response.json()['group']==group
    custom=client.post('/api/types',json={'name':'Тестовый механизм','category':'Электроустановки'}).json()
    assert custom['group']=='Прочие электроустановки'
    renamed=client.put(f"/api/types/{custom['id']}",json={**custom,'name':'Диммер заказной'})
    assert renamed.status_code==200 and renamed.json()['group']=='Диммеры'


def test_blanking_plate_and_cable_outlet_frames_exports_and_restore(client):
    pid,body=setup(client)
    project=client.get(f'/api/projects/{pid}').json()
    kinds=client.get('/api/types').json()
    names=['Розетка одинарная','Заглушка','Вывод кабеля']
    selected=[]
    for index,name in enumerate(names):
        kind=next(item for item in kinds if item['name']==name)
        assert kind['category']=='Электроустановки' and kind['unit']=='шт'
        response=client.post(f'/api/projects/{pid}/elements',json={
            **body,'layer_id':project['layers'][0]['id'],'type_id':kind['id'],
            'x':.2+index*.1,'parameters':{'quantity':1,'ip':44},
        })
        assert response.status_code==201
        selected.append(response.json()['id'])
    assert client.post(f'/api/projects/{pid}/frames',json={'element_ids':selected,'posts':3}).status_code==200
    report=client.get(f'/api/projects/{pid}/report').json()
    assert report['summary']['electrical_total']==3 and report['summary']['frame_total']==1
    assert all(next(row for row in report['rows'] if row['name']==name)['quantity']==1 for name in names)
    xlsx=load_workbook(io.BytesIO(client.get(f'/api/projects/{pid}/export/xlsx').content))
    cells={cell.value for row in xlsx['Электроустановки'].iter_rows() for cell in row if isinstance(cell.value,str)}
    assert all(name in cells for name in names)
    with pymupdf.open(stream=client.get(f'/api/projects/{pid}/export/pdf').content,filetype='pdf') as pdf:
        content=' '.join(' '.join(page.get_text() for page in pdf).split())
        assert all(name in content for name in names)
    backup=client.get(f'/api/projects/{pid}/backup')
    restored=client.post('/api/projects/import',files={'file':('project.zip',backup.content,'application/zip')})
    assert restored.status_code==201
    new_pid=restored.json()['id']
    assert client.get(f'/api/projects/{new_pid}/report').json()['summary']['electrical_total']==3
    assert client.get(f'/api/projects/{new_pid}/report').json()['summary']['frame_total']==1
    with main_module.Session() as db: main_module.seed(db)
    updated=client.get('/api/types').json()
    for name in names:
        assert sum(item['name']==name for item in updated)==1


def test_profile_category_is_measured_and_available_in_quotation(client):
    pid,body=setup(client)
    profile=next(item for item in client.get('/api/types').json() if item['name']=='Алюминиевый профиль')
    assert profile['category']=='Профиль' and profile['unit']=='м'
    project=client.get(f'/api/projects/{pid}').json()
    body.update(type_id=profile['id'],layer_id=next(layer['id'] for layer in project['layers'] if layer['name']=='Профиль'),parameters={'length':2.5})
    created=client.post(f'/api/projects/{pid}/elements',json=body)
    assert created.status_code==201,created.text
    row=next(row for row in client.get(f'/api/projects/{pid}/report').json()['rows'] if row['type_id']==profile['id'])
    assert row['unit']=='м' and row['quantity']==2.5
    quote=client.get(f'/api/projects/{pid}/quotation').json()
    assert len(quote['lines'])==1 and quote['lines'][0]['type_id']==profile['id']
    assert float(quote['lines'][0]['quantity'])==2.5
