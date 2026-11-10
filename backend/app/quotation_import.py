"""Offline, preview-first import of proposal line items. Never evaluates formulas or macros."""
import csv
import io
import re
import uuid
import zipfile
from decimal import Decimal, InvalidOperation
from pathlib import PurePath
from .quotations import QuoteLine, money

MAX_ROWS=5000


def normalized(value):
    return re.sub(r'[^a-zа-яё0-9%]','',str(value or '').casefold()).replace('ё','е')


def numeric(value):
    if isinstance(value,(int,float,Decimal)):
        result=Decimal(str(value))
        return result if result.is_finite() else None
    original=str(value or '').strip().replace('−','-')
    if re.fullmatch(r'[+-]?\d+(?:[.,]\d+)?[eE][+-]?\d+',original):
        try: return Decimal(original.replace(',','.'))
        except InvalidOperation: return None
    value=re.sub(r'[^0-9,.\-]','',original)
    if original.startswith('(') and original.endswith(')'): value='-'+value.lstrip('-')
    if not value or value in ('-',',','.'): return None
    if ',' in value and '.' in value:
        if value.rfind(',')>value.rfind('.'): value=value.replace('.','').replace(',','.')
        else: value=value.replace(',','')
    elif re.fullmatch(r'[+-]?\d{1,3}(?:[,\.]\d{3}){2,}',value): value=value.replace(',','').replace('.','')
    elif ',' in value: value=value.replace(',','.')
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
    from .quotation_import_pdf import extract_pdf_rows
    return extract_pdf_rows(data,warnings)


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
        checks=[]
        for row in rows:
            name=row['name']
            if len(name)>500: warnings.append('Длинное наименование сокращено: '+name[:70])
            quantity=row['quantity'].quantize(Decimal('.001'))
            if quantity!=row['quantity']: warnings.append('Количество округлено до 0,001: '+name[:70])
            line=QuoteLine(id=uuid.uuid4().hex,name=name[:500],sku=str(row.get('sku',''))[:200],
                quantity=quantity,unit_price=money(row['unit_price']),unit=row['unit'],currency=row['currency'],
                image=row.get('image',''),discount=row.get('discount'))
            lines.append(line.model_dump(mode='json'))
            if '_page' in row:
                source=row.get('_source_total')
                checks.append({'line_id':line.id,'page':row['_page'],
                    'source_total':str(money(source)) if source is not None else None,
                    'issues':row.get('_issues',[]),
                    'verified':source is not None and not row.get('_issues')})
        return {'filename':filename[:200],'lines':lines,'warnings':list(dict.fromkeys(warnings)),'checks':checks}
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError('Не удалось прочитать документ. Проверьте формат, пароль и наличие таблицы цен.') from exc
