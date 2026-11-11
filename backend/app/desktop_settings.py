"""Open only the data directory configured by the standalone desktop launcher."""
import os
import secrets
import sys
from pathlib import Path

from fastapi import HTTPException


def data_directory():
    configured=os.getenv('SMART_HOME_CALC_DATA_DIR')
    return Path(configured).resolve() if configured else None


def desktop_settings():
    directory=data_directory()
    available=bool(directory and sys.platform=='win32' and hasattr(os,'startfile')
                   and os.getenv('SMART_HOME_CALC_INSTANCE_TOKEN'))
    return {
        'can_open_data_folder':available,
        'data_directory':str(directory) if available else None,
        'instance':os.getenv('SMART_HOME_CALC_INSTANCE_TOKEN','') if available else '',
    }


def verify_instance(instance):
    settings=desktop_settings()
    if not settings['can_open_data_folder']:
        raise HTTPException(409,'Открытие папки доступно в автономном приложении для Windows')
    if not secrets.compare_digest(instance.encode('utf-8'),settings['instance'].encode('utf-8')):
        raise HTTPException(403,'Откройте настройки заново и повторите попытку')
    return settings


def open_data_folder(instance):
    verify_instance(instance)
    directory=data_directory()
    if not directory.is_dir():
        raise HTTPException(404,'Папка данных не найдена')
    try:
        os.startfile(str(directory),'explore')
    except OSError as exc:
        raise HTTPException(500,'Не удалось открыть Проводник. Скопируйте путь к папке из настроек') from exc
    return {'opened':True}


def rollback_settings(current):
    from .desktop_backup import previous_version
    root=data_directory()
    previous=previous_version(root,current) if root and desktop_settings()['can_open_data_folder'] else None
    warning=root/'rollback-warning.txt' if root else None
    return {'can_backup_all':bool(root and desktop_settings()['can_open_data_folder'] and (root/'smart-home-calc.db').is_file()),
        'rollback_version':previous.name.removeprefix('v') if previous else None,
        'rollback_directory':str(previous) if previous else None,
        'rollback_has_data':bool(previous and (previous/'data'/'smart-home-calc.db').is_file()),
        'rollback_warning':warning.read_text(encoding='utf-8')[:2000] if warning and warning.is_file() else ''}


def open_rollback_folder(instance,current):
    from .desktop_backup import previous_version
    verify_instance(instance)
    directory=previous_version(data_directory(),current)
    if directory is None:raise HTTPException(404,'Предыдущая версия не найдена на этом компьютере')
    try:os.startfile(str(directory),'explore')
    except OSError as exc:raise HTTPException(500,'Не удалось открыть папку предыдущей версии') from exc
    return {'opened':True}
