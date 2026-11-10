import {useEffect,useRef,useState} from 'react';
import type {ClipboardEvent,DragEvent} from 'react';
import './ImageField.css';

export async function prepareImage(file:File,logo=false):Promise<string> {
  if(!file.type.startsWith('image/'))throw Error('Выберите изображение');
  if(file.size>12*1024*1024)throw Error('Изображение больше 12 МБ');
  let bitmap:ImageBitmap;
  try {bitmap=await createImageBitmap(file);}catch{throw Error('Не удалось прочитать изображение. Используйте PNG, JPEG или WebP');}
  try {
    let limit=logo?1000:640;
    for(let attempt=0;attempt<5;attempt++){
      const scale=Math.min(1,limit/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      const context=canvas.getContext('2d');if(!context)throw Error('Не удалось подготовить изображение');
      if(!logo){context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);}
      context.drawImage(bitmap,0,0,canvas.width,canvas.height);
      const result=canvas.toDataURL(logo?'image/png':'image/jpeg',.88);
      if(result.length<=300000)return result;
      limit=Math.floor(limit*.75);
    }
    throw Error('Не удалось уменьшить изображение');
  } finally {bitmap.close();}
}
export function imagePaste(event:ClipboardEvent,done:(file:File)=>void) {
  const file=Array.from(event.clipboardData.files).find(file=>file.type.startsWith('image/'));
  if(!file)return;
  event.preventDefault();event.stopPropagation();done(file);
}
export function imageDrop(event:DragEvent,done:(file:File)=>void){
  if(!event.dataTransfer.types.includes('Files'))return;
  event.preventDefault();event.stopPropagation();
  const file=Array.from(event.dataTransfer.files).find(file=>file.type.startsWith('image/'));
  if(file)done(file);
}
export function imageDragOver(event:DragEvent){if(event.dataTransfer.types.includes('Files')){event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='copy';}}
export default function ImageField({value,onChange,label,disabled=false,logo=false}:{value:string;onChange:(value:string)=>void;label:string;disabled?:boolean;logo?:boolean}) {
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[drag,setDrag]=useState(false);
  const request=useRef(0);
  useEffect(()=>()=>{request.current++;},[]);
  async function receive(file:File) {
    if(disabled)return;
    const current=++request.current;setBusy(true);setError('');
    try {const image=await prepareImage(file,logo);if(current===request.current)onChange(image);}
    catch(e){if(current===request.current)setError(e instanceof Error?e.message:'Ошибка изображения');}
    finally{if(current===request.current)setBusy(false);}
  }
  function over(event:DragEvent){event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect=disabled?'none':'copy';setDrag(true);}
  return <div className={'image-field'+(drag?' image-field-drag':'')} data-image-dropzone tabIndex={disabled?-1:0} aria-label={label+' — вставка и перетаскивание'}
    onPaste={event=>imagePaste(event,file=>void receive(file))} onDragEnter={over} onDragOver={over}
    onDragLeave={event=>{event.stopPropagation();setDrag(false);}} onDrop={event=>{event.preventDefault();event.stopPropagation();setDrag(false);const files=Array.from(event.dataTransfer.files);if(files.length!==1){setError('Перетащите одно изображение');return;}void receive(files[0]);}}>
    {value&&<img className="quotation-product-image" src={value} alt={logo?'Логотип':'Фотография товара'}/>}
    <label className="quote-file">{busy?'Подготовка…':value?'Заменить фото':'Добавить фото'}<input type="file" accept="image/*" aria-label={label} disabled={disabled||busy} onChange={event=>{const file=event.target.files?.[0];if(file)void receive(file);event.target.value='';}}/></label>
    <small>Файл · Ctrl+V · перетащите фото</small>
    {value&&<button type="button" disabled={disabled||busy} onClick={()=>onChange('')}>Убрать фото</button>}
    {error&&<span role="alert">{error}</span>}
  </div>;
}
