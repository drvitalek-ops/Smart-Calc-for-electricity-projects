"""View-only layer filters and distinct, portable minimal lighting symbols."""
import pymupdf
from app import main
from app.plan_appearance import default_glyph,SYMBOLS
from app.catalog import seed,LIGHTING_COLORS
from test_workflow import client,setup


def test_all_fixture_families_have_distinct_default_symbols():
    expected={'Встроенный светильник':'recessed','Накладной светильник':'surface','Люстра':'chandelier','Бра':'sconce','Подвес':'pendant','Spot':'spot','Линейное освещение':'linear','Wall washer':'wall_washer'}
    assert {name:default_glyph(name,'Освещение') for name in expected}==expected
    assert len(set(expected.values()))==len(expected)
    assert len({LIGHTING_COLORS[name] for name in expected})==len(expected)
    assert default_glyph('Pendant','Освещение')=='pendant' and default_glyph('Linear','Освещение')=='linear'
    assert SYMBOLS['style']['radius']==8


def test_old_yellow_defaults_upgrade_once_but_custom_colors_survive(client):
    types=client.get('/api/types').json()
    recessed=next(item for item in types if item['name']=='Встроенный светильник')
    pendant=next(item for item in types if item['name']=='Подвес')
    with main.Session() as db:
        db.get(main.ElementType,recessed['id']).color='#facc15'
        db.get(main.ElementType,pendant['id']).color='#112233';db.commit();seed(db)
    by_id={item['id']:item for item in client.get('/api/types').json()}
    assert by_id[recessed['id']]['color']==LIGHTING_COLORS[recessed['name']]
    assert by_id[pendant['id']]['color']=='#112233'
    custom=client.post('/api/types',json={'name':'Свой фонарь','category':'Освещение','color':'#facc15'}).json()
    with main.Session() as db:seed(db)
    assert next(item for item in client.get('/api/types').json() if item['id']==custom['id'])['color']=='#facc15'


def test_group_filters_persist_undo_and_backup_without_affecting_specification(client):
    pid,body=setup(client)
    element=client.post(f'/api/projects/{pid}/elements',json=body).json()
    layer_id=body['layer_id'];path=f'/api/layers/{layer_id}'
    before=client.get(f'/api/projects/{pid}/report').json()
    response=client.patch(path,json={'hidden_groups':['type:LED-линия','type:Блок питания LED-ленты','type:LED-линия']})
    assert response.status_code==200,response.text
    groups=response.json()['hidden_groups'];assert len(groups)==2
    assert client.get(f'/api/projects/{pid}/report').json()==before
    project=client.get(f'/api/projects/{pid}').json()
    assert next(layer for layer in project['layers'] if layer['id']==layer_id)['hidden_groups']==groups
    assert project['elements'][0]['id']==element['id']
    client.post(f'/api/projects/{pid}/elements/undo')
    assert next(layer for layer in client.get(f'/api/projects/{pid}').json()['layers'] if layer['id']==layer_id)['hidden_groups']==[]
    client.post(f'/api/projects/{pid}/elements/redo')
    backup=client.get(f'/api/projects/{pid}/backup')
    restored=client.post('/api/projects/import',files={'file':('copy.zip',backup.content,'application/zip')})
    assert restored.status_code==201,restored.text
    copy=client.get('/api/projects/'+str(restored.json()['id'])).json()
    assert next(layer for layer in copy['layers'] if layer['name']=='LED-подсветка')['hidden_groups']==groups
    assert client.get('/api/projects/'+str(copy['id'])+'/report').json()['rows'][0]['quantity']==before['rows'][0]['quantity']
    for invalid in ([''],[' '],['x'*301],[1],['x']*1001):
        assert client.patch(path,json={'hidden_groups':invalid}).status_code==422
    assert client.patch(path,json={'hidden_groups':[]}).json()['hidden_groups']==[]


def test_default_pdf_symbols_are_outlined_and_custom_fills_remain(client):
    pid,body=setup(client)
    typ=next(item for item in client.get('/api/types').json() if item['name']=='Встроенный светильник')
    project=client.get(f'/api/projects/{pid}').json();layer=next(item for item in project['layers'] if item['name']=='Освещение')
    common={**body,'type_id':typ['id'],'layer_id':layer['id'],'parameters':{'quantity':1,'ip':20,'plan_label_visible':False}}
    assert client.post(f'/api/projects/{pid}/elements',json=common).status_code==201
    assert client.post(f'/api/projects/{pid}/elements',json={**common,'x':.7,'parameters':{**common['parameters'],'plan_shape':'diamond','plan_color':'#a13d72','plan_icon':'R'}}).status_code==201
    response=client.get(f"/api/projects/{pid}/pages/{body['page_id']}/export.pdf")
    assert response.status_code==200,response.text
    with pymupdf.open(stream=response.content,filetype='pdf') as document:
        drawings=document[0].get_drawings()
        assert any(item.get('fill')==(1,1,1) and item.get('color') and abs(item['color'][1]-145/255)<.01 for item in drawings)
        assert any(item.get('fill') and abs(item['fill'][0]-161/255)<.01 for item in drawings)
        assert 'R' in document[0].get_text()
