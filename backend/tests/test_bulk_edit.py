from test_workflow import client,setup
from test_shared_catalog import kind,product_body
from decimal import Decimal


def test_plan_bulk_edit_is_atomic_and_one_undo(client):
    pid,body=setup(client)
    body={**body,'type_id':kind(client)['id'],'parameters':{'quantity':1},'geometry':{}}
    first=client.post(f'/api/projects/{pid}/elements',json=body).json()
    second=client.post(f'/api/projects/{pid}/elements',json={**body,'x':.7}).json()
    quote=client.get(f'/api/projects/{pid}/quotation').json()
    quote['lines'][0]['unit_price']='83.50'
    assert client.put(f'/api/projects/{pid}/quotation',json=quote).status_code==200
    path=f'/api/projects/{pid}/elements/properties'
    saved=client.patch(path,json={'element_ids':[first['id'],second['id']],'changes':{'comment':'Общий комментарий','parameters':{'quantity':3}}})
    assert saved.status_code==200,saved.text
    assert all(e['parameters']['quantity']==3 and e['comment']=='Общий комментарий' for e in client.get(f'/api/projects/{pid}').json()['elements'])
    quote=client.get(f'/api/projects/{pid}/quotation').json()
    assert Decimal(quote['lines'][0]['quantity'])==6
    assert quote['lines'][0]['unit_price']=='83.50'
    assert client.post(f'/api/projects/{pid}/elements/undo').status_code==200
    assert all(e['parameters']['quantity']==1 and not e['comment'] for e in client.get(f'/api/projects/{pid}').json()['elements'])
    assert Decimal(client.get(f'/api/projects/{pid}/quotation').json()['lines'][0]['quantity'])==2
    failed=client.patch(path,json={'element_ids':[first['id'],999999],'changes':{'comment':'Не записывать'}})
    assert failed.status_code==404
    assert not client.get(f'/api/projects/{pid}').json()['elements'][0]['comment']
    layer=client.get(f'/api/projects/{pid}').json()['layers'][0]
    client.patch(f"/api/layers/{layer['id']}",json={'locked':True})
    failed=client.patch(path,json={'element_ids':[first['id'],second['id']],'changes':{'layer_id':layer['id']}})
    assert failed.status_code==409


def test_mixed_plan_categories_allow_only_shared_properties(client):
    pid,body=setup(client)
    strip=client.post(f'/api/projects/{pid}/elements',json=body).json()
    fixture=client.post(f'/api/projects/{pid}/elements',json={**body,'type_id':kind(client)['id'],'parameters':{'quantity':1}}).json()
    path=f'/api/projects/{pid}/elements/properties';ids=[strip['id'],fixture['id']]
    failed=client.patch(path,json={'element_ids':ids,'changes':{'parameters':{'quantity':2}}})
    assert failed.status_code==422
    saved=client.patch(path,json={'element_ids':ids,'changes':{'comment':'Общее','parameters':{'plan_color':'#123456'}}})
    assert saved.status_code==200,saved.text
    elements=client.get(f'/api/projects/{pid}').json()['elements']
    assert all(e['comment']=='Общее' and e['parameters']['plan_color']=='#123456' for e in elements)
    assert elements[0]['parameters']['length']==3.5


def test_product_bulk_edit_preserves_quote_prices_and_rolls_back(client):
    maker=client.post('/api/manufacturers',json={'name':'Массовые товары'}).json()
    first=client.post('/api/products',json=product_body(client,maker['id'])).json()
    second=client.post('/api/products',json=product_body(client,maker['id'],name='Другая модель',sku='OTHER')).json()
    created=client.post('/api/quotations',json={}).json();qid=created['id'];quote=created['quotation']
    quote['lines']=[{'id':'bound','product_id':first['id'],'type_id':first['type_id'],'name':first['name'],'manufacturer':maker['name'],'quantity':'2','unit_price':'83.50'}]
    assert client.put(f'/api/quotations/{qid}',json=quote).status_code==200
    body={'product_ids':[first['id'],second['id']],'changes':{'price':900,'parameters':{'description':'Общее описание'}}}
    saved=client.patch('/api/products/batch',json=body)
    assert saved.status_code==200,saved.text
    assert all(p['price']==900 for p in client.get('/api/catalog').json()['products'])
    assert client.get(f'/api/quotations/{qid}').json()['lines'][0]['unit_price']=='83.50'
    failed=client.patch('/api/products/batch',json={**body,'product_ids':[first['id'],999999],'changes':{'price':1}})
    assert failed.status_code==404
    assert client.get('/api/catalog').json()['products'][0]['price']==900
