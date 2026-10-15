from sqlalchemy import select
from .models import ElementType, Layer, Project

LAYERS = ['Электроустановки', 'Освещение', 'LED-подсветка', 'Датчики', 'Электрокарнизы', 'Умные устройства']

SMART_DEVICE_COLORS = {
    'Zigbee диммер':'#f59e0b',
    'Zigbee реле одноканальное':'#0ea5e9',
    'Zigbee реле двухканальное':'#0284c7',
    'Zigbee реле трехканальное':'#0369a1',
    'Zigbee лампочка':'#eab308',
    'Zigbee контроллер для ленты':'#d946ef',
    'Zigbee электрокарниз':'#6366f1',
    'Zigbee терморегулятор':'#e11d48',
    'Zigbee розетка':'#f97316',
    'Zigbee выключатель':'#22c55e',
    'Zigbee датчик движения':'#8b5cf6',
    'Zigbee датчик открытия':'#a855f7',
    'Zigbee датчик протечки':'#06b6d4',
    'Zigbee датчик температуры и влажности':'#14b8a6',
    'Zigbee координатор':'#475569',
}

ELECTRICAL_COLORS = {
    'Розетка одинарная':'#f97316',
    'Розетка двойная':'#ea580c',
    'USB':'#8b5cf6',
    'TV':'#0ea5e9',
    'RJ45':'#2563eb',
    'HDMI-розетка':'#7c3aed',
    'Выключатель':'#22c55e',
    'Двойной выключатель':'#16a34a',
    'Двойной перекрестный выключатель':'#0f766e',
    'Двойной проходной выключатель':'#14b8a6',
    'Тройной выключатель':'#65a30d',
    'Одинарный проходной выключатель':'#10b981',
    'Одинарный перекрестный выключатель':'#047857',
    'Диммер':'#eab308',
    'Терморегулятор':'#be123c',
    'Сценарная кнопка':'#ec4899',
    'Влагозащищенная розетка':'#dc2626',
}

def seed(db):
    groups = [
        ('Электроустановки', list(ELECTRICAL_COLORS), '#fb923c', 44),
        ('Умные устройства', list(SMART_DEVICE_COLORS), '#0ea5e9', None),
        ('Освещение', ['Встроенный светильник','Накладной светильник','Люстра','Бра','Подвес','Линейное освещение','Spot','Linear','Wall washer','Pendant'], '#facc15', 44),
        ('Датчики', ['Движение','Присутствие','Температура','Влажность','CO2','Протечка'], '#a78bfa', None),
    ]
    for category, names, color, ip in groups:
        for name in names:
            defaults={'quantity':1,'ip':44 if name=='Влагозащищенная розетка' else 20}
            existing=db.scalar(select(ElementType).where(ElementType.name==name,ElementType.category==category))
            if existing:
                if category=='Электроустановки' and 'frame_posts' in existing.defaults:
                    existing.defaults={key:value for key,value in existing.defaults.items() if key!='frame_posts'}
                if category=='Электроустановки' and existing.color=='#fb923c':
                    existing.color=ELECTRICAL_COLORS[name]
                continue
            db.add(ElementType(name=name, category=category, color=ELECTRICAL_COLORS.get(name,SMART_DEVICE_COLORS.get(name,color)), wet_min_ip=ip, defaults=defaults))
    extras = [
        dict(name='Трек',category='Освещение',unit='м',color='#facc15',defaults={'length':1,'track_type':'магнитный','color':'черный','mount':'накладной','connectors':0,'end_caps':2}),
        dict(name='LED-линия',category='LED-подсветка',unit='м',color='#34d399',wet_min_ip=65,defaults={'length':1,'zone':'','strip_type':'','voltage':24,'ip':20,'profile':'','control':''}),
        dict(name='Электрокарниз',category='Электрокарнизы',color='#60a5fa',defaults={'quantity':1,'length':1,'control':'Zigbee'}),
    ]
    for values in extras:
        if not db.scalar(select(ElementType.id).where(ElementType.name==values['name'],ElementType.category==values['category'])):
            db.add(ElementType(**values))
    for project in db.scalars(select(Project)):
        existing_layers=set(db.scalars(select(Layer.name).where(Layer.project_id==project.id)))
        for name in LAYERS:
            if name not in existing_layers:
                db.add(Layer(project_id=project.id,name=name))
    db.commit()
