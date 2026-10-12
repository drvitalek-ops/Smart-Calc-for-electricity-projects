from sqlalchemy import select
from .models import ElementType

LAYERS = ['Электроустановки', 'Освещение', 'LED-подсветка', 'Датчики', 'Электрокарнизы']

def seed(db):
    groups = [
        ('Электроустановки', ['Розетка одинарная','Розетка двойная','USB','TV','RJ45','HDMI-розетка','Выключатель','Диммер','Сценарная кнопка','Влагозащищенная розетка'], '#fb923c', 44),
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
                continue
            db.add(ElementType(name=name, category=category, color=color, wet_min_ip=ip, defaults=defaults))
    extras = [
        dict(name='Трек',category='Освещение',unit='м',color='#facc15',defaults={'length':1,'track_type':'магнитный','color':'черный','mount':'накладной','connectors':0,'end_caps':2}),
        dict(name='LED-линия',category='LED-подсветка',unit='м',color='#34d399',wet_min_ip=65,defaults={'length':1,'zone':'','strip_type':'','voltage':24,'ip':20,'profile':'','control':''}),
        dict(name='Электрокарниз',category='Электрокарнизы',color='#60a5fa',defaults={'quantity':1,'length':1,'control':'Zigbee'}),
    ]
    for values in extras:
        if not db.scalar(select(ElementType.id).where(ElementType.name==values['name'],ElementType.category==values['category'])):
            db.add(ElementType(**values))
    db.commit()
