"""Category editing and shared, portable quotation typography regressions."""
import pymupdf
from test_workflow import client,setup
from app.quotations import QuoteInput,QuoteLine
from app.quotation_pdf import export_quotation


def test_custom_categories_persist_empty_and_rename_used_positions(client):
    created=client.post('/api/categories',json={'name':'Комплектующие заказчика','description':'Любые дополнительные товары'})
    assert created.status_code==201,created.text
    category=created.json()
    assert any(row['name']==category['name'] and row['positions']==0 for row in client.get('/api/categories').json())
    assert client.post('/api/categories',json={'name':'комплектующие заказчика'}).status_code==409
    position=client.post('/api/types',json={'name':'Любая новая позиция','category':category['name']}).json()
    assert client.delete(f"/api/categories/{category['id']}").status_code==409
    response=client.put(f"/api/categories/{category['id']}",json={'name':'Дополнительные комплектующие','description':'Описание'})
    assert response.status_code==200,response.text
    assert next(row for row in client.get('/api/types').json() if row['id']==position['id'])['category']=='Дополнительные комплектующие'
    empty=client.post('/api/categories',json={'name':'Временная'}).json()
    assert client.delete(f"/api/categories/{empty['id']}").status_code==200


def test_pdf_embeds_real_weights_original_logo_and_white_pages():
    quote=QuoteInput(number='42',customer='Покупатель',lines=[QuoteLine(id=str(i),name='Светильник с длинным названием и артикулом '+str(i),quantity='2',unit_price='6970') for i in range(65)])
    pdf=pymupdf.open(stream=export_quotation(quote,'partner'),filetype='pdf')
    assert len(pdf)>=3
    names={item[3] for item in pdf[0].get_fonts()}
    assert {'Golos Text Regular','Golos Text Bold','Golos Text Black'}<=names
    for page in pdf:
        assert {span['type'] for span in page.get_texttrace()}=={0},'Synthetic bold strokes distort glyphs'
        pixel=page.get_pixmap(clip=pymupdf.Rect(1,150,2,151),alpha=False)
        assert pixel.samples[:3]==b'\xff\xff\xff'
    assert pdf[0].get_images(),'The original logo must be an embedded image'
    assert '13 940,00' in ''.join(page.get_text() for page in pdf)
    assert '64' in ''.join(page.get_text() for page in pdf)


def test_preview_uses_export_renderer_without_saving(client):
    pid,_=setup(client)
    path=f'/api/projects/{pid}/quotation'
    saved=client.get(path).json()
    edited={**saved,'number':'Несохранённый 42','lines':[{'id':'one','name':'Тестовый товар','quantity':'3','unit_price':'100','discount':'15'}]}
    for mode,expected in [('partner','255,00'),('client','300,00')]:
        response=client.post(path+'/preview.pdf?mode='+mode,json=edited)
        assert response.status_code==200,response.text
        preview=pymupdf.open(stream=response.content,filetype='pdf')
        assert expected in ''.join(page.get_text() for page in preview)
    image=client.post(path+'/preview.png?mode=partner&page=1',json=edited)
    assert image.status_code==200 and image.headers['x-preview-pages']=='1'
    pdf=client.post(path+'/preview.pdf?mode=partner',json=edited).content
    with pymupdf.open(stream=pdf,filetype='pdf') as document:
        assert pymupdf.Pixmap(image.content).samples==document[0].get_pixmap(matrix=pymupdf.Matrix(2,2),alpha=False).samples
    assert client.post(path+'/preview.png?page=0',json=edited).status_code==422
    assert client.get(path).json()==saved
    response=client.put(path,json=edited);assert response.status_code==200,response.text
    preview=client.post(path+'/preview.pdf?mode=partner',json=response.json()).content
    download=client.get(path+'/export.pdf?mode=partner').content
    a=pymupdf.open(stream=preview,filetype='pdf');b=pymupdf.open(stream=download,filetype='pdf')
    assert len(a)==len(b)
    for pa,pb in zip(a,b):assert pa.get_pixmap().samples==pb.get_pixmap().samples
