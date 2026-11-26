import io
import json
import zipfile

from test_workflow import client, setup


def test_last_worked_page_follows_placement_and_editing_not_reads(client):
    pid, body = setup(client)
    pages = client.get(f'/api/projects/{pid}').json()['pages']
    body['page_id'] = pages[1]['id']
    item = client.post(f'/api/projects/{pid}/elements', json=body).json()
    assert client.get(f'/api/projects/{pid}').json()['last_worked_page_id'] == pages[1]['id']
    # Reading another page and exporting a report must not move the bookmark.
    client.get(f"/api/pages/{pages[0]['id']}/image")
    client.get(f'/api/projects/{pid}/report')
    assert client.get(f'/api/projects/{pid}').json()['last_worked_page_id'] == pages[1]['id']
    second = client.post(f'/api/projects/{pid}/elements', json={**body, 'page_id': pages[0]['id']}).json()
    assert client.get(f'/api/projects/{pid}').json()['last_worked_page_id'] == pages[0]['id']
    edited = client.put(f"/api/elements/{item['id']}", json={**body, 'x': .4})
    assert edited.status_code == 200
    assert client.get(f'/api/projects/{pid}').json()['last_worked_page_id'] == pages[1]['id']
    assert client.post(f'/api/projects/{pid}/elements/undo').status_code == 200
    restored = client.get(f'/api/projects/{pid}').json()
    assert restored['last_worked_page_id'] == pages[1]['id']
    assert next(row for row in restored['elements'] if row['id'] == item['id'])['x'] == .2
    assert len(restored['elements']) == 2
    assert client.get(f'/api/projects/{pid}/report').json()['rows'][0]['quantity'] == 7


def test_workspace_settings_round_trip_and_project_transfer(client):
    pid, body = setup(client)
    page_id = client.get(f'/api/projects/{pid}').json()['pages'][1]['id']
    client.post(f'/api/projects/{pid}/elements', json={**body, 'page_id': page_id})
    settings = {'symbolScale': .6, 'labelsVisible': False, 'roomLabelsVisible': False,
                'showRoomContours': False, 'adaptiveLabels': False, 'leftTool': 'style'}
    response = client.patch(f'/api/projects/{pid}/view-settings', json=settings)
    assert response.status_code == 200, response.text
    assert response.json() == settings
    assert client.patch(f'/api/projects/{pid}/view-settings', json={'showGrid': False}).status_code == 200
    expected = {**settings, 'showGrid': False}
    project = client.get(f'/api/projects/{pid}').json()
    assert project['view_settings'] == expected
    assert project['last_worked_page_id'] == page_id
    history = project['history']
    assert client.patch(f'/api/projects/{pid}/view-settings', json={'symbolScale': 200}).status_code == 422
    assert client.patch(f'/api/projects/{pid}/view-settings', json={'roomLabelsVisible': 'yes'}).status_code == 422
    assert client.patch(f'/api/projects/{pid}/view-settings', json={'unknown': True}).status_code == 422
    assert client.get(f'/api/projects/{pid}').json()['history'] == history
    backup = client.get(f'/api/projects/{pid}/backup').content
    response = client.post('/api/projects/import', files={'file': ('project.zip', backup, 'application/zip')})
    assert response.status_code == 201, response.text
    restored = client.get(f"/api/projects/{response.json()['id']}").json()
    assert restored['view_settings'] == expected
    assert restored['last_worked_page_id'] == restored['pages'][1]['id'] != page_id
    # Historical ZIPs without workspace metadata still restore.
    with zipfile.ZipFile(io.BytesIO(backup)) as archive:
        entries = {name: archive.read(name) for name in archive.namelist()}
    manifest = json.loads(entries['manifest.json'])
    manifest.pop('last_worked_page_backup_id', None)
    manifest.pop('view_settings', None)
    entries['manifest.json'] = json.dumps(manifest).encode()
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as archive:
        for name, content in entries.items(): archive.writestr(name, content)
    old = client.post('/api/projects/import', files={'file': ('old.zip', output.getvalue(), 'application/zip')})
    assert old.status_code == 201, old.text
    legacy = client.get(f"/api/projects/{old.json()['id']}").json()
    assert legacy['view_settings'] == {}
    assert legacy['last_worked_page_id'] == legacy['pages'][1]['id']


def test_stale_preferences_do_not_overwrite_newer_snapshot(client):
    pid, _ = setup(client)
    path = f'/api/projects/{pid}/view-settings'
    latest = {'savedAt': 2000, 'labelsVisible': False, 'symbolScale': .7}
    assert client.patch(path, json=latest).json() == latest
    assert client.patch(path, json={'savedAt': 1000, 'labelsVisible': True}).json() == latest
    assert client.get(f'/api/projects/{pid}').json()['view_settings'] == latest
