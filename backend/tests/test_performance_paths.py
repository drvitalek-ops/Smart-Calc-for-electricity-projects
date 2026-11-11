from sqlalchemy import event,select
from test_workflow import client,setup
from app.db import Session,engine
from app.models import Element,ElementType,Manufacturer,Product,Room


def test_large_catalogue_and_report_have_bounded_query_counts(client):
    pid,pages=setup(client)
    project=client.get(f'/api/projects/{pid}').json()
    kind=next(item for item in client.get('/api/types').json() if item['name']=='Розетка одинарная')
    with Session() as database:
        maker=Manufacturer(name='Performance maker');database.add(maker);database.flush()
        products=[Product(type_id=kind['id'],manufacturer_id=maker.id,name=f'Performance {i}',price=100+i,parameters={},unit='шт') for i in range(40)]
        database.add_all(products);database.flush()
        room=Room(project_id=pid,name='Большой зал',wet=False);database.add(room);database.flush()
        database.add_all([Element(project_id=pid,page_id=project['pages'][0]['id'],layer_id=project['layers'][0]['id'],type_id=kind['id'],product_id=products[i%40].id,room_id=room.id,x=.5,y=.5,parameters={'quantity':1},geometry={}) for i in range(1000)])
        database.commit()
    queries=[]
    def count(*args):queries.append(1)
    event.listen(engine,'before_cursor_execute',count)
    try:
        response=client.get(f'/api/projects/{pid}/report');assert response.status_code==200,response.text
        assert len(queries)<=9,f'Report reintroduced per-object queries: {len(queries)}'
        result=response.json();assert sum(row['quantity'] for row in result['rows'])==1000
        assert result['totals']['RUB']==sum((100+i%40) for i in range(1000))
        queries.clear();response=client.get('/api/catalog');assert response.status_code==200
        assert len(queries)<=7,f'Catalogue reintroduced per-product queries: {len(queries)}'
        assert all(item['manufacturer']=='Performance maker' for item in response.json()['products'])
    finally:event.remove(engine,'before_cursor_execute',count)


def test_lean_price_preview_does_not_mutate_saved_quote_or_require_photos(client):
    pid,_=setup(client);path=f'/api/projects/{pid}/quotation';saved=client.get(path).json()
    request={'global_discount':'10','lines':[{'id':'a','quantity':'2.5','unit_price':'99.99','currency':'RUB','discount':None},{'id':'b','quantity':'3','unit_price':'15.50','currency':'EUR','discount':'20'}]}
    result=client.post(path+'/calculate',json=request);assert result.status_code==200,result.text
    assert result.json()['client']['totals']['RUB']['total']=='249.98'
    assert result.json()['partner']['totals']['RUB']['total']=='224.98'
    assert result.json()['partner']['totals']['EUR']['total']=='37.20'
    assert client.get(path).json()==saved
    assert client.post(path+'/calculate',json={'lines':[{'id':'bad','quantity':'-1'}]}).status_code==422
    assert client.post(path+'/calculate',json={'lines':[{'id':'x'},{'id':'x'}]}).status_code==422
    assert client.post('/api/projects/999999/quotation/calculate',json=request).status_code==404
