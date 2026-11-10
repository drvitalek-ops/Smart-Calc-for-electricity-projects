"""Quantity summaries shared by the report screen, PDF and Excel."""
import json
from collections import defaultdict
from .nomenclature import nomenclature_key

CATEGORY_ORDER = {name: index for index, name in enumerate((
    'Электроустановки', 'Рамки', 'Умные устройства', 'Освещение',
    'LED-подсветка', 'Профиль', 'Датчики', 'Электрокарнизы',
))}


def summarize_categories(rows):
    grouped = defaultdict(lambda: defaultdict(float))
    posts = 0
    for row in rows:
        if row['quantity'] <= 0:
            continue
        grouped[row['category']][(row['name'], row['unit'])] += row['quantity']
        if row['category'] == 'Рамки':
            posts += int(json.loads(row['parameters'])['frame_posts']) * row['quantity']
    categories = []
    for category in sorted(grouped, key=lambda name: (CATEGORY_ORDER.get(name, 99), name.casefold())):
        items = [{'name': name, 'unit': unit, 'quantity': round(quantity, 3)}
                 for (name, unit), quantity in sorted(grouped[category].items(), key=lambda item: (nomenclature_key(item[0][0]), item[0][1]))
                 if round(quantity, 3) > 0]
        if not items:
            continue
        totals = defaultdict(float)
        for item in items:
            totals[item['unit']] += item['quantity']
        section = {'category': category, 'items': items,
                   'totals': [{'unit': unit, 'quantity': round(quantity, 3)} for unit, quantity in sorted(totals.items())]}
        if category == 'Рамки' and posts > 0:
            section['post_total'] = round(posts, 3)
        categories.append(section)
    return categories


def build_summary(rows):
    categories = summarize_categories(rows)
    rooms = []
    for room in dict.fromkeys(row['room'] for row in rows):
        sections = summarize_categories(row for row in rows if row['room'] == room)
        if sections:
            rooms.append({'room': room, 'categories': sections})
    # Keep the existing API fields for older integrations and project tests.
    electrical = next((item['items'] for item in categories if item['category'] == 'Электроустановки'), [])
    frames = defaultdict(float)
    for row in rows:
        if row['category'] == 'Рамки' and row['quantity'] > 0:
            frames[int(json.loads(row['parameters'])['frame_posts'])] += row['quantity']
    return {
        'categories': categories, 'rooms': rooms,
        'electrical': [{'name': item['name'], 'quantity': item['quantity']} for item in electrical],
        'frames': [{'posts': posts, 'quantity': round(quantity, 3)} for posts, quantity in sorted(frames.items())],
        'electrical_total': round(sum(item['quantity'] for item in electrical), 3),
        'frame_total': round(sum(frames.values()), 3),
        'post_total': round(sum(posts * quantity for posts, quantity in frames.items()), 3),
    }
