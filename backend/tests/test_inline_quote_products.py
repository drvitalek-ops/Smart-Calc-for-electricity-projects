"""Typed quotation goods become real catalogue/plan links without changing terms."""
from decimal import Decimal

from fastapi.testclient import TestClient
from test_workflow import client,setup
from app.db import Session
from app.main import app
from app.models import Quotation


def ok(response):
    assert response.is_success,response.text
    return response.json()


def filled(line,sku='TV-EXAMPLE'):
    return {**line,'name':'Механизм телевизионной розетки','sku':sku,'manufacturer':'Тестовая фабрика',
            'unit_price':'703','discount':'10','comment':'Не менять','overrides':['name','sku','manufacturer','unit_price']}


def test_saving_typed_linked_row_creates_shared_good_and_one_undo(client):
    pid,body=setup(client)
    typ=next(t for t in client.get('/api/types').json() if t['name']=='TV')
    body={**body,'type_id':typ['id'],'parameters':{'quantity':1}}
    a=ok(client.post(f'/api/projects/{pid}/elements',json=body))
    b=ok(client.post(f'/api/projects/{pid}/elements',json={**body,'x':.6}))
    path=f'/api/projects/{pid}/quotation';quote=ok(client.get(path))
    quote['lines']=[filled(quote['lines'][0])];quote['apply_to_plan']=True
    saved=ok(client.put(path,json=quote));line=saved['lines'][0]
    assert line['product_id'] is not None
    goods=ok(client.get('/api/catalog'))['products']
    product=next(p for p in goods if p['id']==line['product_id'])
    assert product['sku']=='TV-EXAMPLE' and product['price']==703
    elements=ok(client.get(f'/api/projects/{pid}'))['elements']
    assert all(e['product_id']==product['id'] for e in elements)
    assert [(e['id'],e['x'],e['y'],e['parameters']['quantity']) for e in elements]==[(a['id'],a['x'],a['y'],1),(b['id'],b['x'],b['y'],1)]
    assert saved['partner']['totals']['RUB']['total']=='1265.40'
    ok(client.post(f'/api/projects/{pid}/elements/undo'))
    assert all(e['product_id'] is None for e in ok(client.get(f'/api/projects/{pid}'))['elements'])
    after=ok(client.get(path));assert after['lines'][0]['product_id'] is None
    # Saving another field after undo must not silently attach the product again.
    after['terms']='Новые условия';after['apply_to_plan']=True
    ok(client.put(path,json=after))
    assert all(e['product_id'] is None for e in ok(client.get(f'/api/projects/{pid}'))['elements'])
    latest=ok(client.get(path))
    restored=ok(client.post(path+'/recover-products',json={'revision':latest['revision']}))
    assert restored['lines'][0]['product_id']==product['id']
    assert all(e['product_id']==product['id'] for e in ok(client.get(f'/api/projects/{pid}'))['elements'])


def test_startup_repairs_every_legacy_project_preserving_quantities_and_frames(client):
    project_ids=[]
    for index in range(2):
        pid,body=setup(client);project_ids.append(pid)
        typ=next(t for t in client.get('/api/types').json() if t['name']=='TV')
        body={**body,'type_id':typ['id'],'parameters':{'quantity':1}}
        ids=[ok(client.post(f'/api/projects/{pid}/elements',json={**body,'x':.2+i*.2}))['id'] for i in range(2)]
        ok(client.post(f'/api/projects/{pid}/frames',json={'element_ids':ids,'posts':2}))
        quote=ok(client.get(f'/api/projects/{pid}/quotation'))
        for line in quote['lines']:
            line.update(filled(line,'FRAME-EXAMPLE' if line['source_key'].startswith('frame:') else 'TV-EXAMPLE'))
            line['name']='Рамка на 2 поста' if line['source_key'].startswith('frame:') else 'Механизм телевизионной розетки'
        point=next(l for l in quote['lines'] if l['source_ids']);point.update(quantity='30',quantity_override='30')
        quote['lines'].append({'id':'manual','name':'Дополнительная накладка','sku':'COVER-EXAMPLE','manufacturer':'Тестовая фабрика','quantity':'30','unit_price':'15','unit':'шт'})
        # Model an already saved v69 quote: inline metadata, no Product records.
        quote.pop('catalog_links_version',None)
        with Session() as db:
            row=db.get(Quotation,pid);row.content={k:v for k,v in quote.items() if k not in ('revision','client','partner')};db.commit()
    with TestClient(app) as restarted:
        for pid in project_ids:
            project=ok(restarted.get(f'/api/projects/{pid}'));quote=ok(restarted.get(f'/api/projects/{pid}/quotation'))
            assert all(item['product_id'] is not None for item in project['elements'])
            assert all(item['parameters'].get('frame_product_id') is not None for item in project['elements'])
            assert len(project['elements'])==2 and sum(e['parameters']['quantity'] for e in project['elements'])==2
            assert all(l['product_id'] is not None for l in quote['lines'])
            assert next(l for l in quote['lines'] if l['source_ids'])['quantity']=='30'
        goods=ok(restarted.get('/api/catalog'))['products']
        assert len([p for p in goods if p['sku'] in ('TV-EXAMPLE','FRAME-EXAMPLE','COVER-EXAMPLE')])==3,'Reuse goods across projects'
        pid=project_ids[0];ok(restarted.post(f'/api/projects/{pid}/elements/undo'))
        project=ok(restarted.get(f'/api/projects/{pid}'))
        assert all(e['product_id'] is None and e['parameters'].get('frame_product_id') is None for e in project['elements'])
        undone=ok(restarted.get(f'/api/projects/{pid}/quotation'))
        assert {l['sku'] for l in undone['lines']}=={'TV-EXAMPLE','FRAME-EXAMPLE','COVER-EXAMPLE'},'Undo must keep authored frame metadata and commercial terms'
    with TestClient(app) as restarted:
        assert all(e['product_id'] is None for e in ok(restarted.get(f'/api/projects/{project_ids[0]}'))['elements']),'Restart respects the user undo'


def test_reuse_generic_good_keeps_quotation_price_catalogue_data_and_nomenclature(client):
    pid,body=setup(client);typ=next(t for t in ok(client.get('/api/types')) if t['name']=='TV')
    item=ok(client.post(f'/api/projects/{pid}/elements',json={**body,'type_id':typ['id'],'parameters':{'quantity':1}}))
    maker=ok(client.post('/api/manufacturers',json={'name':'Тестовая фабрика'}))
    product=ok(client.post('/api/products',json={'name':'Каталожное название','manufacturer_id':maker['id'],'sku':'TV-EXAMPLE','unit':'шт','price':999}))
    path=f'/api/projects/{pid}/quotation';quote=ok(client.get(path));quote['lines']=[filled(quote['lines'][0])];quote['apply_to_plan']=True
    saved=ok(client.put(path,json=quote));line=saved['lines'][0]
    assert line['type_id']==typ['id'] and line['product_id']==product['id'] and Decimal(line['unit_price'])==703
    assert ok(client.get(f'/api/projects/{pid}'))['elements'][0]['product_id']==product['id']
    actual=next(p for p in ok(client.get('/api/catalog'))['products'] if p['id']==product['id'])
    assert actual['price']==999 and actual['name']=='Каталожное название'
    saved['apply_to_plan']=True;ok(client.put(path,json=saved))
    assert len([p for p in ok(client.get('/api/catalog'))['products'] if p['sku']=='TV-EXAMPLE'])==1


def test_preview_never_adds_catalogue_goods(client):
    pid,body=setup(client);ok(client.post(f'/api/projects/{pid}/elements',json=body))
    path=f'/api/projects/{pid}/quotation';quote=ok(client.get(path))
    quote['lines']=[filled(quote['lines'][0])]
    before=ok(client.get('/api/catalog'))['products']
    assert client.post(path+'/preview.pdf',json=quote).status_code==200
    assert ok(client.get('/api/catalog'))['products']==before
    assert ok(client.get(f'/api/projects/{pid}'))['elements'][0]['product_id'] is None


def test_locked_legacy_row_can_be_retried_after_unlock(client):
    pid,body=setup(client);item=ok(client.post(f'/api/projects/{pid}/elements',json=body))
    path=f'/api/projects/{pid}/quotation';quote=ok(client.get(path));quote['lines']=[filled(quote['lines'][0],'LINE-EXAMPLE')]
    quote.pop('catalog_links_version',None)
    with Session() as db:
        row=db.get(Quotation,pid);row.content={k:v for k,v in quote.items() if k not in ('revision','client','partner')};db.commit()
    ok(client.patch(f"/api/layers/{body['layer_id']}",json={'locked':True}))
    with TestClient(app) as restarted:
        quote=ok(restarted.get(path));assert quote['lines'][0]['product_id'] is None
        assert 'заблокирован' in quote['catalog_link_issues'][quote['lines'][0]['id']]
        ok(restarted.patch(f"/api/layers/{body['layer_id']}",json={'locked':False}))
        saved=ok(restarted.post(path+'/recover-products',json={'revision':quote['revision']}))
        assert not saved['catalog_recovery']['issues'] and saved['lines'][0]['product_id'] is not None
        assert ok(restarted.get(f'/api/projects/{pid}'))['elements'][0]['id']==item['id']


def test_ambiguous_sku_never_picks_arbitrary_good_or_creates_duplicate(client):
    pid,body=setup(client);ok(client.post(f'/api/projects/{pid}/elements',json=body))
    maker=ok(client.post('/api/manufacturers',json={'name':'Тестовая фабрика'}))
    for name in ('Первый вариант','Второй вариант'):
        ok(client.post('/api/products',json={'name':name,'sku':'DUP-EXAMPLE','manufacturer_id':maker['id'],'type_id':body['type_id'],'unit':'м','price':100,'allow_duplicate':True}))
    path=f'/api/projects/{pid}/quotation';quote=ok(client.get(path));quote['lines']=[filled(quote['lines'][0],'DUP-EXAMPLE')]
    with Session() as db:
        row=db.get(Quotation,pid);row.content={k:v for k,v in quote.items() if k not in ('revision','client','partner')};db.commit()
    saved=ok(client.post(path+'/recover-products',json={'revision':quote['revision']}))
    assert saved['lines'][0]['product_id'] is None
    assert 'несколько товаров' in saved['catalog_recovery']['issues'][saved['lines'][0]['id']]
    assert len([p for p in ok(client.get('/api/catalog'))['products'] if p['sku']=='DUP-EXAMPLE'])==2
    assert ok(client.get(f'/api/projects/{pid}'))['elements'][0]['product_id'] is None


def test_bad_legacy_quote_does_not_block_app_start_or_healthy_project(client):
    good,body=setup(client);ok(client.post(f'/api/projects/{good}/elements',json=body))
    path=f'/api/projects/{good}/quotation';quote=ok(client.get(path));quote['lines']=[filled(quote['lines'][0],'HEALTHY-EXAMPLE')]
    bad,_=setup(client);ok(client.get(f'/api/projects/{bad}/quotation'))
    invalid={'date':'bad date','lines':[{'id':'bad','name':'Повреждённая строка','sku':'BROKEN','manufacturer':'Тестовая фабрика','quantity':'not a number'}]}
    with Session() as db:
        db.get(Quotation,good).content={k:v for k,v in quote.items() if k not in ('revision','client','partner')}
        db.get(Quotation,bad).content=invalid;db.commit()
    with TestClient(app) as restarted:
        assert restarted.get('/api/health').status_code==200
        assert ok(restarted.get(path))['lines'][0]['product_id'] is not None
        assert len(ok(restarted.get('/api/projects')))==2
    with Session() as db:assert db.get(Quotation,bad).content==invalid


def test_manual_extra_with_optional_nomenclature_reuses_typed_good_without_new_points(client):
    pid,_=setup(client);typ=next(t for t in ok(client.get('/api/types')) if t['name']=='TV')
    maker=ok(client.post('/api/manufacturers',json={'name':'Тестовая фабрика'}))
    product=ok(client.post('/api/products',json={'name':'Механизм телевизионной розетки','manufacturer_id':maker['id'],'type_id':typ['id'],'sku':'TV-EXAMPLE','unit':'шт','price':999}))
    path=f'/api/projects/{pid}/quotation';quote=ok(client.get(path));quote.update(apply_to_plan=True,plan_sync=False)
    quote['lines']=[filled({'id':'manual-extra','unit':'шт','quantity':'5'})]
    saved=ok(client.put(path,json=quote))
    assert saved['lines'][0]['product_id']==product['id'] and saved['lines'][0]['type_id']==typ['id']
    assert len(ok(client.get(f'/api/projects/{pid}'))['elements'])==0
    assert saved['partner']['totals']['RUB']['total']=='3163.50'
