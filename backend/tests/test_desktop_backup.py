import hashlib
import json
import os
from pathlib import Path
import sqlite3
import zipfile
import pytest
from app.desktop_backup import create_full_archive,preserve_before_upgrade,previous_version


def desktop_data(tmp_path):
    root=tmp_path/'SmartHomeCalc'/'data';(root/'storage').mkdir(parents=True)
    with sqlite3.connect(root/'smart-home-calc.db') as database:
        database.execute('CREATE TABLE projects(id INTEGER PRIMARY KEY,name TEXT)')
        database.execute("INSERT INTO projects VALUES(1,'Проект с рамками')")
    (root/'storage'/'план.pdf').write_bytes(b'%PDF-1.7\nmanaged immutable plan')
    previous=root.parent/'rollback'/'v1.0.42';previous.mkdir(parents=True)
    for name in ('SmartHomeCalc.Desktop.exe','SmartHomeCalc.Backend.exe'):(previous/name).write_bytes(b'previous executable')
    return root,previous


def test_upgrade_snapshot_keeps_deleted_storage_and_original_database(tmp_path):
    root,previous=desktop_data(tmp_path)
    point=preserve_before_upgrade(root,'1.0.43');assert point==previous/'data'
    with sqlite3.connect(root/'smart-home-calc.db') as database:database.execute("UPDATE projects SET name='Изменённый проект'")
    original=root/'storage'/'план.pdf';original.unlink()
    assert (point/'storage'/'план.pdf').read_bytes().startswith(b'%PDF')
    with sqlite3.connect(point/'smart-home-calc.db') as database:assert database.execute('SELECT name FROM projects').fetchone()[0]=='Проект с рамками'
    assert preserve_before_upgrade(root,'1.0.43')==point
    assert previous_version(root,'1.0.42') is None
    assert previous_version(root,'1.0.43')==previous


@pytest.mark.parametrize('compact',[False,True])
def test_archive_includes_live_wal_commits_and_verified_files(tmp_path,compact):
    root,_=desktop_data(tmp_path)
    database=sqlite3.connect(root/'smart-home-calc.db');database.execute('PRAGMA journal_mode=WAL')
    database.execute("INSERT INTO projects VALUES(2,'Добавлен в WAL')");database.commit()
    path=create_full_archive(root,'1.0.43',compact=compact)
    try:
        with zipfile.ZipFile(path) as archive:
            manifest=json.loads(archive.read('manifest.json'))
            assert manifest['format']=='smart-home-calc-full-backup'
            for item in manifest['files']:
                data=archive.read(item['path']);assert len(data)==item['size'];assert hashlib.sha256(data).hexdigest()==item['sha256']
            extracted=tmp_path/'restored';archive.extractall(extracted)
            assert archive.read('restore-data.ps1').startswith(b'\xef\xbb\xbf')
            assert 'ВОССТАНОВИТЬ' in archive.read('restore-data.ps1').decode('utf-8-sig')
        with sqlite3.connect(extracted/'data'/'smart-home-calc.db') as restored:
            assert restored.execute('PRAGMA quick_check').fetchone()[0]=='ok'
            assert restored.execute('SELECT COUNT(*) FROM projects').fetchone()[0]==2
    finally:path.unlink();database.close()


def test_incomplete_snapshot_is_not_published_and_source_stays_intact(tmp_path,monkeypatch):
    import app.desktop_backup as module
    root,previous=desktop_data(tmp_path)
    def fail(*args,**kwargs):raise OSError('disk full')
    monkeypatch.setattr(module.os,'link',fail);monkeypatch.setattr(module.shutil,'copy2',fail)
    with pytest.raises(OSError):preserve_before_upgrade(root,'1.0.43')
    assert not (previous/'data').exists()
    assert not list(previous.glob('.data-*'))
    assert (root/'storage'/'план.pdf').is_file()


def test_backup_rejects_external_symlinks(tmp_path):
    root,_=desktop_data(tmp_path)
    external=tmp_path/'outside.pdf';external.write_bytes(b'not managed')
    try:(root/'storage'/'external.pdf').symlink_to(external)
    except OSError:pytest.skip('Symlinks unavailable on this filesystem')
    with pytest.raises(ValueError,match='ссылк'):create_full_archive(root,'1.0.43')


def test_ticket_expiry_and_replacement_remove_unused_archives(tmp_path):
    from app.backup_downloads import BackupDownloads
    tickets=BackupDownloads();one=tmp_path/'one.zip';two=tmp_path/'two.zip';one.write_bytes(b'one');two.write_bytes(b'two')
    first=tickets.add(one,'one.zip');second=tickets.add(two,'two.zip')
    assert not one.exists() and tickets.take(first) is None
    assert tickets.take(second)==(two,'two.zip')
    assert tickets.take(second) is None
    two.unlink()


def test_compact_archive_keeps_data_and_photos_but_omits_only_rebuildable_cache(tmp_path):
    root,_=desktop_data(tmp_path);storage=root/'storage';image=storage/'plan.png';pdf=storage/'plan.pdf'
    image.write_bytes(b'original plan image');pdf.write_bytes(b'%PDF immutable source')
    cache=storage/'plan-q1024.png';cache.write_bytes(b'cached-render'*1000)
    unknown=storage/'other-q1024.png';unknown.write_bytes(b'not registered as a cache')
    photo=b'unchanged product photo';database=root/'smart-home-calc.db'
    with sqlite3.connect(database) as db:
        db.execute('CREATE TABLE pages(image_path TEXT,pdf_path TEXT)');db.execute('INSERT INTO pages VALUES(?,?)',(str(image),str(pdf)))
        db.execute('CREATE TABLE products(id INTEGER PRIMARY KEY,photo BLOB)');db.execute('INSERT INTO products VALUES(1,?)',(photo,))
        db.execute('CREATE TABLE disposable(payload BLOB)');db.executemany('INSERT INTO disposable VALUES(?)',[(b'x'*10000,)]*100);db.execute('DELETE FROM disposable')
    original=hashlib.sha256(database.read_bytes()).hexdigest();archive_path=create_full_archive(root,'1.0.70',compact=True)
    try:
        with zipfile.ZipFile(archive_path) as archive:
            assert 'data/storage/plan-q1024.png' not in archive.namelist()
            assert archive.read('data/storage/other-q1024.png')==unknown.read_bytes()
            assert archive.read('data/storage/plan.png')==image.read_bytes()
            assert archive.read('data/storage/plan.pdf')==pdf.read_bytes()
            manifest=json.loads(archive.read('manifest.json'));details=manifest['optimization']
            assert details['omitted_cache_files']==1 and details['omitted_cache_bytes']==cache.stat().st_size
            assert details['database_bytes_after']<details['database_bytes_before']
            for item in manifest['files']:assert hashlib.sha256(archive.read(item['path'])).hexdigest()==item['sha256']
            destination=tmp_path/'restored-compact';archive.extractall(destination)
        with sqlite3.connect(destination/'data'/'smart-home-calc.db') as restored:
            assert restored.execute('SELECT photo FROM products').fetchone()[0]==photo
            assert restored.execute('SELECT name FROM projects').fetchone()[0]=='Проект с рамками'
            assert restored.execute('PRAGMA quick_check').fetchone()[0]=='ok'
            assert restored.execute('PRAGMA freelist_count').fetchone()[0]==0
        assert hashlib.sha256(database.read_bytes()).hexdigest()==original
        assert cache.is_file() and unknown.is_file()
    finally:archive_path.unlink()


def test_compact_archive_keeps_cache_when_original_pdf_is_missing(tmp_path):
    root,_=desktop_data(tmp_path);storage=root/'storage';image=storage/'scan.png';image.write_bytes(b'original image')
    cache=storage/'scan-q2048.png';cache.write_bytes(b'only cached image')
    with sqlite3.connect(root/'smart-home-calc.db') as db:
        db.execute('CREATE TABLE pages(image_path TEXT,pdf_path TEXT)');db.execute('INSERT INTO pages VALUES(?,?)',(str(image),str(storage/'missing.pdf')))
    path=create_full_archive(root,'1.0.70',compact=True)
    try:
        with zipfile.ZipFile(path) as archive:assert archive.read('data/storage/scan-q2048.png')==cache.read_bytes()
    finally:path.unlink()


def test_desktop_compact_backup_endpoint_preserves_workspace_and_guards(tmp_path):
    import subprocess
    import sys
    root=tmp_path/'data';root.mkdir()
    script='''
import io,json,sqlite3,zipfile
from pathlib import Path
from types import SimpleNamespace
import pymupdf
from fastapi.testclient import TestClient
from app.main import app
import app.desktop_settings as desktop
root=Path(__import__('os').environ['SMART_HOME_CALC_DATA_DIR'])
desktop.sys=SimpleNamespace(platform='win32')
desktop.os.startfile=lambda *args:None
with TestClient(app) as client:
    project=client.post('/api/projects',json={'name':'Компактный перенос проекта'}).json()
    pid=project['id']
    pdf=pymupdf.open();pdf.new_page()
    client.post(f'/api/projects/{pid}/pdf',files={'file':('plan.pdf',pdf.tobytes(),'application/pdf')})
    settings={'symbolScale':.7,'roomLabelsVisible':False,'savedAt':1000}
    assert client.patch(f'/api/projects/{pid}/view-settings',json=settings).status_code==200
    with sqlite3.connect(root/'smart-home-calc.db') as db:
        image=Path(db.execute('SELECT image_path FROM pages').fetchone()[0])
    cache=image.with_name(image.stem+'-q1024.png');cache.write_bytes(b'rebuildable cache')
    endpoint='/api/settings/backups?compact=true'
    assert client.post(endpoint,json={'instance':'wrong'}).status_code==403
    assert client.post(endpoint,headers={'Origin':'https://outside.example'},json={'instance':'backup-test'}).status_code==403
    response=client.post(endpoint,json={'instance':'backup-test'})
    assert response.status_code==200,response.text
    result=response.json()
    assert result['optimization']['omitted_cache_files']==1
    assert result['filename'].endswith('-compact.zip')
    download=client.get(result['url']);assert download.status_code==200
    with zipfile.ZipFile(io.BytesIO(download.content)) as archive:
        manifest=json.loads(archive.read('manifest.json'))
        assert manifest['optimization']==result['optimization']
        copy=root.parent/'snapshot.db';copy.write_bytes(archive.read('data/smart-home-calc.db'))
    with sqlite3.connect(copy) as db:
        name,preferences=db.execute('SELECT name,view_settings FROM projects WHERE id=?',(pid,)).fetchone()
        assert name=='Компактный перенос проекта'
        assert json.loads(preferences)==settings
    assert cache.is_file()
    assert client.get(result['url']).status_code==404
'''
    result=subprocess.run([sys.executable,'-c',script],env={**os.environ,'DATABASE_URL':f'sqlite:///{root}/smart-home-calc.db','AUTO_CREATE_SCHEMA':'1','STORAGE_DIR':str(root/'storage'),'SMART_HOME_CALC_DATA_DIR':str(root),'SMART_HOME_CALC_INSTANCE_TOKEN':'backup-test'},capture_output=True,text=True,timeout=30)
    assert result.returncode==0,result.stderr
