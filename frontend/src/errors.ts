import fields from '../../backend/app/assets/error-fields.json';
const labels:Record<string,string>=fields;
const technical=/Input should|validation error|Value error,|Traceback|JSONDecodeError|IntegrityError|OperationalError|File is not a zip|Expecting value|Error code:|\b(?:[A-Za-z]+Error|invalid|failed|unexpected|cannot|denied|should)\b/i;
const fallbackFor=(status:number)=>({400:'Проверьте введённые данные.',401:'Необходим вход в приложение.',403:'Нет доступа к этому действию.',404:'Запрошенный объект не найден.',405:'Это действие недоступно.',409:'Данные изменились. Обновите их и повторите действие.',413:'Файл или запрос слишком большой.',422:'Проверьте заполнение полей.',429:'Слишком много запросов. Повторите действие немного позже.',502:'Локальный сервер недоступен. Повторите действие.',503:'Приложение временно недоступно. Повторите действие.',504:'Превышено время ожидания ответа. Повторите действие.'} as Record<number,string>)[status]??'Не удалось выполнить действие. Повторите попытку.';
export function errorMessage(error:unknown,fallback='Не удалось выполнить действие. Повторите попытку.'):string{
 const message=error instanceof Error?error.message:typeof error==='string'?error:'';
 if(/[а-яё]/i.test(message)&&/^(?:[а-яё0-9«]|PDF\b|CSV\b|IP\b|ZIP\b|PNG\b|JPEG\b|Excel\b|Word\b|LED\b)/i.test(message.trim())&&!technical.test(message))return message;
 if(/fetch|network|load failed|connection/i.test(message))return 'Не удалось связаться с приложением. Проверьте, что оно запущено, и повторите действие.';
 return fallback==='Ошибка'?'Не удалось выполнить действие. Повторите попытку.':fallback;
}
function fieldName(location:unknown):string{
 if(!Array.isArray(location))return 'Данные';
 const parts=location.filter(part=>!['body','query','path','response'].includes(part)),result:string[]=[];
 for(let i=0;i<parts.length;i++){
  const part=parts[i];if((part==='lines'||part==='benefits')&&typeof parts[i+1]==='number'){result.push((part==='lines'?'Строка КП № ':'Преимущество № ')+(parts[++i]+1));continue;}
  result.push(typeof part==='number'?'№ '+(part+1):labels[String(part)]??'Поле');
 }
 return result.join(' — ')||'Данные';
}
export function responseError(data:unknown,status:number):string{
 const detail=data&&typeof data==='object'&&'detail' in data?(data as {detail:unknown}).detail:null;
 if(typeof detail==='string')return errorMessage(detail,fallbackFor(status));
 if(Array.isArray(detail))return detail.slice(0,50).map(item=>{
  const row=item&&typeof item==='object'?item:{};
  const field=typeof row.field==='string'?errorMessage(row.field,fieldName(row.loc)):fieldName(row.loc);
  const legacy:Record<string,string>={decimal_parsing:'Введите число, например 1 или 2,5.',decimal_type:'Введите число, например 1 или 2,5.',missing:'Заполните обязательное поле.',float_parsing:'Введите число.',int_parsing:'Введите целое число.',finite_number:'Введите конечное число.'};
  return field+': '+errorMessage(row.msg,legacy[row.type]??'Проверьте значение поля.');
 }).join('; ')||fallbackFor(status);
 return fallbackFor(status);
}
export async function apiFetch(url:string,init:RequestInit={}):Promise<Response>{
 let response:Response;
 try{response=await fetch(url,init);}catch(error){if(init.signal?.aborted)throw error;throw Error(errorMessage(error,'Не удалось связаться с приложением. Повторите действие.'));}
 if(!response.ok){let data:unknown;try{data=await response.json();}catch{}throw Error(responseError(data,response.status));}
 return response;
}
export async function api<T>(path:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T>{
 const form=body instanceof FormData,response=await apiFetch('/api'+path,{method,headers:form?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:form?body:JSON.stringify(body),signal});
 if(response.status===204)return undefined as T;
 try{return await response.json();}catch{throw Error('Не удалось прочитать ответ приложения. Повторите действие.');}
}
/** Native browser validation is otherwise displayed in the operating system language. */
export function installRussianValidation(document:Document){
 const clearForm=(form:HTMLFormElement|null)=>form?.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('input:not([data-decimal-input]),select,textarea').forEach(input=>input.setCustomValidity(''));
 // Search pickers and editor resets may set controlled values without an input event.
 // Clear translated native messages before the browser checks the next submission.
 document.addEventListener('click',event=>{const target=event.target,button=target instanceof Element?target.closest('button,input'):null;if((button instanceof HTMLButtonElement||button instanceof HTMLInputElement)&&button.type==='submit')clearForm(button.form);},true);
 document.addEventListener('keydown',event=>{const input=event.target;if(event.key==='Enter'&&(input instanceof HTMLInputElement||input instanceof HTMLSelectElement))clearForm(input.form);},true);
 document.addEventListener('change',event=>{const input=event.target;if(input instanceof HTMLSelectElement)input.setCustomValidity('');},true);
 document.addEventListener('invalid',event=>{
  const input=event.target;if(!(input instanceof HTMLInputElement||input instanceof HTMLSelectElement||input instanceof HTMLTextAreaElement))return;
  const v=input.validity;
  if(v.customError)return;
  let message='Проверьте значение поля.';
  if(v.valueMissing)message='Заполните обязательное поле.';
  else if(v.typeMismatch)message=input instanceof HTMLInputElement&&input.type==='email'?'Укажите корректный адрес электронной почты.':'Проверьте формат значения.';
  else if(v.rangeUnderflow)message='Введите число не меньше '+(input as HTMLInputElement).min+'.';
  else if(v.rangeOverflow)message='Введите число не больше '+(input as HTMLInputElement).max+'.';
  else if(v.stepMismatch||v.badInput)message='Введите допустимое число.';
  else if(v.tooLong)message='Сократите значение поля.';
  input.setCustomValidity(message);
 },true);
 document.addEventListener('input',event=>{const input=event.target;if(input instanceof HTMLInputElement||input instanceof HTMLSelectElement||input instanceof HTMLTextAreaElement)input.setCustomValidity('');},true);
}
