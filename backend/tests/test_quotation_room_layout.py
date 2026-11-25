"""Price shared plan positions once, then distribute quantities by actual rooms."""
from decimal import Decimal
import io
import pymupdf
import pytest
from docx import Document
from test_workflow import client,setup
from app import main


def ok(response):
    assert response.is_success,response.text
    return response.json()


def scene(client):
    pid,base=setup(client)
    project=ok(client.get(f'/api/projects/{pid}'));types=ok(client.get('/api/types'))
    room=ok(client.post(f'/api/projects/{pid}/rooms',json={'name':'Кухня'}))
    fixtures=[]
    for name,room_id,quantity in [('Встроенный светильник',base['room_id'],2),('Встроенный светильник',room['id'],3),('Розетка одинарная',base['room_id'],1),('Розетка одинарная',room['id'],4),('LED-линия',base['room_id'],3.5),('LED-линия',room['id'],2.5)]:
        kind=next(t for t in types if t['name']==name);layer=next(l for l in project['layers'] if l['name']==kind['category'])
        item=ok(client.post(f'/api/projects/{pid}/elements',json={**base,'type_id':kind['id'],'layer_id':layer['id'],'room_id':room_id,'parameters':{'length' if kind['unit']=='м' else 'quantity':quantity,'ip':20}}))
        fixtures.append(item)
    return pid,base,room,fixtures


def test_new_quote_is_combined_and_binding_once_applies_to_every_room(client):
    pid,base,room,items=scene(client);path=f'/api/projects/{pid}/quotation'
    quote=ok(client.get(path));assert quote['room_layout']=='combined' and len(quote['lines'])==3
    assert all(not line['room'] for line in quote['lines'])
    assert sorted(Decimal(line['quantity']) for line in quote['lines'])==[5,5,6]
    light=next(line for line in quote['lines'] if items[0]['id'] in line['source_ids'])
    assert set(light['source_ids'])=={items[0]['id'],items[1]['id']}
    bound=ok(client.post(path+'/product',json={'revision':quote['revision'],'line_id':light['id'],'type_id':light['type_id'],'name':'Светильник выбранный','manufacturer':'Бренд','sku':'LIGHT-01','unit_price':'100'}))
    product_id=next(line['product_id'] for line in bound['lines'] if line['id']==light['id'])
    actual=ok(client.get(f'/api/projects/{pid}'))['elements']
    assert all(next(e for e in actual if e['id']==item['id'])['product_id']==product_id for item in items[:2])
    current=next(line for line in bound['lines'] if line['id']==light['id']);current.update(discount='10',comment='Общий комментарий',manufacturer='Мой бренд',overrides=['manufacturer','unit_price'])
    saved=ok(client.put(path,json=bound));before=saved['partner']['totals']
    product=next(p for p in ok(client.get('/api/catalog'))['products'] if p['id']==product_id)
    ok(client.put('/api/products/'+str(product_id),json={**product,'price':200}))
    split=ok(client.post(path+'/room-layout',json={'revision':saved['revision'],'layout':'rooms'}))
    assert split['room_layout']=='rooms' and len(split['lines'])==6 and split['partner']['totals']==before
    lights=[line for line in split['lines'] if line['type_id']==light['type_id']]
    assert {line['room']:Decimal(line['quantity']) for line in lights}=={'Ванная':Decimal(2),'Кухня':Decimal(3)}
    assert all(line['product_id']==product_id and Decimal(line['unit_price'])==100 and Decimal(line['discount'])==10 and line['manufacturer']=='Мой бренд' and line['comment']=='Общий комментарий' and line['sku']=='LIGHT-01' for line in lights)
    strips=[line for line in split['lines'] if line['type_id']==items[-1]['type_id']]
    assert {line['room']:Decimal(line['quantity']) for line in strips}=={'Ванная':Decimal('3.5'),'Кухня':Decimal('2.5')}
    for mode in ('client','partner'):
        response=client.get(path+'/export.pdf?mode='+mode)
        with pymupdf.open(stream=response.content,filetype='pdf') as pdf:
            text=' '.join(p.get_text() for p in pdf);assert 'Кухня' in text and 'Ванная' in text
    back=ok(client.post(path+'/room-layout',json={'revision':split['revision'],'layout':'combined'}))
    assert len(back['lines'])==3 and all(not line['room'] for line in back['lines']) and back['partner']['totals']==before
    assert ok(client.get(path))==back


def test_room_action_preserves_distinct_prices_comments_and_manual_rows(client):
    pid,base,room,items=scene(client);path=f'/api/projects/{pid}/quotation';quote=ok(client.get(path))
    split=ok(client.post(path+'/room-layout',json={'revision':quote['revision'],'layout':'rooms'}))
    lights=[line for line in split['lines'] if line['type_id']==items[0]['type_id']]
    for i,line in enumerate(lights):line.update(unit_price=str(100+i),comment='Комментарий '+str(i),overrides=['unit_price'])
    split['lines'].append({'id':'manual','name':'Доставка','quantity':'1','unit_price':'500','room':'Ручная группа','comment':'Не менять'})
    saved=ok(client.put(path,json=split));before=saved['client']['totals']
    combined=ok(client.post(path+'/room-layout',json={'revision':saved['revision'],'layout':'combined'}))
    retained=[line for line in combined['lines'] if line['type_id']==items[0]['type_id']]
    assert len(retained)==2 and {line['unit_price'] for line in retained}=={'100','101'}
    assert all(not line['room'] for line in retained) and combined['client']['totals']==before
    manual=next(line for line in combined['lines'] if line['id']=='manual');assert manual['room']=='Ручная группа' and manual['comment']=='Не менять'
    assert ok(client.get(path))==combined


def test_manual_quantity_split_is_rejected_atomically_and_revision_is_checked(client):
    pid,_,_,items=scene(client);path=f'/api/projects/{pid}/quotation';quote=ok(client.get(path))
    light=next(line for line in quote['lines'] if line['type_id']==items[0]['type_id']);light['quantity_override']='12'
    saved=ok(client.put(path,json=quote))
    response=client.post(path+'/room-layout',json={'revision':saved['revision'],'layout':'rooms'})
    assert response.status_code==409 and 'Вручную' in response.json()['detail'] and ok(client.get(path))==saved
    assert client.post(path+'/room-layout',json={'revision':0,'layout':'rooms'}).status_code==409
    light=next(line for line in saved['lines'] if line['type_id']==items[0]['type_id']);light['quantity_override']=None
    saved=ok(client.put(path,json=saved));assert client.post(path+'/room-layout',json={'revision':saved['revision'],'layout':'rooms'}).status_code==200


def test_legacy_quotes_and_old_backups_keep_room_layout_until_explicit_action(client):
    pid,_,_,items=scene(client);path=f'/api/projects/{pid}/quotation';quote=ok(client.get(path))
    split=ok(client.post(path+'/room-layout',json={'revision':quote['revision'],'layout':'rooms'}))
    with main.Session() as db:
        stored=db.get(main.Quotation,pid);stored.content={key:value for key,value in stored.content.items() if key!='room_layout'};db.commit()
    legacy=ok(client.get(path));assert legacy['room_layout']=='legacy' and len(legacy['lines'])==6
    assert all(legacy['lines'][i]['room']==split['lines'][i]['room'] for i in range(6))
    backup=client.get(f'/api/projects/{pid}/backup')
    restored=ok(client.post('/api/projects/import',files={'file':('copy.zip',backup.content,'application/zip')}))
    assert ok(client.get('/api/projects/'+str(restored['id'])+'/quotation'))['room_layout']=='legacy'
    changed=ok(client.post(path+'/room-layout',json={'revision':legacy['revision'],'layout':'combined'}));assert len(changed['lines'])==3


def test_room_layout_word_and_automatic_count_follow_the_selected_mode(client):
    pid,base,room,items=scene(client);path=f'/api/projects/{pid}/quotation';quote=ok(client.get(path))
    split=ok(client.post(path+'/room-layout',json={'revision':quote['revision'],'layout':'rooms'}))
    a=items[0];ok(client.put('/api/elements/'+str(a['id']),json={**a,'parameters':{**a['parameters'],'quantity':7}}))
    current=ok(client.get(path));light=next(line for line in current['lines'] if a['id'] in line['source_ids'])
    assert Decimal(light['quantity'])==7 and light['room']=='Ванная'
    payload={'room_layout':current['room_layout'],'lines':current['lines']}
    response=client.post(path+'/sku.docx',json=payload);assert response.status_code==200,response.text
    word=Document(io.BytesIO(response.content));assert len(word.tables[0].rows)==7
    combined=ok(client.post(path+'/room-layout',json={'revision':current['revision'],'layout':'combined'}))
    light=next(line for line in combined['lines'] if a['id'] in line['source_ids']);assert Decimal(light['quantity'])==10


def test_room_distribution_requires_plan_links_and_does_not_guess_manual_rows(client):
    pid,_=setup(client);path=f'/api/projects/{pid}/quotation';quote=ok(client.get(path))
    quote['lines']=[{'id':'manual','name':'Ручной светильник','quantity':2,'unit_price':100}]
    saved=ok(client.put(path,json=quote))
    response=client.post(path+'/room-layout',json={'revision':saved['revision'],'layout':'rooms'})
    assert response.status_code==422 and 'из расчёта' in response.json()['detail']
    assert ok(client.get(path))==saved


def test_frame_prices_and_quantities_split_combine_and_survive_project_transfer(client):
    pid,base=setup(client);project=ok(client.get(f'/api/projects/{pid}'));types=ok(client.get('/api/types'))
    kind=next(t for t in types if t['name']=='Розетка одинарная');layer=next(l for l in project['layers'] if l['name']==kind['category'])
    room=ok(client.post(f'/api/projects/{pid}/rooms',json={'name':'Кухня'}))
    for room_id in (base['room_id'],room['id']):
        pair=[ok(client.post(f'/api/projects/{pid}/elements',json={**base,'room_id':room_id,'type_id':kind['id'],'layer_id':layer['id'],'x':.2+i*.2,'parameters':{'quantity':1,'ip':20}})) for i in range(2)]
        ok(client.post(f'/api/projects/{pid}/frames',json={'element_ids':[e['id'] for e in pair],'posts':2}))
    path=f'/api/projects/{pid}/quotation';quote=ok(client.get(path))
    frame=next(line for line in quote['lines'] if line['source_key'].startswith('frame:'))
    assert Decimal(frame['quantity'])==2
    quote=ok(client.post(path+'/product',json={'revision':quote['revision'],'line_id':frame['id'],'name':'Рамка производителя','manufacturer':'Завод','sku':'FRAME-2','unit_price':'250'}))
    split=ok(client.post(path+'/room-layout',json={'revision':quote['revision'],'layout':'rooms'}))
    frames=[line for line in split['lines'] if line['source_key'].startswith('frame:')]
    assert len(frames)==2 and all(Decimal(line['quantity'])==1 and Decimal(line['unit_price'])==250 and line['sku']=='FRAME-2' for line in frames)
    assert split['client']['totals']['RUB']['total']=='500.00'
    backup=client.get(f'/api/projects/{pid}/backup');copy=ok(client.post('/api/projects/import',files={'file':('copy.zip',backup.content,'application/zip')}))
    copied=ok(client.get('/api/projects/'+str(copy['id'])+'/quotation'));assert copied['room_layout']=='rooms' and copied['client']['totals']==split['client']['totals']
    # Different frame terms have no element IDs to disambiguate an automatic merge.
    frames[0]['unit_price']='300';saved=ok(client.put(path,json=split))
    assert client.post(path+'/room-layout',json={'revision':saved['revision'],'layout':'combined'}).status_code==409
    assert ok(client.get(path))==saved
    for line in saved['lines']:
        if line['source_key'].startswith('frame:'):line['unit_price']='250'
    saved=ok(client.put(path,json=saved));combined=ok(client.post(path+'/room-layout',json={'revision':saved['revision'],'layout':'combined'}))
    frame=next(line for line in combined['lines'] if line['source_key'].startswith('frame:'))
    assert Decimal(frame['quantity'])==2 and Decimal(frame['unit_price'])==250 and combined['client']['totals']['RUB']['total']=='500.00'


def test_all_plan_categories_distribute_like_specification_without_lights_or_sockets(client):
    pid,base=setup(client);path=f'/api/projects/{pid}/quotation'
    project=ok(client.get(f'/api/projects/{pid}'));types=ok(client.get('/api/types'))
    kitchen=ok(client.post(f'/api/projects/{pid}/rooms',json={'name':'Кухня'}))
    custom=ok(client.post('/api/types',json={'name':'Свой модуль','category':'Пользовательское оборудование','unit':'шт','defaults':{'quantity':1}}))
    custom_layer=ok(client.post(f'/api/projects/{pid}/layers',json={'name':custom['category']}))
    project['layers'].append(custom_layer);types.append(custom)
    names=['LED-линия','Блок питания LED-ленты','Алюминиевый профиль','Движение','Электрокарниз','Zigbee диммер двухканальный','Свой модуль']
    tape=None
    for name in names:
        kind=next(t for t in types if t['name']==name)
        layer=next(l for l in project['layers'] if l['name']==kind['category'])
        for index,room_id in enumerate((base['room_id'],kitchen['id'],None)):
            parameters={'length':1.25+index*.5} if kind['unit']=='м' else {'quantity':index+1}
            # Supply placement room, rather than its linked tape's room, follows the report.
            if name=='Блок питания LED-ленты':parameters.update(power_watts=60,led_strip_ids=[tape])
            item=ok(client.post(f'/api/projects/{pid}/elements',json={**base,'type_id':kind['id'],'layer_id':layer['id'],'room_id':room_id,'parameters':parameters}))
            if name=='LED-линия' and tape is None:tape=item['id']
    report=ok(client.get(f'/api/projects/{pid}/report'))['rows'];quote=ok(client.get(path))
    assert len(quote['lines'])==len(names) and all(not line['room'] for line in quote['lines'])
    for index,line in enumerate(quote['lines']):line.update(unit_price=str(100+index*10),discount='10',comment='Сохранить '+str(index))
    saved=ok(client.put(path,json=quote));terms={line['type_id']:(line['unit_price'],line['discount'],line['comment']) for line in saved['lines']}
    split=ok(client.post(path+'/room-layout',json={'revision':saved['revision'],'layout':'rooms'}))
    expected={(row['type_id'],row['room']):(Decimal(str(row['quantity'])),row['unit'],set(row['element_ids'])) for row in report}
    actual={(line['type_id'],line['room']):(Decimal(line['quantity']),line['unit'],set(line['source_ids'])) for line in split['lines']}
    assert actual==expected and len(split['lines'])==len(names)*3
    assert all((line['unit_price'],line['discount'],line['comment'])==terms[line['type_id']] for line in split['lines'])
    assert split['partner']['totals']==saved['partner']['totals'] and ok(client.get(path))==split
    for mode in ('client','partner'):
        response=client.get(path+'/export.pdf?mode='+mode);assert response.is_success
        with pymupdf.open(stream=response.content,filetype='pdf') as pdf:
            text=' '.join(p.get_text() for p in pdf)
            assert all(name in text for name in ('Ванная','Кухня','Без помещения','Блок питания LED-ленты','Свой модуль')) and 'Общие позиции' not in text
    # Existing pre-v63 room mode can be redistributed again without re-entering terms.
    combined=ok(client.post(path+'/room-layout',json={'revision':split['revision'],'layout':'combined'}))
    assert len(combined['lines'])==len(names) and combined['partner']['totals']==saved['partner']['totals']
    with main.Session() as db:
        stored=db.get(main.Quotation,pid);stored.content={**stored.content,'room_layout':'rooms','lines':[{**line,'room':'Общие позиции'} for line in stored.content['lines']]};db.commit()
    old=ok(client.get(path));redistributed=ok(client.post(path+'/room-layout',json={'revision':old['revision'],'layout':'rooms'}))
    assert {(line['type_id'],line['room']):(Decimal(line['quantity']),line['unit'],set(line['source_ids'])) for line in redistributed['lines']}==expected
    assert redistributed['partner']['totals']==saved['partner']['totals']


def test_frames_created_after_quote_appear_in_rooms_and_export(client):
    pid,base,room,items=scene(client);path=f'/api/projects/{pid}/quotation'
    quote=ok(client.get(path));assert not any(line['source_key'].startswith('frame:') for line in quote['lines'])
    for item in items[2:4]:
        ok(client.post(f'/api/projects/{pid}/frames',json={'element_ids':[item['id']],'posts':1}))
    expected={row['room']:Decimal(str(row['quantity'])) for row in ok(client.get(f'/api/projects/{pid}/report'))['rows'] if row['category']=='Рамки'}
    split=ok(client.post(path+'/room-layout',json={'revision':quote['revision'],'layout':'rooms'}))
    frames=[line for line in split['lines'] if line['source_key'].startswith('frame:')]
    assert {line['room']:Decimal(line['quantity']) for line in frames}==expected
    assert sum(Decimal(line['quantity']) for line in frames)==2
    assert ok(client.get(path))==split
    for mode in ('client','partner'):
        response=client.get(path+'/export.pdf?mode='+mode);assert response.is_success
        with pymupdf.open(stream=response.content,filetype='pdf') as pdf:
            assert 'Рамка на 1 пост' in ''.join(page.get_text() for page in pdf)
    combined=ok(client.post(path+'/room-layout',json={'revision':split['revision'],'layout':'combined'}))
    assert sum(Decimal(line['quantity']) for line in combined['lines'] if line['source_key'].startswith('frame:'))==2


def test_new_room_frames_keep_existing_terms_and_new_sizes_are_separate(client):
    pid,base,room,items=scene(client);path=f'/api/projects/{pid}/quotation'
    ok(client.post(f'/api/projects/{pid}/frames',json={'element_ids':[items[2]['id']],'posts':1}))
    quote=ok(client.get(path));frame=next(line for line in quote['lines'] if line['source_key'].startswith('frame:'))
    quote=ok(client.post(path+'/product',json={'revision':quote['revision'],'line_id':frame['id'],'name':'Рамка заказная','manufacturer':'Завод','sku':'FRAME-1','unit_price':'250'}))
    frame=next(line for line in quote['lines'] if line['source_key'].startswith('frame:'));frame.update(discount='10',comment='Согласованная рамка')
    quote=ok(client.put(path,json=quote));quote=ok(client.post(path+'/room-layout',json={'revision':quote['revision'],'layout':'rooms'}))
    ok(client.post(f'/api/projects/{pid}/frames',json={'element_ids':[items[3]['id']],'posts':1}))
    pair=[ok(client.post(f'/api/projects/{pid}/elements',json={**items[2],'x':.4+i*.1})) for i in range(2)]
    ok(client.post(f'/api/projects/{pid}/frames',json={'element_ids':[e['id'] for e in pair],'posts':2}))
    current=ok(client.get(path));frames=[line for line in current['lines'] if line['source_key'].startswith('frame:')]
    singles=[line for line in frames if line['source_key'].endswith(':Рамка на 1 пост')]
    assert len(singles)==2 and {line['room'] for line in singles}=={'Ванная','Кухня'}
    assert all(line['sku']=='FRAME-1' and Decimal(line['unit_price'])==250 and Decimal(line['discount'])==10 and line['comment']=='Согласованная рамка' for line in singles)
    double=next(line for line in frames if line['source_key'].endswith(':Рамка на 2 поста'))
    assert Decimal(double['quantity'])==1 and Decimal(double['unit_price'])==0 and double['product_id'] is None
    assert current['client']['totals']['RUB']['total']=='500.00' and current['partner']['totals']['RUB']['total']=='450.00'
    assert ok(client.get(path))==current


def test_frame_omission_survives_layout_changes_exports_and_transfer(client):
    pid,base,room,items=scene(client);path=f'/api/projects/{pid}/quotation'
    for item in items[2:4]:ok(client.post(f'/api/projects/{pid}/frames',json={'element_ids':[item['id']],'posts':1}))
    quote=ok(client.get(path));quote=ok(client.post(path+'/room-layout',json={'revision':quote['revision'],'layout':'rooms'}))
    quote['lines']=[line for line in quote['lines'] if not (line['source_key'].startswith('frame:') and line['room']=='Кухня')]
    quote=ok(client.put(path,json=quote))
    assert quote['excluded_frame_keys']==['frame:Кухня:Рамка на 1 пост']
    for layout in ('combined','rooms','combined','rooms'):
        quote=ok(client.post(path+'/room-layout',json={'revision':quote['revision'],'layout':layout}))
        frames=[line for line in quote['lines'] if line['source_key'].startswith('frame:')]
        assert sum(Decimal(line['quantity']) for line in frames)==1
        if layout=='rooms':assert [line['room'] for line in frames]==['Ванная']
    archive=client.get(f'/api/projects/{pid}/backup');copy=ok(client.post('/api/projects/import',files={'file':('copy.zip',archive.content,'application/zip')}))
    copied=ok(client.get('/api/projects/'+str(copy['id'])+'/quotation'))
    assert copied['excluded_frame_keys']==quote['excluded_frame_keys']
    assert sum(Decimal(line['quantity']) for line in copied['lines'] if line['source_key'].startswith('frame:'))==1
    # Removing the last frame in an unsaved draft must also affect both exports.
    quote['lines']=[line for line in quote['lines'] if not line['source_key'].startswith('frame:')]
    response=client.post(path+'/preview.pdf?mode=client',json=quote);assert response.is_success,response.text
    with pymupdf.open(stream=response.content,filetype='pdf') as pdf:assert 'Рамка на' not in ''.join(page.get_text() for page in pdf)
    response=client.post(path+'/sku.docx',json=quote);assert response.is_success,response.text
    assert not any('Рамка на' in cell.text for row in Document(io.BytesIO(response.content)).tables[0].rows for cell in row.cells)
    assert any(line['source_key'].startswith('frame:') for line in ok(client.get(path))['lines'])
    # Explicit reimport restores omissions, unlike switching display modes.
    restored=ok(client.post(path+'/import',json={'revision':quote['revision']}))
    assert restored['excluded_frame_keys']==[]
    assert sum(Decimal(line['quantity']) for line in restored['lines'] if line['source_key'].startswith('frame:'))==2


@pytest.mark.parametrize('layout',['combined','rooms','legacy'])
def test_old_quotes_recover_missing_frame_rows(client,layout):
    pid,base,room,items=scene(client);path=f'/api/projects/{pid}/quotation'
    for item in items[2:4]:ok(client.post(f'/api/projects/{pid}/frames',json={'element_ids':[item['id']],'posts':1}))
    ok(client.get(path))
    with main.Session() as db:
        stored=db.get(main.Quotation,pid)
        content={key:value for key,value in stored.content.items() if key not in ('plan_frame_snapshot_keys','excluded_frame_keys')}
        content['room_layout']=layout;content['lines']=[line for line in content['lines'] if not line['source_key'].startswith('frame:')]
        stored.content=content;db.commit()
    quote=ok(client.get(path));assert sum(Decimal(line['quantity']) for line in quote['lines'] if line['source_key'].startswith('frame:'))==2
    split=ok(client.post(path+'/room-layout',json={'revision':quote['revision'],'layout':'rooms'}))
    assert {line['room']:Decimal(line['quantity']) for line in split['lines'] if line['source_key'].startswith('frame:')}=={'Ванная':Decimal(1),'Кухня':Decimal(1)}
