import {api,errorMessage} from "./errors";
import { useCallback, useEffect, useState } from "react";
import {matchesSearch} from "./SearchSelect";
import QuotationEditor, { type QuotationKind } from "./QuotationEditor";

type Draft={id:number;revision:number;number:string;customer:string;date:string;lines_count:number};
type ProjectQuote={project_id:number;name:string;number:string;customer:string;lines_count:number};
type Listing={standalone:Draft[];projects:ProjectQuote[]};
type Props={types:QuotationKind[];onChanged:()=>Promise<void>;onOpenProject:(id:number)=>Promise<void>;
  onDirtyChange:(value:boolean)=>void;onBusyChange:(value:boolean)=>void};



export default function QuotationHub({types,onChanged,onOpenProject,onDirtyChange,onBusyChange}:Props) {
  const [search,setSearch]=useState("");
  const [listing,setListing]=useState<Listing>({standalone:[],projects:[]});
  const [selectedId,setSelectedId]=useState<number|null>(null),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[error,setError]=useState("");
  const busyChanged=useCallback((value:boolean)=>{setBusy(value);onBusyChange(value);},[onBusyChange]);
  const dirtyChanged=useCallback((value:boolean)=>{setDirty(value);onDirtyChange(value);},[onDirtyChange]);
  async function work(action:()=>Promise<void>) {
    busyChanged(true);setError("");
    try{await action();}catch(error){setError(errorMessage(error,"Ошибка КП"));}
    finally{busyChanged(false);}
  }
  async function load(){setListing(await api<Listing>("/quotations"));}
  useEffect(()=>{if(selectedId===null)void work(load);},[selectedId]);
  useEffect(()=>()=>{onDirtyChange(false);onBusyChange(false);},[onDirtyChange,onBusyChange]);
  if(selectedId!==null)return <QuotationEditor key={selectedId} quotationId={selectedId} projectName="КП без проекта" types={types}
    onChanged={onChanged} onDirtyChange={dirtyChanged} onBusyChange={busyChanged} onAttached={onOpenProject}
    onBrowse={()=>{if(dirty && !confirm("В КП есть несохранённые изменения. Вернуться к списку без сохранения?"))return;setSelectedId(null);}}/>;
  return <section className="quotation-editor quotation-hub" aria-label="Все коммерческие предложения">
    <div className="quotation-heading"><div><div className="eyebrow">КОММЕРЧЕСКИЕ ПРЕДЛОЖЕНИЯ</div><h2>Все КП</h2><p>Создайте КП с нуля и прикрепите к проекту, когда он понадобится.</p></div>
      <div className="quotation-actions"><button className="quote-primary" disabled={busy} onClick={()=>void work(async()=>{
        const created=await api<{id:number}>("/quotations","POST",{});setSelectedId(created.id);
      })}>＋ Создать КП без проекта</button><button disabled={busy} onClick={()=>void work(load)}>Обновить список КП</button></div>
    </div>
    {error && <p role="alert" className="catalog-error">{error}</p>}
    {busy && <p role="status">Загрузка списка КП…</p>}
    <label>Поиск КП<input type="search" aria-label="Поиск КП" placeholder="Номер, клиент или проект…" value={search} onChange={event=>setSearch(event.target.value)}/></label>
    <h3>КП без проекта</h3>
    {!listing.standalone.length && !busy && <p className="hint">Здесь появятся самостоятельно созданные КП. В них доступны товары, фотографии, импорт документов, скидки и оба PDF.</p>}
    <div className="quotation-cards">{listing.standalone.filter(item=>matchesSearch(item.number+" "+item.customer,search)).map(item=><article key={item.id} data-standalone-quote={item.id}>
      <div><strong>КП № {item.number || item.id}</strong><p>{item.customer || "Клиент пока не указан"}</p><small>{item.date} · Позиций: {item.lines_count}</small></div>
      <div><button disabled={busy} onClick={()=>setSelectedId(item.id)} aria-label={"Открыть КП "+item.number}>Открыть</button>
        <button disabled={busy} className="quote-delete" aria-label={"Удалить КП "+item.number} onClick={()=>void work(async()=>{
          if(!confirm("Удалить самостоятельное КП № "+item.number+"? Отменить удаление нельзя."))return;
          await api("/quotations/"+item.id,"DELETE",{revision:item.revision});await load();
        })}>Удалить</button></div>
    </article>)}</div>
    <h3>КП проектов</h3>
    {!listing.projects.length && !busy && <p className="hint">КП, связанные с проектами, появятся здесь после создания или привязки.</p>}
    <div className="quotation-cards">{listing.projects.filter(item=>matchesSearch(item.name+" "+item.number+" "+item.customer,search)).map(item=><article key={item.project_id}>
      <div><strong>{item.name}</strong><p>КП № {item.number} {item.customer ? "· "+item.customer : ""}</p><small>Позиций: {item.lines_count}</small></div>
      <button disabled={busy} onClick={()=>void work(()=>onOpenProject(item.project_id))} aria-label={"Открыть КП проекта "+item.name}>Открыть КП проекта</button>
    </article>)}</div>
  </section>;
}
