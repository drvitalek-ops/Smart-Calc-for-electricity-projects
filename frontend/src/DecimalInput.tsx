import {useEffect,useRef,useId,type InputHTMLAttributes} from 'react';
function decimalText(value:unknown):string{
 let text=String(value??'').trim();
 if(/^[+-]?\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d+)?$/.test(text))text=text.replace(/[ \u00a0\u202f]/g,'');
 if(text.includes(',')&&!text.includes('.')&&(text.match(/,/g)?.length??0)===1)text=text.replace(',','.');
 return text;
}
export function decimalValue(value:unknown):number|null{
 const text=decimalText(value);
 if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text))return null;
 const number=Number(text);return Number.isFinite(number)?number:null;
}
export function decimalIssue(value:unknown,min:number,max:number,places:number,positive=false):string{
 const number=decimalValue(value);
 if(number===null)return 'Введите число, например 1 или 2,5.';
 if(positive&&number<=0)return 'Введите число больше нуля.';
 if(number<min)return 'Введите число не меньше '+String(min).replace('.',',')+'.';
 if(number>max)return 'Введите число не больше '+String(max).replace('.',',')+'.';
 // Decimal place limits apply to the value, including exponent notation and trailing zeros.
 const [coefficient,exponent='0']=decimalText(value).toLowerCase().split('e');
 const fraction=coefficient.split('.')[1]?.length??0,zeros=coefficient.replace('.','').match(/0+$/)?.[0].length??0;
 if(Math.max(0,fraction-Number(exponent)-zeros)>places)return 'Допустимо не больше '+places+' знаков после запятой.';
 return '';
}
type Props=Omit<InputHTMLAttributes<HTMLInputElement>,'type'|'inputMode'>;
export default function DecimalInput({value,min=0,max=1000000000,step='.01',required=true,onChange,...props}:Props){
 const errorId=useId(),ref=useRef<HTMLInputElement>(null),places=String(step).split('.')[1]?.length??0;
 const issue=!required&&String(value??'').trim()===''?'':decimalIssue(value,Number(min),Number(max),places);
 useEffect(()=>{ref.current?.setCustomValidity(issue);},[issue]);
 return <span className="decimal-field"><input {...props} aria-describedby={[props['aria-describedby'],issue?errorId:''].filter(Boolean).join(' ')||undefined} onChange={event=>{event.currentTarget.setCustomValidity(!required&&event.target.value.trim()===''?'':decimalIssue(event.target.value,Number(min),Number(max),places));onChange?.(event);}} ref={ref} data-decimal-input type="text" inputMode="decimal" value={value} required={required} aria-invalid={Boolean(issue)}/>{issue&&<small className="field-error" id={errorId}>{issue}</small>}</span>;
}
