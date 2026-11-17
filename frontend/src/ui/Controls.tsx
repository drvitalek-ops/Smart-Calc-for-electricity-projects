import {useId,type ButtonHTMLAttributes,type ReactNode} from 'react';
import './Controls.css';

type ButtonProps=ButtonHTMLAttributes<HTMLButtonElement>&{
  variant?:'secondary'|'primary'|'quiet'|'danger';
  size?:'regular'|'compact';
};
/** Native button semantics and existing layout classes remain available. */
export function Button({variant='secondary',size='regular',className='',type,children,...props}:ButtonProps){
  return <button {...props} type={type} className={'ui-button '+className} data-variant={variant} data-size={size}>{children}</button>;
}
export function StatusBadge({tone='info',children}:{tone?:'info'|'success'|'warning'|'error';children:ReactNode}){
  return <span className="ui-status" data-tone={tone}><span className="ui-status-mark" aria-hidden="true"/>{children}</span>;
}
/** Use a render prop so the label, error and native control share stable IDs. */
export function Field({label,hint,error,children}:{label:string;hint?:string;error?:string;children:(props:{id:string;'aria-describedby'?:string;'aria-invalid':boolean})=>ReactNode}){
  const id=useId(),description=[hint?id+'-hint':'',error?id+'-error':''].filter(Boolean).join(' ')||undefined;
  return <div className="ui-field"><label htmlFor={id}>{label}</label>{children({id,'aria-describedby':description,'aria-invalid':Boolean(error)})}{hint&&<small id={id+'-hint'}>{hint}</small>}{error&&<small id={id+'-error'} className="ui-field-error">{error}</small>}</div>;
}
