"""Exported annotations must retain complete text at page edges."""
import pymupdf
import pytest
from test_workflow import client

@pytest.mark.parametrize('height',[700,1400])
def test_exported_plan_retains_edge_labels(client,height):
    pid=client.post('/api/projects',json={'name':'Подписи у границы'}).json()['id']
    document=pymupdf.open();document.new_page(width=1000,height=height)
    page=client.post(f'/api/projects/{pid}/pdf',files={'file':('plan.pdf',document.tobytes(),'application/pdf')}).json()[0]
    project=client.get(f'/api/projects/{pid}').json();types=client.get('/api/types').json()
    kind=next(t for t in types if t['name']=='Розетка одинарная');layer=next(l for l in project['layers'] if l['name']==kind['category'])
    names=['Правый край','Верхний угол','Левый край','Нижний угол','ОченьДлинноеНазваниеБезПробелов'*6]
    for (x,y),name in zip([(.99,.3),(.99,.001),(.001,.5),(.99,.999),(.5,.8)],names):
        response=client.post(f'/api/projects/{pid}/elements',json={'page_id':page['id'],'layer_id':layer['id'],'type_id':kind['id'],'x':x,'y':y,'parameters':{'display_name':name,'quantity':2,'plan_label_size':40 if name==names[-1] else 7}})
        assert response.status_code==201,response.text
    before=client.get(f'/api/projects/{pid}').json()
    response=client.get(f'/api/projects/{pid}/pages/{page["id"]}/export.pdf');assert response.status_code==200
    with pymupdf.open(stream=response.content,filetype='pdf') as pdf:
        sheet=pdf[0];text=''.join(sheet.get_text().split())
        for name in names:assert ''.join(name.split()) in text,f'Clipped annotation: {name}'
        for block in sheet.get_text('dict')['blocks']:
            for line in block.get('lines',[]):
                for span in line['spans']:
                    rect=pymupdf.Rect(span['bbox']);assert rect.x0>=0 and rect.y0>=0 and rect.x1<=sheet.rect.width+.1 and rect.y1<=sheet.rect.height+.1
    assert client.get(f'/api/projects/{pid}').json()==before
