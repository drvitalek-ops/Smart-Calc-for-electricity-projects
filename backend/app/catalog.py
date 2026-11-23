from sqlalchemy import select
from .models import ElementType, Element, Product, Layer, Project, CatalogCategory
from .plan_appearance import SYMBOLS

LIGHTING_COLORS = SYMBOLS['lighting_colors']

LAYERS = ['Электроустановки', 'Освещение', 'LED-подсветка', 'Датчики', 'Электрокарнизы', 'Умные устройства', 'Профиль']

SMART_DEVICE_COLORS = {
    'Zigbee диммер':'#f59e0b',
    'Zigbee диммер двухканальный':'#d97706',
    'Zigbee диммер трехканальный':'#b45309',
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

# Momentary switches are grouped by keys and execution, without contact variants.
MOMENTARY_SWITCH_DEFAULTS = {}
for keys,prefix in ((1,'одноклавишный'),(2,'двухклавишный'),(3,'трехклавишный')):
    MOMENTARY_SWITCH_DEFAULTS[f'Звонковый выключатель {prefix}'] = {
        'keys':keys,'switch_action':'Самовозвратный',
    }
    MOMENTARY_SWITCH_DEFAULTS[f'Звонковый выключатель {prefix} с подсветкой'] = {
        'keys':keys,'switch_action':'Самовозвратный','backlight':'Да',
    }
MOMENTARY_SWITCH_DEFAULTS.update({
    'Звонковый выключатель с символом звонка': {'keys':1,'switch_action':'Самовозвратный'},
    'Звонковый выключатель влагозащищенный IP44': {'keys':1,'switch_action':'Самовозвратный','ip':44},
    'Звонковый выключатель влагозащищенный IP55': {'keys':1,'switch_action':'Самовозвратный','ip':55},
    'Выключатель самовозвратный для жалюзи, двухклавишный': {'keys':2,'switch_action':'Самовозвратный','control':'Вверх / вниз'},
})

ELECTRICAL_COLORS = {
    'Розетка одинарная':'#f97316',
    'Розетка двойная':'#ea580c',
    'Розетка с USB (2 в 1)':'#f97316',
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
    'Заглушка':'#64748b',
    'Вывод кабеля':'#b45309',
}

ELECTRICAL_COLORS.update({name: {1:"#15803d",2:"#16a34a",3:"#22c55e"}[values["keys"]]
                          for name,values in MOMENTARY_SWITCH_DEFAULTS.items()})

def builtin_type(db, **values):
    key=f"{values['category']}:{values['name']}"
    existing=db.scalar(select(ElementType).where(ElementType.seed_key==key))
    if existing is None:
        existing=db.scalar(select(ElementType).where(
            ElementType.name==values['name'],ElementType.category==values['category'],
            ElementType.seed_key.is_(None)).order_by(ElementType.id))
    if existing:
        # Upgrade legacy defaults only when adopting the builtin identity.
        # Later user edits (including the former default colour) must persist.
        if existing.seed_key is None and values['category']=='Электроустановки':
            if 'frame_posts' in existing.defaults:
                existing.defaults={key:value for key,value in existing.defaults.items() if key!='frame_posts'}
            if existing.color=='#fb923c': existing.color=ELECTRICAL_COLORS[values['name']]
        if values['category']=='Освещение' and existing.color.lower()=='#facc15' and values['name'] in LIGHTING_COLORS:
            existing.color=LIGHTING_COLORS[values['name']]
        existing.seed_key=key
        return existing
    item=ElementType(seed_key=key,**values)
    db.add(item); db.flush()
    return item


def simplify_momentary_switches(db):
    for name in MOMENTARY_SWITCH_DEFAULTS:
        canonical=db.scalar(select(ElementType).where(ElementType.seed_key==f'Электроустановки:{name}'))
        if not canonical: continue
        legacy_names=[f'{name} ({contact})' for contact in ('НО','НЗ','НО/НЗ')]
        legacy=list(db.scalars(select(ElementType).where(ElementType.category=='Электроустановки',ElementType.name.in_(legacy_names))))
        for item in [canonical,*legacy]:
            if 'contact_type' in item.defaults:
                item.defaults={key:value for key,value in item.defaults.items() if key!='contact_type'}
            for element in db.scalars(select(Element).where(Element.type_id==item.id)):
                element.type_id=canonical.id
                element.parameters={key:value for key,value in element.parameters.items() if key!='contact_type'}
            for product in db.scalars(select(Product).where(Product.type_id==item.id)):
                product.type_id=canonical.id
                product.parameters={key:value for key,value in product.parameters.items() if key!='contact_type'}
            if item.id!=canonical.id:
                item.active=False
                item.name=name
                item.seed_key=f'legacy-momentary:{item.id}'


TRACK_EQUIPMENT = [
    dict(name='Шинопровод',unit='м',color='#475569',defaults={'length':1,'track_type':'магнитный','voltage':48,'color':'черный','mount':'накладной'}),
    dict(name='Трековый светильник',color='#0284c7',defaults={'quantity':1,'ip':20}),
    dict(name='Трековый линейный светильник',color='#059669',defaults={'quantity':1,'ip':20}),
    dict(name='Трековый спот',color='#db2777',defaults={'quantity':1,'ip':20}),
    dict(name='Трековый подвес',color='#7c3aed',defaults={'quantity':1,'ip':20}),
    dict(name='Блок питания трека',color='#dc2626',defaults={'quantity':1,'power_watts':100,'voltage':48,'plan_shape':'rectangle'}),
    *[dict(name=name,color='#64748b',defaults={'quantity':1}) for name in (
        'Соединитель трека прямой','Соединитель трека угловой','Соединитель трека Т-образный',
        'Соединитель трека гибкий','Ввод питания трека','Заглушка трека','Подвес трека','Крепление трека')],
]


def seed(db):
    groups = [
        ('Электроустановки', list(ELECTRICAL_COLORS), '#fb923c', 44),
        ('Умные устройства', list(SMART_DEVICE_COLORS), '#0ea5e9', None),
        ('Освещение', ['Встроенный светильник','Накладной светильник','Люстра','Бра','Подвес','Линейное освещение','Spot','Linear','Wall washer','Pendant'], '#facc15', 44),
        ('Датчики', ['Движение','Присутствие','Температура','Влажность','CO2','Протечка'], '#a78bfa', None),
    ]
    for category,names,color,ip in groups:
        for name in names:
            defaults={'quantity':1,'ip':44 if name=='Влагозащищенная розетка' else 20}
            defaults.update(MOMENTARY_SWITCH_DEFAULTS.get(name,{}))
            builtin_type(db,name=name,category=category,
                color=ELECTRICAL_COLORS.get(name,SMART_DEVICE_COLORS.get(name,LIGHTING_COLORS.get(name,color))),wet_min_ip=ip,defaults=defaults)
    extras = [
        dict(name='Алюминиевый профиль',category='Профиль',unit='м',color='#94a3b8',defaults={'length':1}),
        dict(name='Блок питания LED-ленты',category='LED-подсветка',unit='шт',color='#dc2626',defaults={'quantity':1}),
        dict(name='Трек',category='Освещение',unit='м',color=LIGHTING_COLORS['Трек'],defaults={'length':1,'track_type':'магнитный','color':'черный','mount':'накладной','connectors':0,'end_caps':2}),
        dict(name='LED-линия',category='LED-подсветка',unit='м',color='#34d399',wet_min_ip=65,defaults={'length':1,'zone':'','strip_type':'','voltage':24,'ip':20,'profile':'','control':''}),
        dict(name='Электрокарниз',category='Электрокарнизы',color='#60a5fa',defaults={'quantity':1,'length':1,'control':'Zigbee'}),
    ]
    for values in extras: builtin_type(db,**values)
    for values in TRACK_EQUIPMENT:builtin_type(db,category='Освещение',**values)
    simplify_momentary_switches(db)
    for project in db.scalars(select(Project)):
        layers=list(db.scalars(select(Layer).where(Layer.project_id==project.id).order_by(Layer.id)))
        for name in LAYERS:
            if any(layer.seed_key==name for layer in layers): continue
            existing=next((layer for layer in layers if layer.seed_key is None and layer.name==name),None)
            if existing is not None: existing.seed_key=name
            else:
                layer=Layer(project_id=project.id,name=name,seed_key=name)
                db.add(layer);layers.append(layer)
    db.flush()
    registered=set(db.scalars(select(CatalogCategory.name)))
    for name in set(LAYERS) | set(db.scalars(select(ElementType.category))):
        if name not in registered: db.add(CatalogCategory(name=name,description=''))
    db.commit()
