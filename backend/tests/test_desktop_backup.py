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


def test_archive_includes_live_wal_commits_and_verified_files(tmp_path):
    root,_=desktop_data(tmp_path)
    database=sqlite3.connect(root/'smart-home-calc.db');database.execute('PRAGMA journal_mode=WAL')
    database.execute("INSERT INTO projects VALUES(2,'Добавлен в WAL')");database.commit()
    path=create_full_archive(root,'1.0.43')
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
