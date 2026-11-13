import DecimalInput,{decimalIssue,decimalValue} from "./DecimalInput";
import {api,apiFetch,errorMessage} from "./errors";
import {moveQuoteLine,QUOTE_LINE_DRAG} from "./quotationOrder";
import ImageField,{imagePaste,prepareImage,imageDrop,imageDragOver} from "./ImageField";
import SearchInput from "./SearchInput";
import QuotationPreview from "./QuotationPreview";
import ToolRail, {ToolButton, type ToolItem} from "./ToolRail";
import SearchSelect,{matchesSearch,type SearchOption} from "./SearchSelect";
import usePreference from "./usePreference";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import "./QuotationEditor.css";

export type QuotationKind = { id:number; name:string; category:string; unit:string; active:boolean };
type Product = { id:number; type_id:number; name:string; sku:string; unit:string; price:number; currency:string; active:boolean; manufacturer:string; parameters?:{image?:string;description?:string} };
type Catalogue = { products:Product[]; manufacturers:{id:number;name:string}[] };
type Line = {
  id:string; source_key:string; source_signature?:string; source_ids:number[]; type_id:number|null; product_id:number|null;
  name:string; sku:string; manufacturer:string; room:string; description:string; comment?:string; quantity:string;
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
  projectName:string; rooms?:{name:string}[]; types:QuotationKind[]; onChanged:()=>Promise<void>; onBrowse?:()=>void;
  onDirtyChange:(dirty:boolean)=>void; onBusyChange:(busy:boolean)=>void;
} & ({projectId:number;quotationId?:never;onAttached?:never} | {quotationId:number;projectId?:never;onAttached:(projectId:number)=>Promise<void>});
type AttachmentProject={id:number;name:string;quote_revision:number};
type ImportCheck={line_id:string;page:number;source_total:string|null;issues:string[];verified:boolean;modified?:boolean};


const cash=(value:string|number)=>Number(value).toLocaleString("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:2});
const amount=(value:string|number,code:string)=>cash(value)+" "+(({RUB:"₽",USD:"$",EUR:"€"} as Record<string,string>)[code] ?? code);
const newLine=():Line=>({id:crypto.randomUUID(),source_key:"",source_ids:[],type_id:null,product_id:null,
  name:"Новая позиция",sku:"",manufacturer:"",room:"",description:"",comment:"",quantity:"1",unit:"шт",unit_price:"0",currency:"RUB",discount:null,image:""});

function pricePayload(quote:Quote|null){return {global_discount:quote?.global_discount??'0',lines:quote?.lines.map(line=>({id:line.id,quantity:line.quantity,unit_price:line.unit_price,currency:line.currency,discount:line.discount}))??[]};}
function priceRequest(quote:Quote|null){const payload=pricePayload(quote);payload.lines.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);return JSON.stringify(payload);}
function numberError(quote:Quote|null):string{
 if(!quote)return '';
 const issues:string[]=[];
 const global=decimalIssue(quote.global_discount,0,100,2);
 if(global)issues.push('Общая скидка: '+global);
 quote.lines.forEach((line,index)=>{
  const checks:[string,unknown,number,number,number,boolean?][]=[['Количество',line.quantity,.001,1000000,3,true],['Цена за единицу',line.unit_price,0,1000000000,2]];
  if(line.discount!==null&&line.discount!=='')checks.push(['Скидка',line.discount,0,100,2]);
  for(const [label,value,min,max,places,positive] of checks){const issue=decimalIssue(value,min,max,places,positive);if(issue)issues.push('Строка КП № '+(index+1)+' — '+label+': '+issue);}
 });
 return issues.slice(0,50).join('; ');
}
type Calculated=Pick<Quote,'client'|'partner'>;

export default function QuotationEditor({projectId,quotationId,projectName,rooms=[],types,onChanged,onDirtyChange,onBusyChange,onBrowse,onAttached}:Props) {
  const [doc,setDoc]=useState<Quote|null>(null),[prices,setPrices]=useState<Calculated|null>(null);
  const [catalogue,setCatalogue]=useState<Catalogue>({products:[],manufacturers:[]});
  const [busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[calculating,setCalculating]=useState(false);
  const [error,setError]=useState(""),[message,setMessage]=useState(""),[mode,setMode]=useState<"client"|"partner">("partner");
  const [linePage,setLinePage]=useState(0),[lineQuery,setLineQuery]=useState(''),[catalogLimit,setCatalogLimit]=useState(100);
  const [linePageSize,setLinePageSize]=usePreference<number>('quote-page-size',100,(value):value is number=>typeof value==='number'&&[25,50,100,200,500].includes(value));
  const [preview,setPreview]=useState(false),[quoteTool,setQuoteTool]=useState("positions"),[productSearch,setProductSearch]=useState("");
  function chooseQuoteTool(id:string){setQuoteTool(id);setPreview(id==="preview");}
  const [attachOpen,setAttachOpen]=useState(false),[attachProjects,setAttachProjects]=useState<AttachmentProject[]>([]),[attachTarget,setAttachTarget]=useState("");
  const [imported,setImported]=useState<{filename:string;lines:Line[];warnings:string[];checks?:ImportCheck[]}|null>(null);
  const [importPage,setImportPage]=useState(0);
  const [importMode,setImportMode]=useState<"append"|"replace">("append");
  const importInput=useRef<HTMLInputElement>(null);
  const [newProduct,setNewProduct]=useState<{lineId:string;name:string;manufacturer:string;sku:string;typeId:string;price:string;currency:string;image:string}|null>(null);
  const [roomFilter,setRoomFilter]=useState<string|null>(null),[activeLineId,setActiveLineId]=useState<string|null>(null),[editingLineId,setEditingLineId]=useState<string|null>(null);
  const [expandedRows,setExpandedRows]=useState<ReadonlySet<string>>(new Set());
  const [draggedId,setDraggedId]=useState<string|null>(null),[dropTarget,setDropTarget]=useState<{id:string;after:boolean}|null>(null);
  const dragSource=useRef<string|null>(null),dragY=useRef<number|null>(null),tableWrap=useRef<HTMLDivElement>(null);
  const normalizeRoom=(value:string)=>value.trim()==='Без помещения'?'':value.trim();
  const roomChoices=useMemo(()=>[...new Set([...(doc?.lines.map(line=>normalizeRoom(line.room))??[]),...rooms.map(room=>normalizeRoom(room.name))])].filter(Boolean),[doc?.lines,rooms]);
  const grouped=Boolean(doc?.lines.some(line=>normalizeRoom(line.room)));
  function expandRow(id:string,open=true){setExpandedRows(current=>{const next=new Set(current);if(open)next.add(id);else next.delete(id);return next;});}
  useEffect(()=>{
    if(!draggedId)return;
    let frame=0;
    const scroll=()=>{const node=tableWrap.current,y=dragY.current;if(node&&y!==null){const rect=node.getBoundingClientRect(),outer=node.closest('.quotation-content')?.getBoundingClientRect(),top=Math.max(rect.top,outer?.top??rect.top),bottom=Math.min(rect.bottom,outer?.bottom??rect.bottom),edge=42;const delta=y<top+edge?-Math.min(15,(top+edge-y)/3):y>bottom-edge?Math.min(15,(y-bottom+edge)/3):0;if(delta)node.scrollTop+=delta;}frame=requestAnimationFrame(scroll);};
    frame=requestAnimationFrame(scroll);return()=>cancelAnimationFrame(frame);
  },[draggedId]);
  const productPickers=useMemo(()=>{
    const byUnit=new Map<string,SearchOption[]>(),byType=new Map<string,SearchOption[]>(),byId=new Map<number,SearchOption>();
    const add=(map:Map<string,SearchOption[]>,key:string,option:SearchOption)=>{const options=map.get(key)??[{value:'',label:'Без привязки к товару'}];options.push(option);map.set(key,options);};
    for(const product of catalogue.products){
      const option={value:String(product.id),label:product.name+(product.sku?' · '+product.sku:''),group:product.manufacturer,disabled:!product.active};byId.set(product.id,option);
      if(product.active){add(byUnit,product.unit,option);add(byType,product.unit+':'+product.type_id,option);}
    }
    return {byUnit,byType,byId};
  },[catalogue.products]);
  const filteredLines=useMemo(()=>doc?.lines.flatMap((line,index)=>
    (line.id===editingLineId||(roomFilter===null||normalizeRoom(line.room)===roomFilter)&&(!lineQuery||matchesSearch([line.name,line.sku,line.manufacturer,line.room,line.comment].join(' '),lineQuery)))?[{line,index}]:[])??[],[doc?.lines,lineQuery,roomFilter,editingLineId]);
  const linePages=Math.max(1,Math.ceil(filteredLines.length/linePageSize)),activePage=Math.min(linePage,linePages-1),visibleLines=filteredLines.slice(activePage*linePageSize,(activePage+1)*linePageSize);
  const insertionAnchor=visibleLines.find(item=>item.line.id===activeLineId)??visibleLines.at(-1);
  const filteredProducts=useMemo(()=>catalogue.products.filter(product=>product.active&&matchesSearch([product.name,product.sku,product.manufacturer].join(' '),productSearch)),[catalogue.products,productSearch]);
  const docRef=useRef<Quote|null>(doc);docRef.current=doc;
  const numericError=useMemo(()=>numberError(doc),[doc]);
  const calculationBody=useMemo(()=>priceRequest(doc),[doc]),calculatedKey=useRef('');
  const history=useRef<Quote[]>([]),future=useRef<Quote[]>([]),lastChange=useRef(0);
  const standalone=quotationId!==undefined;
  const base=standalone ? "/quotations/"+quotationId : "/projects/"+projectId+"/quotation";
  function apply(value:Quote) {calculatedKey.current=priceRequest(value);setDoc(value);setPrices(value);setDirty(false);setCalculating(false);history.current=[];future.current=[];lastChange.current=0;}
  async function work(action:()=>Promise<void>) {
    setBusy(true);setError("");setMessage("");
    try {await action();} catch(error) {setError(errorMessage(error,"Ошибка"));}
    finally {setBusy(false);}
  }
  async function load() {
    const [value,products]=await Promise.all([api<Quote>(base),api<Catalogue>("/catalog")]);
    apply(value);setCatalogue(products);
  }
  useEffect(()=>{void work(load);},[base]);
  useEffect(()=>{onDirtyChange(dirty||Boolean(newProduct)||Boolean(imported));},[dirty,newProduct,imported,onDirtyChange]);
  useEffect(()=>{onBusyChange(busy);},[busy,onBusyChange]);
  useEffect(()=>()=>{onDirtyChange(false);onBusyChange(false);},[onDirtyChange,onBusyChange]);
  useEffect(()=>{
    const unload=(event:BeforeUnloadEvent)=>{if(dirty){event.preventDefault();event.returnValue="";}};
    window.addEventListener("beforeunload",unload);return()=>window.removeEventListener("beforeunload",unload);
  },[dirty]);
  useEffect(()=>{
    if(!doc || !dirty || calculatedKey.current===calculationBody){setCalculating(false);return;}
    const cancellation=new AbortController();
    setCalculating(true);
    const timer=window.setTimeout(()=>{
      if(numericError){setError(numericError);setCalculating(false);return;}
      api<Calculated>(base+"/calculate","POST",pricePayload(docRef.current),cancellation.signal)
        .then(value=>{if(!cancellation.signal.aborted){calculatedKey.current=calculationBody;setPrices(value);setCalculating(false);setError("");}})
        .catch(error=>{if(!cancellation.signal.aborted){setError(errorMessage(error,"Ошибка расчёта"));setCalculating(false);}});
    },350);
    return()=>{window.clearTimeout(timer);cancellation.abort();};
  },[calculationBody,dirty,base,numericError]);
  function change(update:(current:Quote)=>Quote,separate=false) {
    const current=docRef.current;
    if(!current || busy)return;
    const now=Date.now();
    if(separate || now-lastChange.current>600){history.current.push(current);if(history.current.length>30)history.current.shift();}
    lastChange.current=separate?0:now;future.current=[];const next=update(current);docRef.current=next;setDoc(next);setDirty(true);setMessage("");
  }
  function appendLine(line:Line){const count=docRef.current?.lines.length??0;if(count>=5000){setError("В КП не может быть больше 5000 строк");return;}change(quote=>({...quote,lines:[...quote.lines,line]}),true);setLineQuery('');setRoomFilter(null);setActiveLineId(line.id);setLinePage(Math.floor(count/linePageSize));chooseQuoteTool('positions');}
  function insertNearCurrent(){
    const current=docRef.current;if(!current||current.lines.length>=5000)return;
    const anchor=insertionAnchor?.line;
    const index=anchor?current.lines.findIndex(line=>line.id===anchor.id)+1:current.lines.length;
    const line={...newLine(),room:anchor?.room??roomFilter??''};
    change(quote=>({...quote,lines:[...quote.lines.slice(0,index),line,...quote.lines.slice(index)]}),true);
    setLineQuery('');setRoomFilter(null);setActiveLineId(line.id);setLinePage(Math.floor(index/linePageSize));chooseQuoteTool('positions');
    requestAnimationFrame(()=>document.querySelector<HTMLInputElement>(`[data-quote-line="${CSS.escape(line.id)}"] .quotation-name-input`)?.focus());
  }
  function moveLine(id:string,target:string,after=false){
    const current=docRef.current;if(!current)return;
    const next=moveQuoteLine(current.lines,id,target,after);if(next===current.lines)return;
    change(quote=>({...quote,lines:next}),true);setActiveLineId(id);setMessage('Позиция перемещена. Ctrl+Z — отменить.');
  }
  function moveToPosition(id:string){
    const current=docRef.current;if(!current)return;
    const answer=prompt('Номер позиции, на которую переместить строку (1–'+current.lines.length+')',String(current.lines.findIndex(line=>line.id===id)+1));if(answer===null)return;
    const number=Number(answer.trim());if(!Number.isInteger(number)||number<1||number>current.lines.length){setError('Введите целый номер от 1 до '+current.lines.length);return;}
    const index=current.lines.findIndex(line=>line.id===id);moveLine(id,current.lines[number-1].id,index<number-1);setLineQuery('');setRoomFilter(null);setLinePage(Math.floor((number-1)/linePageSize));requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>(`[data-quote-line="${CSS.escape(id)}"] .quote-drag-handle`)?.focus());
  }
  function endDrag(){dragSource.current=null;dragY.current=null;setDraggedId(null);setDropTarget(null);}
  function rowDragOver(event:React.DragEvent<HTMLTableRowElement>,id:string){
    if(event.dataTransfer.types.includes('Files')){imageDragOver(event);return;}
    if(!dragSource.current||!event.dataTransfer.types.includes(QUOTE_LINE_DRAG))return;
    event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';dragY.current=event.clientY;
    const box=event.currentTarget.getBoundingClientRect(),after=event.clientY>box.top+box.height/2;
    setDropTarget(current=>current?.id===id&&current.after===after?current:{id,after});
  }
  function rowDrop(event:React.DragEvent<HTMLTableRowElement>,id:string){
    if(event.dataTransfer.types.includes('Files')){imageDrop(event,file=>void upload(file,image=>editLine(id,{image})));return;}
    if(!event.dataTransfer.types.includes(QUOTE_LINE_DRAG))return;
    event.preventDefault();event.stopPropagation();
    try{const payload=JSON.parse(event.dataTransfer.getData(QUOTE_LINE_DRAG));if(payload.base===base&&payload.id===dragSource.current){const rect=event.currentTarget.getBoundingClientRect();moveLine(payload.id,id,event.clientY>rect.top+rect.height/2);}}catch{}finally{endDrag();}
  }
  function groupLines(){
    change(current=>{const order=new Map<string,number>();for(const line of current.lines){const room=normalizeRoom(line.room);if(!order.has(room))order.set(room,order.size);}return {...current,lines:[...current.lines].sort((a,b)=>order.get(normalizeRoom(a.room))!-order.get(normalizeRoom(b.room))!)};},true);setLinePage(0);
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
    const item=source.pop();if(!item)return;destination.push(doc);docRef.current=item;setDoc(item);setDirty(true);lastChange.current=0;
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
    api<Catalogue>('/catalog','GET',undefined,controller.signal).then(value=>{if(!controller.signal.aborted)setCatalogue(value);}).catch(error=>{if(!controller.signal.aborted)setError(errorMessage(error,'Не удалось обновить каталог'));});
    return()=>controller.abort();
  },[types]);
  async function saveCurrent():Promise<Quote> {
    if(!doc)throw Error("КП ещё не загружено");
    const issue=numberError(doc);if(issue)throw Error(issue);
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
      const response=await apiFetch("/api"+base+"/export.pdf?mode="+target);
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
      const response=await apiFetch("/api"+base+"/import-file",{method:"POST",body:form});
      const value=await response.json();
      setImported(value);setImportMode("append");setImportPage(0);
    });
  }
  function editImportedLine(id:string,patch:Partial<Line>) {
    setImported(current=>current ? {...current,lines:current.lines.map(line=>line.id===id ? {...line,...patch} : line),
      checks:current.checks?.map(check=>check.line_id===id ? {...check,modified:true} : check)} : null);
  }
  async function upload(file:File|undefined,done:(value:string)=>void,logo=false) {
    if(!file)return;
    try {done(await prepareImage(file,logo));}catch(error){setError(errorMessage(error,"Ошибка изображения"));}
  }
  if(!doc)return <section className="quotation-editor"><h2>Редактор КП</h2>{busy ? <p role="status">Загрузка КП…</p> : <><p role="alert">{error}</p><button onClick={()=>void work(load)}>Повторить загрузку КП</button></>}</section>;
  const calculated=prices ?? doc;
  const visiblePrices=calculated[mode];
  const rowPrices=new Map(visiblePrices.lines.map(line=>[line.id,line]));
  const unpriced=doc.lines.filter(line=>decimalValue(line.unit_price)===0).length;
  const productOptions=(line:Line)=>{
    const options=(line.source_ids.length&&line.type_id!==null?productPickers.byType.get(line.unit+':'+line.type_id):productPickers.byUnit.get(line.unit))??[{value:'',label:'Без привязки к товару'}];
    const selected=line.product_id?productPickers.byId.get(line.product_id):null;
    return selected?.disabled?[...options,selected]:options;
  };
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
    <div className="quotation-heading"><div><div className="eyebrow">КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ</div><h2>КП № {doc.number}</h2><p>{projectName} · {tools.find(tool=>tool.id===quoteTool)?.label}</p></div><div className="quotation-switch">
      <label>Цены<SearchSelect aria-label="Цены предпросмотра КП" value={mode} onChange={event=>setMode(event.target.value as "client"|"partner")}><option value="partner">Партнёр — со скидками</option><option value="client">Клиент — без скидок</option></SearchSelect></label>
    </div></div>
    <input ref={importInput} hidden type="file" aria-label="Файл внешнего КП" accept=".pdf,.xlsx,.xls,.xlsm,.docx,.csv" disabled={busy} onChange={event=>{void importFile(event.target.files?.[0]);event.target.value='';}}/>
    {!newProduct && !imported && !attachOpen && error && <p className="catalog-error" role="alert">{error}</p>}
    {message && <p className="catalog-success" role="status">{message}</p>}
    {!standalone&&doc.lines.some(line=>line.source_key)&&<p className="hint">Количество связанных позиций обновляется из плана при открытии, сохранении и экспорте КП. Галочка «Вручную» сохраняет заданное вами количество.</p>}
    <div className="quotation-status" role="status">{busy ? "Сохранение…" : dirty ? "Есть несохранённые изменения" : "КП сохранено"}{calculating ? " · Пересчёт итогов…" : ""}</div>
    <div className="quotation-totals">
      {(["client","partner"] as const).map(target=><article key={target}><small>{target==="client" ? "Для клиента · без скидок" : "Для партнёра · со скидками"}</small>
        {!numericError&&Object.entries(calculated[target].totals).map(([code,total])=><strong key={code}>{amount(total.total,code)}</strong>)}
        {numericError&&<span>Проверьте числовые поля КП</span>}{!numericError&&!Object.keys(calculated[target].totals).length && <strong>0,00 ₽</strong>}
        {!numericError&&target==="partner" && Object.entries(calculated.partner.totals).map(([code,total])=><span key={code}>Скидка: {amount(total.discount,code)}</span>)}
      </article>)}
    </div>

    {!preview ? <>
      <fieldset disabled={busy} className="quotation-fields">
        <label>Номер КП<input aria-label="Номер КП" maxLength={100} value={doc.number} onChange={e=>change(q=>({...q,number:e.target.value}))}/></label>
        <label>Дата<input aria-label="Дата КП" type="date" value={doc.date} onChange={e=>change(q=>({...q,date:e.target.value}))}/></label>
        <label>Срок действия, дней<input aria-label="Срок действия КП" type="number" min="1" max="365" value={doc.valid_days} onChange={e=>change(q=>({...q,valid_days:Number(e.target.value)}))}/></label>
        <label>Общая скидка, %<DecimalInput aria-label="Общая скидка КП"  min="0" max="100" step=".01" value={doc.global_discount} onChange={e=>change(q=>({...q,global_discount:e.target.value}))}/></label>
        <label>Кому<input aria-label="Клиент КП" value={doc.customer} onChange={e=>change(q=>({...q,customer:e.target.value}))}/></label>
        <label>Контакт клиента<input aria-label="Контакт клиента КП" value={doc.contact} onChange={e=>change(q=>({...q,contact:e.target.value}))}/></label>
      </fieldset>
      <p className="hint">Пустая скидка строки использует общую. Индивидуальная скидка, включая 0%, заменяет общую. В клиентском PDF все скидки отключены.</p>
      {unpriced>0 && <p className="warning">Позиций без цены: {unpriced}. Выберите товар или укажите цену перед отправкой КП.</p>}
      {quoteTool==='positions'&&<div className="quotation-position-tools"><label className="quotation-line-search">Поиск в позициях<input type="search" aria-label="Поиск позиций КП" placeholder="Название, артикул, помещение, комментарий…" value={lineQuery} onChange={event=>{setLineQuery(event.target.value);setLinePage(0);}}/></label>
        <label className="quotation-group-filter">Группа / помещение<SearchSelect aria-label="Группа позиций КП" value={roomFilter===null?'all':roomFilter===''?'none':'group:'+roomFilter} onChange={event=>{setEditingLineId(null);const value=event.target.value;setRoomFilter(value==='all'?null:value==='none'?'':value.slice(6));setLinePage(0);}}><option value="all">Все помещения</option><option value="none">Без помещения</option>{roomChoices.map(room=><option value={'group:'+room} key={room}>{room}</option>)}</SearchSelect></label>
        <ToolButton icon="layers" disabled={busy||!grouped} onClick={groupLines}>Сгруппировать</ToolButton>
        <label>Строк на странице<SearchSelect aria-label="Строк на странице КП" value={linePageSize} onChange={event=>{setLinePageSize(Number(event.target.value));setLinePage(0);}}>{[25,50,100,200,500].map(size=><option key={size} value={size}>{size}</option>)}</SearchSelect></label>
      </div>}
      {quoteTool==='positions'&&<>
      <div ref={tableWrap} className="quotation-table-wrap"><table className="quotation-table"><thead><tr><th>Позиция / товар</th><th>Кол-во</th><th>Ед.</th><th>Цена</th><th>Валюта</th><th>Скидка, %</th><th>Сумма</th><th></th></tr></thead>
        <tbody>{visibleLines.map(({line,index},visibleIndex)=>{
          const group=normalizeRoom(line.room),showGroup=grouped&&(visibleIndex===0||normalizeRoom(visibleLines[visibleIndex-1].line.room)!==group);
          return <Fragment key={line.id}>{showGroup&&<tr data-quote-group={group}><th colSpan={8}><span>{group||'Без помещения'}</span></th></tr>}
        <tr data-quote-line={line.id} className={(activeLineId===line.id?'quote-row-active ':'')+(draggedId===line.id?'quote-row-dragging ':'')+(dropTarget?.id===line.id?(dropTarget.after?'quote-drop-after':'quote-drop-before'):'')}
          onFocusCapture={()=>{setActiveLineId(line.id);setEditingLineId(line.id);}} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setEditingLineId(null);}} data-image-target onDragOver={event=>rowDragOver(event,line.id)} onDrop={event=>rowDrop(event,line.id)} onPasteCapture={event=>imagePaste(event,file=>void upload(file,image=>editLine(line.id,{image})))}>
          <td><div className="quotation-line-name"><button type="button" className="quote-drag-handle" draggable={!busy} disabled={busy} aria-label={'Перетащить строку '+(index+1)} title="Перетащите для перемещения. Ctrl+↑ / Ctrl+↓ — на одну позицию."
            onDragStart={event=>{if(busy){event.preventDefault();return;}event.stopPropagation();dragSource.current=line.id;setDraggedId(line.id);setActiveLineId(line.id);event.dataTransfer.effectAllowed='move';event.dataTransfer.setData(QUOTE_LINE_DRAG,JSON.stringify({base,id:line.id}));}}
            onDragEnd={endDrag} onKeyDown={event=>{if((event.ctrlKey||event.metaKey)&&['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();const target=doc.lines[index+(event.key==='ArrowUp'?-1:1)];if(target){moveLine(line.id,target.id,event.key==='ArrowDown');setLinePage(Math.floor((index+(event.key==='ArrowUp'?-1:1))/linePageSize));requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>(`[data-quote-line="${CSS.escape(line.id)}"] .quote-drag-handle`)?.focus());}}}}><span aria-hidden="true">⠿</span><small>{index+1}</small></button>
            {line.image&&<img src={line.image} alt=""/>}<div><input className="quotation-name-input" title={[line.name,line.sku].filter(Boolean).join(" · ")} aria-label={"Наименование строки "+(index+1)} value={line.name} disabled={busy} onChange={e=>editLine(line.id,{name:e.target.value})}/></div></div>
            <div className="quotation-row-meta"><SearchInput aria-label={"Помещение строки "+(index+1)} placeholder="Без помещения" maxLength={500} options={roomChoices} value={group} disabled={busy} onChange={room=>editLine(line.id,{room})}/>
              <textarea className="quotation-row-comment" aria-label={"Комментарий строки "+(index+1)} placeholder="Комментарий" rows={1} maxLength={2000} title={line.comment||''} value={line.comment??''} disabled={busy} onChange={event=>editLine(line.id,{comment:event.target.value})}/></div>
            <details className="quotation-row-details" open={expandedRows.has(line.id)} onToggle={event=>{const open=event.currentTarget.open;if(open!==expandedRows.has(line.id))expandRow(line.id,open);}}><summary aria-label={"Свойства строки "+(index+1)} title="Товар, фото и свойства">Товар, фото и свойства{line.sku?' · '+line.sku:''}{line.source_ids.length?' · На плане: '+line.source_ids.length:''}</summary>
            {expandedRows.has(line.id)&&<>
            <SearchSelect aria-label={"Товар строки "+(index+1)} value={line.product_id??''} disabled={busy} dataOptions={productOptions(line)} onChange={event=>void bind(line.id,event.target.value)}/>
            <div className="quotation-inline-actions"><button type="button" disabled={busy} onClick={()=>{setError("");setNewProduct({lineId:line.id,name:line.name,manufacturer:line.manufacturer,sku:line.sku,typeId:line.type_id?String(line.type_id):"",price:line.unit_price,currency:line.currency,image:line.image});}}>＋ Товар в базу</button>
              <ImageField label={"Фото строки "+(index+1)} value={line.image} disabled={busy} onChange={image=>editLine(line.id,{image})}/>
            </div>
            <input aria-label={"Артикул строки "+(index+1)} placeholder="Артикул" value={line.sku} disabled={busy} onChange={e=>editLine(line.id,{sku:e.target.value})}/><SearchInput aria-label={"Производитель строки "+(index+1)} placeholder="Производитель" options={catalogue.manufacturers.map(m=>m.name)} value={line.manufacturer} disabled={busy} onChange={manufacturer=>editLine(line.id,{manufacturer})}/>
            <label>Номенклатура<SearchSelect aria-label={"Номенклатура строки "+(index+1)} disabled={busy||Boolean(line.source_ids.length)} value={line.type_id??''} onChange={event=>{const type=types.find(type=>type.id===Number(event.target.value));editLine(line.id,{type_id:type?.id??null,product_id:null});}}><option value="">Без категории</option>{types.filter(type=>type.active&&type.unit===line.unit).map(type=><option key={type.id} value={type.id}>{type.category} · {type.name}</option>)}</SearchSelect></label>
            <ToolButton icon="copy" type="button" disabled={busy} aria-label={"Дублировать строку "+(index+1)+" в КП"} onClick={()=>appendLine({...line,id:crypto.randomUUID(),source_key:'',source_ids:[],quantity_override:null,calculated_quantity:null,overrides:[]})}>Ручная копия строки</ToolButton>
            <ToolButton icon="list" type="button" disabled={busy} aria-label={'Переместить строку '+(index+1)+' на номер'} onClick={()=>moveToPosition(line.id)}>Переместить на №…</ToolButton>
            <textarea aria-label={"Описание строки "+(index+1)} placeholder="Описание товара" value={line.description} disabled={busy} onChange={e=>editLine(line.id,{description:e.target.value})}/>
            </>}</details>
          </td>
          <td><DecimalInput aria-label={"Количество строки "+(index+1)}  min=".001" max="1000000" step=".001" value={line.quantity} disabled={busy || (Boolean(line.source_key)&&line.quantity_override==null)} onChange={e=>editLine(line.id,{quantity:e.target.value,...(line.source_key?{quantity_override:e.target.value}:{})})}/>{line.source_key&&<><label className="manual-quantity"><input type="checkbox" aria-label={"Ручное количество строки "+(index+1)} checked={line.quantity_override!=null} onChange={event=>editLine(line.id,event.target.checked?{calculated_quantity:line.calculated_quantity??line.quantity,quantity_override:line.quantity}:{quantity_override:null,quantity:line.calculated_quantity??line.quantity})}/>Вручную</label><small>По плану: {line.calculated_quantity??line.quantity}</small></>}</td>
          <td><SearchSelect aria-label={"Единица строки "+(index+1)} value={line.unit} disabled={busy || Boolean(line.source_key) || Boolean(line.product_id)} onChange={e=>editLine(line.id,{unit:e.target.value as "шт"|"м"})}><option value="шт">шт</option><option value="м">м</option></SearchSelect></td>
          <td><DecimalInput aria-label={"Цена строки "+(index+1)}  min="0" max="1000000000" step=".01" value={line.unit_price} disabled={busy} onChange={e=>editLine(line.id,{unit_price:e.target.value})}/></td>
          <td><input aria-label={"Валюта строки "+(index+1)} maxLength={3} value={line.currency} disabled={busy} onChange={e=>editLine(line.id,{currency:e.target.value.toUpperCase()})}/></td>
          <td><DecimalInput required={false} aria-label={"Скидка строки "+(index+1)}  min="0" max="100" step=".01" placeholder="Общая" value={line.discount ?? ""} disabled={busy} onChange={e=>editLine(line.id,{discount:e.target.value==="" ? null : e.target.value})}/><small>{line.discount===null ? "По общей" : "Индивидуальная"}</small></td>
          <td className="quotation-row-total">{calculating ? "…" : numericError ? "—" : rowPrices.has(line.id) ? amount(rowPrices.get(line.id)!.total,line.currency) : "—"}</td>
          <td><button aria-label={"Удалить строку "+(index+1)+" из КП"} title="Убрать только из КП" disabled={busy} onClick={()=>change(q=>({...q,lines:q.lines.filter(item=>item.id!==line.id)}),true)}>×</button></td>
        </tr></Fragment>;})}</tbody></table></div>
      <div className="quotation-pagination" aria-label="Страницы позиций КП"><span>{filteredLines.length?activePage*linePageSize+1:0}–{Math.min((activePage+1)*linePageSize,filteredLines.length)} из {filteredLines.length}{lineQuery?' · всего '+doc.lines.length:''}</span><button type="button" disabled={activePage<=0} onClick={()=>setLinePage(activePage-1)}>Назад</button><span>Страница {activePage+1} из {linePages}</span><button type="button" disabled={activePage>=linePages-1} onClick={()=>setLinePage(activePage+1)}>Далее</button></div>
      {!filteredLines.length&&doc.lines.length>0&&<p className="hint">Подходящих позиций нет. Измените поиск.</p>}
      </>}
      {!doc.lines.length && <p className="hint">Пока нет позиций. Добавьте строку вручную или импортируйте расчёт проекта.</p>}

      {quoteTool==='catalog'&&<section className="quote-catalog-panel" aria-label="Товары для КП"><h3>Добавить товар из базы</h3><input aria-label="Поиск товаров для КП" type="search" placeholder="Название, артикул, производитель…" value={productSearch} onChange={event=>{setProductSearch(event.target.value);setCatalogLimit(100);}}/>
        <div className="quote-catalog-products">{filteredProducts.slice(0,catalogLimit).map(product=><article key={product.id}><strong>{product.name}</strong><small>{product.manufacturer} · {product.sku}</small><b>{amount(product.price,product.currency)} / {product.unit}</b><ToolButton icon="plus" disabled={busy} onClick={()=>{appendLine({...newLine(),name:product.name,sku:product.sku,manufacturer:product.manufacturer,product_id:product.id,type_id:product.type_id,unit:product.unit as 'шт'|'м',unit_price:String(product.price),currency:product.currency,image:product.parameters?.image??'',description:product.parameters?.description??''});}}>Добавить в КП</ToolButton></article>)}</div>
        {filteredProducts.length>catalogLimit&&<button type="button" onClick={()=>setCatalogLimit(value=>value+100)}>Показать ещё {Math.min(100,filteredProducts.length-catalogLimit)} товаров</button>}
        <p className="hint">Найдено товаров: {filteredProducts.length}</p>
      </section>}
      <fieldset disabled={busy} className="quotation-notes"><label>Условия предложения<textarea aria-label="Условия КП" rows={4} value={doc.terms} onChange={e=>change(q=>({...q,terms:e.target.value}))}/></label></fieldset>
      <details open className="quotation-brand"><summary>Оформление и реквизиты</summary><fieldset disabled={busy} className="quotation-fields">
        {([["title","Заголовок КП"],["seller","Компания"],["city","Город"],["phone","Телефон"],["email","E-mail"],["website","Сайт"],["address","Адрес"],["slogan","Слоган"],["tax_note","Примечание о НДС"]] as const).map(([key,label])=><label key={key}>{label}<input aria-label={label+" КП"} value={doc[key]} onChange={e=>change(q=>({...q,[key]:e.target.value}))}/></label>)}
        <ImageField label="Логотип КП" value={doc.logo} disabled={busy} logo onChange={logo=>change(q=>({...q,logo}))}/>
        {doc.benefits.map((benefit,index)=><label key={index}>Преимущество {index+1}<input aria-label={"Заголовок преимущества "+(index+1)} value={benefit.title} onChange={e=>change(q=>({...q,benefits:q.benefits.map((item,i)=>i===index ? {...item,title:e.target.value} : item)}))}/><input aria-label={"Текст преимущества "+(index+1)} value={benefit.text} onChange={e=>change(q=>({...q,benefits:q.benefits.map((item,i)=>i===index ? {...item,text:e.target.value} : item)}))}/></label>)}
        <button onClick={()=>change(q=>({...q,benefits:[]}))}>Убрать блок преимуществ</button>
      </fieldset><p className="hint">Примечание о НДС и гарантийные условия укажите в соответствии с вашими ценами и товарами.</p></details>
    </> : <QuotationPreview base={base} document={doc} mode={mode}/>}
    </div>
    <div className="quotation-dock" role="toolbar" aria-label="Действия с позициями КП">
      <ToolButton icon="plus" aria-label="＋ Добавить строку КП" disabled={busy||doc.lines.length>=5000} onClick={insertNearCurrent}>Добавить строку КП</ToolButton>
      <ToolButton icon="catalog" disabled={busy} onClick={()=>chooseQuoteTool('catalog')}>Добавить из каталога</ToolButton>
      <span className="quotation-insert-hint">{insertionAnchor?'После позиции '+(insertionAnchor.index+1):'В конец списка'}</span>
      <ToolButton icon="undo" disabled={busy||!history.current.length} onClick={()=>undo()}>Отменить правку КП</ToolButton><ToolButton icon="redo" disabled={busy||!future.current.length} onClick={()=>undo(true)}>Вернуть правку КП</ToolButton>
      <ToolButton icon="save" disabled={busy||!dirty} onClick={()=>void work(async()=>{await saveCurrent();setMessage('КП сохранено');})}>Сохранить изменения КП</ToolButton>
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
          <label>Цена<DecimalInput aria-label="Цена нового товара КП" required  min="0" max="1000000000" step=".01" value={newProduct.price} onChange={e=>setNewProduct({...newProduct,price:e.target.value})}/></label>
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
          <td><DecimalInput aria-label={"Импорт: количество "+(index+1)}  min=".001" step=".001" value={line.quantity} onChange={e=>editImportedLine(line.id,{quantity:e.target.value})}/></td>
          <td><SearchSelect aria-label={"Импорт: единица "+(index+1)} value={line.unit} onChange={e=>editImportedLine(line.id,{unit:e.target.value as Line["unit"]})}><option>шт</option><option>м</option></SearchSelect></td>
          <td><DecimalInput aria-label={"Импорт: цена "+(index+1)}  min="0" step=".01" value={line.unit_price} onChange={e=>editImportedLine(line.id,{unit_price:e.target.value})}/></td>
          <td><DecimalInput required={false} aria-label={"Импорт: скидка "+(index+1)}  min="0" max="100" step=".01" placeholder="Нет" value={line.discount??""} onChange={e=>editImportedLine(line.id,{discount:e.target.value||null})}/></td>
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
