from test_workflow import client,setup


def kind(client):
    return next(t for t in client.get('/api/types').json() if t['name']=='Встроенный светильник')


def product_body(client,maker_id,**changes):
    return {'name':'Светильник для проверки','sku':'CAT-57','manufacturer_id':maker_id,'type_id':kind(client)['id'],'unit':'шт','price':100,'currency':'RUB',**changes}


def test_manufacturer_identity_is_shared_and_normalized(client):
    first=client.post('/api/manufacturers',json={'name':'  Arlight  '}).json()
    second=client.post('/api/manufacturers',json={'name':'arlight'}).json()
    assert second['id']==first['id']
    assert len(client.get('/api/catalog').json()['manufacturers'])==1


def test_csv_import_reuses_shared_identity_and_keeps_quote_price(client):
    maker=client.post('/api/manufacturers',json={'name':'Общий бренд'}).json()
    product=client.post('/api/products',json=product_body(client,maker['id'])).json()
    created=client.post('/api/quotations',json={}).json();qid=created['id'];quote=created['quotation']
    quote['lines']=[{'id':'line','name':product['name'],'product_id':product['id'],'type_id':product['type_id'],'sku':product['sku'],'manufacturer':maker['name'],'quantity':'2','unit_price':'83.50'}]
    assert client.put(f'/api/quotations/{qid}',json=quote).status_code==200
    csv='name;sku;type;manufacturer;price\nОбновлённый светильник;cat-57;Встроенный светильник;ОБЩИЙ  БРЕНД;900\nОбновлённый светильник;CAT-57;Встроенный светильник;общий бренд;950\n'
    imported=client.post('/api/catalog/import',files={'file':('price.csv',csv.encode(),'text/csv')})
    assert imported.status_code==201,imported.text
    assert imported.json()=={'created':0,'updated':2,'total':2}
    catalog=client.get('/api/catalog').json()
    assert len(catalog['manufacturers'])==len(catalog['products'])==1
    assert catalog['products'][0]['price']==950
    line=client.get(f'/api/quotations/{qid}').json()['lines'][0]
    assert line['name']=='Обновлённый светильник'
    assert (line['unit_price'],line['quantity'])==('83.50','2')


def test_duplicate_product_warning_has_candidates_and_explicit_override(client):
    maker=client.post('/api/manufacturers',json={'name':'Test Brand'}).json()
    body=product_body(client,maker['id'])
    first=client.post('/api/products',json=body);assert first.status_code==201
    duplicate=client.post('/api/products',json={**body,'name':'Светильник для проверки — новая карточка'})
    assert duplicate.status_code==409
    assert duplicate.json()['code']=='catalog_duplicate'
    assert duplicate.json()['matches'][0]['id']==first.json()['id']
    assert len(client.get('/api/catalog').json()['products'])==1
    assert client.post('/api/products',json={**body,'allow_duplicate':True}).status_code==201


def test_archived_manufacturer_and_products_keep_plan_and_quotation(client):
    pid,element=setup(client);typ=kind(client)
    maker=client.post('/api/manufacturers',json={'name':'Ошибочный производитель'}).json()
    product=client.post('/api/products',json=product_body(client,maker['id'])).json()
    point=client.post(f'/api/projects/{pid}/elements',json={**element,'type_id':typ['id'],'product_id':product['id'],'parameters':{'quantity':2}}).json()
    quote=client.get(f'/api/projects/{pid}/quotation').json();total=quote['client']['totals']
    removed=client.delete(f"/api/manufacturers/{maker['id']}")
    assert removed.status_code==200,removed.text
    catalog=client.get('/api/catalog').json()
    assert not next(m for m in catalog['manufacturers'] if m['id']==maker['id'])['active']
    assert not next(p for p in catalog['products'] if p['id']==product['id'])['active']
    assert client.get(f'/api/projects/{pid}').json()['elements'][0]['id']==point['id']
    assert client.get(f'/api/projects/{pid}/quotation').json()['client']['totals']==total


def test_quote_product_uses_same_duplicate_guard_and_existing_id(client):
    maker=client.post('/api/manufacturers',json={'name':'Общий бренд'}).json()
    product=client.post('/api/products',json=product_body(client,maker['id'])).json()
    created=client.post('/api/quotations',json={}).json();qid=created['id'];quote=created['quotation']
    quote['lines']=[{'id':'line','name':product['name'],'quantity':'2','unit_price':'85'}]
    quote=client.put(f'/api/quotations/{qid}',json=quote).json()
    body={'revision':quote['revision'],'line_id':'line','type_id':product['type_id'],'name':product['name'],'sku':product['sku'],'manufacturer':' общий  бренд ','unit_price':'120','currency':'RUB'}
    duplicate=client.post(f'/api/quotations/{qid}/product',json=body)
    assert duplicate.status_code==409,duplicate.text
    assert duplicate.json()['matches'][0]['id']==product['id']
    saved=client.post(f'/api/quotations/{qid}/product',json={**body,'existing_product_id':product['id']})
    assert saved.status_code==201,saved.text
    assert saved.json()['lines'][0]['product_id']==product['id']
    assert len(client.get('/api/catalog').json()['products'])==1
    assert len(client.get('/api/catalog').json()['manufacturers'])==1


def test_catalog_metadata_sync_preserves_agreed_quote_prices_and_manual_fields(client):
    maker=client.post('/api/manufacturers',json={'name':'Исходный бренд'}).json()
    body=product_body(client,maker['id']);product=client.post('/api/products',json=body).json()
    created=client.post('/api/quotations',json={}).json();qid=created['id'];quote=created['quotation']
    quote['lines']=[{'id':'bound','name':body['name'],'quantity':'2','unit_price':'100','product_id':product['id'],'type_id':product['type_id'],'sku':body['sku'],'manufacturer':maker['name'],'comment':'Не потерять','discount':'15'}, {'id':'manual','name':'Ручное название','quantity':'1','unit_price':'77','product_id':product['id'],'type_id':product['type_id'],'sku':body['sku'],'manufacturer':'Мой бренд','overrides':['name','manufacturer']}]
    saved=client.put(f'/api/quotations/{qid}',json=quote);assert saved.status_code==200,saved.text
    edit=client.put(f"/api/products/{product['id']}",json={**body,'name':'Новое название','sku':'NEW-57','price':250})
    assert edit.status_code==200,edit.text
    renamed=client.put(f"/api/manufacturers/{maker['id']}",json={'name':'Новый бренд'});assert renamed.status_code==200
    updated=client.get(f'/api/quotations/{qid}').json();one,two=updated['lines']
    assert (one['name'],one['sku'],one['manufacturer'])==('Новое название','NEW-57','Новый бренд')
    assert (one['unit_price'],one['quantity'],one['discount'],one['comment'])==('100','2','15','Не потерять')
    assert (two['name'],two['manufacturer'],two['unit_price'])==('Ручное название','Мой бренд','77')
    assert updated['revision']>saved.json()['revision']


def test_editing_bound_product_from_quote_keeps_existing_price(client):
    maker=client.post('/api/manufacturers',json={'name':'Без переоценки'}).json()
    product=client.post('/api/products',json=product_body(client,maker['id'])).json()
    created=client.post('/api/quotations',json={}).json();qid=created['id'];quote=created['quotation']
    quote['lines']=[{'id':'line','name':product['name'],'product_id':product['id'],'type_id':product['type_id'],'quantity':'2','unit_price':'83.50','discount':'7'}]
    quote=client.put(f'/api/quotations/{qid}',json=quote).json()
    response=client.post(f'/api/quotations/{qid}/product',json={'revision':quote['revision'],'line_id':'line','existing_product_id':product['id'],'type_id':product['type_id'],'name':product['name'],'sku':product['sku'],'manufacturer':maker['name'],'unit_price':'500','currency':'RUB'})
    assert response.status_code==201,response.text
    assert response.json()['lines'][0]['unit_price']=='83.50'
    assert response.json()['lines'][0]['discount']=='7'
    assert client.get('/api/catalog').json()['products'][0]['price']==500


def test_concurrent_manufacturer_creation_uses_one_identity(client,monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    import time
    from app import shared_catalog
    original=shared_catalog.manufacturer_named
    def slow_lookup(db,name):
        item=original(db,name)
        if item is None:time.sleep(.08)
        return item
    monkeypatch.setattr(shared_catalog,'manufacturer_named',slow_lookup)
    with ThreadPoolExecutor(max_workers=8) as pool:
        responses=list(pool.map(lambda i:client.post('/api/manufacturers',json={'name':'Общий параллельный бренд' if i%2 else '  общий  параллельный бренд '}),range(12)))
    assert all(response.status_code==201 for response in responses)
    assert len({response.json()['id'] for response in responses})==1


def test_legacy_duplicate_manufacturer_names_do_not_hide_product_duplicates(client):
    from app.db import Session
    from app.models import Manufacturer,Product
    typ=kind(client)
    with Session() as db:
        inactive=Manufacturer(name=' Legacy ',active=False)
        active=Manufacturer(name='Legacy',active=True)
        duplicate=Manufacturer(name='legacy',active=True)
        db.add_all([inactive,active,duplicate]);db.flush()
        item=Product(name='Старая карточка',sku='LEGACY-57',type_id=typ['id'],manufacturer_id=active.id,unit='шт',price=100,currency='RUB',active=True,parameters={})
        db.add(item);db.commit();active_id=active.id;duplicate_id=duplicate.id;product_id=item.id
    assert client.post('/api/manufacturers',json={'name':'legacy'}).json()['id']==active_id
    response=client.post('/api/products',json=product_body(client,duplicate_id,name='Старая карточка',sku='LEGACY-57'))
    assert response.status_code==409,response.text
    assert response.json()['matches'][0]['id']==product_id


def test_long_names_from_quote_can_be_edited_in_the_common_catalogue(client):
    name=('Светильник '+('с подробным описанием ' * 15)).strip()
    brand=('Производитель '+('с подробным названием ' * 12)).strip()
    created=client.post('/api/quotations',json={}).json();qid=created['id'];quote=created['quotation']
    quote['lines']=[{'id':'long','name':name,'quantity':'1','unit_price':'30'}]
    quote=client.put(f'/api/quotations/{qid}',json=quote).json()
    response=client.post(f'/api/quotations/{qid}/product',json={'revision':quote['revision'],'line_id':'long','type_id':kind(client)['id'],'name':name,'manufacturer':brand,'unit_price':'30','currency':'RUB'})
    assert response.status_code==201,response.text
    product=client.get('/api/catalog').json()['products'][0]
    edited=client.put('/api/products/'+str(product['id']),json={**product,'price':50})
    assert edited.status_code==200,edited.text
    assert edited.json()['name']==name and edited.json()['manufacturer']==brand
    assert float(client.get(f'/api/quotations/{qid}').json()['lines'][0]['unit_price'])==30
