from decimal import Decimal
from test_workflow import client,setup


def ok(response):
    assert response.is_success,response.text
    return response.json()


def test_untyped_product_can_be_created_bound_and_transferred(client):
    pid,base=setup(client);item=ok(client.post(f'/api/projects/{pid}/elements',json=base))
    ok(client.get(f'/api/projects/{pid}/quotation'))
    maker=ok(client.post('/api/manufacturers',json={'name':'Завод'}))
    product=ok(client.post('/api/products',json={'name':'Товар без номенклатуры','manufacturer_id':maker['id'],'unit':'м','price':150}))
    assert product['type_id'] is None
    assert next(p for p in ok(client.get('/api/catalog'))['products'] if p['id']==product['id'])['type_id'] is None
    assert not any(t['name'].startswith('Без номенклатуры') for t in ok(client.get('/api/types')))
    ok(client.post(f'/api/projects/{pid}/elements/product',json={'element_ids':[item['id']],'product_id':product['id']}))
    quote=ok(client.get(f'/api/projects/{pid}/quotation'));assert quote['lines'][0]['type_id']==base['type_id']
    quote['apply_to_plan']=True;quote['lines'][0]['comment']='Комментарий после выбора товара'
    ok(client.put(f'/api/projects/{pid}/quotation',json=quote))
    assert 'display_name' not in ok(client.get(f'/api/projects/{pid}'))['elements'][0]['parameters'],'Generated catalogue names must not become sticky manual plan labels'
    archive=client.get(f'/api/projects/{pid}/backup');copy=ok(client.post('/api/projects/import',files={'file':('copy.zip',archive.content,'application/zip')}))
    assert ok(client.get(f'/api/projects/{copy["id"]}/quotation'))['lines'][0]['product_id'] is not None
    standalone=ok(client.post('/api/quotations',json={'lines':[{'id':'manual','name':'Своя позиция','unit':'шт'}]}))
    saved=ok(client.post(f'/api/quotations/{standalone["id"]}/product',json={'revision':standalone['quotation']['revision'],'line_id':'manual','name':'Товар КП','manufacturer':'Завод','unit_price':100}))
    assert saved['lines'][0]['type_id'] is None


def test_quote_changes_existing_points_with_atomic_undo_and_project_prices(client):
    pid,base=setup(client);kind=next(t for t in ok(client.get('/api/types')) if t['name']=='Люстра')
    project=ok(client.get(f'/api/projects/{pid}'));base={**base,'type_id':kind['id'],'layer_id':next(l['id'] for l in project['layers'] if l['name']==kind['category']),'parameters':{'quantity':1,'ip':20}}
    items=[ok(client.post(f'/api/projects/{pid}/elements',json={**base,'x':.1+i*.1})) for i in range(6)]
    path=f'/api/projects/{pid}/quotation';quote=ok(client.get(path));quote['apply_to_plan']=True
    quote['lines'][0].update(quantity='8',quantity_override='8',name='Новое название',ip='IP44',comment='Монтаж',sku='SKU-65',manufacturer='Бренд',unit_price='100')
    saved=ok(client.put(path,json=quote));actual=ok(client.get(f'/api/projects/{pid}'))['elements']
    assert len(actual)==6 and sum(e['parameters']['quantity'] for e in actual)==8
    assert all(e['parameters']['display_name']=='Новое название' and e['parameters']['ip']==44 and e['comment']=='Монтаж' for e in actual)
    assert saved['lines'][0]['quantity_override'] is None and Decimal(saved['lines'][0]['quantity'])==8
    report=ok(client.get(f'/api/projects/{pid}/report'))['rows'][0]
    assert report['sku']=='SKU-65' and report['manufacturer']=='Бренд' and report['unit_price']==100
    ok(client.post(f'/api/projects/{pid}/elements/undo'))
    restored=ok(client.get(f'/api/projects/{pid}'))['elements'];assert [e['parameters'] for e in restored]==[e['parameters'] for e in items]
    ok(client.post(f'/api/projects/{pid}/elements/redo'));assert sum(e['parameters']['quantity'] for e in ok(client.get(f'/api/projects/{pid}'))['elements'])==8


def test_locked_objects_reject_quote_mutations_and_stale_quantities_do_not_overwrite(client):
    pid,base=setup(client);item=ok(client.post(f'/api/projects/{pid}/elements',json=base));path=f'/api/projects/{pid}/quotation';quote=ok(client.get(path));quote['apply_to_plan']=True
    ok(client.put('/api/elements/'+str(item['id']),json={**base,'parameters':{'length':7,'ip':20}}))
    quote['lines'][0]['comment']='Только комментарий';saved=ok(client.put(path,json=quote))
    assert Decimal(saved['lines'][0]['quantity'])==7
    ok(client.patch('/api/layers/'+str(item['layer_id']),json={'locked':True}))
    saved['apply_to_plan']=True;saved['lines'][0].update(quantity='9',quantity_override='9')
    assert client.put(path,json=saved).status_code==409
    assert ok(client.get(f'/api/projects/{pid}'))['elements'][0]['parameters']['length']==7


def test_track_nomenclature_calibrated_polyline_and_components(client):
    pid,base=setup(client);types=ok(client.get('/api/types'));track=next(t for t in types if t['name']=='Шинопровод')
    required={'Трековый светильник','Трековый линейный светильник','Трековый спот','Трековый подвес','Блок питания трека','Ввод питания трека','Заглушка трека','Крепление трека'}
    assert required.issubset({t['name'] for t in types}) and all(t['category']=='Освещение' for t in types if t['name'] in required)
    project=ok(client.get(f'/api/projects/{pid}'));layer=next(l for l in project['layers'] if l['name']=='Освещение')
    ok(client.post(f'/api/pages/{base["page_id"]}/calibrate',json={'x1':.1,'y1':.2,'x2':.9,'y2':.2,'real_length_mm':8000}))
    item=ok(client.post(f'/api/projects/{pid}/elements',json={**base,'layer_id':layer['id'],'type_id':track['id'],'parameters':{},'geometry':{'points':[{'x':.1,'y':.2},{'x':.5,'y':.2},{'x':.9,'y':.2}]}}))
    assert item['parameters']['length']==8 and track['unit']=='м'
    power=next(t for t in types if t['name']=='Блок питания трека')
    ok(client.post(f'/api/projects/{pid}/elements',json={**base,'layer_id':layer['id'],'type_id':power['id'],'parameters':{'quantity':1,'power_watts':100}}))
    quote=ok(client.get(f'/api/projects/{pid}/quotation'));assert len(quote['lines'])==2
    quote['apply_to_plan']=True;line=next(line for line in quote['lines'] if line['type_id']==track['id']);line['quantity_override']='8'
    quote=ok(client.put(f'/api/projects/{pid}/quotation',json=quote))
    assert 'manual_length' not in ok(client.get(f'/api/projects/{pid}'))['elements'][0]['parameters']
    quote['apply_to_plan']=True;line=next(line for line in quote['lines'] if line['type_id']==track['id']);line.update(quantity='10',quantity_override='10')
    ok(client.put(f'/api/projects/{pid}/quotation',json=quote));actual=ok(client.get(f'/api/projects/{pid}'))['elements'][0]
    assert actual['geometry']==item['geometry'] and actual['parameters']['length']==10 and actual['parameters']['manual_length']==10


def test_newly_derived_quote_row_can_update_its_unsaved_plan_group(client):
    pid,base=setup(client);path=f'/api/projects/{pid}/quotation';ok(client.get(path))
    item=ok(client.post(f'/api/projects/{pid}/elements',json=base))
    quote=ok(client.get(path));quote['apply_to_plan']=True;quote['lines'][0].update(quantity='9',quantity_override='9')
    saved=ok(client.put(path,json=quote))
    assert saved['lines'][0]['quantity_override'] is None
    assert ok(client.get(f'/api/projects/{pid}'))['elements'][0]['parameters']['length']==9
