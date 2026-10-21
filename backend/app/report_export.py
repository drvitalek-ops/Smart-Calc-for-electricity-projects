"""Readable PDF and Excel specifications, sharing labels and number formatting."""
import io
import json
import math
import re
from datetime import datetime, timedelta, timezone
from xml.sax.saxutils import escape
from .report_summary import build_summary, summarize_categories

PARAMETER_LABELS = {
    'ip': 'Степень защиты', 'voltage': 'Напряжение, В', 'control': 'Управление',
    'zone': 'Зона', 'strip_type': 'Тип ленты', 'profile': 'Профиль',
    'track_type': 'Тип трека', 'color': 'Цвет', 'mount': 'Монтаж',
    'connectors': 'Соединители', 'end_caps': 'Заглушки', 'frame_posts': 'Постов в рамке',
    'length': 'Длина, м', 'quantity': 'Количество',
    'power_watts':'Мощность, Вт','led_strip':'Питает ленту','keys': 'Клавиш', 'contact_type': 'Контакт', 'switch_action': 'Механизм', 'backlight': 'Подсветка',
}
HEADERS = ['Помещение', 'Категория', 'Элемент', 'Товар', 'Артикул', 'Производитель',
           'Поставщик', 'Количество', 'Ед.', 'Цена', 'Валюта', 'Сумма', 'Характеристики']
TEAL = '176B65'
INK = '193746'
PALE = 'E9F3F2'


def text(value):
    return re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', str(value))


def parameters_text(raw):
    values = json.loads(raw) if isinstance(raw, str) else raw
    lines = []
    for key, value in values.items():
        if value is None or value == '':
            continue
        if isinstance(value, bool):
            value = 'Да' if value else 'Нет'
        elif isinstance(value, (dict, list)):
            value = json.dumps(value, ensure_ascii=False)
        if key == 'ip':
            value = f'IP{value}'
        lines.append(f'{PARAMETER_LABELS.get(key, key)}: {value}')
    return '\n'.join(lines)


def number(value, money=False):
    result = f'{value:,.2f}' if money else f'{value:,.3f}'.rstrip('0').rstrip('.')
    return result.replace(',', ' ').replace('.', ',')


def generated_at():
    return datetime.now(timezone(timedelta(hours=3))).strftime('%d.%m.%Y %H:%M') + ' МСК'


def export_xlsx(project_name, result):
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter
    from openpyxl.worksheet.pagebreak import Break
    from openpyxl.worksheet.page import PageMargins

    wb = Workbook()
    wb.remove(wb.active)
    stamp = generated_at()
    border = Border(bottom=Side(style='hair', color='D9E5E8'))

    def cell(ws, row, column, value):
        item = ws.cell(row, column, text(value) if isinstance(value, str) else value)
        # Explicit string cells prevent names, SKUs and warnings becoming formulas.
        if isinstance(value, str):
            item.data_type = 's'
        return item

    def create_sheet(name, columns=13):
        name = re.sub(r'[\\/*?:\[\]]', ' ', text(name)).strip(" '") or 'Раздел'
        name = name[:31]
        used = {value.casefold() for value in wb.sheetnames}
        candidate, index = name, 2
        while candidate.casefold() in used:
            candidate = f'{name[:27]} {index}'[:31]
            index += 1
        ws = wb.create_sheet(candidate)
        ws.sheet_view.showGridLines = False
        ws.sheet_properties.pageSetUpPr.fitToPage = True
        ws.sheet_properties.outlinePr.summaryRight = False
        ws.page_setup.orientation = 'landscape'
        ws.page_setup.paperSize = ws.PAPERSIZE_A3
        ws.page_setup.fitToWidth, ws.page_setup.fitToHeight = 1, 0
        ws.page_margins = PageMargins(left=.25, right=.25, top=.45, bottom=.4, header=.2, footer=.2)
        ws.oddFooter.left.text = 'Smart Home Calc'
        ws.oddFooter.right.text = 'Стр. &P из &N'
        ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=columns)
        cell(ws, 1, 1, project_name).font = Font(name='Calibri', size=18, bold=True, color=INK)
        ws['A1'].alignment = Alignment(wrap_text=True, vertical='center')
        title_chars = 60 if columns == 4 else 160
        title_lines = sum(max(1, math.ceil(len(line) / title_chars)) for line in project_name.split('\n'))
        ws.row_dimensions[1].height = max(45, 24 * title_lines)
        ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=columns)
        cell(ws, 2, 1, f'Спецификация • {stamp}').font = Font(name='Calibri', size=10, color='57717E')
        return ws

    def heading(ws, row, title, columns=13):
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=columns)
        item = cell(ws, row, 1, title)
        item.fill = PatternFill('solid', fgColor=PALE)
        item.font = Font(name='Calibri', size=12, bold=True, color=INK)
        item.alignment = Alignment(wrap_text=True, vertical='center')
        ws.row_dimensions[row].height = 30

    def header(ws, row, values):
        for column, value in enumerate(values, 1):
            item = cell(ws, row, column, value)
            item.fill = PatternFill('solid', fgColor=TEAL)
            item.font = Font(name='Calibri', size=10, bold=True, color='FFFFFF')
            item.alignment = Alignment(wrap_text=True, vertical='center')
        ws.row_dimensions[row].height = 30

    widths = [21, 21, 28, 28, 19, 21, 21, 12, 8, 15, 10, 17, 38]

    def data_row(ws, index, row, alternate):
        values = [row[key] for key in ('room', 'category', 'name', 'product', 'sku', 'manufacturer',
                                      'supplier', 'quantity', 'unit', 'unit_price', 'currency', 'total')]
        values.append(parameters_text(row['parameters']))
        height = 2
        for column, value in enumerate(values, 1):
            item = cell(ws, index, column, value)
            item.font = Font(name='Calibri', size=10, color=INK, bold=column == 12)
            item.alignment = Alignment(vertical='top', wrap_text=True,
                                       horizontal='right' if column in (8, 10, 12) else 'left')
            item.border = border
            if alternate:
                item.fill = PatternFill('solid', fgColor='F3F7F9')
            if column in (10, 12):
                item.number_format = '#,##0.00'
            elif column == 8:
                item.number_format = '#,##0' if float(value).is_integer() else '#,##0.000'
            if isinstance(value, str):
                height = max(height, sum(max(1, math.ceil(len(line) / (widths[column - 1] - 2)))
                                         for line in value.split('\n')))
        ws.row_dimensions[index].height = min(409, 15 * height + 8)

    def detail_sheet(name, rows, grouped=False):
        ws = create_sheet(name)
        for index, width in enumerate(widths, 1):
            ws.column_dimensions[get_column_letter(index)].width = width
        heading(ws, 4, name)
        header(ws, 5, HEADERS)
        ws.freeze_panes = 'D6'
        ws.print_title_rows = '1:5'
        index = 6
        previous_room = None
        for sequence, row in enumerate(rows):
            if grouped and row['room'] != previous_room:
                if previous_room is not None:
                    ws.row_breaks.append(Break(id=index - 1))
                heading(ws, index, row['room'])
                previous_room = row['room']
                index += 1
            data_row(ws, index, row, sequence % 2 == 1)
            index += 1
        if not rows:
            cell(ws, index, 1, 'В спецификации пока нет позиций.')
        if not grouped:
            ws.auto_filter.ref = f'A5:M{max(5, index - 1)}'
        ws.print_area = f'A1:M{max(6, index - 1)}'
        return ws

    summary = build_summary(result['rows'])
    ws = create_sheet('Итоги', 4)
    ws.page_setup.orientation, ws.page_setup.paperSize = 'portrait', ws.PAPERSIZE_A4
    for key, width in {'A': 48, 'B': 18, 'C': 12, 'D': 18}.items():
        ws.column_dimensions[key].width = width
    heading(ws, 4, 'Итоги по всем помещениям', 4)
    header(ws, 5, ['Позиция / показатель', 'Количество', 'Ед.', ''])

    def summary_line(ws, index, label, quantity, unit, bold=False):
        for column, value in enumerate((label, quantity, unit), 1):
            item = cell(ws, index, column, value)
            item.font = Font(name='Calibri', size=11, color=INK, bold=bold)
            item.alignment = Alignment(wrap_text=True, vertical='center')
        ws.cell(index, 2).number_format = '#,##0.000' if quantity % 1 else '#,##0'
        ws.row_dimensions[index].height = max(32, 15 * math.ceil(len(label) / 44) + 10)
        return index + 1

    def summary_sections(ws, index, sections):
        for section in sections:
            heading(ws, index, section['category'], 4)
            index += 1
            for total in section['totals']:
                index = summary_line(ws, index, 'Всего', total['quantity'], total['unit'], bold=True)
            for item in section['items']:
                index = summary_line(ws, index, item['name'], item['quantity'], item['unit'])
            if section.get('post_total'):
                index = summary_line(ws, index, 'Постов в рамках', section['post_total'], 'шт')
            index += 1
        return index

    index = summary_sections(ws, 6, summary['categories'])
    if not summary['categories']:
        cell(ws, index, 1, 'В спецификации пока нет посчитанных позиций.')
        index += 1
    index += 1
    heading(ws, index, 'Стоимость по валютам', 4)
    index += 1
    header(ws, index, ['Валюта', 'Сумма', '', ''])
    index += 1
    for currency, total in sorted(result['totals'].items()):
        cell(ws, index, 1, currency)
        cell(ws, index, 2, total).number_format = '#,##0.00'
        ws.row_dimensions[index].height = 24
        index += 1
    ws.freeze_panes = 'B6'
    ws.print_area = f'A1:D{index}'
    room_totals = create_sheet('Итоги по помещениям', 4)
    room_totals.page_setup.orientation, room_totals.page_setup.paperSize = 'portrait', room_totals.PAPERSIZE_A4
    for key, width in {'A': 48, 'B': 18, 'C': 12, 'D': 18}.items():
        room_totals.column_dimensions[key].width = width
    header(room_totals, 4, ['Позиция / показатель', 'Количество', 'Ед.', ''])
    index = 5
    for room in summary['rooms']:
        if index > 5:
            room_totals.row_breaks.append(Break(id=index - 1))
        heading(room_totals, index, f"Помещение: {room['room']}", 4)
        index = summary_sections(room_totals, index + 1, room['categories'])
    if not summary['rooms']:
        cell(room_totals, index, 1, 'В спецификации пока нет посчитанных позиций.')
    room_totals.freeze_panes = 'B5'
    room_totals.print_title_rows = '1:4'
    room_totals.print_area = f'A1:D{index}'
    detail_sheet('Общая ведомость', result['rows'])
    detail_sheet('По помещениям', result['rows'], grouped=True)
    for category in sorted({r['category'] for r in result['rows']}):
        detail_sheet(category, [row for row in result['rows'] if row['category'] == category])
    notes = create_sheet('Проверки IP', 3)
    notes.column_dimensions['A'].width = 110
    heading(notes, 4, 'Рекомендации по степени защиты IP', 3)
    for index, warning in enumerate(result['warnings'] or ['Замечаний по степени защиты IP нет.'], 6):
        item = cell(notes, index, 1, warning)
        item.alignment = Alignment(wrap_text=True, vertical='top')
        item.font = Font(name='Calibri', size=11, color=INK)
        notes.row_dimensions[index].height = max(30, 15 * math.ceil(len(warning) / 100))
    output = io.BytesIO()
    wb.save(output)
    return output.getvalue()


def export_pdf(project_name, result, font_path):
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_RIGHT
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, LongTable, TableStyle

    pdfmetrics.registerFont(TTFont('CalcReport', str(font_path)))
    ink, teal, pale = (colors.HexColor('#' + value) for value in (INK, TEAL, PALE))
    body = ParagraphStyle('Body', fontName='CalcReport', fontSize=8.3, leading=11,
                          textColor=ink, splitLongWords=True)
    right = ParagraphStyle('Right', parent=body, alignment=TA_RIGHT)
    white = ParagraphStyle('Header', parent=body, textColor=colors.white, fontSize=8)
    title = ParagraphStyle('Title', parent=body, fontSize=22, leading=28, spaceAfter=9)
    subtitle = ParagraphStyle('Subtitle', parent=body, fontSize=10, leading=14, spaceAfter=16)
    section = ParagraphStyle('Section', parent=body, fontSize=13, leading=17,
                             spaceBefore=16, spaceAfter=8, keepWithNext=True)
    small = ParagraphStyle('Small', parent=body, fontSize=8, leading=11)
    output = io.BytesIO()
    doc = SimpleDocTemplate(output, pagesize=landscape(A4), rightMargin=30, leftMargin=30,
                           topMargin=45, bottomMargin=38, title=f'Спецификация — {project_name}',
                           author='Smart Home Calc')
    def paragraph(value, style=body):
        return Paragraph(escape(text(value)).replace('\n', '<br/>'), style)

    def grid(data, widths, numeric_columns=(), room=None):
        header_row = 1 if room is not None else 0
        if room is not None:
            data = [[paragraph(room, section)] + [''] * (len(widths) - 1)] + data
        table = LongTable(data, colWidths=widths, repeatRows=header_row + 1,
                          splitByRow=1, splitInRow=1, hAlign='LEFT')
        table.spaceBefore = 12 if room is not None else 0
        commands = [('BACKGROUND', (0, header_row), (-1, header_row), teal),
                    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                    ('LEFTPADDING', (0, 0), (-1, -1), 6),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 6),
                    ('TOPPADDING', (0, 0), (-1, -1), 7),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
                    ('ROWBACKGROUNDS', (0, header_row + 1), (-1, -1), [colors.white, colors.HexColor('#F2F6F8')]),
                    ('LINEBELOW', (0, header_row), (-1, header_row), .6, teal),
                    ('LINEBELOW', (0, header_row + 1), (-1, -1), .3, colors.HexColor('#D9E5E8'))]
        if room is not None:
            commands.extend([('SPAN', (0, 0), (-1, 0)), ('BACKGROUND', (0, 0), (-1, 0), pale)])
        for column in numeric_columns:
            commands.append(('ALIGN', (column, header_row + 1), (column, -1), 'RIGHT'))
        table.setStyle(TableStyle(commands))
        return table

    stamp = generated_at()
    rows, summary = result['rows'], build_summary(result['rows'])
    story = [paragraph('Спецификация оборудования', title), paragraph(project_name, subtitle),
             paragraph(f'Сформировано: {stamp} • Строк: {len(rows)} • Помещений: {len({r["room"] for r in rows})}', small),
             Spacer(1, 12)]
    def quantity_summary(categories, title):
        if not categories:
            return
        counts = [[paragraph(value, white) for value in ('Раздел / позиция', 'Количество', 'Ед.')]]
        category_rows = []
        for category in categories:
            category_rows.append(len(counts) + 1)
            counts.append([paragraph(category['category']), paragraph(''), paragraph('')])
            for total in category['totals']:
                counts.append([paragraph('Всего'), paragraph(number(total['quantity']), right), paragraph(total['unit'])])
            counts += [[paragraph(item['name']), paragraph(number(item['quantity']), right), paragraph(item['unit'])]
                       for item in category['items']]
            if category.get('post_total'):
                counts.append([paragraph('Постов в рамках'), paragraph(number(category['post_total']), right), paragraph('шт')])
        table = grid(counts, [doc.width - 145, 100, 45], (1,), room=title)
        table.setStyle(TableStyle([command for row in category_rows for command in (
            ('SPAN', (0, row), (-1, row)), ('BACKGROUND', (0, row), (-1, row), pale))]))
        story.append(table)

    if not rows:
        story += [Spacer(1, 18), paragraph('В спецификации пока нет позиций.')]
    headers = ['№', 'Наименование / товар', 'Характеристики', 'Производитель / артикул',
               'Поставщик', 'Кол-во', 'Ед.', 'Цена', 'Валюта', 'Сумма']
    widths = [25, 150, 121, 105, 76, 48, 32, 72, 45]
    widths.append(doc.width - sum(widths))
    sequence = 0
    for room in dict.fromkeys(row['room'] for row in rows):
        entries = [[paragraph(value, white) for value in headers]]
        room_rows = [row for row in rows if row['room'] == room]
        for row in room_rows:
            sequence += 1
            description = row['name'] + ('\n' + row['product'] if row['product'] else '') + '\n' + row['category']
            entries.append([paragraph(sequence), paragraph(description), paragraph(parameters_text(row['parameters']) or '—'),
                            paragraph('\n'.join(filter(None, [row['manufacturer'], row['sku']])) or '—'),
                            paragraph(row['supplier'] or '—'), paragraph(number(row['quantity']), right),
                            paragraph(row['unit']), paragraph(number(row['unit_price'], money=True), right),
                            paragraph(row['currency']), paragraph(number(row['total'], money=True), right)])
        story.append(grid(entries, widths, (5, 7, 9), room=room))
        electrical_rows = [row for row in room_rows if row['category'] in ('Электроустановки', 'Рамки')]
        quantity_summary(summarize_categories(electrical_rows), f'Итог по помещению: {room}')
    if result['warnings']:
        story.append(paragraph('Рекомендации по степени защиты IP', section))
        story.extend(paragraph('• ' + warning) for warning in result['warnings'])
    story.append(paragraph('Итоги спецификации', section))
    total_data = [[paragraph('Валюта', white), paragraph('Стоимость', white)]]
    total_data += [[paragraph(currency), paragraph(number(total, money=True), right)]
                   for currency, total in sorted(result['totals'].items())]
    if len(total_data) == 1:
        total_data.append([paragraph('—'), paragraph('0,00', right)])
    story.append(grid(total_data, [150, 150], (1,)))
    quantity_summary(summary['categories'], 'Полный итог по всем помещениям')

    def page_decoration(canvas, document):
        canvas.saveState()
        canvas.setFont('CalcReport', 8)
        canvas.setFillColor(ink)
        canvas.drawString(doc.leftMargin, landscape(A4)[1] - 25, 'SMART HOME CALC  /  СПЕЦИФИКАЦИЯ')
        canvas.setStrokeColor(colors.HexColor('#D9E5E8'))
        canvas.line(doc.leftMargin, 30, landscape(A4)[0] - doc.rightMargin, 30)
        name = text(project_name).replace('\n', ' ')
        while pdfmetrics.stringWidth(name, 'CalcReport', 8) > doc.width - 110:
            name = name[:-5] + '…'
        canvas.drawString(doc.leftMargin, 17, name)
        canvas.drawRightString(landscape(A4)[0] - doc.rightMargin, 17, f'Страница {document.page}')
        canvas.restoreState()
    doc.build(story, onFirstPage=page_decoration, onLaterPages=page_decoration)
    return output.getvalue()
