"""New plan groups join a linked CP without overwriting negotiated rows."""
from decimal import Decimal
import io
import zipfile
import pymupdf
from test_workflow import client,setup


def ok(response):
    assert response.is_success,response.text
    return response.json()


def supply(client,pid,base,strip_id,*,kind=None,watts=60):
    types=ok(client.get('/api/types'))
    kind=kind or next(t for t in types if t['name']=='Блок питания LED-ленты')
    project=ok(client.get(f'/api/projects/{pid}'))
    return ok(client.post(f'/api/projects/{pid}/elements',json={**base,'type_id':kind['id'],'layer_id':next(l['id'] for l in project['layers'] if l['name']==kind['category']),'room_id':None,'parameters':{'quantity':1,'power_watts':watts,'led_strip_ids':[strip_id]}}))


def test_new_power_supply_nomenclature_joins_existing_quote_and_shared_catalogue(client):
    pid,base=setup(client);strip=ok(client.post(f'/api/projects/{pid}/elements',json=base));path=f'/api/projects/{pid}/quotation'
    quote=ok(client.get(path));quote['lines'][0].update(unit_price='100',discount='20',comment='Условия ленты');quote=ok(client.put(path,json=quote));old=quote['lines'][0]
    kind=ok(client.post('/api/types',json={'name':'Блок питания 24В новый','category':'LED-подсветка','unit':'шт','defaults':{'quantity':1}}))
    power=supply(client,pid,base,strip['id'],kind=kind)
    current=ok(client.get(path));row=next((line for line in current['lines'] if power['id'] in line['source_ids']),None)
    assert row is not None,'A new supply type must enter an existing quotation automatically'
    assert Decimal(row['quantity'])==1 and row['type_id']==kind['id'] and Decimal(row['unit_price'])==0
    assert ok(client.get(path))==current,'Derived rows need stable identities'
    retained=next(line for line in current['lines'] if strip['id'] in line['source_ids'])
    assert (retained['id'],retained['unit_price'],retained['discount'],retained['comment'])==(old['id'],old['unit_price'],old['discount'],old['comment'])
    bound=ok(client.post(path+'/product',json={'revision':current['revision'],'line_id':row['id'],'type_id':kind['id'],'name':'Блок питания модель','manufacturer':'Завод БП','sku':'PSU-24','unit_price':'450'}))
    product=next(p for p in ok(client.get('/api/catalog'))['products'] if p['sku']=='PSU-24')
    assert next(line for line in bound['lines'] if power['id'] in line['source_ids'])['product_id']==product['id']
    assert next(item for item in ok(client.get(f'/api/projects/{pid}'))['elements'] if item['id']==power['id'])['product_id']==product['id']
    another=supply(client,pid,base,strip['id'],kind=kind,watts=100)
    final=ok(client.get(path));assert {eid for line in final['lines'] for eid in line['source_ids']}=={strip['id'],power['id'],another['id']}
    assert len([line for line in final['lines'] if line['type_id']==kind['id']])==2
    response=client.get(path+'/export.pdf?mode=partner');assert response.status_code==200
    with pymupdf.open(stream=response.content,filetype='pdf') as pdf:assert 'Блок питания' in ''.join(p.get_text() for p in pdf)


def test_empty_project_quote_and_stale_save_include_new_groups(client):
    pid,base=setup(client);path=f'/api/projects/{pid}/quotation';empty=ok(client.get(path));assert empty['lines']==[]
    point=next(t for t in ok(client.get('/api/types')) if t['name']=='Люстра');project=ok(client.get(f'/api/projects/{pid}'))
    added=ok(client.post(f'/api/projects/{pid}/elements',json={**base,'type_id':point['id'],'layer_id':next(l['id'] for l in project['layers'] if l['name']=='Освещение'),'parameters':{'quantity':3}}))
    empty['customer']='Сохранение старого окна';saved=ok(client.put(path,json=empty))
    assert len(saved['lines'])==1 and saved['lines'][0]['source_ids']==[added['id']] and Decimal(saved['lines'][0]['quantity'])==3


def test_explicit_row_omission_survives_new_objects_but_import_restores_it(client):
    pid,base=setup(client);strip=ok(client.post(f'/api/projects/{pid}/elements',json=base));path=f'/api/projects/{pid}/quotation';ok(client.get(path))
    excluded=supply(client,pid,base,strip['id']);quote=ok(client.get(path))
    quote['lines']=[line for line in quote['lines'] if excluded['id'] not in line['source_ids']]
    saved=ok(client.put(path,json=quote));assert excluded['id'] not in {eid for line in saved['lines'] for eid in line['source_ids']}
    new=supply(client,pid,base,strip['id'],watts=100);current=ok(client.get(path))
    ids={eid for line in current['lines'] for eid in line['source_ids']};assert ids=={strip['id'],new['id']}
    restored=ok(client.post(path+'/import',json={'revision':saved['revision']}));assert {eid for line in restored['lines'] for eid in line['source_ids']}=={strip['id'],excluded['id'],new['id']}


def test_old_quote_recovers_missing_power_and_hidden_layers_still_count(client):
    from app import main
    pid,base=setup(client);strip=ok(client.post(f'/api/projects/{pid}/elements',json=base));path=f'/api/projects/{pid}/quotation';ok(client.get(path))
    with main.Session() as db:
        stored=db.get(main.Quotation,pid);stored.content={key:value for key,value in stored.content.items() if not key.startswith('plan_')};db.commit()
    power=supply(client,pid,base,strip['id']);ok(client.patch('/api/layers/'+str(power['layer_id']),json={'visible':False}))
    quote=ok(client.get(path));assert power['id'] in {eid for line in quote['lines'] for eid in line['source_ids']}
    ok(client.patch('/api/layers/'+str(power['layer_id']),json={'export':False}))
    assert ok(client.get(path))['lines']==[]


def test_explicit_omission_remaps_with_project_backup(client):
    pid,base=setup(client);strip=ok(client.post(f'/api/projects/{pid}/elements',json=base));path=f'/api/projects/{pid}/quotation'
    power=supply(client,pid,base,strip['id']);quote=ok(client.get(path));quote['lines']=[line for line in quote['lines'] if power['id'] not in line['source_ids']];ok(client.put(path,json=quote))
    archive=client.get(f'/api/projects/{pid}/backup');copy=ok(client.post('/api/projects/import',files={'file':('project.zip',archive.content,'application/zip')}))
    project=ok(client.get('/api/projects/'+str(copy['id'])));new_power=next(e for e in project['elements'] if e['type_id']==power['type_id']);new_strip=next(e for e in project['elements'] if e['type_id']==strip['type_id'])
    assert new_power['id']!=power['id']
    restored=ok(client.get(f'/api/projects/{copy["id"]}/quotation'))
    assert {eid for line in restored['lines'] for eid in line['source_ids']}=={new_strip['id']}


def test_explicit_element_omission_survives_room_distribution(client):
    from test_quotation_room_layout import scene
    pid,_,_,items=scene(client);path=f'/api/projects/{pid}/quotation';quote=ok(client.get(path))
    omitted={item['id'] for item in items if item['type_id']==items[-1]['type_id']}
    quote['lines']=[line for line in quote['lines'] if not omitted.intersection(line['source_ids'])]
    quote=ok(client.put(path,json=quote))
    for layout in ('rooms','combined'):
        quote=ok(client.post(path+'/room-layout',json={'revision':quote['revision'],'layout':layout}))
        assert not omitted.intersection(eid for line in quote['lines'] for eid in line['source_ids'])


def test_stale_quote_save_and_refresh_keep_prices_for_existing_bound_products(client):
    pid,base=setup(client);strip=ok(client.post(f'/api/projects/{pid}/elements',json=base));path=f'/api/projects/{pid}/quotation';quote=ok(client.get(path))
    quote=ok(client.post(path+'/product',json={'revision':quote['revision'],'line_id':quote['lines'][0]['id'],'type_id':base['type_id'],'name':'Лента по согласованной цене','manufacturer':'Завод','sku':'FIXED-LED','unit_price':'100'}))
    original=quote['lines'][0];product=next(p for p in ok(client.get('/api/catalog'))['products'] if p['id']==original['product_id'])
    ok(client.put('/api/products/'+str(product['id']),json={**product,'price':500}))
    power=supply(client,pid,base,strip['id']);quote['lines'][0]['comment']='Правка старого окна';saved=ok(client.put(path,json=quote))
    assert power['id'] in {eid for line in saved['lines'] for eid in line['source_ids']}
    refreshed=ok(client.post(path+'/import',json={'revision':saved['revision']}))
    retained=next(line for line in refreshed['lines'] if strip['id'] in line['source_ids']);assert Decimal(retained['unit_price'])==100 and retained['comment']=='Правка старого окна'


def test_explicit_refresh_rejects_merging_different_negotiated_prices(client):
    pid,base=setup(client);a=ok(client.post(f'/api/projects/{pid}/elements',json=base));b=ok(client.post(f'/api/projects/{pid}/elements',json={**base,'parameters':{**base['parameters'],'ip':44},'x':.7}));path=f'/api/projects/{pid}/quotation';quote=ok(client.get(path))
    for i,line in enumerate(quote['lines']):line['unit_price']=str(100+i*100)
    quote=ok(client.put(path,json=quote));ok(client.put('/api/elements/'+str(b['id']),json={**base,'x':.7}))
    response=client.post(path+'/import',json={'revision':quote['revision']});assert response.status_code==409 and 'разными ценами' in response.json()['detail']
    assert sorted(Decimal(line['unit_price']) for line in ok(client.get(path))['lines'])==[100,200]


def test_unsaved_omission_is_respected_by_pdf_and_price_free_sku(client):
    pid,base=setup(client);strip=ok(client.post(f'/api/projects/{pid}/elements',json=base));path=f'/api/projects/{pid}/quotation';ok(client.get(path));power=supply(client,pid,base,strip['id']);draft=ok(client.get(path))
    draft['lines']=[line for line in draft['lines'] if power['id'] not in line['source_ids']]
    response=client.post(path+'/preview.pdf?mode=client',json=draft);assert response.status_code==200,response.text
    with pymupdf.open(stream=response.content,filetype='pdf') as document:assert 'Блок питания' not in ''.join(p.get_text() for p in document)
    response=client.post(path+'/sku.docx',json=draft);assert response.status_code==200,response.text
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        xml=archive.read('word/document.xml').decode();assert 'Блок питания' not in xml and 'LED-линия' in xml
    assert power['id'] in {eid for line in ok(client.get(path))['lines'] for eid in line['source_ids']},'Read-only exports must not persist draft omissions'
