"""Offline restore points and portable full backups of the desktop database."""
from contextlib import closing
from datetime import datetime,timezone
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import shutil
import sqlite3
import tempfile
import time
import zipfile

_VERSION=re.compile(r'^v?(\d+)\.(\d+)\.(\d+)$')


def version_tuple(value):
    match=_VERSION.fullmatch(str(value))
    return tuple(map(int,match.groups())) if match else None


def previous_version(root,current=None):
    candidates=[]
    directory=Path(root).parent/'rollback'
    if not directory.is_dir():return None
    current_number=version_tuple(current) if current else None
    for folder in directory.iterdir():
        version=version_tuple(folder.name)
        if not version or current_number and version>=current_number or folder.is_symlink():continue
        if all((folder/name).is_file() for name in ('SmartHomeCalc.Desktop.exe','SmartHomeCalc.Backend.exe')):
            candidates.append((version,folder))
    return max(candidates,key=lambda item:item[0])[1] if candidates else None


def _copy_database(source,destination,deadline=None):
    if not source.is_file():raise FileNotFoundError('База данных не найдена')
    with closing(sqlite3.connect(source.as_uri()+'?mode=ro',uri=True,timeout=15)) as original,closing(sqlite3.connect(destination)) as backup:
        def progress(*_):
            if deadline is not None and time.monotonic()>deadline:raise TimeoutError('Автоматическая копия заняла слишком много времени; создайте полную копию ZIP в настройках')
        original.backup(backup,pages=256,progress=progress)
        if backup.execute('PRAGMA quick_check').fetchall()!=[('ok',)]:raise ValueError('Не удалось проверить целостность базы')


def preserve_before_upgrade(root,current):
    """Snapshot once. Managed plan files are immutable, so hard links preserve
    deleted originals without copying large PDFs on a normal NTFS installation.
    A regular copy is used on filesystems that do not support hard links.
    """
    root=Path(root).resolve();previous=previous_version(root,current)
    if previous is None or not (root/'smart-home-calc.db').is_file():return None
    destination=previous/'data'
    if destination.is_dir():return destination
    temporary=Path(tempfile.mkdtemp(prefix='.data-',dir=previous))
    deadline=time.monotonic()+25
    copied=0
    try:
        _copy_database(root/'smart-home-calc.db',temporary/'smart-home-calc.db',deadline)
        storage=temporary/'storage';storage.mkdir()
        original_storage=root/'storage'
        if original_storage.is_dir():
            for source in original_storage.rglob('*'):
                if time.monotonic()>deadline:raise TimeoutError('Создайте полную копию ZIP: автоматическая копия хранилища не завершилась за 25 секунд')
                if source.is_symlink():raise ValueError('В хранилище есть символическая ссылка: '+source.name)
                if not source.is_file():continue
                target=storage/source.relative_to(original_storage);target.parent.mkdir(parents=True,exist_ok=True)
                try:os.link(source,target)
                except OSError:
                    copied+=source.stat().st_size
                    if copied>100*1024*1024:raise OSError('Файловая система не поддерживает быструю копию планов; создайте полный ZIP в настройках')
                    shutil.copy2(source,target)
        (temporary/'restore-point.json').write_text(json.dumps({'format':'smart-home-calc-restore-point','created_at':datetime.now(timezone.utc).isoformat(),'before_version':current,'previous_version':previous.name},ensure_ascii=False,indent=2),encoding='utf-8')
        temporary.rename(destination)
        return destination
    finally:
        if temporary.exists():shutil.rmtree(temporary)


def _derived_cache_files(snapshot,storage):
    """Only omit cache levels the application can rebuild from an included PDF."""
    cache=set()
    with closing(sqlite3.connect(snapshot)) as database:
        if not database.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='pages'").fetchone():return cache
        fields={row[1] for row in database.execute('PRAGMA table_info(pages)')}
        if not {'image_path','pdf_path'}<=fields:return cache
        for image,pdf in database.execute('SELECT image_path,pdf_path FROM pages'):
            image,pdf=Path(image).resolve(),Path(pdf).resolve()
            if not image.is_relative_to(storage) or not pdf.is_relative_to(storage) or not image.is_file() or not pdf.is_file():continue
            cache.update(image.with_name(f'{image.stem}-q{edge}.png') for edge in (1024,2048,4096,8192))
    return cache


def create_full_archive(root,version,*,compact=False):
    """Return a temporary ZIP path. The caller deletes it after the download.
    SQLite's backup API includes committed WAL data while the app is open.
    """
    root=Path(root).resolve()
    if not root.is_dir():raise FileNotFoundError('Папка данных не найдена')
    descriptor,path=tempfile.mkstemp(prefix='smart-home-calc-backup-',suffix='.zip')
    os.close(descriptor);archive_path=Path(path)
    try:
        with tempfile.TemporaryDirectory(prefix='smart-home-calc-snapshot-') as temporary:
            snapshot=Path(temporary)/'smart-home-calc.db'
            _copy_database(root/'smart-home-calc.db',snapshot)
            database_size_before=snapshot.stat().st_size
            if compact:
                with closing(sqlite3.connect(snapshot)) as database:
                    database.execute('VACUUM')
                    if database.execute('PRAGMA quick_check').fetchall()!=[('ok',)]:raise ValueError('Не удалось проверить компактную копию базы')
            omitted=_derived_cache_files(snapshot,root/'storage') if compact else set()
            skipped_count=0;skipped_bytes=0
            files=[]
            with zipfile.ZipFile(archive_path,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6 if compact else 1,allowZip64=True) as archive:
                def add(source,name):
                    digest=hashlib.sha256();size=0
                    with source.open('rb') as original,archive.open(name,'w',force_zip64=True) as target:
                        for block in iter(lambda:original.read(1024*1024),b''):
                            target.write(block);digest.update(block);size+=len(block)
                    files.append({'path':name,'size':size,'sha256':digest.hexdigest()})
                add(snapshot,'data/smart-home-calc.db')
                storage=root/'storage'
                if storage.is_dir():
                    for source in sorted(storage.rglob('*')):
                        if source.is_symlink():raise ValueError('Нельзя включить символическую ссылку в резервную копию')
                        if source.is_file():
                            if source in omitted:skipped_count+=1;skipped_bytes+=source.stat().st_size;continue
                            add(source,'data/storage/'+source.relative_to(storage).as_posix())
                manifest={'format':'smart-home-calc-full-backup','format_version':1,'application_version':version,'created_at':datetime.now(timezone.utc).isoformat(),'files':files}
                if compact:manifest['optimization']={'mode':'compact','database_bytes_before':database_size_before,'database_bytes_after':snapshot.stat().st_size,'omitted_cache_files':skipped_count,'omitted_cache_bytes':skipped_bytes}
                archive.writestr('manifest.json',json.dumps(manifest,ensure_ascii=False,indent=2))
                archive.writestr('Восстановление.txt',RESTORE_INSTRUCTIONS)
                archive.writestr('restore-data.ps1',RESTORE_SCRIPT.encode('utf-8-sig'))
                archive.writestr('Restore-data.cmd','@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restore-data.ps1"\r\npause\r\n')
        return archive_path
    except BaseException:
        archive_path.unlink(missing_ok=True)
        raise


RESTORE_INSTRUCTIONS='''Smart Home Calc — полная резервная копия

Архив включает все проекты, каталог, категории, фотографии товаров, КП,
PDF-планы и изображения. Файл manifest.json содержит контрольные суммы.

На Windows:
1. Распакуйте ZIP в отдельную папку.
2. Закройте Smart Home Calc.
3. Запустите Restore-data.cmd и следуйте подсказкам.
   Скрипт проверит контрольные суммы и попросит ввести ВОССТАНОВИТЬ.
   Прежняя папка данных сохранится рядом как data-before-restore-....
4. Запустите нужную версию EXE. Пути к PDF восстановятся автоматически.

Вручную: закройте приложение и скопируйте содержимое папки data из архива
в %LOCALAPPDATA%\\SmartHomeCalc\\data. Сначала сохраните прежнюю папку data.
Не переносите только файл базы: планы находятся в data/storage.
'''

RESTORE_SCRIPT=r'''$ErrorActionPreference = 'Stop'
$staging = $null
try {
    $running = Get-Process -Name 'SmartHomeCalc.Desktop','SmartHomeCalc.Backend' -ErrorAction SilentlyContinue
    if ($running) { throw 'Закройте Smart Home Calc и повторите восстановление.' }
    $manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.format -ne 'smart-home-calc-full-backup' -or $manifest.format_version -ne 1) { throw 'Неизвестный формат резервной копии.' }
    $source = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'data'))
    foreach ($entry in $manifest.files) {
        $path = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot $entry.path))
        if (-not $path.StartsWith($source + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Некорректный путь в резервной копии.' }
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw ('Отсутствует файл: ' + $entry.path) }
        if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw ('Контрольная сумма не совпадает: ' + $entry.path) }
    }
    $root = Join-Path $env:LOCALAPPDATA 'SmartHomeCalc'
    $target = Join-Path $root 'data'
    Write-Host ('Будут восстановлены все данные Smart Home Calc ' + $manifest.application_version)
    Write-Host ('Папка назначения: ' + $target)
    Write-Host 'Текущие данные будут сохранены в отдельную папку перед заменой.'
    if ((Read-Host 'Для продолжения введите ВОССТАНОВИТЬ') -cne 'ВОССТАНОВИТЬ') { Write-Host 'Восстановление отменено.'; exit 0 }
    [IO.Directory]::CreateDirectory($root) | Out-Null
    $staging = Join-Path $root ('data-restoring-' + [Guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory($staging) | Out-Null
    Copy-Item -LiteralPath (Join-Path $source 'smart-home-calc.db') -Destination $staging
    if (Test-Path -LiteralPath (Join-Path $source 'storage')) { Copy-Item -LiteralPath (Join-Path $source 'storage') -Destination $staging -Recurse }
    $previous = Join-Path $root ('data-before-restore-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,6))
    if (Get-Process -Name 'SmartHomeCalc.Desktop','SmartHomeCalc.Backend' -ErrorAction SilentlyContinue) { throw 'Smart Home Calc запущен. Закройте приложение и повторите восстановление.' }
    $moved = $false
    try {
        if (Test-Path -LiteralPath $target) { Move-Item -LiteralPath $target -Destination $previous; $moved = $true }
        Move-Item -LiteralPath $staging -Destination $target
    } catch {
        if ($moved -and -not (Test-Path -LiteralPath $target)) { Move-Item -LiteralPath $previous -Destination $target }
        throw
    }
    Write-Host 'Готово. Запустите нужную версию Smart Home Calc.'
    if ($moved) { Write-Host ('Предыдущие данные: ' + $previous) }
} catch {
    Write-Error $_
    exit 1
} finally {
    if ($staging -and (Test-Path -LiteralPath $staging)) { Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue }
}
'''
