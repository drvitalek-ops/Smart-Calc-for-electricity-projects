"""Offline, preview-first import of proposal line items. Never evaluates formulas or macros."""
import base64
import csv
import io
import re
import uuid
import zipfile
from decimal import Decimal, InvalidOperation
from pathlib import PurePath
import pymupdf
from .quotations import QuoteLine, money

MAX_ROWS=5000


def normalized(value):
    return re.sub(r'[^a-zа-яё0-9%]','',str(value or '').casefold()).replace('ё','е')


def numeric(value):
    if isinstance(value,(int,float,Decimal)):
        result=Decimal(str(value))
        return result if result.is_finite() else None
    value=re.sub(r'[^0-9,.\-]','',str(value or ''))
    if not value or value in ('-',',','.'): return None
    if ',' in value: value=value.replace('.','').replace(',','.')
    elif value.count('.')>1:
        parts=value.split('.');value=''.join(parts[:-1])+'.'+parts[-1]
    try:
        result=Decimal(value)
        return result if result.is_finite() else None
    except InvalidOperation: return None


def columns(row):
    result={}
    for index,cell in enumerate(row):
        name=normalized(cell)
        if not name: continue
        if any(word in name for word in ('наименован','название','товар','номенклат','description','product','itemname')) or name=='name':
            result.setdefault('name',index)
        elif any(word in name for word in ('скидк','discount')):
            result.setdefault('discount',index)
        elif any(word in name for word in ('цена','цены','price','заед')):
            result.setdefault('price',index)
        elif any(word in name for word in ('колво','колич','quantity','qty')) or name=='count':
            result.setdefault('quantity',index)
        elif any(word in name for word in ('артикул','sku','article')) or name=='код':
            result.setdefault('sku',index)
        elif name in ('ед','едизм','единица','единицы','unit','единицаизмерения'):
            result.setdefault('unit',index)
        elif any(word in name for word in ('валют','currency')):
            result.setdefault('currency',index)
    return result


def recognized_rows(table,warnings):
    header=None
    mapping=None
    for index,row in enumerate(table[:100]):
        candidate=columns(row)
        if all(key in candidate for key in ('name','price','quantity')):
            header=index;mapping=candidate;break
    if header is None: return []
    result=[]
    discount_present='discount' in mapping
    for row in table[header+1:]:
        if all(key in columns(row) for key in ('name','price','quantity')): continue
        def cell(key):
            index=mapping.get(key)
            return row[index] if index is not None and index<len(row) else ''
        name=str(cell('name') or '').strip()
        if not name or re.match(r'^(итого|всего|к оплате|total|subtotal)\b',name,re.I): continue
        quantity=numeric(cell('quantity'));price=numeric(cell('price'))
        if quantity is None or price is None or quantity<=0 or price<0:
            warnings.append('Пропущена строка без корректной цены и количества: '+name[:80]);continue
        unit='м' if normalized(cell('unit')) in ('м','m','пм','погм','метр','метры') else 'шт'
        currency=str(cell('currency') or '').upper().strip()
        if not re.fullmatch(r'[A-Z]{3}',currency):
            price_text=str(cell('price'))
            currency='EUR' if '€' in price_text else 'USD' if '$' in price_text else 'RUB'
        result.append({'name':name,'quantity':quantity,'unit_price':price,'unit':unit,'currency':currency,'sku':str(cell('sku') or '')})
    if discount_present:
        warnings.append('В источнике есть скидки. Перенесены цены из колонки «Цена»; скидки задайте в редакторе КП.')
    return result


def safe_zip(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        files=archive.infolist()
        if len(files)>10000 or sum(item.file_size for item in files)>100*1024*1024:
            raise ValueError('Распакованный документ больше 100 МБ')
        if any(item.flag_bits & 1 for item in files):
            raise ValueError('Документ защищён паролем')


def pdf_rows(data,warnings):
    rows=[]
    with pymupdf.open(stream=data,filetype='pdf') as document:
        if document.needs_pass: raise ValueError('PDF защищён паролем')
        if len(document)>100: raise ValueError('В PDF больше 100 страниц')
        text_found=False
        for page in document:
            words=page.get_text('words')
            text_found=text_found or bool(words)
            # Recover columns by their header positions. This handles horizontal-rule
            # tables like the supplied reference, including wrapped item names.
            headers=[]
            for word in words:
                if normalized(word[4]) in ('цена','price'):
                    band=[other for other in words if abs((other[1]+other[3])/2-(word[1]+word[3])/2)<15]
                    name=next((item for item in band if any(key in normalized(item[4]) for key in ('наименован','название','номенклат','товар','description'))),None)
                    qty=next((item for item in band if any(key in normalized(item[4]) for key in ('колво','кол','quantity','qty'))),None)
                    unit=next((item for item in band if normalized(item[4]) in ('ед','unit','едизм')),None)
                    if name and qty: headers.append((word,name,qty,unit))
            rules=[]
            for drawing in page.get_drawings():
                for item in drawing['items']:
                    if item[0]=='l' and abs(item[1].y-item[2].y)<1 and abs(item[1].x-item[2].x)>page.rect.width*.6:
                        rules.append(item[1].y)
            spatial=[]
            for price_header,name_header,qty_header,unit_header in headers:
                qty_center=(qty_header[0]+qty_header[2])/2
                header_end=max(price_header[3],name_header[3],qty_header[3])
                anchors=[word for word in words if word[1]>header_end+1 and abs((word[0]+word[2])/2-qty_center)<max(12,(qty_header[2]-qty_header[0])/2+4)
                         and re.fullmatch(r'\d+(?:[,.]\d+)?',word[4])]
                anchors.sort(key=lambda word:word[1])
                for index,anchor in enumerate(anchors):
                    center=(anchor[1]+anchor[3])/2
                    quantity=numeric(anchor[4])
                    price_words=[word for word in words if abs((word[1]+word[3])/2-center)<7 and word[0]>=price_header[0]-80
                                 and word[2]<anchor[0]-4 and re.fullmatch(r'[\d ,.]+',word[4])]
                    price_words.sort(key=lambda word:word[0])
                    price=numeric(' '.join(word[4] for word in price_words))
                    if price is None or quantity is None or quantity<=0: continue
                    start=header_end+3 if index==0 else ((anchors[index-1][1]+anchors[index-1][3])/2+center)/2
                    end=min([rule for rule in rules if rule>center+5],default=center+60) if index==len(anchors)-1 else (center+(anchors[index+1][1]+anchors[index+1][3])/2)/2
                    price_left=min(word[0] for word in price_words)-6
                    name_words=[word for word in words if name_header[0]-8<=word[0]<price_left and word[2]<=price_left+5
                                and start<=(word[1]+word[3])/2<end]
                    name_words.sort(key=lambda word:(round(word[1]/4),word[0]))
                    name=' '.join(word[4] for word in name_words).strip()
                    if not name: continue
                    unit_words=[word[4] for word in words if unit_header and abs((word[0]+word[2])/2-(unit_header[0]+unit_header[2])/2)<12
                                and abs((word[1]+word[3])/2-center)<8]
                    unit='м' if any(normalized(value) in ('м','m','пм') for value in unit_words) else 'шт'
                    row={'name':name,'quantity':quantity,'unit_price':price,'unit':unit,'currency':('EUR' if any('€' in word[4] for word in words if abs((word[1]+word[3])/2-center)<7) else 'USD' if any('$' in word[4] for word in words if abs((word[1]+word[3])/2-center)<7) else 'RUB')}
                    # Only small inline images can be product photos, never the masthead.
                    for info in page.get_image_info(xrefs=True):
                        rect=pymupdf.Rect(info['bbox'])
                        if rect.width<110 and rect.height<110 and rect.width>5 and rect.height>5 and start<=rect.y0<end and rect.x1<price_left:
                            pixmap=page.get_pixmap(clip=rect,matrix=pymupdf.Matrix(min(2,200/max(rect.width,rect.height)),min(2,200/max(rect.width,rect.height))),alpha=False)
                            row['image']='data:image/png;base64,'+base64.b64encode(pixmap.tobytes('png')).decode()
                            break
                    spatial.append(row)
            if spatial:
                rows.extend(spatial);continue
            tables=page.find_tables()
            extracted=[]
            for table in tables.tables: extracted.extend(recognized_rows(table.extract(),warnings))
            if not extracted:
                tables=page.find_tables(strategy='text',min_words_vertical=2,min_words_horizontal=1)
                for table in tables.tables: extracted.extend(recognized_rows(table.extract(),warnings))
            rows.extend(extracted)
        if not text_found: raise ValueError('PDF содержит сканы без текста. Сначала распознайте текст либо используйте Excel или Word (.docx).')
    return rows


def parse_quote_file(data,filename):
    extension=PurePath(filename).suffix.casefold()
    warnings=[]
    rows=[]
    try:
        if extension=='.pdf':
            rows=pdf_rows(data,warnings)
        elif extension in ('.xlsx','.xlsm'):
            safe_zip(data)
            from openpyxl import load_workbook
            workbook=load_workbook(io.BytesIO(data),read_only=True,data_only=True)
            try:
                if len(workbook.worksheets)>100: raise ValueError('В книге больше 100 листов')
                for sheet in workbook.worksheets:
                    table=[]
                    for index,row in enumerate(sheet.iter_rows(values_only=True)):
                        if index>20000: raise ValueError('В листе больше 20000 строк')
                        table.append(list(row[:100]))
                    rows.extend(recognized_rows(table,warnings))
            finally: workbook.close()
        elif extension=='.xls':
            import xlrd
            workbook=xlrd.open_workbook(file_contents=data,on_demand=True)
            try:
                if workbook.nsheets>100: raise ValueError('В книге больше 100 листов')
                for sheet in workbook.sheets():
                    if sheet.nrows>20000: raise ValueError('В листе больше 20000 строк')
                    rows.extend(recognized_rows([sheet.row_values(index)[:100] for index in range(sheet.nrows)],warnings))
            finally: workbook.release_resources()
        elif extension=='.docx':
            safe_zip(data)
            from docx import Document
            document=Document(io.BytesIO(data))
            for table in document.tables:
                if len(table.rows)>20000: raise ValueError('В таблице больше 20000 строк')
                rows.extend(recognized_rows([[cell.text for cell in row.cells[:100]] for row in table.rows],warnings))
        elif extension=='.csv':
            try: content=data.decode('utf-8-sig')
            except UnicodeDecodeError: content=data.decode('cp1251')
            dialect=csv.Sniffer().sniff(content[:4096],delimiters=';,\t')
            rows=recognized_rows(list(csv.reader(io.StringIO(content),dialect)),warnings)
        elif extension=='.doc':
            raise ValueError('Сохраните старый Word .doc в формате .docx и загрузите повторно.')
        else:
            raise ValueError('Поддерживаются PDF, Excel (.xlsx, .xls), Word (.docx) и CSV')
        if not rows:
            raise ValueError('Не найдены строки с колонками «Наименование», «Цена» и «Количество». Проверьте заголовки таблицы.')
        if len(rows)>MAX_ROWS: raise ValueError('В КП больше 5000 позиций')
        lines=[]
        for row in rows:
            name=row['name']
            if len(name)>500: warnings.append('Длинное наименование сокращено: '+name[:70])
            quantity=row['quantity'].quantize(Decimal('.001'))
            if quantity!=row['quantity']: warnings.append('Количество округлено до 0,001: '+name[:70])
            line=QuoteLine(id=uuid.uuid4().hex,name=name[:500],sku=str(row.get('sku',''))[:200],
                quantity=quantity,unit_price=money(row['unit_price']),unit=row['unit'],currency=row['currency'],
                image=row.get('image',''))
            lines.append(line.model_dump(mode='json'))
        return {'filename':filename[:200],'lines':lines,'warnings':list(dict.fromkeys(warnings))}
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError('Не удалось прочитать документ. Проверьте формат, пароль и наличие таблицы цен.') from exc
