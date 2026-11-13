"""Russian public errors; technical exception details stay in server logs."""
import json
import logging
import re
from pathlib import Path
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse

FIELDS=json.loads((Path(__file__).parent/'assets/error-fields.json').read_text(encoding='utf-8'))
FALLBACKS={400:'Не удалось обработать запрос. Проверьте введённые данные.',401:'Необходим вход в приложение.',403:'Нет доступа к этому действию.',404:'Запрошенный объект не найден.',405:'Это действие недоступно.',409:'Данные изменились. Обновите их и повторите действие.',413:'Файл или запрос слишком большой.',422:'Проверьте заполнение полей.',429:'Слишком много запросов. Повторите действие немного позже.',500:'Не удалось выполнить действие из-за внутренней ошибки. Повторите попытку.',502:'Локальный сервер недоступен. Повторите действие.',503:'Приложение временно недоступно. Повторите действие.',504:'Превышено время ожидания ответа. Повторите действие.'}
TECHNICAL=re.compile(r'Input should|validation error|Value error,|Traceback|JSONDecodeError|IntegrityError|OperationalError|File is not a zip|Expecting value|Error code:|\b(?:[A-Za-z]+Error|invalid|failed|unexpected|cannot|denied|should)\b',re.I)


def public_message(value,status=422):
    if not isinstance(value,str) or not re.search('[а-яё]',value,re.I) or TECHNICAL.search(value):
        return FALLBACKS.get(status,FALLBACKS[500])
    for key,label in FIELDS.items():
        value=re.sub(r'(?<![\w])'+re.escape(key)+r'(?=\s*:|\s*$)',label,value)
    if not re.match(r'^(?:[а-яё0-9«]|PDF\b|CSV\b|IP\b|ZIP\b|PNG\b|JPEG\b|Excel\b|Word\b|LED\b)',value.strip(),re.I):
        return FALLBACKS.get(status,FALLBACKS[500])
    return value


def field_name(location):
    parts=[part for part in location if part not in ('body','query','path','response')]
    result=[];index=0
    while index<len(parts):
        part=parts[index]
        if part in ('lines','benefits') and index+1<len(parts) and isinstance(parts[index+1],int):
            result.append(('Строка КП № ' if part=='lines' else 'Преимущество № ')+str(parts[index+1]+1));index+=2;continue
        if isinstance(part,int):result.append('№ '+str(part+1))
        elif part in FIELDS:result.append(FIELDS[part])
        elif isinstance(part,str) and part.startswith('custom:'):result.append('Своя характеристика')
        else:result.append('Поле')
        index+=1
    return ' — '.join(result) or 'Данные'


def validation_message(error):
    kind=error.get('type','');ctx=error.get('ctx') or {}
    simple={
      'missing':'Заполните обязательное поле.', 'decimal_parsing':'Введите число, например 1 или 2,5.',
      'decimal_type':'Введите число, например 1 или 2,5.', 'float_parsing':'Введите число.', 'float_type':'Введите число.',
      'int_parsing':'Введите целое число.', 'int_type':'Введите целое число.', 'int_from_float':'Введите целое число.',
      'finite_number':'Введите конечное число.', 'bool_parsing':'Выберите допустимое значение.', 'bool_type':'Выберите допустимое значение.',
      'string_type':'Введите текст.', 'string_pattern_mismatch':'Проверьте формат значения.', 'literal_error':'Выберите допустимое значение.',
      'enum':'Выберите значение из списка.', 'list_type':'Выберите значения из списка.', 'dict_type':'Проверьте состав данных.',
      'model_type':'Проверьте состав данных.', 'model_attributes_type':'Проверьте состав данных.', 'extra_forbidden':'Это поле не поддерживается.',
      'json_invalid':'Не удалось прочитать данные. Повторите действие.', 'json_type':'Не удалось прочитать данные.',
      'date_parsing':'Укажите корректную дату.', 'date_from_datetime_parsing':'Укажите корректную дату.', 'date_type':'Укажите корректную дату.',
    }
    if kind in simple:return simple[kind]
    limits={'greater_than':('gt','Введите число больше {}.'),'greater_than_equal':('ge','Введите число не меньше {}.'),'less_than':('lt','Введите число меньше {}.'),'less_than_equal':('le','Введите число не больше {}.'),'decimal_max_places':('decimal_places','Допустимо не больше {} знаков после запятой.'),'decimal_max_digits':('max_digits','Допустимо не больше {} цифр.'),'decimal_whole_digits':('whole_digits','Допустимо не больше {} цифр до запятой.'),'string_too_short':('min_length','Введите не меньше {} символов.'),'string_too_long':('max_length','Допустимо не больше {} символов.'),'too_short':('min_length','Нужно не меньше {} значений.'),'too_long':('max_length','Допустимо не больше {} значений.')}
    if kind in limits:
        key,template=limits[kind];return template.format(str(ctx.get(key,'указанного количества')).replace('.',','))
    if kind=='value_error':return public_message(str(ctx.get('error','')))
    return 'Проверьте значение поля.'


def validation_details(errors):
    return [{'loc':list(error.get('loc',[])),'field':field_name(error.get('loc',[])),'msg':validation_message(error)} for error in errors[:50]]


def exception_message(error,fallback):
    if isinstance(error,ValidationError):
        return '; '.join(item['field']+': '+item['msg'] for item in validation_details(error.errors()))
    if isinstance(error,ValueError):
        message=public_message(str(error))
        if message!=FALLBACKS[422]:return message
    return fallback


def install_error_handlers(app):
    @app.exception_handler(RequestValidationError)
    @app.exception_handler(ValidationError)
    async def validation_error(_request,error):
        return JSONResponse(status_code=422,content={'detail':validation_details(error.errors())})

    @app.exception_handler(HTTPException)
    async def http_error(_request,error):
        detail=public_message(error.detail,error.status_code)
        return JSONResponse(status_code=error.status_code,content={'detail':detail},headers=error.headers)

    @app.exception_handler(Exception)
    async def internal_error(_request,error):
        logging.getLogger(__name__).error('Unhandled application error',exc_info=(type(error),error,error.__traceback__))
        return JSONResponse(status_code=500,content={'detail':FALLBACKS[500]})
