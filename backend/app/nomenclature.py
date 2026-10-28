"""Stable functional grouping of standard and user-created equipment names."""
import re

ELECTRICAL_GROUPS = (
    'Розетки', 'Розетки слаботочные', 'Выключатели',
    'Выключатели проходные', 'Выключатели перекрёстные',
    'Выключатели звонковые', 'Диммеры', 'Терморегуляторы',
    'Сценарные кнопки', 'Заглушки', 'Выводы кабеля',
    'Прочие электроустановки',
)


def nomenclature_group(name, category):
    if category != 'Электроустановки':
        return category
    value=name.casefold().replace('ё','е')
    if 'заглуш' in value:
        return 'Заглушки'
    if 'вывод' in value and 'кабел' in value:
        return 'Выводы кабеля'
    if 'терморегулятор' in value:
        return 'Терморегуляторы'
    if 'сценарн' in value:
        return 'Сценарные кнопки'
    if 'диммер' in value:
        return 'Диммеры'
    if 'выключател' in value or 'кнопк' in value:
        if 'звонков' in value or 'самовозврат' in value:
            return 'Выключатели звонковые'
        if 'перекрест' in value:
            return 'Выключатели перекрёстные'
        if 'проходн' in value:
            return 'Выключатели проходные'
        return 'Выключатели'
    if 'розет' in value and any(word in value for word in ('с usb','с юсб','220','230')):
        return 'Розетки'
    if any(word in value for word in ('usb','юсб','rj45','rj-45','rj11','rj-11','hdmi','tv','тв','слаботоч','телевиз','телефон','антенн','ethernet')):
        return 'Розетки слаботочные'
    if 'розет' in value:
        return 'Розетки'
    return 'Прочие электроустановки'


def nomenclature_group_order(name, category):
    group=nomenclature_group(name,category)
    return ELECTRICAL_GROUPS.index(group) if category=='Электроустановки' else 0


def channel_count(name):
    name=name.casefold().replace('ё','е')
    number=re.search(r'(\d+)\s*[-–]?\s*(канал|клавиш|пост)',name)
    if number:
        return int(number.group(1))
    for count,words in ((3,('трех','трой')), (2,('двух','двойн')), (4,('четырех',)),
                        (5,('пяти',)), (6,('шести',))):
        if any(word in name for word in words):
            return count
    return 1


def nomenclature_key(name):
    value=name.casefold().replace('ё','е')
    value=re.sub(r'^zigbee\s+', '',value)
    variant=0
    if 'розет' in value or any(port in value for port in ('usb','rj45','hdmi')) or value=='tv':
        family=0
        variant=1 if "розет" in value and ("usb" in value or "юсб" in value) else 2 if any(port in value for port in ("usb","rj45","hdmi")) or value=="tv" else 0
    elif 'терморегулятор' in value:
        family=1
    elif 'сценарн' in value:
        family=2
    elif 'диммер' in value:
        family=3
    elif 'выключател' in value or 'кнопк' in value:
        family=4
        variant=3 if ('звонков' in value or 'самовозврат' in value) else 2 if 'перекрест' in value else 1 if 'проходн' in value else 0
    elif 'реле' in value:
        family=5
    elif 'светильник' in value or 'линейное освещение' in value or value in ('spot','linear','wall washer'):
        family=6
    elif 'люстр' in value:
        family=7
    elif value=='бра':
        family=8
    elif 'подвес' in value or value=='pendant':
        family=9
    elif 'трек' in value:
        family=10
    elif 'контроллер' in value:
        family=11
    elif 'лент' in value or 'led' in value:
        family=12
    elif 'лампоч' in value or 'ламп' in value:
        family=13
    elif 'карниз' in value:
        family=14
    elif 'датчик' in value:
        family=15
    elif 'координатор' in value:
        family=16
    elif 'заглуш' in value:
        family=17
    elif 'вывод' in value and 'кабел' in value:
        family=18
    else:
        family=19
    natural=re.sub(r'\d+',lambda match:match.group().zfill(8),value)
    return family,variant,channel_count(value),natural
