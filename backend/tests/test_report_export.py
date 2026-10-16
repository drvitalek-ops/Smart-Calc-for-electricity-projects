import copy
import io
import json

import pymupdf
from openpyxl import load_workbook

from app.main import pdf_font_path
from app.report_export import export_pdf, export_xlsx, parameters_text


def example():
    return {
        'rows': [dict(room='Гостиная', category='Электроустановки', name='Розетка одинарная',
                      product='Розетка с защитными шторками', sku='SKU-001', manufacturer='Производитель',
                      supplier='Поставщик', quantity=12, unit='шт', unit_price=450.25, currency='RUB',
                      total=5403, parameters=json.dumps({'ip': 44, 'voltage': 220, 'color': 'Белый'})),
                 dict(room='Кухня', category='LED-подсветка', name='LED-линия', product='', sku='SKU-002',
                      manufacturer='', supplier='', quantity=3.5, unit='м', unit_price=10.5, currency='EUR',
                      total=36.75, parameters=json.dumps({'voltage': 24, 'control': 'Zigbee'}))],
        'summary': dict(electrical=[dict(name='Розетка одинарная', quantity=12)], frames=[dict(posts=3, quantity=4)],
                        electrical_total=12, frame_total=4, post_total=12),
        'totals': {'RUB': 5403, 'EUR': 36.75}, 'warnings': ['Кухня: LED-линия — рекомендуется IP65 или выше'],
    }


def test_export_preserves_values_and_currency_with_readable_excel():
    report = example()
    original = copy.deepcopy(report)
    # Excel must retain literal user text, including formula-like names.
    report['rows'][0]['product'] = '=HYPERLINK("https://example.org")'
    report['rows'][0]['sku'] = '+12345'
    workbook = load_workbook(io.BytesIO(export_xlsx('Квартира', report)))
    assert workbook.sheetnames[0] == 'Итоги'
    sheet = workbook['Общая ведомость']
    assert sheet['D6'].data_type == 's' and sheet['D6'].value.startswith('=HYPERLINK')
    assert sheet['E6'].data_type == 's' and sheet['E6'].value == '+12345'
    assert sheet['H6'].value == 12 and sheet['H7'].value == 3.5
    assert sheet['J6'].value == 450.25 and sheet['L6'].value == 5403
    assert sheet['J6'].number_format == '#,##0.00'
    assert sheet['M6'].value == 'Степень защиты: IP44\nНапряжение, В: 220\nЦвет: Белый'
    assert sheet.freeze_panes == 'D6' and sheet.auto_filter.ref == 'A5:M7'
    assert sheet.print_title_rows == '$1:$5' and sheet.page_setup.orientation == 'landscape'
    assert sheet['D6'].alignment.wrap_text
    totals = {row[0]: row[1] for row in workbook['Итоги'].iter_rows(values_only=True) if row[0] in ('RUB', 'EUR')}
    assert totals == {'RUB': 5403, 'EUR': 36.75}
    assert workbook['По помещениям']['A6'].value == 'Гостиная'
    assert workbook['По помещениям']['A8'].value == 'Кухня'
    assert workbook['Проверки IP']['A6'].value == original['warnings'][0]
    assert report['rows'][0]['quantity'] == original['rows'][0]['quantity']


def test_excel_handles_reserved_duplicate_sheet_titles():
    report = example()
    report['rows'] = []
    for index, category in enumerate(['Итоги', 'По помещениям', 'Проверки IP', 'Трек/свет', 'Трек:свет', 'А' * 100]):
        row = copy.deepcopy(example()['rows'][0])
        row['category'] = category
        report['rows'].append(row)
    wb = load_workbook(io.BytesIO(export_xlsx('Проект', report)))
    assert len(wb.sheetnames) == 11
    assert len({name.lower() for name in wb.sheetnames}) == 11
    assert all(len(name) <= 31 for name in wb.sheetnames)
    assert all(len([row for row in ws.iter_rows(min_row=6, values_only=True) if row[7] == 12]) == 1
               for ws in wb.worksheets[4:10])


def test_pdf_paginates_and_repeats_headers_without_losing_rows():
    report = example()
    report['rows'] = []
    for index in range(85):
        row = copy.deepcopy(example()['rows'][0])
        row.update(sku=f'POSITION-{index:03}', name='Влагозащищенная розетка <двойная> & USB',
                   product='Серия с длинным названием для проверки переноса описаний ' * 2)
        report['rows'].append(row)
    original = copy.deepcopy(report)
    content = export_pdf('Тестовый дом — длинная спецификация', report, pdf_font_path())
    with pymupdf.open(stream=content, filetype='pdf') as pdf:
        assert len(pdf) > 3
        assert 'POSITION-000' in pdf[0].get_text()
        combined = '\n'.join(page.get_text() for page in pdf)
        for index in range(85):
            assert f'POSITION-{index:03}' in combined
        assert 'Степень защиты: IP44' in combined
        assert 'Влагозащищенная розетка <двойная> & USB' in combined.replace('\n', ' ')
        for index, page in enumerate(pdf):
            extracted = page.get_text()
            assert f'Страница {index + 1}' in extracted
            if 'POSITION-' in extracted:
                assert 'Кол-во' in extracted and 'Поставщик' in extracted
            for x0, y0, x1, y1, *_ in page.get_text('words'):
                assert 0 <= x0 < x1 <= page.rect.width + 1
                assert 0 <= y0 < y1 <= page.rect.height + 1
        assert 'Итоги спецификации' in combined
    assert report == original


def test_pdf_handles_a_description_taller_than_one_page():
    report = example()
    report['rows'] = report['rows'][:1]
    report['rows'][0]['product'] = 'Длинное описание изделия ' * 350 + ' END-OF-DESCRIPTION'
    with pymupdf.open(stream=export_pdf('Большое описание', report, pdf_font_path()), filetype='pdf') as pdf:
        assert len(pdf) > 2
        assert 'END-OF-DESCRIPTION' in ''.join(page.get_text() for page in pdf)


def test_empty_exports_and_parameter_labels():
    report = example()
    report.update(rows=[], totals={}, warnings=[])
    report['summary'] = dict(electrical=[], frames=[], electrical_total=0, frame_total=0, post_total=0)
    workbook = load_workbook(io.BytesIO(export_xlsx('Пустой проект', report)))
    assert workbook['Общая ведомость']['A6'].value == 'В спецификации пока нет позиций.'
    with pymupdf.open(stream=export_pdf('Пустой проект', report, pdf_font_path()), filetype='pdf') as pdf:
        assert 'В спецификации пока нет позиций.' in pdf[0].get_text()
    assert parameters_text({'frame_posts': 3, 'custom': True, 'zone': ''}) == 'Постов в рамке: 3\ncustom: Да'
