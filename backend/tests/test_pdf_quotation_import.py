"""Independent supplier layouts, not just round trips through our own exporter."""
from decimal import Decimal
import pymupdf
import pytest
from app.quotation_import import parse_quote_file

# CI and Windows use the same application font selection as production.
from app.main import pdf_font_path


def supplier_pdf(rows, *, order=('number','name','price','quantity','unit','total'),
                 spaced=False, ruled=False, continuation=False, discount=False,
                 price_missing=False, offsets=False):
    if price_missing: order=tuple(k for k in order if k!='price')
    if discount: order=order[:-1]+('discount',order[-1])
    widths={'number':28,'name':245,'price':85,'quantity':55,'unit':40,'total':95,'discount':60,'sku':70}
    width=sum(widths[k] for k in order)+40
    headings={'number':'№','name':'Наименование','price':'Цена','quantity':'Кол-во','unit':'Ед.','total':'Сумма','discount':'Скидка %','sku':'Артикул'}
    doc=pymupdf.open()
    def page_new():
        p=doc.new_page(width=width,height=820);p.insert_font(fontname='Test',fontfile=str(pdf_font_path()));return p
    page=page_new();y=60
    def text(x,y,value,size=9): page.insert_text((x,y),str(value),fontname='Test',fontsize=size)
    def header():
        x=20
        for key in order:
            label=headings[key]
            if spaced: label=' '.join(label.upper())
            if spaced and key=='quantity':
                text(x+6,y-4,'К О Л -',6);text(x+9,y+4,'В О',6)
            else: text(x+5,y,label,6 if spaced else 8)
            x+=widths[key]
    header();y+=12
    for index,row in enumerate(rows):
        if index==len(rows)//2 and continuation:
            page=page_new();y=28
        height=max(36,len(row.get('name_lines',[row['name']]))*12+18)
        if ruled:
            page.draw_line((20,y),(width-20,y),width=.5)
        x=20
        for key in order:
            if ruled: page.draw_line((x,y),(x,y+height),width=.5)
            if key=='name':
                for n,line in enumerate(row.get('name_lines',[row['name']])): text(x+5,y+15+n*12,line)
                if row.get('article'): text(x+5,y+height-3,row['article'],6)
            else:
                value=str(index+1) if key=='number' else str(row.get(key,''))
                yy=y+height/2+3+(2 if offsets and key=='total' else 0)
                font=pymupdf.Font(fontfile=str(pdf_font_path()))
                text(x+widths[key]-5-font.text_length(value,fontsize=9),yy,value)
            x+=widths[key]
        y+=height
    if ruled: page.draw_line((20,y),(width-20,y),width=.5)
    text(25,y+25,'Итого по предложению')
    text(width-105,y+25,'140 743,00')
    result=doc.tobytes();doc.close();return result


@pytest.mark.parametrize('spaced,ruled,continuation,offsets',[
    (True,False,False,True),(False,True,False,True),
    (False,False,True,False),(True,True,True,True),
])
def test_supplier_reference_prices_names_and_quantities(spaced,ruled,continuation,offsets):
    prices=['25 904,00','54 500,00','10 847,00','19 540,00','4 590,00','2 667,00','16 100,00','185,00','185,00','210,00']
    quantities=[1,1,1,1,1,1,1,1,4,27]
    rows=[{'name':f'Светильник модели {i+1}',
           'name_lines':[f'Светильник модели {i+1}','LED 20W IP54 3000K 220V'],
           'article':f'ART-{i+1}', 'price':p,'quantity':q,'unit':'шт',
           'total':str(Decimal(p.replace(' ','').replace(',','.'))*q).replace('.',',')}
          for i,(p,q) in enumerate(zip(prices,quantities))]
    imported=parse_quote_file(supplier_pdf(rows,spaced=spaced,ruled=ruled,continuation=continuation,offsets=offsets),'supplier.pdf')
    assert len(imported['lines'])==10,imported
    assert [Decimal(l['unit_price']) for l in imported['lines']]==[Decimal(p.replace(' ','').replace(',','.')) for p in prices]
    assert [Decimal(l['quantity']) for l in imported['lines']]==quantities
    assert sum(Decimal(l['unit_price'])*Decimal(l['quantity']) for l in imported['lines'])==Decimal('140743')
    for i,line in enumerate(imported['lines']):
        assert line['name']==f'Светильник модели {i+1} LED 20W IP54 3000K 220V'
        assert line['sku']==f'ART-{i+1}'
    assert not imported['warnings'],imported['warnings']


@pytest.mark.parametrize('order',[
    ('number','sku','name','quantity','unit','price','total'),
    ('name','unit','quantity','price','total'),
    ('number','name','price','total','quantity','unit'),
])
def test_different_column_order_and_fractional_meters(order):
    data=supplier_pdf([{'name':'Лента LED 24V 120','sku':'LED-42','price':'1 234,50','quantity':'2,5','unit':'м','total':'3 086,25'}],order=order,ruled=True)
    result=parse_quote_file(data,'columns.pdf')
    assert len(result['lines'])==1,result
    line=result['lines'][0]
    assert line['name']=='Лента LED 24V 120'
    assert Decimal(line['quantity'])==Decimal('2.5') and line['unit']=='м'
    assert Decimal(line['unit_price'])==Decimal('1234.5')
    assert not result['warnings'],result['warnings']


def test_arithmetic_mismatch_is_visible_and_never_changes_source_price():
    result=parse_quote_file(supplier_pdf([{'name':'Розетка','price':'123,45','quantity':'3','unit':'шт','total':'300,00'}]),'mismatch.pdf')
    assert result['lines'][0]['unit_price']=='123.45'
    assert any('300.00' in w and '370.35' in w for w in result['warnings'])


def test_only_row_total_derives_unit_price_explicitly():
    result=parse_quote_file(supplier_pdf([{'name':'Профиль','quantity':'2,5','unit':'м','total':'250,00'}],price_missing=True),'total-only.pdf')
    assert result['lines'][0]['unit_price']=='100.00'
    assert any('рассчитана' in w for w in result['warnings'])


def test_explicit_percentage_discount_survives_import():
    result=parse_quote_file(supplier_pdf([{'name':'Диммер','price':'1000,00','quantity':'2','unit':'шт','discount':'15 %','total':'1700,00'}],discount=True),'discount.pdf')
    assert result['lines'][0]['unit_price']=='1000.00'
    assert Decimal(result['lines'][0]['discount'])==15
    assert not result['warnings'],result['warnings']


def test_invalid_row_is_reported_while_valid_rows_survive():
    result=parse_quote_file(supplier_pdf([
        {'name':'Розетка','price':'125,50','quantity':'2','unit':'шт','total':'251,00'},
        {'name':'Выключатель','price':'99,00','quantity':'?','unit':'шт','total':'99,00'}]),'partial.pdf')
    assert len(result['lines'])==1,result
    assert any('пропущена' in w and 'Выключатель' in w for w in result['warnings']),result


@pytest.mark.parametrize('price,total,expected',[
    ('1,234.50 $','3,703.50 $','1234.50'),('1.234,50 €','3.703,50 €','1234.50'),
    ('1,234','3,702','1234.00'),('1.234.567','3.703.701','1234567.00'),
    ('0,00','0,00','0.00'),
])
def test_money_separators_and_zero_prices(price,total,expected):
    result=parse_quote_file(supplier_pdf([{'name':'Оборудование','price':price,'quantity':'3','unit':'шт','total':total}]),'money.pdf')
    assert result['lines'][0]['unit_price']==expected,result
    assert result['checks'][0]['verified'],result
    if '$' in price: assert result['lines'][0]['currency']=='USD'
    if '€' in price: assert result['lines'][0]['currency']=='EUR'


def test_rotated_pages_keep_all_positions():
    rows=[{'name':f'Позиция {i}','price':'100,00','quantity':str(i),'unit':'шт','total':str(i*100)+',00'} for i in range(1,15)]
    data=supplier_pdf(rows,ruled=True)
    with pymupdf.open(stream=data,filetype='pdf') as doc:
        doc[0].set_rotation(90);data=doc.tobytes()
    result=parse_quote_file(data,'rotated.pdf')
    assert len(result['lines'])==14,result
    assert not result['warnings'],result['warnings']


def test_mixed_scan_and_text_pages_report_unimported_scan():
    data=supplier_pdf([{'name':'Светильник','price':'100,00','quantity':'2','unit':'шт','total':'200,00'}])
    with pymupdf.open(stream=data,filetype='pdf') as doc:
        doc.new_page();data=doc.tobytes()
    result=parse_quote_file(data,'mixed.pdf')
    assert len(result['lines'])==1
    assert any('2' in w and 'OCR' in w for w in result['warnings'])


def test_row_checks_identify_source_page_and_price_mismatch():
    result=parse_quote_file(supplier_pdf([{'name':'Датчик','price':'100,00','quantity':'2','unit':'шт','total':'150,00'}]),'review.pdf')
    check=result['checks'][0]
    assert check['line_id']==result['lines'][0]['id'] and check['page']==1
    assert check['source_total']=='150.00' and not check['verified'] and check['issues']


def test_pdf_without_total_never_claims_arithmetic_verification():
    data=supplier_pdf([{'name':'Реле','price':'150,00','quantity':'2','unit':'шт'}],order=('number','name','quantity','unit','price'))
    result=parse_quote_file(data,'no-total.pdf')
    assert len(result['lines'])==1 and result['lines'][0]['unit_price']=='150.00'
    assert not result['checks'][0]['verified'] and result['checks'][0]['source_total'] is None


def test_different_height_rows_do_not_mix_names():
    rows=[{'name':'Короткое название','price':'1500,00','quantity':'2','unit':'шт','total':'3000,00'},
          {'name':'Длинное название','name_lines':['Длинное название','светильника с описанием','цвета и материалов','и технических свойств','строка пятая','последняя строка'],'price':'2500,00','quantity':'1','unit':'шт','total':'2500,00'},
          {'name':'Следующий товар','price':'500,00','quantity':'3','unit':'шт','total':'1500,00'}]
    result=parse_quote_file(supplier_pdf(rows),'wrapped.pdf')
    assert [line['name'] for line in result['lines']]==[r.get('name_lines') and ' '.join(r['name_lines']) or r['name'] for r in rows],result
    assert not result['warnings'],result['warnings']


def test_overprinted_bold_text_does_not_duplicate_names_or_numbers():
    data=supplier_pdf([{'name':'Профиль накладной','price':'1234,50','quantity':'2','unit':'м','total':'2469,00'}])
    with pymupdf.open(stream=data,filetype='pdf') as source, pymupdf.open() as doubled:
        page=doubled.new_page(width=source[0].rect.width,height=source[0].rect.height)
        page.show_pdf_page(page.rect,source,0)
        page.show_pdf_page(pymupdf.Rect(.2,.2,page.rect.width+.2,page.rect.height+.2),source,0)
        data=doubled.tobytes()
    result=parse_quote_file(data,'overprinted.pdf')
    assert len(result['lines'])==1 and result['lines'][0]['name']=='Профиль накладной'
    assert result['lines'][0]['unit_price']=='1234.50' and result['lines'][0]['quantity']=='2.000'
    assert not result['warnings'],result['warnings']


def test_scan_with_text_footer_is_not_silently_omitted_from_mixed_pdf():
    data=supplier_pdf([{'name':'Розетка','price':'100,00','quantity':'2','unit':'шт','total':'200,00'}])
    with pymupdf.open(stream=data,filetype='pdf') as doc:
        raster=doc[0].get_pixmap(matrix=pymupdf.Matrix(.7,.7)).tobytes('png')
        scanned=doc.new_page(width=doc[0].rect.width,height=doc[0].rect.height)
        scanned.insert_image(scanned.rect,stream=raster)
        scanned.insert_text((20,800),'Page 2')
        data=doc.tobytes()
    result=parse_quote_file(data,'mixed-scan.pdf')
    assert len(result['lines'])==1
    assert any('Страница 2' in warning and 'OCR' in warning for warning in result['warnings'])
