import { useEffect, useRef, useState } from "react";
import "./QuotationEditor.css";

export type QuotationKind = { id:number; name:string; category:string; unit:string; active:boolean };
type Product = { id:number; type_id:number; name:string; sku:string; unit:string; price:number; currency:string; active:boolean; manufacturer:string };
type Catalogue = { products:Product[]; manufacturers:{id:number;name:string}[] };
type Line = {
  id:string; source_key:string; source_ids:number[]; type_id:number|null; product_id:number|null;
  name:string; sku:string; manufacturer:string; room:string; description:string; quantity:string;
  unit:"шт"|"м"; unit_price:string; currency:string; discount:string|null; image:string;
};
type Prices = {lines:(Line & {total:string;base_total:string;discount_amount:string;effective_discount:string})[];
  totals:Record<string,{base:string;discount:string;total:string}>};
type Quote = {
  revision:number; number:string; date:string; title:string; seller:string; customer:string;
  contact:string; terms:string; global_discount:string; lines:Line[];
  city:string;phone:string;email:string;website:string;address:string;slogan:string;valid_days:number;
  tax_note:string;logo:string;benefits:{title:string;text:string}[];
  client:Prices;partner:Prices;
};
type Props = {
  projectName:string; types:QuotationKind[]; onChanged:()=>Promise<void>; onBrowse?:()=>void;
  onDirtyChange:(dirty:boolean)=>void; onBusyChange:(busy:boolean)=>void;
} & ({projectId:number;quotationId?:never;onAttached?:never} | {quotationId:number;projectId?:never;onAttached:(projectId:number)=>Promise<void>});
type AttachmentProject={id:number;name:string;quote_revision:number};

async function api<T>(path:string,method="GET",body?:unknown,signal?:AbortSignal):Promise<T> {
  const response=await fetch("/api"+path,{method,headers:{"Content-Type":"application/json"},
    body:body===undefined ? undefined : JSON.stringify(body),signal});
  if(!response.ok) {
    const result=await response.json();
    const detail=result.detail;
    throw new Error(typeof detail==="string" ? detail : Array.isArray(detail) ? detail.map((item:{msg:string;loc:unknown[]})=>item.loc.slice(1).join(".")+": "+item.msg).join("; ") : "Ошибка запроса");
  }
  return response.json();
}
const cash=(value:string|number)=>Number(value).toLocaleString("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:2});
const amount=(value:string|number,code:string)=>cash(value)+" "+(({RUB:"₽",USD:"$",EUR:"€"} as Record<string,string>)[code] ?? code);
const newLine=():Line=>({id:crypto.randomUUID(),source_key:"",source_ids:[],type_id:null,product_id:null,
  name:"Новая позиция",sku:"",manufacturer:"",room:"",description:"",quantity:"1",unit:"шт",unit_price:"0",currency:"RUB",discount:null,image:""});

async function picture(file:File,logo=false):Promise<string> {
  if(!["image/png","image/jpeg"].includes(file.type))throw Error("Выберите изображение PNG или JPEG");
  if(file.size>8*1024*1024)throw Error("Изображение больше 8 МБ");
  const bitmap=await createImageBitmap(file);
  const scale=Math.min(1,240/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement("canvas");
  canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const context=canvas.getContext("2d");if(!context)throw Error("Не удалось подготовить изображение");
  if(!logo){context.fillStyle="white";context.fillRect(0,0,canvas.width,canvas.height);}
  context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  const value=canvas.toDataURL(logo ? "image/png" : "image/jpeg",.85);
  if(value.length>300000)throw Error("Слишком большое изображение. Выберите меньший файл.");
  return value;
}

export default function QuotationEditor({projectId,quotationId,projectName,types,onChanged,onDirtyChange,onBusyChange,onBrowse,onAttached}:Props) {
  const [doc,setDoc]=useState<Quote|null>(null),[prices,setPrices]=useState<Quote|null>(null);
  const [catalogue,setCatalogue]=useState<Catalogue>({products:[],manufacturers:[]});
  const [busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[calculating,setCalculating]=useState(false);
  const [error,setError]=useState(""),[message,setMessage]=useState(""),[mode,setMode]=useState<"client"|"partner">("partner");
  const [preview,setPreview]=useState(false);
  const [attachOpen,setAttachOpen]=useState(false),[attachProjects,setAttachProjects]=useState<AttachmentProject[]>([]),[attachTarget,setAttachTarget]=useState("");
  const [imported,setImported]=useState<{filename:string;lines:Line[];warnings:string[]}|null>(null);
  const [importMode,setImportMode]=useState<"append"|"replace">("append");
  const importInput=useRef<HTMLInputElement>(null);
  const [newProduct,setNewProduct]=useState<{lineId:string;name:string;manufacturer:string;sku:string;typeId:string;price:string;currency:string;image:string}|null>(null);
  const docRef=useRef<Quote|null>(doc);docRef.current=doc;
  const history=useRef<Quote[]>([]),future=useRef<Quote[]>([]),lastChange=useRef(0);
  const standalone=quotationId!==undefined;
  const base=standalone ? "/quotations/"+quotationId : "/projects/"+projectId+"/quotation";
  function apply(value:Quote) {setDoc(value);setPrices(value);setDirty(false);history.current=[];future.current=[];lastChange.current=0;}
  async function work(action:()=>Promise<void>) {
    setBusy(true);setError("");setMessage("");
    try {await action();} catch(error) {setError(error instanceof Error ? error.message : "Ошибка");}
    finally {setBusy(false);}
  }
  async function load() {
    const [value,products]=await Promise.all([api<Quote>(base),api<Catalogue>("/catalog")]);
    apply(value);setCatalogue(products);
  }
  useEffect(()=>{void work(load);},[base]);
  useEffect(()=>{onDirtyChange(dirty);},[dirty,onDirtyChange]);
  useEffect(()=>{onBusyChange(busy);},[busy,onBusyChange]);
  useEffect(()=>()=>{onDirtyChange(false);onBusyChange(false);},[onDirtyChange,onBusyChange]);
  useEffect(()=>{
    const unload=(event:BeforeUnloadEvent)=>{if(dirty){event.preventDefault();event.returnValue="";}};
    window.addEventListener("beforeunload",unload);return()=>window.removeEventListener("beforeunload",unload);
  },[dirty]);
  useEffect(()=>{
    if(!doc || !dirty)return;
    const cancellation=new AbortController();
    setCalculating(true);
    const timer=window.setTimeout(()=>{
      api<Quote>(base+"/preview","POST",doc,cancellation.signal)
        .then(value=>{if(!cancellation.signal.aborted){setPrices(value);setCalculating(false);setError("");}})
        .catch(error=>{if(!cancellation.signal.aborted){setError(error instanceof Error ? error.message : "Ошибка расчёта");setCalculating(false);}});
    },350);
    return()=>{window.clearTimeout(timer);cancellation.abort();};
  },[doc,dirty,base]);
  function change(update:(current:Quote)=>Quote,separate=false) {
    const current=docRef.current;
    if(!current || busy)return;
    const now=Date.now();
    if(separate || now-lastChange.current>600){history.current.push(current);if(history.current.length>30)history.current.shift();}
    lastChange.current=now;future.current=[];const next=update(current);docRef.current=next;setDoc(next);setDirty(true);setMessage("");
  }
  function editLine(id:string,patch:Partial<Line>) {
    change(current=>({...current,lines:current.lines.map(line=>line.id===id ? {...line,...patch} : line)}));
  }
  function undo(redo=false) {
    if(!doc || busy)return;
    const source=redo ? future.current : history.current,destination=redo ? history.current : future.current;
    const item=source.pop();if(!item)return;destination.push(doc);setDoc(item);setDirty(true);lastChange.current=0;
  }
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      if(newProduct || imported || attachOpen || (event.target as HTMLElement|null)?.closest('[role="dialog"]') || (event.target as HTMLElement|null)?.matches("input,textarea,select,[contenteditable=true]"))return;
      if((event.ctrlKey||event.metaKey)&&["z","я","y","н"].includes(event.key.toLowerCase())){
        event.preventDefault();undo(event.shiftKey||["y","н"].includes(event.key.toLowerCase()));
      }
    };
    window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key);
  },[doc,busy,newProduct,imported,attachOpen]);
  async function saveCurrent():Promise<Quote> {
    if(!doc)throw Error("КП ещё не загружено");
    if(!dirty)return doc;
    const saved=await api<Quote>(base,"PUT",doc);apply(saved);return saved;
  }
  async function bind(lineId:string,productId:string) {
    await work(async()=>{
      const saved=await saveCurrent();
      const value=await api<Quote>(base+"/bind","POST",{revision:saved.revision,line_id:lineId,product_id:productId ? Number(productId) : null});
      apply(value);await onChanged();setMessage(standalone ? "Товар привязан к строке КП." : "Товар привязан. Позиции плана обновлены.");
    });
  }
  async function download(target:"client"|"partner") {
    await work(async()=>{
      const saved=await saveCurrent();
      if(!saved.lines.length)throw Error("Добавьте позиции в КП");
      const response=await fetch("/api"+base+"/export.pdf?mode="+target);
      if(!response.ok){const result=await response.json();throw Error(result.detail ?? "Не удалось сформировать PDF");}
      const url=URL.createObjectURL(await response.blob()),link=document.createElement("a");
      link.href=url;link.download="КП-"+saved.number.replace(/[^a-zа-яё0-9_-]/gi,"-")+"-"+target+".pdf";
      link.click();window.setTimeout(()=>URL.revokeObjectURL(url),30000);
      setMessage(target==="client" ? "Клиентский PDF сформирован без скидок." : "Партнёрский PDF сформирован со скидками.");
    });
  }
  async function importFile(file:File|undefined) {
    if(!file)return;
    await work(async()=>{
      const form=new FormData();form.append("file",file);
      const response=await fetch("/api"+base+"/import-file",{method:"POST",body:form});
      const value=await response.json();
      if(!response.ok)throw Error(typeof value.detail==="string" ? value.detail : "Не удалось прочитать КП");
      setImported(value);setImportMode("append");
    });
  }
  async function upload(file:File|undefined,done:(value:string)=>void,logo=false) {
    if(!file)return;
    try {done(await picture(file,logo));}catch(error){setError(error instanceof Error ? error.message : "Ошибка изображения");}
  }
  if(!doc)return <section className="quotation-editor"><h2>Редактор КП</h2>{busy ? <p role="status">Загрузка КП…</p> : <><p role="alert">{error}</p><button onClick={()=>void work(load)}>Повторить загрузку КП</button></>}</section>;
  const calculated=prices ?? doc;
  const visiblePrices=calculated[mode];
  const rowPrices=new Map(visiblePrices.lines.map(line=>[line.id,line]));
  const unpriced=doc.lines.filter(line=>Number(line.unit_price)===0).length;
  const validProducts=(line:Line)=>catalogue.products.filter(product=>
    (product.active || product.id===line.product_id) && product.unit===line.unit && (!line.source_ids.length || line.type_id===null || product.type_id===line.type_id));
  return <section className="quotation-editor" aria-label="Редактор коммерческого предложения">
    <div className="quotation-heading"><div><div className="eyebrow">КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ</div><h2>{projectName}</h2><p>{standalone ? "Товары → готовое КП → привязка к проекту" : "Расчёт → товары → готовое КП"}</p></div>
      <div className="quotation-actions">
        {onBrowse && <button disabled={busy} onClick={onBrowse}>К списку КП</button>}
        {standalone && <button disabled={busy} className="quote-primary" onClick={()=>void work(async()=>{setAttachProjects(await api<AttachmentProject[]>("/quotations/project-options"));setAttachTarget("");setAttachOpen(true);})}>Прикрепить к проекту</button>}
        <button disabled={busy || !dirty} onClick={()=>void work(async()=>{await saveCurrent();setMessage("КП сохранено");})}>Сохранить КП</button>
        <button disabled={busy} onClick={()=>void work(async()=>{
          if(dirty && !confirm("Отменить несохранённые правки и загрузить сохранённое КП?"))return;
          await load();
        })}>Загрузить сохранённое КП</button>
        <button disabled={busy} onClick={()=>importInput.current?.click()}>Импорт из PDF / Excel / Word</button>
        <input ref={importInput} hidden type="file" aria-label="Файл внешнего КП" accept=".pdf,.xlsx,.xls,.xlsm,.docx,.csv" disabled={busy} onChange={e=>{void importFile(e.target.files?.[0]);e.target.value="";}}/>
        <button disabled={busy || standalone} title={standalone ? "Сначала прикрепите КП к проекту" : undefined} onClick={()=>void work(async()=>{
          if(doc.lines.length && !confirm("Обновить позиции из расчёта? Количество обновится, удалённые на плане позиции уйдут из КП. Ручные строки и скидки сохранятся."))return;
          const saved=await saveCurrent();apply(await api<Quote>(base+"/import","POST",{revision:saved.revision}));setMessage("Позиции обновлены из расчёта");
        })}>Обновить из расчёта</button>
        <button disabled={busy || !doc.lines.length} onClick={()=>void download("client")}>PDF для клиента — без скидок</button>
        <button className="quote-primary" disabled={busy || !doc.lines.length} onClick={()=>void download("partner")}>PDF для партнёра — со скидками</button>
      </div>
    </div>
    {!newProduct && !imported && !attachOpen && error && <p className="catalog-error" role="alert">{error}</p>}
    {message && <p className="catalog-success" role="status">{message}</p>}
    <div className="quotation-status" role="status">{busy ? "Сохранение…" : dirty ? "Есть несохранённые изменения" : "КП сохранено"}{calculating ? " · Пересчёт итогов…" : ""}</div>
    <div className="quotation-totals">
      {(["client","partner"] as const).map(target=><article key={target}><small>{target==="client" ? "Для клиента · без скидок" : "Для партнёра · со скидками"}</small>
        {Object.entries(calculated[target].totals).map(([code,total])=><strong key={code}>{amount(total.total,code)}</strong>)}
        {!Object.keys(calculated[target].totals).length && <strong>0,00 ₽</strong>}
        {target==="partner" && Object.entries(calculated.partner.totals).map(([code,total])=><span key={code}>Скидка: {amount(total.discount,code)}</span>)}
      </article>)}
    </div>
    <div className="quotation-switch"><button className={!preview ? "active" : ""} onClick={()=>setPreview(false)}>Редактировать</button><button className={preview ? "active" : ""} onClick={()=>setPreview(true)}>Предпросмотр</button>
      <label>Цены<select aria-label="Цены предпросмотра КП" value={mode} onChange={event=>setMode(event.target.value as "client"|"partner")}><option value="partner">Партнёр — со скидками</option><option value="client">Клиент — без скидок</option></select></label>
    </div>
    {!preview ? <>
      <fieldset disabled={busy} className="quotation-fields">
        <label>Номер КП<input aria-label="Номер КП" maxLength={100} value={doc.number} onChange={e=>change(q=>({...q,number:e.target.value}))}/></label>
        <label>Дата<input aria-label="Дата КП" type="date" value={doc.date} onChange={e=>change(q=>({...q,date:e.target.value}))}/></label>
        <label>Срок действия, дней<input aria-label="Срок действия КП" type="number" min="1" max="365" value={doc.valid_days} onChange={e=>change(q=>({...q,valid_days:Number(e.target.value)}))}/></label>
        <label>Общая скидка, %<input aria-label="Общая скидка КП" type="number" min="0" max="100" step=".01" value={doc.global_discount} onChange={e=>change(q=>({...q,global_discount:e.target.value}))}/></label>
        <label>Кому<input aria-label="Клиент КП" value={doc.customer} onChange={e=>change(q=>({...q,customer:e.target.value}))}/></label>
        <label>Контакт клиента<input aria-label="Контакт клиента КП" value={doc.contact} onChange={e=>change(q=>({...q,contact:e.target.value}))}/></label>
      </fieldset>
      <p className="hint">Пустая скидка строки использует общую. Индивидуальная скидка, включая 0%, заменяет общую. В клиентском PDF все скидки отключены.</p>
      {unpriced>0 && <p className="warning">Позиций без цены: {unpriced}. Выберите товар или укажите цену перед отправкой КП.</p>}
      <div className="quotation-line-actions"><button disabled={busy} onClick={()=>change(q=>({...q,lines:[...q.lines,newLine()]}),true)}>＋ Добавить строку КП</button>
        <button disabled={busy || !history.current.length} onClick={()=>undo()}>Отменить правку КП</button><button disabled={busy || !future.current.length} onClick={()=>undo(true)}>Вернуть правку КП</button></div>
      <div className="quotation-table-wrap"><table className="quotation-table"><thead><tr><th>Позиция / товар</th><th>Кол-во</th><th>Ед.</th><th>Цена</th><th>Валюта</th><th>Скидка, %</th><th>Сумма</th><th></th></tr></thead>
        <tbody>{doc.lines.map((line,index)=><tr key={line.id} data-quote-line={line.id}>
          <td><div className="quotation-line-name">{line.image && <img src={line.image} alt=""/>}<div><input aria-label={"Наименование строки "+(index+1)} value={line.name} disabled={busy} onChange={e=>editLine(line.id,{name:e.target.value})}/><small>{line.room}{line.source_ids.length ? " · На плане: "+line.source_ids.length : line.source_key.startsWith("frame:") ? " · Рамка по расчёту" : " · Ручная строка"}</small></div></div>
            <select aria-label={"Товар строки "+(index+1)} value={line.product_id ?? ""} disabled={busy} onChange={e=>void bind(line.id,e.target.value)}><option value="">Без привязки к товару</option>{validProducts(line).map(product=><option key={product.id} value={product.id} disabled={!product.active && product.id!==line.product_id}>{product.manufacturer} · {product.name}{product.sku ? " · "+product.sku : ""}</option>)}</select>
            <div className="quotation-inline-actions"><button type="button" disabled={busy} onClick={()=>{setError("");setNewProduct({lineId:line.id,name:line.name,manufacturer:line.manufacturer,sku:line.sku,typeId:line.type_id ? String(line.type_id) : "",price:line.unit_price,currency:line.currency,image:line.image});}}>＋ Товар в базу</button>
              <label className="quote-file">Фото<input type="file" accept="image/png,image/jpeg" disabled={busy} aria-label={"Фото строки "+(index+1)} onChange={e=>{void upload(e.target.files?.[0],image=>editLine(line.id,{image}));e.target.value="";}}/></label>
              {line.image && <button disabled={busy} onClick={()=>editLine(line.id,{image:""})}>Убрать фото</button>}
            </div>
            <details><summary>Описание и артикул</summary><input aria-label={"Артикул строки "+(index+1)} placeholder="Артикул" value={line.sku} disabled={busy} onChange={e=>editLine(line.id,{sku:e.target.value})}/><textarea aria-label={"Описание строки "+(index+1)} value={line.description} disabled={busy} onChange={e=>editLine(line.id,{description:e.target.value})}/></details>
          </td>
          <td><input aria-label={"Количество строки "+(index+1)} type="number" min=".001" max="1000000" step=".001" value={line.quantity} disabled={busy || Boolean(line.source_key)} onChange={e=>editLine(line.id,{quantity:e.target.value})}/>{line.source_key && <small>Из расчёта</small>}</td>
          <td><select aria-label={"Единица строки "+(index+1)} value={line.unit} disabled={busy || Boolean(line.source_key) || Boolean(line.product_id)} onChange={e=>editLine(line.id,{unit:e.target.value as "шт"|"м"})}><option value="шт">шт</option><option value="м">м</option></select></td>
          <td><input aria-label={"Цена строки "+(index+1)} type="number" min="0" max="1000000000" step=".01" value={line.unit_price} disabled={busy} onChange={e=>editLine(line.id,{unit_price:e.target.value})}/></td>
          <td><input aria-label={"Валюта строки "+(index+1)} maxLength={3} value={line.currency} disabled={busy} onChange={e=>editLine(line.id,{currency:e.target.value.toUpperCase()})}/></td>
          <td><input aria-label={"Скидка строки "+(index+1)} type="number" min="0" max="100" step=".01" placeholder="Общая" value={line.discount ?? ""} disabled={busy} onChange={e=>editLine(line.id,{discount:e.target.value==="" ? null : e.target.value})}/><small>{line.discount===null ? "По общей" : "Индивидуальная"}</small></td>
          <td className="quotation-row-total">{calculating ? "…" : rowPrices.has(line.id) ? amount(rowPrices.get(line.id)!.total,line.currency) : "—"}</td>
          <td><button aria-label={"Удалить строку "+(index+1)+" из КП"} title="Убрать только из КП" disabled={busy} onClick={()=>change(q=>({...q,lines:q.lines.filter(item=>item.id!==line.id)}),true)}>×</button></td>
        </tr>)}</tbody></table></div>
      {!doc.lines.length && <p className="hint">Пока нет позиций. Добавьте строку вручную или импортируйте расчёт проекта.</p>}
      <fieldset disabled={busy} className="quotation-notes"><label>Условия предложения<textarea aria-label="Условия КП" rows={4} value={doc.terms} onChange={e=>change(q=>({...q,terms:e.target.value}))}/></label></fieldset>
      <details className="quotation-brand"><summary>Оформление и реквизиты</summary><fieldset disabled={busy} className="quotation-fields">
        {([["title","Заголовок КП"],["seller","Компания"],["city","Город"],["phone","Телефон"],["email","E-mail"],["website","Сайт"],["address","Адрес"],["slogan","Слоган"],["tax_note","Примечание о НДС"]] as const).map(([key,label])=><label key={key}>{label}<input aria-label={label+" КП"} value={doc[key]} onChange={e=>change(q=>({...q,[key]:e.target.value}))}/></label>)}
        <label className="quote-file">Логотип PNG/JPEG<input aria-label="Логотип КП" type="file" accept="image/png,image/jpeg" onChange={e=>{void upload(e.target.files?.[0],logo=>change(q=>({...q,logo})),true);e.target.value="";}}/></label>
        {doc.logo && <div><img className="quotation-logo" src={doc.logo} alt="Логотип"/><button onClick={()=>change(q=>({...q,logo:""}))}>Убрать логотип</button></div>}
        {doc.benefits.map((benefit,index)=><label key={index}>Преимущество {index+1}<input aria-label={"Заголовок преимущества "+(index+1)} value={benefit.title} onChange={e=>change(q=>({...q,benefits:q.benefits.map((item,i)=>i===index ? {...item,title:e.target.value} : item)}))}/><input aria-label={"Текст преимущества "+(index+1)} value={benefit.text} onChange={e=>change(q=>({...q,benefits:q.benefits.map((item,i)=>i===index ? {...item,text:e.target.value} : item)}))}/></label>)}
        <button onClick={()=>change(q=>({...q,benefits:[]}))}>Убрать блок преимуществ</button>
      </fieldset><p className="hint">Примечание о НДС и гарантийные условия укажите в соответствии с вашими ценами и товарами.</p></details>
    </> : <div className="quotation-paper" aria-label="Предпросмотр коммерческого предложения">
      <div className="quotation-paper-masthead"><div>{doc.logo ? <img src={doc.logo} alt="Логотип"/> : <strong>{doc.seller}</strong>}<span>{doc.slogan}</span></div><address>{doc.city}<b>{doc.phone}</b>{doc.website}<b>{doc.email}</b></address></div>
      <div className="quotation-paper-body"><div className="quotation-paper-meta"><h2>{doc.title}<br/>№ КП {doc.number}</h2><dl><div><dt>ДАТА</dt><dd>{doc.date.split("-").reverse().join(".")}</dd></div><div><dt>СРОК ДЕЙСТВИЯ</dt><dd>{doc.valid_days} дней</dd></div><div><dt>ПОЗИЦИЙ</dt><dd>{doc.lines.length} шт</dd></div></dl></div>
        <small>КОМУ</small><h3>{doc.customer}</h3><p>{doc.contact}</p>
        <div className="quotation-paper-total"><span>ИТОГО ПО КП</span><div>{Object.entries(visiblePrices.totals).map(([code,total])=><strong key={code}>{amount(total.total,code)}</strong>)}<small>{doc.tax_note}</small></div></div>
        {doc.benefits.length>0 && <div className="quotation-paper-benefits">{doc.benefits.map((item,i)=><div key={i}><i>✓</i><span><b>{item.title}</b><small>{item.text}</small></span></div>)}</div>}
        <table><thead><tr><th>№</th><th>Наименование</th><th>Цена</th><th>Кол-во</th><th>Ед.</th>{mode==="partner" && <th>Скидка</th>}<th>Сумма</th></tr></thead><tbody>{doc.lines.map((line,i)=><tr key={line.id}><td>{i+1}</td><td><div className="quotation-preview-product">{line.image && <img src={line.image} alt=""/>}<div>{line.name}<small>{line.sku} {line.manufacturer}</small></div></div></td><td>{amount(line.unit_price,line.currency)}</td><td>{line.quantity}</td><td>{line.unit}</td>{mode==="partner" && <td>{rowPrices.get(line.id)?.effective_discount ?? "0"}%</td>}<td className="quotation-preview-amount">{rowPrices.has(line.id) ? amount(rowPrices.get(line.id)!.total,line.currency) : "—"}</td></tr>)}</tbody></table>
        {doc.terms && <p className="quotation-paper-terms">{doc.terms}</p>}<footer><strong>{doc.seller}</strong><p>{doc.address}</p><p>{doc.phone} · {doc.email} · {doc.website}</p></footer>
      </div>
    </div>}
    {newProduct && <QuoteDialog title="Новый товар из КП" busy={busy} onClose={()=>{setNewProduct(null);setError("");}}>
      <h2>Новый товар в базу</h2><p>{standalone ? "Товар сохранится в общем каталоге и строке КП." : "Товар сохранится в общем каталоге и будет привязан к этой строке и её объектам на плане."}</p>
      <form onSubmit={event=>{event.preventDefault();void work(async()=>{
        const saved=await saveCurrent();
        const value=await api<Quote>(base+"/product","POST",{revision:saved.revision,line_id:newProduct.lineId,type_id:newProduct.typeId ? Number(newProduct.typeId) : null,
          name:newProduct.name,manufacturer:newProduct.manufacturer,sku:newProduct.sku,unit_price:newProduct.price,currency:newProduct.currency,image:newProduct.image});
        apply(value);setNewProduct(null);setCatalogue(await api<Catalogue>("/catalog"));await onChanged();setMessage("Товар создан в каталоге и привязан к позиции");
      });}}>
        <fieldset disabled={busy}>
          <label>Название<input autoFocus aria-label="Название нового товара КП" required maxLength={500} value={newProduct.name} onChange={e=>setNewProduct({...newProduct,name:e.target.value})}/></label>
          <label>Номенклатура<select aria-label="Номенклатура нового товара КП" required={!doc.lines.find(line=>line.id===newProduct.lineId)?.source_key.startsWith("frame:")} value={newProduct.typeId} onChange={e=>setNewProduct({...newProduct,typeId:e.target.value})}><option value="">{doc.lines.find(line=>line.id===newProduct.lineId)?.source_key.startsWith("frame:") ? "Рамка по расчёту" : "Выберите номенклатуру"}</option>{types.filter(type=>type.active && type.unit===doc.lines.find(line=>line.id===newProduct.lineId)?.unit && (!doc.lines.find(line=>line.id===newProduct.lineId)?.source_ids.length || type.id===doc.lines.find(line=>line.id===newProduct.lineId)?.type_id)).map(type=><option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
          <label>Производитель<input aria-label="Производитель нового товара КП" required list="quote-manufacturers" value={newProduct.manufacturer} onChange={e=>setNewProduct({...newProduct,manufacturer:e.target.value})}/></label><datalist id="quote-manufacturers">{catalogue.manufacturers.map(m=><option key={m.id} value={m.name}/>)}</datalist>
          <label>Артикул<input aria-label="Артикул нового товара КП" value={newProduct.sku} onChange={e=>setNewProduct({...newProduct,sku:e.target.value})}/></label>
          <label>Цена<input aria-label="Цена нового товара КП" required type="number" min="0" max="1000000000" step=".01" value={newProduct.price} onChange={e=>setNewProduct({...newProduct,price:e.target.value})}/></label>
          <label>Валюта<input aria-label="Валюта нового товара КП" required pattern="[A-Z]{3}" maxLength={3} value={newProduct.currency} onChange={e=>setNewProduct({...newProduct,currency:e.target.value.toUpperCase()})}/></label>
          <label className="quote-file">Фотография товара<input aria-label="Фото нового товара КП" type="file" accept="image/png,image/jpeg" onChange={e=>{void upload(e.target.files?.[0],image=>setNewProduct(current=>current ? {...current,image} : null));e.target.value="";}}/></label>{newProduct.image && <img className="quotation-product-image" src={newProduct.image} alt="Товар"/>}
        </fieldset>
        {error && <p role="alert" className="catalog-error">{error}</p>}
        <div className="modal-actions"><button type="button" disabled={busy} onClick={()=>{setNewProduct(null);setError("");}}>Отмена</button><button className="quote-primary" disabled={busy}>Создать и привязать товар</button></div>
      </form>
    </QuoteDialog>}
    {attachOpen && <QuoteDialog title="Прикрепить КП к проекту" busy={busy} onClose={()=>{setAttachOpen(false);setError("");}}>
      <h2>Прикрепить КП к проекту</h2>
      <p>КП целиком перейдёт в выбранный проект: позиции, цены, скидки, реквизиты и фотографии сохранятся.</p>
      <label>Проект<select aria-label="Проект для КП" disabled={busy} value={attachTarget} onChange={e=>setAttachTarget(e.target.value)}><option value="">Выберите проект</option>{attachProjects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      {attachProjects.length===0 && <p className="hint">Сначала создайте проект, затем вернитесь к этому КП и прикрепите его.</p>}
      {attachProjects.find(project=>project.id===Number(attachTarget))?.quote_revision ? <p className="hint">Текущее КП проекта будет сохранено отдельно в списке «КП без проекта».</p> : null}
      <button disabled={busy} onClick={()=>void work(async()=>setAttachProjects(await api<AttachmentProject[]>("/quotations/project-options")))}>Обновить список проектов</button>
      {error && <p className="catalog-error" role="alert">{error}</p>}
      <div className="modal-actions"><button disabled={busy} onClick={()=>setAttachOpen(false)}>Отмена</button><button className="quote-primary" disabled={busy || !attachTarget} onClick={()=>void work(async()=>{
        const target=attachProjects.find(project=>project.id===Number(attachTarget));if(!target)return;
        const saved=await saveCurrent();
        const result=await api<{project_id:number}>(base+"/attach","POST",{revision:saved.revision,project_id:target.id,project_revision:target.quote_revision});
        setAttachOpen(false);setDirty(false);await onAttached?.(result.project_id);
      })}>Прикрепить КП</button></div>
    </QuoteDialog>}
    {imported && <QuoteDialog title="Проверка импорта КП" busy={busy} className="quotation-import-modal" onClose={()=>{setImported(null);setError("");}}>
      <h2>{imported.filename}</h2><p>Распознано позиций: {imported.lines.length}. Проверьте цены и количество. После переноса все строки можно редактировать.</p>
      {imported.warnings.map((warning,index)=><p key={index} className="warning">{warning}</p>)}
      <label>Перенос<select aria-label="Режим импорта КП" value={importMode} onChange={e=>setImportMode(e.target.value as "append"|"replace")}><option value="append">Добавить к текущим позициям</option><option value="replace">Заменить позиции текущего КП</option></select></label>
      <div className="quotation-import-table"><table><thead><tr><th>Наименование</th><th>Количество</th><th>Ед.</th><th>Цена</th><th>Валюта</th></tr></thead><tbody>{imported.lines.slice(0,100).map((line,index)=><tr key={line.id}><td><input aria-label={"Импорт: наименование "+(index+1)} value={line.name} onChange={e=>setImported({...imported,lines:imported.lines.map((item,i)=>i===index ? {...item,name:e.target.value} : item)})}/></td><td><input aria-label={"Импорт: количество "+(index+1)} type="number" min=".001" step=".001" value={line.quantity} onChange={e=>setImported({...imported,lines:imported.lines.map((item,i)=>i===index ? {...item,quantity:e.target.value} : item)})}/></td><td>{line.unit}</td><td><input aria-label={"Импорт: цена "+(index+1)} type="number" min="0" step=".01" value={line.unit_price} onChange={e=>setImported({...imported,lines:imported.lines.map((item,i)=>i===index ? {...item,unit_price:e.target.value} : item)})}/></td><td>{line.currency}</td></tr>)}</tbody></table></div>
      {imported.lines.length>100 && <p className="hint">Показаны первые 100 строк. Все {imported.lines.length} позиций будут перенесены; остальные можно проверить в редакторе.</p>}
      {error && <p className="catalog-error" role="alert">{error}</p>}
      <div className="modal-actions"><button onClick={()=>setImported(null)}>Отмена</button><button className="quote-primary" onClick={()=>{
        if((importMode==="append" ? doc.lines.length : 0)+imported.lines.length>5000){setError("В КП допускается не больше 5000 строк");return;}
        change(q=>({...q,lines:importMode==="append" ? [...q.lines,...imported.lines] : imported.lines}),true);
        setImported(null);setMessage("Позиции перенесены. Проверьте КП и сохраните изменения.");
      }}>Перенести позиции в КП</button></div>
    </QuoteDialog>}
  </section>;
}


function QuoteDialog({title,busy,onClose,children,className=""}:{title:string;busy:boolean;onClose:()=>void;children:React.ReactNode;className?:string}) {
  const node=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    const frame=requestAnimationFrame(()=>node.current?.querySelector<HTMLElement>("input,select,button")?.focus());
    return()=>{cancelAnimationFrame(frame);if(previous?.isConnected)previous.focus();};
  },[]);
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      if(event.key==="Escape"){event.preventDefault();event.stopImmediatePropagation();if(!busy)onClose();}
    };
    window.addEventListener("keydown",key,true);return()=>window.removeEventListener("keydown",key,true);
  },[busy,onClose]);
  return <div ref={node} className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title} onKeyDown={event=>{
    if(event.key!=="Tab")return;
    const controls=[...event.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])")].filter(item=>item.getClientRects().length);
    const first=controls[0],last=controls.at(-1);
    if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
  }}><section className={"catalog-modal quotation-product-modal "+className}>{children}</section></div>;
}
