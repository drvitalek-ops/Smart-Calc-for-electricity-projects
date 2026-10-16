import io
import json

import pymupdf
from openpyxl import load_workbook

from app.main import pdf_font_path
from app.report_export import export_pdf, export_xlsx
from app.report_summary import build_summary


def row(room, category, name, quantity, unit='шт', parameters=None):
    return dict(room=room, category=category, name=name, quantity=quantity, unit=unit,
                parameters=json.dumps(parameters or {}), product='', sku='', manufacturer='', supplier='',
                unit_price=0, currency='RUB', total=0)


def test_summary_covers_each_counted_category_room_and_unit():
    rows = [row('Кухня', 'Умные устройства', 'Zigbee диммер двухканальный', 2),
            row('Гостиная', 'Умные устройства', 'Zigbee диммер двухканальный', 3),
            row('Гостиная', 'Освещение', 'Люстра', 2),
            row('Гостиная', 'Освещение', 'Трек', 3.25, 'м'),
            row('Кухня', 'Освещение', 'Трек', 1.125, 'м'),
            row('Гостиная', 'LED-подсветка', 'LED-линия', 7.125, 'м'),
            row('Кухня', 'LED-подсветка', 'LED-линия', 2.375, 'м'),
            row('Гостиная', 'Датчики', 'Движение', 0)]
    summary = build_summary(rows)
    sections = {item['category']: item for item in summary['categories']}
    assert set(sections) == {'Умные устройства', 'Освещение', 'LED-подсветка'}
    assert sections['Умные устройства']['items'] == [dict(name='Zigbee диммер двухканальный', quantity=5, unit='шт')]
    assert sections['Освещение']['totals'] == [dict(unit='м', quantity=4.375), dict(unit='шт', quantity=2)]
    assert sections['LED-подсветка']['totals'] == [dict(unit='м', quantity=9.5)]
    rooms = {item['room']: item['categories'] for item in summary['rooms']}
    assert rooms['Кухня'][0]['items'][0]['quantity'] == 2
    assert rooms['Гостиная'][0]['items'][0]['quantity'] == 3
    assert summary['electrical'] == [] and summary['frame_total'] == 0
    assert build_summary([])['categories'] == []
    assert build_summary([row('Без помещения', 'Датчики', 'Движение', 0)])['rooms'] == []


def test_frames_custom_categories_and_unassigned_elements_remain_in_summary():
    summary = build_summary([
        row('Без помещения', 'Мой раздел', 'Оборудование', 2),
        row('Без помещения', 'Мой раздел', 'Оборудование', 3.125, 'м'),
        row('Кухня', 'Электроустановки', 'Розетка одинарная', 3),
        row('Кухня', 'Рамки', 'Рамка на 3 поста', 1, parameters={'frame_posts': 3}),
    ])
    frames = next(item for item in summary['categories'] if item['category'] == 'Рамки')
    assert frames['post_total'] == 3
    assert summary['post_total'] == 3 and summary['electrical_total'] == 3
    custom = next(item for item in summary['categories'] if item['category'] == 'Мой раздел')
    assert len(custom['items']) == 2  # Same name with metres and pieces must not be merged.
    assert any(item['room'] == 'Без помещения' for item in summary['rooms'])


def test_adaptive_export_contains_room_and_global_totals_without_empty_categories():
    rows = [row('Кухня', 'Умные устройства', 'Zigbee диммер двухканальный', 2),
            row('Гостиная', 'Умные устройства', 'Zigbee диммер двухканальный', 3)]
    report = dict(rows=rows, totals={'RUB': 0}, summary=build_summary(rows), warnings=[])
    wb = load_workbook(io.BytesIO(export_xlsx('Умный дом', report)))
    for sheet in (wb['Итоги'], wb['Итоги по помещениям']):
        content = ' '.join(str(cell.value) for line in sheet for cell in line if cell.value is not None)
        assert 'Электроустановки' not in content and 'Рамки' not in content
        assert 'Умные устройства' in content
    global_rows = [line for line in wb['Итоги'].iter_rows(values_only=True) if line[0] == 'Zigbee диммер двухканальный']
    assert len(global_rows) == 1 and global_rows[0][1:3] == (5, 'шт')
    room_rows = [line for line in wb['Итоги по помещениям'].iter_rows(values_only=True) if line[0] == 'Zigbee диммер двухканальный']
    assert [line[1] for line in room_rows] == [2, 3]
    with pymupdf.open(stream=export_pdf('Умный дом', report, pdf_font_path()), filetype='pdf') as pdf:
        content = ' '.join(page.get_text() for page in pdf)
        assert 'Электроустановки' not in content and 'Рамки' not in content
        assert 'Итог по помещению:' not in content
        before_final, final = content.split('Полный итог по всем помещениям', 1)
        assert 'Всего' not in before_final
        assert 'Zigbee диммер двухканальный' in ' '.join(final.split())
        assert 'Полный итог по всем помещениям' in content
        for page in pdf:
            for x0, y0, x1, y1, *_ in page.get_text('words'):
                assert 0 <= x0 < x1 <= page.rect.width + 1
                assert 0 <= y0 < y1 <= page.rect.height + 1


def test_pdf_room_subtotals_only_for_electrical_and_frames_with_all_items_at_end():
    rows = [row('Кухня', 'Электроустановки', 'Розетка одинарная', 3),
            row('Кухня', 'Рамки', 'Рамка на 3 поста', 1, parameters={'frame_posts': 3}),
            row('Кухня', 'Умные устройства', 'Zigbee диммер двухканальный', 2),
            row('Кухня', 'Освещение', 'Люстра', 2),
            row('Кухня', 'LED-подсветка', 'LED-линия', 7.5, 'м'),
            row('Гостиная', 'Умные устройства', 'Zigbee диммер двухканальный', 3),
            row('Гостиная', 'LED-подсветка', 'LED-линия', 2.5, 'м')]
    report = dict(rows=rows, totals={'RUB': 0}, summary=build_summary(rows), warnings=['Кухня: проверьте степень IP'])
    with pymupdf.open(stream=export_pdf('Тестовый проект', report, pdf_font_path()), filetype='pdf') as pdf:
        content = '\n'.join(page.get_text() for page in pdf)
        assert 'Итог по помещению: Кухня' in content
        assert 'Итог по помещению: Гостиная' not in content
        room_summary = content.split('Итог по помещению: Кухня', 1)[1].split('Гостиная', 1)[0]
        assert 'Электроустановки' in room_summary and 'Рамки' in room_summary
        assert 'Постов в рамках' in room_summary
        assert all(name not in room_summary for name in ('Умные устройства', 'Освещение', 'LED-подсветка'))
        final = content.split('Полный итог по всем помещениям', 1)[1]
        assert all(name in final for name in ('Электроустановки', 'Рамки', 'Умные устройства', 'Освещение', 'LED-подсветка'))
        assert 'Zigbee диммер двухканальный' in ' '.join(final.split())
        assert '10' in final and 'м' in final  # Both rooms' strip lengths are included.
        assert content.index('Рекомендации по степени защиты IP') < content.index('Полный итог по всем помещениям')
        assert 'Стоимость по помещению:' not in content
