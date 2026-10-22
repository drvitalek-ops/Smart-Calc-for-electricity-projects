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


def open_data_folder(instance):
    settings=desktop_settings()
    if not settings['can_open_data_folder']:
        raise HTTPException(409,'Открытие папки доступно в автономном приложении для Windows')
    if not secrets.compare_digest(instance.encode('utf-8'),settings['instance'].encode('utf-8')):
        raise HTTPException(403,'Откройте настройки заново и повторите попытку')
    directory=data_directory()
    if not directory.is_dir():
        raise HTTPException(404,'Папка данных не найдена')
    try:
        os.startfile(str(directory),'explore')
    except OSError as exc:
        raise HTTPException(500,'Не удалось открыть Проводник. Скопируйте путь к папке из настроек') from exc
    return {'opened':True}
