import ImageField,{imagePaste,prepareImage,imageDrop,imageDragOver} from "./ImageField";
import SearchInput from "./SearchInput";
import QuotationPreview from "./QuotationPreview";
import ToolRail, {ToolButton, type ToolItem} from "./ToolRail";
import SearchSelect from "./SearchSelect";
import { useEffect, useRef, useState } from "react";
import "./QuotationEditor.css";

export type QuotationKind = { id:number; name:string; category:string; unit:string; active:boolean };
type Product = { id:number; type_id:number; name:string; sku:string; unit:string; price:number; currency:string; active:boolean; manufacturer:string; parameters?:{image?:string;description?:string} };
type Catalogue = { products:Product[]; manufacturers:{id:number;name:string}[] };
type Line = {
  id:string; source_key:string; source_ids:number[]; type_id:number|null; product_id:number|null;
  name:string; sku:string; manufacturer:string; room:string; description:string; quantity:string;
  quantity_override?:string|null; calculated_quantity?:string|null; overrides?:string[];
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
type ImportCheck={line_id:string;page:number;source_total:string|null;issues:string[];verified:boolean;modified?:boolean};

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

export default function QuotationEditor({projectId,quotationId,projectName,types,onChanged,onDirtyChange,onBusyChange,onBrowse,onAttached}:Props) {
  const [doc,setDoc]=useState<Quote|null>(null),[prices,setPrices]=useState<Quote|null>(null);
  const [catalogue,setCatalogue]=useState<Catalogue>({products:[],manufacturers:[]});
  const [busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[calculating,setCalculating]=useState(false);
  const [error,setError]=useState(""),[message,setMessage]=useState(""),[mode,setMode]=useState<"client"|"partner">("partner");
  const [preview,setPreview]=useState(false),[quoteTool,setQuoteTool]=useState("positions"),[productSearch,setProductSearch]=useState("");
  function chooseQuoteTool(id:string){setQuoteTool(id);setPreview(id==="preview");}
  const [attachOpen,setAttachOpen]=useState(false),[attachProjects,setAttachProjects]=useState<AttachmentProject[]>([]),[attachTarget,setAttachTarget]=useState("");
  const [imported,setImported]=useState<{filename:string;lines:Line[];warnings:string[];checks?:ImportCheck[]}|null>(null);
  const [importPage,setImportPage]=useState(0);
  const [importMode,setImportMode]=useState<"append"|"replace">("append");
  const importInput=useRef<HTMLInputElement>(null);
  const [newProduct,setNewProduct]=useState<{lineId:string;name:string;manufacturer:string;sku:string;typeId:string;price:string;currency:string;image:string}|null>(null);
  const docRef=useRef<Quote|null>(doc);docRef.current=doc;
  const history=useRef<Quote[]>([]),future=useRef<Quote[]>([]),lastChange=useRef(0);
  const standalone=quotationId!==undefined;
  const base=standalone ? "/quotations/"+quotationId : "/projects/"+projectId+"/quotation";
  function apply(value:Quote) {setDoc(value);setPrices(value);setDirty(false);setCalculating(false);history.current=[];future.current=[];lastChange.current=0;}
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
    if(!doc || !dirty){setCalculating(false);return;}
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
    change(current=>({...current,lines:current.lines.map(line=>{
      if(line.id!==id)return line;
      const allowed=['name','sku','manufacturer','room','description','unit_price','currency','image'];
      const overrides=line.source_key ? [...new Set([...(line.overrides??[]),...Object.keys(patch).filter(key=>allowed.includes(key))])] : line.overrides;
      return {...line,...patch,overrides};
    })}));
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
  useEffect(()=>{
    const controller=new AbortController();
    api<Catalogue>('/catalog','GET',undefined,controller.signal).then(value=>{if(!controller.signal.aborted)setCatalogue(value);}).catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:'Не удалось обновить каталог');});
    return()=>controller.abort();
  },[types]);
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
      setImported(value);setImportMode("append");setImportPage(0);
    });
  }
  function editImportedLine(id:string,patch:Partial<Line>) {
    setImported(current=>current ? {...current,lines:current.lines.map(line=>line.id===id ? {...line,...patch} : line),
      checks:current.checks?.map(check=>check.line_id===id ? {...check,modified:true} : check)} : null);
  }
  async function upload(file:File|undefined,done:(value:string)=>void,logo=false) {
    if(!file)return;
    try {done(await prepareImage(file,logo));}catch(error){setError(error instanceof Error ? error.message : "Ошибка изображения");}
  }
  if(!doc)return <section className="quotation-editor"><h2>Редактор КП</h2>{busy ? <p role="status">Загрузка КП…</p> : <><p role="alert">{error}</p><button onClick={()=>void work(load)}>Повторить загрузку КП</button></>}</section>;
  const calculated=prices ?? doc;
  const visiblePrices=calculated[mode];
  const rowPrices=new Map(visiblePrices.lines.map(line=>[line.id,line]));
  const unpriced=doc.lines.filter(line=>Number(line.unit_price)===0).length;
  const validProducts=(line:Line)=>catalogue.products.filter(product=>
    (product.active || product.id===line.product_id) && product.unit===line.unit && (!line.source_ids.length || line.type_id===null || product.type_id===line.type_id));
  const tools:ToolItem[]=[
    {id:'positions',label:'Позиции',icon:'list',actionLabel:'Редактировать'},
    {id:'details',label:'Реквизиты и условия',icon:'edit'},
    {id:'brand',label:'Оформление КП',icon:'palette'},
    {id:'catalog',label:'Товары',icon:'catalog'},
    {id:'preview',label:'Предпросмотр',icon:'eye',actionLabel:'Предпросмотр'},
    {id:'save',label:'Сохранить',icon:'save',actionLabel:'Сохранить КП',disabled:busy||!dirty,command:()=>void work(async()=>{await saveCurrent();setMessage('КП сохранено');})},
    {id:'load',label:'Загрузить сохранённое',icon:'refresh',actionLabel:'Загрузить сохранённое КП',disabled:busy,command:()=>void work(async()=>{if(dirty&&!confirm('Отменить несохранённые правки и загрузить сохранённое КП?'))return;await load();})},
    {id:'import',label:'Импорт из файла',icon:'import',actionLabel:'Импорт из PDF / Excel / Word',disabled:busy,command:()=>importInput.current?.click()},
    {id:'sync',label:'Обновить из расчёта',icon:'refresh',actionLabel:'Обновить из расчёта',disabled:busy||standalone,command:()=>void work(async()=>{if(doc.lines.length&&!confirm('Обновить позиции из расчёта? Ручные правки, количество и скидки сохранятся. Удалённые на плане позиции уйдут из КП.'))return;const saved=await saveCurrent();apply(await api<Quote>(base+'/import','POST',{revision:saved.revision}));setMessage('Позиции обновлены из расчёта');})},
    {id:'client',label:'PDF клиенту',icon:'pdf',actionLabel:'PDF для клиента — без скидок',disabled:busy||!doc.lines.length,command:()=>void download('client')},
    {id:'partner',label:'PDF партнёру',icon:'pdf',actionLabel:'PDF для партнёра — со скидками',disabled:busy||!doc.lines.length,command:()=>void download('partner')},
    ...(standalone?[{id:'attach',label:'Прикрепить к проекту',icon:'link',actionLabel:'Прикрепить к проекту',disabled:busy,command:()=>void work(async()=>{setAttachProjects(await api<AttachmentProject[]>("/quotations/project-options"));setAttachTarget("");setAttachOpen(true);})}]:[]),
    ...(onBrowse?[{id:'browse',label:'К списку КП',icon:'back',actionLabel:'К списку КП',disabled:busy,command:onBrowse}]:[]),
  ];
  return <section className="quotation-editor quote-workspace" aria-label="Редактор коммерческого предложения">
    <ToolRail label="Инструменты коммерческого предложения" active={quoteTool} onSelect={chooseQuoteTool} items={tools}/>
    <div className="quotation-content" data-tool={quoteTool}>
    <div className="quotation-heading"><div><div className="eyebrow">КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ</div><h2>КП № {doc.number}</h2><p>{projectName} · {tools.find(tool=>tool.id===quoteTool)?.label}</p></div></div>
    <input ref={importInput} hidden type="file" aria-label="Файл внешнего КП" accept=".pdf,.xlsx,.xls,.xlsm,.docx,.csv" disabled={busy} onChange={event=>{void importFile(event.target.files?.[0]);event.target.value='';}}/>
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
    <div className="quotation-switch">
      <label>Цены<SearchSelect aria-label="Цены предпросмотра КП" value={mode} onChange={event=>setMode(event.target.value as "client"|"partner")}><option value="partner">Партнёр — со скидками</option><option value="client">Клиент — без скидок</option></SearchSelect></label>
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
      <div className="quotation-line-actions"><ToolButton icon="plus" disabled={busy} onClick={()=>change(q=>({...q,lines:[...q.lines,newLine()]}),true)}>＋ Добавить строку КП</ToolButton>
        <ToolButton icon="undo" disabled={busy || !history.current.length} onClick={()=>undo()}>Отменить правку КП</ToolButton><ToolButton icon="redo" disabled={busy || !future.current.length} onClick={()=>undo(true)}>Вернуть правку КП</ToolButton></div>
      <div className="quotation-table-wrap"><table className="quotation-table"><thead><tr><th>Позиция / товар</th><th>Кол-во</th><th>Ед.</th><th>Цена</th><th>Валюта</th><th>Скидка, %</th><th>Сумма</th><th></th></tr></thead>
        <tbody>{doc.lines.map((line,index)=><tr key={line.id} data-quote-line={line.id} data-image-target onDragOver={imageDragOver} onDrop={event=>imageDrop(event,file=>void upload(file,image=>editLine(line.id,{image})))} onPasteCapture={event=>imagePaste(event,file=>void upload(file,image=>editLine(line.id,{image})))}>
          <td><div className="quotation-line-name">{line.image && <img src={line.image} alt=""/>}<div><input aria-label={"Наименование строки "+(index+1)} value={line.name} disabled={busy} onChange={e=>editLine(line.id,{name:e.target.value})}/><small>{line.room}{line.source_ids.length ? " · На плане: "+line.source_ids.length : line.source_key.startsWith("frame:") ? " · Рамка по расчёту" : " · Ручная строка"}</small></div></div>
            <SearchSelect aria-label={"Товар строки "+(index+1)} value={line.product_id ?? ""} disabled={busy} onChange={e=>void bind(line.id,e.target.value)}><option value="">Без привязки к товару</option>{validProducts(line).map(product=><option key={product.id} value={product.id} disabled={!product.active && product.id!==line.product_id}>{product.manufacturer} · {product.name}{product.sku ? " · "+product.sku : ""}</option>)}</SearchSelect>
            <div className="quotation-inline-actions"><button type="button" disabled={busy} onClick={()=>{setError("");setNewProduct({lineId:line.id,name:line.name,manufacturer:line.manufacturer,sku:line.sku,typeId:line.type_id ? String(line.type_id) : "",price:line.unit_price,currency:line.currency,image:line.image});}}>＋ Товар в базу</button>
              <ImageField label={"Фото строки "+(index+1)} value={line.image} disabled={busy} onChange={image=>editLine(line.id,{image})}/>

            </div>
            <details><summary>Описание и артикул</summary><input aria-label={"Артикул строки "+(index+1)} placeholder="Артикул" value={line.sku} disabled={busy} onChange={e=>editLine(line.id,{sku:e.target.value})}/><SearchInput aria-label={"Производитель строки "+(index+1)} placeholder="Производитель" options={catalogue.manufacturers.map(m=>m.name)} value={line.manufacturer} disabled={busy} onChange={manufacturer=>editLine(line.id,{manufacturer})}/><input aria-label={"Помещение строки "+(index+1)} placeholder="Помещение" value={line.room} disabled={busy} onChange={event=>editLine(line.id,{room:event.target.value})}/>
            <label>Номенклатура<SearchSelect aria-label={"Номенклатура строки "+(index+1)} disabled={busy||Boolean(line.source_ids.length)} value={line.type_id??''} onChange={event=>{const type=types.find(type=>type.id===Number(event.target.value));editLine(line.id,{type_id:type?.id??null,product_id:null});}}><option value="">Без категории</option>{types.filter(type=>type.active&&type.unit===line.unit).map(type=><option key={type.id} value={type.id}>{type.category} · {type.name}</option>)}</SearchSelect></label>
            <ToolButton icon="copy" type="button" disabled={busy} aria-label={"Дублировать строку "+(index+1)+" в КП"} onClick={()=>change(quote=>({...quote,lines:[...quote.lines,{...line,id:crypto.randomUUID(),source_key:'',source_ids:[],quantity_override:null,calculated_quantity:null,overrides:[]}]}),true)}>Ручная копия строки</ToolButton>
            <textarea aria-label={"Описание строки "+(index+1)} value={line.description} disabled={busy} onChange={e=>editLine(line.id,{description:e.target.value})}/></details>
          </td>
          <td><input aria-label={"Количество строки "+(index+1)} type="number" min=".001" max="1000000" step=".001" value={line.quantity} disabled={busy || (Boolean(line.source_key)&&line.quantity_override==null)} onChange={e=>editLine(line.id,{quantity:e.target.value,...(line.source_key?{quantity_override:e.target.value}:{})})}/>{line.source_key&&<><label className="manual-quantity"><input type="checkbox" aria-label={"Ручное количество строки "+(index+1)} checked={line.quantity_override!=null} onChange={event=>editLine(line.id,event.target.checked?{calculated_quantity:line.calculated_quantity??line.quantity,quantity_override:line.quantity}:{quantity_override:null,quantity:line.calculated_quantity??line.quantity})}/>Вручную</label><small>По плану: {line.calculated_quantity??line.quantity}</small></>}</td>
          <td><SearchSelect aria-label={"Единица строки "+(index+1)} value={line.unit} disabled={busy || Boolean(line.source_key) || Boolean(line.product_id)} onChange={e=>editLine(line.id,{unit:e.target.value as "шт"|"м"})}><option value="шт">шт</option><option value="м">м</option></SearchSelect></td>
          <td><input aria-label={"Цена строки "+(index+1)} type="number" min="0" max="1000000000" step=".01" value={line.unit_price} disabled={busy} onChange={e=>editLine(line.id,{unit_price:e.target.value})}/></td>
          <td><input aria-label={"Валюта строки "+(index+1)} maxLength={3} value={line.currency} disabled={busy} onChange={e=>editLine(line.id,{currency:e.target.value.toUpperCase()})}/></td>
          <td><input aria-label={"Скидка строки "+(index+1)} type="number" min="0" max="100" step=".01" placeholder="Общая" value={line.discount ?? ""} disabled={busy} onChange={e=>editLine(line.id,{discount:e.target.value==="" ? null : e.target.value})}/><small>{line.discount===null ? "По общей" : "Индивидуальная"}</small></td>
          <td className="quotation-row-total">{calculating ? "…" : rowPrices.has(line.id) ? amount(rowPrices.get(line.id)!.total,line.currency) : "—"}</td>
          <td><button aria-label={"Удалить строку "+(index+1)+" из КП"} title="Убрать только из КП" disabled={busy} onClick={()=>change(q=>({...q,lines:q.lines.filter(item=>item.id!==line.id)}),true)}>×</button></td>
        </tr>)}</tbody></table></div>
      {!doc.lines.length && <p className="hint">Пока нет позиций. Добавьте строку вручную или импортируйте расчёт проекта.</p>}

      <section className="quote-catalog-panel" aria-label="Товары для КП"><h3>Добавить товар из базы</h3><input aria-label="Поиск товаров для КП" type="search" placeholder="Название, артикул, производитель…" value={productSearch} onChange={event=>setProductSearch(event.target.value)}/>
        <div className="quote-catalog-products">{catalogue.products.filter(product=>product.active&&[product.name,product.sku,product.manufacturer].join(' ').toLocaleLowerCase().includes(productSearch.toLocaleLowerCase())).map(product=><article key={product.id}><strong>{product.name}</strong><small>{product.manufacturer} · {product.sku}</small><b>{amount(product.price,product.currency)} / {product.unit}</b><ToolButton icon="plus" disabled={busy} onClick={()=>{change(quote=>({...quote,lines:[...quote.lines,{...newLine(),name:product.name,sku:product.sku,manufacturer:product.manufacturer,product_id:product.id,type_id:product.type_id,unit:product.unit as 'шт'|'м',unit_price:String(product.price),currency:product.currency,image:product.parameters?.image??'',description:product.parameters?.description??''}]}),true);chooseQuoteTool('positions');}}>Добавить в КП</ToolButton></article>)}</div>
      </section>
      <fieldset disabled={busy} className="quotation-notes"><label>Условия предложения<textarea aria-label="Условия КП" rows={4} value={doc.terms} onChange={e=>change(q=>({...q,terms:e.target.value}))}/></label></fieldset>
      <details open className="quotation-brand"><summary>Оформление и реквизиты</summary><fieldset disabled={busy} className="quotation-fields">
        {([["title","Заголовок КП"],["seller","Компания"],["city","Город"],["phone","Телефон"],["email","E-mail"],["website","Сайт"],["address","Адрес"],["slogan","Слоган"],["tax_note","Примечание о НДС"]] as const).map(([key,label])=><label key={key}>{label}<input aria-label={label+" КП"} value={doc[key]} onChange={e=>change(q=>({...q,[key]:e.target.value}))}/></label>)}
        <ImageField label="Логотип КП" value={doc.logo} disabled={busy} logo onChange={logo=>change(q=>({...q,logo}))}/>
        {doc.benefits.map((benefit,index)=><label key={index}>Преимущество {index+1}<input aria-label={"Заголовок преимущества "+(index+1)} value={benefit.title} onChange={e=>change(q=>({...q,benefits:q.benefits.map((item,i)=>i===index ? {...item,title:e.target.value} : item)}))}/><input aria-label={"Текст преимущества "+(index+1)} value={benefit.text} onChange={e=>change(q=>({...q,benefits:q.benefits.map((item,i)=>i===index ? {...item,text:e.target.value} : item)}))}/></label>)}
        <button onClick={()=>change(q=>({...q,benefits:[]}))}>Убрать блок преимуществ</button>
      </fieldset><p className="hint">Примечание о НДС и гарантийные условия укажите в соответствии с вашими ценами и товарами.</p></details>
    </> : <QuotationPreview base={base} document={doc} mode={mode}/>}
    </div>
    {newProduct && <QuoteDialog title="Новый товар из КП" busy={busy} onClose={()=>{setNewProduct(null);setError("");}}>
      <h2>Новый товар в базу</h2><p>{standalone ? "Товар сохранится в общем каталоге и строке КП." : "Товар сохранится в общем каталоге и будет привязан к этой строке и её объектам на плане."}</p>
      <form onSubmit={event=>{event.preventDefault();void work(async()=>{
        const saved=await saveCurrent();
        const value=await api<Quote>(base+"/product","POST",{revision:saved.revision,line_id:newProduct.lineId,type_id:newProduct.typeId ? Number(newProduct.typeId) : null,
          name:newProduct.name,manufacturer:newProduct.manufacturer,sku:newProduct.sku,unit_price:newProduct.price,currency:newProduct.currency,image:newProduct.image});
        apply(value);setNewProduct(null);setCatalogue(await api<Catalogue>("/catalog"));await onChanged();setMessage("Товар создан в каталоге и привязан к позиции");
      });}}>
        <fieldset disabled={busy} onDragOver={imageDragOver} onDrop={event=>imageDrop(event,file=>void upload(file,image=>setNewProduct(current=>current?{...current,image}:null)))} data-image-target onPasteCapture={event=>imagePaste(event,file=>void upload(file,image=>setNewProduct(current=>current?{...current,image}:null)))}>
          <label>Название<input autoFocus aria-label="Название нового товара КП" required maxLength={500} value={newProduct.name} onChange={e=>setNewProduct({...newProduct,name:e.target.value})}/></label>
          <label>Номенклатура<SearchSelect aria-label="Номенклатура нового товара КП" required={!doc.lines.find(line=>line.id===newProduct.lineId)?.source_key.startsWith("frame:")} value={newProduct.typeId} onChange={e=>setNewProduct({...newProduct,typeId:e.target.value})}><option value="">{doc.lines.find(line=>line.id===newProduct.lineId)?.source_key.startsWith("frame:") ? "Рамка по расчёту" : "Выберите номенклатуру"}</option>{types.filter(type=>type.active && type.unit===doc.lines.find(line=>line.id===newProduct.lineId)?.unit && (!doc.lines.find(line=>line.id===newProduct.lineId)?.source_ids.length || type.id===doc.lines.find(line=>line.id===newProduct.lineId)?.type_id)).map(type=><option key={type.id} value={type.id}>{type.name}</option>)}</SearchSelect></label>
          <label>Производитель<SearchInput aria-label="Производитель нового товара КП" required options={catalogue.manufacturers.map(m=>m.name)} value={newProduct.manufacturer} onChange={manufacturer=>setNewProduct(current=>current?{...current,manufacturer}:null)}/></label>
          <label>Артикул<input aria-label="Артикул нового товара КП" value={newProduct.sku} onChange={e=>setNewProduct({...newProduct,sku:e.target.value})}/></label>
          <label>Цена<input aria-label="Цена нового товара КП" required type="number" min="0" max="1000000000" step=".01" value={newProduct.price} onChange={e=>setNewProduct({...newProduct,price:e.target.value})}/></label>
          <label>Валюта<input aria-label="Валюта нового товара КП" required pattern="[A-Z]{3}" maxLength={3} value={newProduct.currency} onChange={e=>setNewProduct({...newProduct,currency:e.target.value.toUpperCase()})}/></label>
          <ImageField label="Фото нового товара КП" value={newProduct.image} disabled={busy} onChange={image=>setNewProduct(current=>current?{...current,image}:null)}/>

        </fieldset>
        {error && <p role="alert" className="catalog-error">{error}</p>}
        <div className="modal-actions"><button type="button" disabled={busy} onClick={()=>{setNewProduct(null);setError("");}}>Отмена</button><button className="quote-primary" disabled={busy}>Создать и привязать товар</button></div>
      </form>
    </QuoteDialog>}
    {attachOpen && <QuoteDialog title="Прикрепить КП к проекту" busy={busy} onClose={()=>{setAttachOpen(false);setError("");}}>
      <h2>Прикрепить КП к проекту</h2>
      <p>КП целиком перейдёт в выбранный проект: позиции, цены, скидки, реквизиты и фотографии сохранятся.</p>
      <label>Проект<SearchSelect aria-label="Проект для КП" disabled={busy} value={attachTarget} onChange={e=>setAttachTarget(e.target.value)}><option value="">Выберите проект</option>{attachProjects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}</SearchSelect></label>
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
      <label>Перенос<SearchSelect aria-label="Режим импорта КП" value={importMode} onChange={e=>setImportMode(e.target.value as "append"|"replace")}><option value="append">Добавить к текущим позициям</option><option value="replace">Заменить позиции текущего КП</option></SearchSelect></label>
      {!!imported.checks?.length && <p className="hint">Суммы совпали с PDF: {imported.checks.filter(check=>check.verified&&!check.modified&&imported.lines.some(line=>line.id===check.line_id)).length}. Отметка относится к исходным значениям. Цена за единицу и скидка перенесены раздельно.</p>}
      <div className="quotation-import-table"><table><thead><tr><th>Наименование / артикул</th><th>Количество</th><th>Ед.</th><th>Цена за ед.</th><th>Скидка %</th><th>Валюта</th><th>Проверка PDF</th><th></th></tr></thead><tbody>{imported.lines.slice(importPage*100,(importPage+1)*100).map((line,offset)=>{
        const index=importPage*100+offset,check=imported.checks?.find(item=>item.line_id===line.id);
        return <tr key={line.id} className={check?.issues.length ? "quotation-import-review" : ""}>
          <td><input aria-label={"Импорт: наименование "+(index+1)} value={line.name} onChange={e=>editImportedLine(line.id,{name:e.target.value})}/><input aria-label={"Импорт: артикул "+(index+1)} placeholder="Артикул" value={line.sku} onChange={e=>editImportedLine(line.id,{sku:e.target.value})}/></td>
          <td><input aria-label={"Импорт: количество "+(index+1)} type="number" min=".001" step=".001" value={line.quantity} onChange={e=>editImportedLine(line.id,{quantity:e.target.value})}/></td>
          <td><SearchSelect aria-label={"Импорт: единица "+(index+1)} value={line.unit} onChange={e=>editImportedLine(line.id,{unit:e.target.value as Line["unit"]})}><option>шт</option><option>м</option></SearchSelect></td>
          <td><input aria-label={"Импорт: цена "+(index+1)} type="number" min="0" step=".01" value={line.unit_price} onChange={e=>editImportedLine(line.id,{unit_price:e.target.value})}/></td>
          <td><input aria-label={"Импорт: скидка "+(index+1)} type="number" min="0" max="100" step=".01" placeholder="Нет" value={line.discount??""} onChange={e=>editImportedLine(line.id,{discount:e.target.value||null})}/></td>
          <td><input aria-label={"Импорт: валюта "+(index+1)} maxLength={3} value={line.currency} onChange={e=>editImportedLine(line.id,{currency:e.target.value.toUpperCase()})}/></td>
          <td>{check ? <><small>Стр. {check.page}{check.source_total!==null ? " · Сумма "+cash(check.source_total)+" "+line.currency : ""}</small><small>{check.modified ? "Изменено вручную" : check.verified ? "Сумма совпала" : "Проверьте строку"}</small>{check.issues.map((issue,i)=><small key={i} className="warning">{issue}</small>)}</> : "—"}</td>
          <td><button aria-label={"Удалить импортированную строку "+(index+1)} onClick={()=>{
            const lines=imported.lines.filter(item=>item.id!==line.id);setImported({...imported,lines});setImportPage(Math.min(importPage,Math.max(0,Math.ceil(lines.length/100)-1)));
          }}>×</button></td>
        </tr>;
      })}</tbody></table></div>
      {imported.lines.length>100 && <div className="quotation-import-pages"><button disabled={importPage===0} onClick={()=>setImportPage(importPage-1)}>Назад</button><span>Строки {importPage*100+1}–{Math.min((importPage+1)*100,imported.lines.length)} из {imported.lines.length}</span><button disabled={(importPage+1)*100>=imported.lines.length} onClick={()=>setImportPage(importPage+1)}>Далее</button></div>}
      {error && <p className="catalog-error" role="alert">{error}</p>}
      <div className="modal-actions"><button onClick={()=>setImported(null)}>Отмена</button><button className="quote-primary" onClick={()=>{
        const invalid=imported.lines.findIndex(line=>!line.name.trim() || !/^\d+(?:[.]\d{1,3})?$/.test(line.quantity) || +line.quantity<=0 || +line.quantity>1000000 || !/^\d+(?:[.]\d{1,2})?$/.test(line.unit_price) || +line.unit_price>1000000000 || !/^[A-Z]{3}$/.test(line.currency) || (line.discount!==null && (!Number.isFinite(+line.discount) || +line.discount<0 || +line.discount>100)));
        if(!imported.lines.length || invalid>=0){setError(invalid>=0 ? "Проверьте название, количество, цену, валюту и скидку в строке "+(invalid+1) : "Нет позиций для переноса");return;}
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
      if(event.key==="Escape" && !(event.target as HTMLElement)?.closest("[data-search-popup]")){event.preventDefault();event.stopImmediatePropagation();if(!busy)onClose();}
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
