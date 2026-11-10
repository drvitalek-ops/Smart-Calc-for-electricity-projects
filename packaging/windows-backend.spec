# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

project_root = Path(SPECPATH).parent

analysis = Analysis(
    [str(project_root / 'backend' / 'desktop.py')],
    pathex=[str(project_root / 'backend')],
    binaries=[],
    datas=[(str(project_root / 'frontend' / 'dist'), 'frontend'),
           (str(project_root / 'backend' / 'app' / 'assets'), 'app/assets')],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['psycopg', 'pytest'],
    noarchive=False,
)
pyz = PYZ(analysis.pure)

exe = EXE(
    pyz,
    analysis.scripts,
    analysis.binaries,
    analysis.datas,
    [],
    name='SmartHomeCalc.Backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
)
