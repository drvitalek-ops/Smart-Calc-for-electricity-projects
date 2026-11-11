"""Undo must freeze nested data and keep a bounded working set."""
import zlib
from app import main
from test_workflow import client,setup


def test_snapshot_freezes_geometry_rooms_pages_and_custom_fields(client):
    pid,body=setup(client)
    assert client.post(f"/api/pages/{body['page_id']}/calibrate",json={'x1':.1,'y1':.1,'x2':.6,'y2':.1,'real_length_mm':5000}).status_code==200
    body['geometry']={'points':[{'x':.2,'y':.4},{'x':.8,'y':.4}]}
    body['parameters']={**body['parameters'],'custom:Протокол':'DALI','plan_icon':'LED'}
    response=client.post(f'/api/projects/{pid}/elements',json=body);assert response.status_code==201,response.text
    created=response.json()
    with main.Session() as db:
        snapshot=main.element_snapshot(db,pid)
        before=main.unpack_snapshot(snapshot)
        item=db.get(main.Element,created['id'])
        item.parameters['custom:Протокол']='Изменено'
        item.geometry['points'][0]['x']=.7
        page=db.get(main.Page,body['page_id']);page.scale=1.75
        assert main.unpack_snapshot(snapshot)==before
    assert isinstance(snapshot,bytes)
    assert len(snapshot)<len(zlib.decompress(snapshot))/2
    assert before['elements'][0]['geometry']['points'][0]['x']==.2
    assert before['pages'][body['page_id']]['scale']==1
    assert before['rooms'][0]['name']=='Ванная'


def test_empty_history_does_not_snapshot_a_large_project(client,monkeypatch):
    pid=client.post('/api/projects',json={'name':'Empty history'}).json()['id']
    def forbidden(*args):raise AssertionError('Empty undo must not scan the project')
    monkeypatch.setattr(main,'element_snapshot',forbidden)
    assert client.post(f'/api/projects/{pid}/elements/undo').json()=={'undone':False}
    assert client.post(f'/api/projects/{pid}/elements/redo').json()=={'undone':False}


def test_history_memory_evicts_inactive_projects_and_retains_redo(client,monkeypatch):
    monkeypatch.setattr(main,'ELEMENT_HISTORY_BYTES',500)
    monkeypatch.setattr(main,'ELEMENT_HISTORY_TOTAL_BYTES',800)
    with main.ELEMENT_HISTORY_LOCK:
        main.ELEMENT_HISTORY[1]=[b'a'*100 for _ in range(7)]
        main.ELEMENT_REDO[1]=[b'b'*100 for _ in range(2)]
        main.trim_history(1)
        assert sum(map(len,main.ELEMENT_HISTORY[1]+main.ELEMENT_REDO[1]))<=500
        assert main.ELEMENT_HISTORY[1] and main.ELEMENT_REDO[1]
        main.ELEMENT_HISTORY[2]=[b'c'*100 for _ in range(5)]
        main.trim_history(2)
        assert 1 not in main.ELEMENT_HISTORY and 1 not in main.ELEMENT_REDO
        assert main.ELEMENT_HISTORY[2]==[b'c'*100 for _ in range(5)]
        main.ELEMENT_HISTORY[2]=[b'x']*75
        main.trim_history(2)
        assert len(main.ELEMENT_HISTORY[2])==50
