import io
import json
import zipfile
from decimal import Decimal
import pymupdf
import pytest
from test_workflow import client,setup


def create(client,pid,body):
    response=client.post(f'/api/projects/{pid}/elements',json=body)
    assert response.status_code==201,response.text
    return response.json()


def test_all_category_appearance_names_custom_fields_export_and_backup(client):
    pid,body=setup(client)
    params={**body['parameters'],'display_name':'Лента над столом','plan_icon':'LED-24V','plan_color':'#a13d72','plan_shape':'diamond','plan_size':1.5,'plan_rotation':30,'plan_label_color':'#254a80','plan_label_size':9,'custom:Гарантия, лет':5,'custom:Диммирование':True}
    first=create(client,pid,{**body,'parameters':params})
    second=create(client,pid,{**body,'x':.7,'parameters':{**params,'plan_color':'#11aa22','plan_shape':'square'}})
    report=client.get(f'/api/projects/{pid}/report').json()
    assert len(report['rows'])==1,'Only appearance must not split the specification'
    row=report['rows'][0];assert row['name']=='Лента над столом' and row['quantity']==7
    assert 'plan_shape' not in json.loads(row['parameters'])
    quote=client.get(f'/api/projects/{pid}/quotation').json()
    assert quote['lines'][0]['name']=='Лента над столом'
    assert 'Гарантия, лет: 5' in quote['lines'][0]['description']
    exported=client.get(f'/api/projects/{pid}/pages/{body["page_id"]}/export.pdf')
    assert exported.status_code==200,exported.text
    with pymupdf.open(stream=exported.content,filetype='pdf') as doc:
        assert 'LED-24V' in doc[0].get_text() and 'Лента над столом' in doc[0].get_text()
        assert any(drawing['fill'] and abs(drawing['fill'][0]-161/255)<.01 for drawing in doc[0].get_drawings())
    backup=client.get(f'/api/projects/{pid}/backup')
    assert backup.status_code==200
    restored=client.post('/api/projects/import',files={'file':('copy.zip',backup.content,'application/zip')})
    assert restored.status_code==201,restored.text
    elements=client.get('/api/projects/'+str(restored.json()['id'])).json()['elements']
    assert elements[0]['parameters']==first['parameters'] and elements[1]['parameters']==second['parameters']


def test_measured_line_manual_length_survives_recalibration_and_can_be_reset(client):
    pid,body=setup(client);page=body['page_id']
    calibration={'x1':.1,'y1':.1,'x2':.6,'y2':.1,'real_length_mm':1000}
    assert client.post(f'/api/pages/{page}/calibrate',json=calibration).status_code==200
    item=create(client,pid,{**body,'geometry':{'points':[{'x':.1,'y':.1},{'x':.6,'y':.1}]},'parameters':{**body['parameters'],'manual_length':2.75,'line_width':4,'line_dash':'dashed'}})
    assert item['parameters']['length']==2.75 and item['parameters']['measured_length']==1
    assert client.post(f'/api/pages/{page}/calibrate',json={**calibration,'real_length_mm':2000}).status_code==200
    item=client.get(f'/api/projects/{pid}').json()['elements'][0]
    assert item['parameters']['length']==2.75 and item['parameters']['measured_length']==2
    del item['parameters']['manual_length']
    reset=client.put(f'/api/elements/{item["id"]}',json=item)
    assert reset.status_code==200,reset.text
    assert reset.json()['parameters']['length']==2 and 'measured_length' not in reset.json()['parameters']


def test_batch_appearance_atomic_undo_redo_and_locked_layer(client):
    pid,body=setup(client)
    a=create(client,pid,body);b=create(client,pid,{**body,'x':.7})
    new_layer=client.post(f'/api/projects/{pid}/layers',json={'name':'Второй'}).json()
    b=client.put(f'/api/elements/{b["id"]}',json={**b,'layer_id':new_layer['id']}).json()
    client.patch(f'/api/layers/{new_layer["id"]}',json={'locked':True})
    url=f'/api/projects/{pid}/elements/appearance'
    change={'element_ids':[a['id'],b['id']],'changes':{'plan_color':'#123456','plan_icon':'A'}}
    assert client.patch(url,json=change).status_code==409
    assert all('plan_color' not in e['parameters'] for e in client.get(f'/api/projects/{pid}').json()['elements'])
    client.patch(f'/api/layers/{new_layer["id"]}',json={'locked':False})
    assert client.patch(url,json=change).json()=={'updated':2}
    assert client.post(f'/api/projects/{pid}/elements/undo').status_code==200
    assert all('plan_color' not in e['parameters'] for e in client.get(f'/api/projects/{pid}').json()['elements'])
    assert client.post(f'/api/projects/{pid}/elements/redo').status_code==200
    assert all(e['parameters']['plan_color']=='#123456' for e in client.get(f'/api/projects/{pid}').json()['elements'])
    assert client.patch(url,json={**change,'changes':{'length':9}}).status_code==422


def test_quote_manual_quantity_and_fields_survive_plan_refresh(client):
    pid,body=setup(client);item=create(client,pid,body)
    url=f'/api/projects/{pid}/quotation';quote=client.get(url).json();line=quote['lines'][0]
    line.update(quantity_override='1.25',unit_price='500.00',name='Название вручную',sku='CUSTOM-01',manufacturer='Свой завод',overrides=['name','sku','manufacturer','unit_price'])
    saved=client.put(url,json=quote);assert saved.status_code==200,saved.text
    assert saved.json()['client']['totals']['RUB']['total']=='625.00'
    changed=client.put(f'/api/elements/{item["id"]}',json={**item,'parameters':{**item['parameters'],'length':5}});assert changed.status_code==200
    refreshed=client.post(url+'/import',json={'revision':saved.json()['revision']});assert refreshed.status_code==200,refreshed.text
    row=refreshed.json()['lines'][0]
    assert row['name']=='Название вручную' and row['sku']=='CUSTOM-01' and row['manufacturer']=='Свой завод'
    assert Decimal(row['quantity'])==Decimal('1.25') and Decimal(row['calculated_quantity'])==5 and Decimal(row['unit_price'])==500
    quote=refreshed.json();quote['lines'][0]['quantity_override']=None
    saved=client.put(url,json=quote).json()
    refreshed=client.post(url+'/import',json={'revision':saved['revision']}).json()
    assert Decimal(refreshed['lines'][0]['quantity'])==5


@pytest.mark.parametrize('change',[{'plan_shape':'script'},{'plan_icon':'X'*13},{'plan_color':'red'},{'plan_size':0},{'plan_rotation':181},{'plan_label_visible':'false'},{'manual_length':0},{'custom:Test':{'nested':1}}])
def test_invalid_visual_and_custom_parameters_are_rejected(client,change):
    pid,body=setup(client)
    assert client.post(f'/api/projects/{pid}/elements',json={**body,'parameters':{**body['parameters'],**change}}).status_code==422


def test_project_and_layer_rename_and_standalone_quantity_remains_editable(client):
    pid,body=setup(client)
    assert client.patch(f'/api/projects/{pid}',json={'name':'   '}).status_code==422
    assert client.patch(f'/api/projects/{pid}',json={'name':'  Переименованный дом  '}).json()['name']=='Переименованный дом'
    lid=body['layer_id']
    assert client.patch(f'/api/layers/{lid}',json={'name':'Своя подсветка'}).status_code==200
    assert client.post(f'/api/projects/{pid}/elements/undo').status_code==200
    assert next(l for l in client.get(f'/api/projects/{pid}').json()['layers'] if l['id']==lid)['name']=='LED-подсветка'
    draft=client.post('/api/quotations',json={'lines':[{'id':'x','name':'Лента','quantity':'3','quantity_override':'1'}]}).json()
    assert draft['quotation']['lines'][0]['quantity']=='3' and draft['quotation']['lines'][0]['quantity_override'] is None


def test_renamed_default_layers_survive_reseed_and_backup(client):
    from app.catalog import seed
    from app.db import Session
    pid,body=setup(client)
    client.patch(f'/api/layers/{body["layer_id"]}',json={'name':'Моя подсветка'})
    before=client.get(f'/api/projects/{pid}').json()['layers']
    with Session() as db: seed(db)
    assert client.get(f'/api/projects/{pid}').json()['layers']==before
    backup=client.get(f'/api/projects/{pid}/backup')
    restored=client.post('/api/projects/import',files={'file':('copy.zip',backup.content,'application/zip')}).json()
    with Session() as db: seed(db)
    layers=client.get(f'/api/projects/{restored["id"]}').json()['layers']
    assert len(layers)==len(before)
    assert next(layer for layer in layers if layer['seed_key']=='LED-подсветка')['name']=='Моя подсветка'


def test_same_custom_name_keeps_different_nomenclatures_separate(client):
    pid,body=setup(client)
    profile=next(t for t in client.get('/api/types').json() if t['name']=='Алюминиевый профиль')
    params={**body['parameters'],'display_name':'Узел 1'}
    create(client,pid,{**body,'parameters':params})
    create(client,pid,{**body,'type_id':profile['id'],'parameters':params})
    rows=client.get(f'/api/projects/{pid}/report').json()['rows']
    assert len(rows)==2 and {row['type_id'] for row in rows}=={body['type_id'],profile['id']}


def test_concurrent_first_quote_reads_share_one_document(client,monkeypatch):
    from app import quotations
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    pid,_=setup(client);barrier=Barrier(2);persist=quotations.persist_quote
    def synchronized(*args,**kwargs):
        if args[2].revision==0: barrier.wait(timeout=10)
        return persist(*args,**kwargs)
    monkeypatch.setattr(quotations,'persist_quote',synchronized)
    with ThreadPoolExecutor(2) as pool:
        responses=list(pool.map(lambda _:client.get(f'/api/projects/{pid}/quotation'),range(2)))
    assert [response.status_code for response in responses]==[200,200],[r.text for r in responses]
    assert responses[0].json()['revision']==responses[1].json()['revision']==1


def test_manual_quote_fields_survive_product_price_updates_and_reset_on_rebind(client):
    pid,body=setup(client);create(client,pid,body)
    url=f'/api/projects/{pid}/quotation';quote=client.get(url).json()
    response=client.post(url+'/product',json={'revision':quote['revision'],'line_id':quote['lines'][0]['id'],'type_id':body['type_id'],'name':'Лента из базы','manufacturer':'Завод','unit_price':'100','sku':'BASE-1'})
    assert response.status_code==201,response.text
    quote=response.json();line=quote['lines'][0]
    line.update(name='Моя лента',unit_price='150',sku='OVERRIDE',quantity_override='2.5',overrides=['name','unit_price','sku'])
    quote=client.put(url,json=quote).json();product=next(p for p in client.get('/api/catalog').json()['products'] if p['id']==line['product_id'])
    assert client.put('/api/products/'+str(product['id']),json={**product,'name':'Новое имя базы','price':200}).status_code==200
    quote=client.post(url+'/import',json={'revision':quote['revision']}).json();line=quote['lines'][0]
    assert line['name']=='Моя лента' and line['sku']=='OVERRIDE' and Decimal(line['unit_price'])==150
    assert quote['partner']['totals']['RUB']['total']=='375.00'
    response=client.post(url+'/bind',json={'revision':quote['revision'],'line_id':line['id'],'product_id':product['id']})
    assert response.status_code==200,response.text
    line=response.json()['lines'][0]
    assert line['name']=='Новое имя базы' and Decimal(line['unit_price'])==200 and Decimal(line['quantity'])==Decimal('2.5')


def test_split_groups_never_duplicate_manual_quantity(client):
    pid,body=setup(client);a=create(client,pid,body);b=create(client,pid,{**body,'x':.8})
    url=f'/api/projects/{pid}/quotation';quote=client.get(url).json()
    quote['lines'][0].update(quantity_override='2.5',unit_price='100',overrides=['unit_price'])
    saved=client.put(url,json=quote).json()
    room=client.post(f'/api/projects/{pid}/rooms',json={'name':'Другая комната'}).json()
    assert client.put('/api/elements/'+str(b['id']),json={**b,'room_id':room['id']}).status_code==200
    response=client.post(url+'/import',json={'revision':saved['revision']})
    assert response.status_code==409 and 'Вручную' in response.json()['detail']
    assert client.get(url).json()==saved,'Ambiguous regrouping must not change any saved prices or quantities'
    saved['lines'][0]['quantity_override']=None
    saved=client.put(url,json=saved).json()
    response=client.post(url+'/import',json={'revision':saved['revision']})
    assert response.status_code==200,response.text
    assert len(response.json()['lines'])==2 and all(Decimal(line['unit_price'])==100 for line in response.json()['lines'])


def test_merge_preserves_equal_manual_fields_and_rejects_conflicting_prices(client):
    pid,body=setup(client)
    room=client.post(f'/api/projects/{pid}/rooms',json={'name':'Вторая'}).json()
    a=create(client,pid,body);b=create(client,pid,{**body,'room_id':room['id'],'x':.7})
    url=f'/api/projects/{pid}/quotation';quote=client.get(url).json()
    for index,line in enumerate(quote['lines']): line.update(unit_price=str(100+index),overrides=['unit_price'])
    saved=client.put(url,json=quote).json()
    assert client.put('/api/elements/'+str(b['id']),json={**b,'room_id':body['room_id']}).status_code==200
    assert client.post(url+'/import',json={'revision':saved['revision']}).status_code==409
    assert client.get(url).json()==saved
    for line in saved['lines']: line['unit_price']='150'
    saved=client.put(url,json=saved).json()
    response=client.post(url+'/import',json={'revision':saved['revision']})
    assert response.status_code==200,response.text
    assert len(response.json()['lines'])==1 and Decimal(response.json()['lines'][0]['unit_price'])==150
