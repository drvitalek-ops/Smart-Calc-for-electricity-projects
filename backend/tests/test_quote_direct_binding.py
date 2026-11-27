"""Choose an existing good before saving/merging the edited quotation draft."""
from copy import deepcopy
from decimal import Decimal

from test_workflow import client, setup


def ok(response):
    assert response.is_success, response.text
    return response.json()


def good(client, type_id, unit='м'):
    maker=ok(client.post('/api/manufacturers',json={'name':'Фабрика прямого выбора'}))
    return ok(client.post('/api/products',json={'name':'Выбранный товар','sku':'DIRECT-01',
        'manufacturer_id':maker['id'],'type_id':type_id,'unit':unit,'price':120.50}))


def test_binding_saves_dirty_plan_draft_once_without_creating_query_goods(client):
    pid,body=setup(client)
    item=ok(client.post(f'/api/projects/{pid}/elements',json=body))
    path=f'/api/projects/{pid}/quotation';initial=ok(client.get(path))
    product=good(client,body['type_id']);draft=deepcopy(initial)
    draft.update(customer='Новый клиент',global_discount='10')
    line=draft['lines'][0]
    line.update(name='Введённый поисковый запрос',sku='ЧАСТЬ-АРТИКУЛА',manufacturer='Другой бренд',
        comment='Не потерять комментарий',quantity='5',quantity_override='5',discount='15',
        overrides=['name','sku','manufacturer'])
    saved=ok(client.post(path+'/bind',json={'revision':initial['revision'],'line_id':line['id'],
        'product_id':product['id'],'draft':draft}))
    assert saved['revision']==initial['revision']+1
    selected=saved['lines'][0]
    assert selected['product_id']==product['id'] and selected['sku']==product['sku']
    assert selected['name']==product['name'] and selected['manufacturer']==product['manufacturer']
    assert Decimal(selected['quantity'])==5 and Decimal(selected['unit_price'])==Decimal('120.50')
    assert selected['comment']=='Не потерять комментарий' and selected['discount']=='15'
    assert saved['customer']=='Новый клиент' and saved['global_discount']=='10'
    assert saved['partner']['totals']['RUB']['total']=='512.12'
    assert len(ok(client.get('/api/catalog'))['products'])==1
    actual=ok(client.get(f'/api/projects/{pid}'))['elements'][0]
    assert actual['product_id']==product['id'] and actual['parameters']['length']==5
    assert 'display_name' not in actual['parameters'] and '_quotation' not in actual['parameters']
    assert (actual['x'],actual['y'])==(item['x'],item['y'])
    ok(client.post(f'/api/projects/{pid}/elements/undo'))
    restored=ok(client.get(f'/api/projects/{pid}'))['elements'][0]
    assert restored['product_id'] is None and restored['parameters']['length']==3.5


def test_select_before_merging_keeps_other_row_and_accepts_unsaved_rows(client):
    product=good(client,None,'шт')
    created=ok(client.post('/api/quotations',json={'lines':[
        {'id':'keep','name':'Одинаковый текст','quantity':'2','unit_price':'0'},
        {'id':'choose','name':'Редактируемая строка','quantity':'3','unit_price':'0'}]}))
    path=f'/api/quotations/{created["id"]}';draft=deepcopy(created['quotation'])
    draft['lines'][1]['name']='Одинаковый текст'
    saved=ok(client.post(path+'/bind',json={'revision':draft['revision'],'line_id':'choose',
        'product_id':product['id'],'draft':draft}))
    assert len(saved['lines'])==2
    assert saved['lines'][0]['product_id'] is None and Decimal(saved['lines'][0]['quantity'])==2
    assert saved['lines'][1]['product_id']==product['id'] and Decimal(saved['lines'][1]['quantity'])==3
    draft=deepcopy(saved);draft['lines'].append({'id':'new','name':'Новая позиция','quantity':'1','unit_price':'0','comment':'Отдельная строка'})
    saved=ok(client.post(path+'/bind',json={'revision':draft['revision'],'line_id':'new',
        'product_id':product['id'],'draft':draft}))
    assert next(line for line in saved['lines'] if line['id']=='new')['product_id']==product['id']


def test_failed_binding_does_not_save_draft_or_plan_or_create_goods(client):
    pid,body=setup(client);ok(client.post(f'/api/projects/{pid}/elements',json=body))
    path=f'/api/projects/{pid}/quotation';initial=ok(client.get(path));product=good(client,body['type_id'])
    ok(client.patch(f'/api/layers/{body["layer_id"]}',json={'locked':True}))
    draft=deepcopy(initial);draft['customer']='Не сохранять'
    draft['lines'][0].update(name='Поисковый текст',sku='QUERY',manufacturer='Лишняя фабрика')
    before=ok(client.get(f'/api/projects/{pid}'));catalog=ok(client.get('/api/catalog'))
    response=client.post(path+'/bind',json={'revision':initial['revision'],'line_id':draft['lines'][0]['id'],
        'product_id':product['id'],'draft':draft})
    assert response.status_code==409 and 'заблокирован' in response.text
    assert ok(client.get(path))==initial
    assert ok(client.get(f'/api/projects/{pid}'))==before
    assert ok(client.get('/api/catalog'))==catalog


def test_frame_binding_and_clearing_share_draft_transaction_and_undo(client):
    from test_frame_goods import scene,frames
    pid,groups,points,_=scene(client);path=f'/api/projects/{pid}';qpath=path+'/quotation'
    product=good(client,None,'шт');initial=ok(client.get(qpath));draft=deepcopy(initial)
    line=next(line for line in frames(draft) if groups[0] in line['source_frame_ids'])
    line['comment']='Рамки из общей базы';draft['contact']='Контакт сохранён'
    saved=ok(client.post(qpath+'/bind',json={'revision':draft['revision'],'line_id':line['id'],
        'product_id':product['id'],'draft':draft}))
    bound=next(line for line in frames(saved) if line['product_id']==product['id'])
    members=[item for group in points[:3] for item in group]
    actual=ok(client.get(path))['elements']
    assert all(item['product_id'] is None for item in actual)
    assert all(item['parameters'].get('frame_product_id')==product['id'] for item in actual if item['id'] in {e['id'] for e in members})
    assert saved['contact']=='Контакт сохранён' and bound['comment']=='Рамки из общей базы'
    ok(client.post(path+'/elements/undo'))
    assert all(item['parameters'].get('frame_product_id') is None for item in ok(client.get(path))['elements'])
    # Re-selecting explicitly after plan undo must work on the first attempt.
    draft=ok(client.get(qpath));line=next(line for line in frames(draft) if groups[0] in line['source_frame_ids'])
    saved=ok(client.post(qpath+'/bind',json={'revision':draft['revision'],'line_id':line['id'],'product_id':product['id'],'draft':draft}))
    line=next(line for line in frames(saved) if line['product_id']==product['id'])
    cleared=ok(client.post(qpath+'/bind',json={'revision':saved['revision'],'line_id':line['id'],'product_id':None,'draft':saved}))
    assert all(item['parameters'].get('frame_product_id') is None for item in ok(client.get(path))['elements'])
    assert all(line['product_id'] is None for line in frames(cleared))
    assert len(ok(client.get('/api/catalog'))['products'])==1
