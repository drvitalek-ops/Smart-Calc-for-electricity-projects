"""Every public failure stays Russian; localized numbers never change meaning."""
from decimal import Decimal
from fastapi.testclient import TestClient
import pytest
from app import main
from app.quotations import PriceInput
from test_workflow import client,setup


def test_decimal_comma_spaces_and_limits_are_checked_after_normalization(client):
    qid=client.post('/api/quotations',json={}).json()['id']
    path=f'/api/quotations/{qid}'
    quote=client.get(path).json()
    quote['global_discount']='10,5'
    quote['lines']=[{'id':'a','name':'Лента','quantity':'2,5','unit_price':'1\u202f234,50','discount':'20,5'},
                    {'id':'b','name':'Светильник','quantity':'1','unit_price':'100,00'}]
    response=client.put(path,json=quote);assert response.status_code==200,response.text
    saved=response.json()
    assert saved['lines'][0]['quantity']=='2.5' and saved['lines'][0]['unit_price']=='1234.50'
    assert saved['partner']['totals']['RUB']['total']=='2543.07'
    calculation=client.post(path+'/calculate',json={'global_discount':'10,5','lines':quote['lines']})
    assert calculation.status_code==200 and calculation.json()['partner']['totals']==saved['partner']['totals']
    for invalid in ('1 2','1,2,3','1,234.56','','NaN','Infinity','-1','0','0,0001','1000001'):
        response=client.post(path+'/calculate',json={'lines':[{'id':'bad','quantity':invalid,'unit_price':'1'}]})
        assert response.status_code==422,(invalid,response.text)
        details=response.json()['detail'];assert details[0]['field']=='Строка КП № 1 — Количество'
        assert 'Input should' not in response.text and 'msg' in details[0]
    assert client.get(path).json()==saved


def test_errors_identify_second_and_third_rows_and_never_echo_inputs(client):
    qid=client.post('/api/quotations',json={}).json()['id']
    payload={'lines':[{'id':'one','quantity':1},{'id':'two','quantity':''},{'id':'three','quantity':'private-invalid-input'}]}
    response=client.post(f'/api/quotations/{qid}/calculate',json=payload)
    assert response.status_code==422
    details=response.json()['detail']
    assert [error['field'] for error in details]==['Строка КП № 2 — Количество','Строка КП № 3 — Количество']
    assert all('Введите число' in error['msg'] for error in details)
    assert 'private-invalid-input' not in response.text and 'input' not in details[0]
    bad_path=client.get('/api/projects/not-a-number')
    assert bad_path.status_code==422 and bad_path.json()['detail'][0]['field']=='Проект'
    bad_json=client.post('/api/projects',content=b'{broken',headers={'Content-Type':'application/json'})
    assert bad_json.status_code==422 and 'Не удалось прочитать данные' in bad_json.json()['detail'][0]['msg']
    assert client.get('/api/unknown-url').json()['detail']=='Запрошенный объект не найден.'


def test_custom_validation_messages_and_corrupt_archive_are_russian(client):
    pid,body=setup(client)
    response=client.post(f'/api/projects/{pid}/elements',json={**body,'parameters':{'length':'not-number'}})
    assert response.status_code==422 and response.json()['detail']=='Некорректный параметр: Длина'
    response=client.post('/api/projects/import',files={'file':('broken.zip',b'not zip','application/zip')})
    assert response.status_code==422 and 'архив' in response.json()['detail']
    assert 'zip file' not in response.text and 'Traceback' not in response.text
    qid=client.post('/api/quotations',json={}).json()['id']
    response=client.post(f'/api/quotations/{qid}/calculate',json={'lines':[{'id':'same'},{'id':'same'}]})
    assert response.status_code==422
    assert response.json()['detail'][0]['msg']=='Повторяющийся идентификатор строки КП'


def test_unexpected_server_failure_does_not_expose_english_or_technical_details(client,monkeypatch):
    pid,_=setup(client)
    def fail(*_args):raise RuntimeError('Database driver failure with private details')
    monkeypatch.setattr(main,'report_rows',fail)
    with TestClient(main.app,raise_server_exceptions=False) as safe:
        response=safe.get(f'/api/projects/{pid}/report')
    assert response.status_code==500
    assert response.json()['detail']=='Не удалось выполнить действие из-за внутренней ошибки. Повторите попытку.'
    assert 'driver' not in response.text and 'private' not in response.text


def test_exact_fraction_validation_does_not_round_excess_decimal_places():
    for quantity in ('0,1','1.23000','1000e-4','0.300'):
        value=PriceInput(lines=[{'id':'a','quantity':quantity}]);assert value.lines[0].quantity>0
    with pytest.raises(ValueError):PriceInput(lines=[{'id':'a','quantity':'0.30000000000000004'}])
