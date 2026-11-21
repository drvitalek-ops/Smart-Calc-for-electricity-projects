import base64
from decimal import Decimal
import pymupdf
from test_workflow import client,setup
from test_shared_catalog import kind,product_body


def photo(color=160):
    image=pymupdf.Pixmap(pymupdf.csRGB,pymupdf.IRect(0,0,4,4),False);image.clear_with(color)
    return 'data:image/png;base64,'+base64.b64encode(image.tobytes('png')).decode()


def points(client):
    pid,body=setup(client);typ=kind(client)
    body={**body,'type_id':typ['id'],'parameters':{'quantity':1,'plan_icon':'F'}}
    items=[client.post(f'/api/projects/{pid}/elements',json={**body,'x':x}).json() for x in [.2,.6]]
    return pid,typ,items


def test_create_on_plan_shares_photo_and_preserves_quote_terms_and_undo(client):
    pid,typ,items=points(client);image=photo()
    quote=client.get(f'/api/projects/{pid}/quotation').json();quote['lines'][0].update(unit_price='83.50',discount='7',comment='Сохранить',name='Моё название',overrides=['name'])
    assert client.put(f'/api/projects/{pid}/quotation',json=quote).status_code==200
    body={'element_ids':[item['id'] for item in items],'create':{'name':'Товар с плана','manufacturer':'Новый завод','sku':'PLAN-59','type_id':typ['id'],'unit_price':'249.90','currency':'RUB','image':image}}
    response=client.post(f'/api/projects/{pid}/elements/product',json=body)
    assert response.status_code==201,response.text
    product=response.json()['product'];assert product['parameters']['image']==image
    assert all(item['product_id']==product['id'] for item in client.get(f'/api/projects/{pid}').json()['elements'])
    quote=client.get(f'/api/projects/{pid}/quotation').json();line=quote['lines'][0]
    assert (line['image'],line['sku'],line['manufacturer'],line['product_id'])==(image,'PLAN-59','Новый завод',product['id'])
    assert (line['name'],line['unit_price'],line['discount'],line['comment'])==('Моё название','83.50','7','Сохранить')
    assert 'plan_icon' not in line['description'] and 'Количество' not in line['description']
    assert client.put(f'/api/projects/{pid}/quotation',json=quote).status_code==200
    assert client.post(f'/api/projects/{pid}/elements/undo').status_code==200
    line=client.get(f'/api/projects/{pid}/quotation').json()['lines'][0]
    assert line['product_id'] is None and not line['image']
    assert line['unit_price']=='83.50'
    assert len(client.get('/api/catalog').json()['products'])==1
    assert client.post(f'/api/projects/{pid}/elements/redo').status_code==200
    assert client.get(f'/api/projects/{pid}/quotation').json()['lines'][0]['image']==image


def test_partial_plan_binding_splits_quote_without_changing_money(client):
    pid,typ,items=points(client)
    quote=client.get(f'/api/projects/{pid}/quotation').json();quote['lines'][0].update(unit_price='100.00',discount='10',comment='Общее')
    client.put(f'/api/projects/{pid}/quotation',json=quote)
    maker=client.post('/api/manufacturers',json={'name':'Завод'}).json()
    product=client.post('/api/products',json=product_body(client,maker['id'],parameters={'image':photo()})).json()
    response=client.post(f'/api/projects/{pid}/elements/product',json={'element_ids':[items[0]['id']],'product_id':product['id']})
    assert response.status_code==201,response.text
    quote=client.get(f'/api/projects/{pid}/quotation').json()
    assert len(quote['lines'])==2 and len({line['id'] for line in quote['lines']})==2
    assert all(line['unit_price']=='100.00' and line['discount']=='10' and line['comment']=='Общее' for line in quote['lines'])
    assert Decimal(quote['partner']['totals']['RUB']['total'])==180
    assert sum(Decimal(line['quantity']) for line in quote['lines'])==2
    assert next(line for line in quote['lines'] if line['product_id']==product['id'])['image']==product['parameters']['image']
    assert [line['id'] for line in client.get(f'/api/projects/{pid}/quotation').json()['lines']]==[line['id'] for line in quote['lines']]


def test_failed_creation_is_atomic_for_mixed_types_locked_layers_and_duplicate(client):
    pid,typ,items=points(client);socket=next(t for t in client.get('/api/types').json() if t['name']=='Розетка одинарная')
    client.put(f"/api/elements/{items[1]['id']}",json={**items[1],'type_id':socket['id']})
    create={'name':'Новая модель','manufacturer':'Единый завод','sku':'59-NEW','type_id':typ['id'],'unit_price':'100','image':photo()}
    path=f'/api/projects/{pid}/elements/product'
    response=client.post(path,json={'element_ids':[item['id'] for item in items],'create':create})
    assert response.status_code==422
    assert not client.get('/api/catalog').json()['manufacturers']
    layer=items[0]['layer_id'];client.patch(f'/api/layers/{layer}',json={'locked':True})
    assert client.post(path,json={'element_ids':[items[0]['id']],'create':create}).status_code==409
    assert not client.get('/api/catalog').json()['products']
    client.patch(f'/api/layers/{layer}',json={'locked':False})
    first=client.post(path,json={'element_ids':[items[0]['id']],'create':create});assert first.status_code==201
    duplicate=client.post(path,json={'element_ids':[items[0]['id']],'create':create})
    assert duplicate.status_code==409 and duplicate.json()['code']=='catalog_duplicate'
    assert len(client.get('/api/catalog').json()['products'])==1


def test_manual_quote_quantity_is_not_silently_divided(client):
    pid,typ,items=points(client)
    quote=client.get(f'/api/projects/{pid}/quotation').json();quote['lines'][0]['quantity_override']='5'
    client.put(f'/api/projects/{pid}/quotation',json=quote)
    response=client.post(f'/api/projects/{pid}/elements/product',json={'element_ids':[items[0]['id']],'create':{'name':'Не создавать','manufacturer':'Не создавать завод','type_id':typ['id'],'unit_price':'50'}})
    assert response.status_code==409,response.text
    assert not client.get('/api/catalog').json()['products'] and not client.get('/api/catalog').json()['manufacturers']
    assert all(item['product_id'] is None for item in client.get(f'/api/projects/{pid}').json()['elements'])
    response=client.post(f'/api/projects/{pid}/elements/product',json={'element_ids':[item['id'] for item in items],'create':{'name':'Разрешённое назначение','manufacturer':'Завод','type_id':typ['id'],'unit_price':'50'}})
    assert response.status_code==201,response.text
    assert Decimal(client.get(f'/api/projects/{pid}/quotation').json()['lines'][0]['quantity'])==5


def test_existing_card_edit_and_reuse_preserve_snapshots_and_fill_new_quotes(client):
    pid,typ,items=points(client);maker=client.post('/api/manufacturers',json={'name':'Производитель'}).json()
    product=client.post('/api/products',json=product_body(client,maker['id'],parameters={'image':photo(),'custom:Сохранить':'Да'})).json()
    path=f'/api/projects/{pid}/elements/product';ids=[item['id'] for item in items]
    assert client.post(path,json={'element_ids':ids,'product_id':product['id']}).status_code==201
    quote=client.get(f'/api/projects/{pid}/quotation').json();quote['lines'][0].update(unit_price='81.25',discount='19')
    client.put(f'/api/projects/{pid}/quotation',json=quote)
    image=photo(40)
    edited=client.post(path,json={'element_ids':ids,'create':{'existing_product_id':product['id'],'name':'Исправленная карточка','manufacturer':maker['name'],'type_id':typ['id'],'sku':'UPDATED-59','unit_price':'300','image':image}})
    assert edited.status_code==201,edited.text
    catalog=client.get('/api/catalog').json();assert len(catalog['products'])==1
    assert catalog['products'][0]['parameters']['custom:Сохранить']=='Да'
    line=client.get(f'/api/projects/{pid}/quotation').json()['lines'][0]
    assert (line['image'],line['unit_price'],line['discount'])==(image,'81.25','19')
    new_pid,new_typ,new_items=points(client)
    assert client.post(f'/api/projects/{new_pid}/elements/product',json={'element_ids':[item['id'] for item in new_items],'product_id':product['id']}).status_code==201
    line=client.get(f'/api/projects/{new_pid}/quotation').json()['lines'][0]
    assert (line['name'],line['image'],Decimal(line['unit_price']))==('Исправленная карточка',image,300)


def test_partial_assignment_cannot_change_quote_total_through_rounding(client):
    pid,typ,items=points(client)
    quote=client.get(f'/api/projects/{pid}/quotation').json();quote['lines'][0].update(unit_price='123.45',discount='10')
    saved=client.put(f'/api/projects/{pid}/quotation',json=quote).json()
    response=client.post(f'/api/projects/{pid}/elements/product',json={'element_ids':[items[0]['id']],'create':{'name':'Округление','manufacturer':'Завод округления','type_id':typ['id'],'unit_price':'100'}})
    assert response.status_code==409,response.text
    assert 'округлен' in response.json()['detail'].lower()
    assert not client.get('/api/catalog').json()['products']
    assert client.get(f'/api/projects/{pid}/quotation').json()['partner']['totals']==saved['partner']['totals']


def test_legacy_inherited_price_survives_new_plan_product_identity(client):
    import copy
    from app.db import Session
    from app.models import Quotation
    from app.quotations import source_key
    pid,typ,items=points(client)
    quote=client.get(f'/api/projects/{pid}/quotation').json();template=quote['lines'][0]
    quote['lines']=[{**template,'id':'legacy-'+str(index),'source_ids':[item['id']],'source_key':source_key({'element_ids':[item['id']]}),'quantity':'1','unit_price':'100'} for index,item in enumerate(items)]
    assert client.put(f'/api/projects/{pid}/quotation',json=quote).status_code==200
    # Older versions could store an empty duplicate price; current views inherit
    # the already agreed price from the other identical position.
    with Session() as db:
        row=db.get(Quotation,pid);content=copy.deepcopy(row.content);content['lines'][1]['unit_price']='0';content['lines'][1]['overrides']=[];row.content=content;db.commit()
    assert client.get(f'/api/projects/{pid}/quotation').json()['lines'][1]['unit_price']=='100'
    response=client.post(f'/api/projects/{pid}/elements/product',json={'element_ids':[items[1]['id']],'create':{'name':'Каталожная модель','manufacturer':'Завод','type_id':typ['id'],'unit_price':'900'}})
    assert response.status_code==201,response.text
    current=client.get(f'/api/projects/{pid}/quotation').json()
    assert all(Decimal(line['unit_price'])==100 for line in current['lines'])
