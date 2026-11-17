import {api,errorMessage} from './errors';
import {useCallback,useEffect,useState} from 'react';
import {matchesSearch} from './SearchSelect';
import QuotationEditor,{type QuotationKind} from './QuotationEditor';
import {ActionIcon} from './ToolRail';
import {WorkspaceHeading,WorkspaceMetric,EmptyState} from './ui/Workspace';

type Draft={id:number;revision:number;number:string;customer:string;date:string;lines_count:number};
type ProjectQuote={project_id:number;name:string;number:string;customer:string;lines_count:number};
type Listing={standalone:Draft[];projects:ProjectQuote[]};
type Props={types:QuotationKind[];onChanged:()=>Promise<void>;onOpenProject:(id:number)=>Promise<void>;onDirtyChange:(value:boolean)=>void;onBusyChange:(value:boolean)=>void};

export default function QuotationHub({types,onChanged,onOpenProject,onDirtyChange,onBusyChange}:Props){
  const [search,setSearch]=useState(''),[filter,setFilter]=useState<'all'|'standalone'|'projects'>('all');
  const [listing,setListing]=useState<Listing>({standalone:[],projects:[]});
  const [selectedId,setSelectedId]=useState<number|null>(null),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[error,setError]=useState('');
  const busyChanged=useCallback((value:boolean)=>{setBusy(value);onBusyChange(value);},[onBusyChange]);
  const dirtyChanged=useCallback((value:boolean)=>{setDirty(value);onDirtyChange(value);},[onDirtyChange]);
  async function work(action:()=>Promise<void>){busyChanged(true);setError('');try{await action();}catch(e){setError(errorMessage(e,'Ошибка КП'));}finally{busyChanged(false);}}
  async function load(){setListing(await api<Listing>('/quotations'));}
  useEffect(()=>{if(selectedId===null)void work(load);},[selectedId]);
  useEffect(()=>()=>{onDirtyChange(false);onBusyChange(false);},[onDirtyChange,onBusyChange]);
  if(selectedId!==null)return <QuotationEditor key={selectedId} quotationId={selectedId} projectName="КП без проекта" types={types} onChanged={onChanged} onDirtyChange={dirtyChanged} onBusyChange={busyChanged} onAttached={onOpenProject} onBrowse={()=>{if(dirty&&!confirm('В КП есть несохранённые изменения. Вернуться к списку без сохранения?'))return;setSelectedId(null);}}/>;
  const standalone=listing.standalone.filter(item=>matchesSearch(item.number+' '+item.customer,search)),projects=listing.projects.filter(item=>matchesSearch(item.name+' '+item.number+' '+item.customer,search));
  const hasMatches=(filter!=='projects'&&standalone.length>0)||(filter!=='standalone'&&projects.length>0);
  return <section className="quotation-editor quotation-hub" aria-label="Все коммерческие предложения">
    <WorkspaceHeading title="Все КП" eyebrow="КОММЕРЧЕСКИЕ ПРЕДЛОЖЕНИЯ" description="Предложения по проектам и самостоятельные документы" icon="pdf" actions={<><button className="quote-primary" aria-label="＋ Создать КП без проекта" disabled={busy} onClick={()=>void work(async()=>{const created=await api<{id:number}>('/quotations','POST',{});setSelectedId(created.id);})}><ActionIcon name="plus"/>Создать КП без проекта</button><button disabled={busy} onClick={()=>void work(load)}><ActionIcon name="refresh"/>Обновить список КП</button></>}/>
    {error&&<p role="alert" className="catalog-error">{error}</p>}{busy&&<p role="status">Загрузка списка КП…</p>}
    <div className="workspace-metrics"><WorkspaceMetric label="Всего предложений" value={listing.standalone.length+listing.projects.length} icon="pdf"/><WorkspaceMetric label="Связаны с проектом" value={listing.projects.length} icon="link"/><WorkspaceMetric label="Без проекта" value={listing.standalone.length} icon="edit"/></div>
    <div className="hub-toolbar"><label>Поиск КП<input type="search" aria-label="Поиск КП" placeholder="Номер, клиент или проект…" value={search} onChange={event=>setSearch(event.target.value)}/></label><div className="hub-filters" role="group" aria-label="Отображение КП">{[['all','Все'],['projects','С проектом'],['standalone','Без проекта']].map(([value,label])=><button key={value} type="button" aria-pressed={filter===value} onClick={()=>setFilter(value as typeof filter)}>{label}</button>)}</div></div>
    {filter!=='projects'&&<><h3 className="hub-section-title"><ActionIcon name="edit"/>КП без проекта<small>{standalone.length}</small></h3>
      {!listing.standalone.length&&!busy&&<EmptyState icon="pdf">Здесь появятся самостоятельно созданные КП. В них доступны товары, фотографии, импорт документов, скидки и оба PDF.</EmptyState>}
      <div className="quotation-cards">{standalone.map(item=><article key={item.id} data-standalone-quote={item.id}><span className="quote-card-icon" aria-hidden="true"><ActionIcon name="pdf"/></span><div className="quote-card-copy"><strong>КП № {item.number||item.id}</strong><p>{item.customer||'Клиент пока не указан'}</p><small>{item.date} · Позиций: {item.lines_count}</small></div><div className="quote-card-actions"><button disabled={busy} onClick={()=>setSelectedId(item.id)} aria-label={'Открыть КП '+item.number}>Открыть</button><button disabled={busy} className="quote-delete" title={'Удалить КП '+item.number} aria-label={'Удалить КП '+item.number} onClick={()=>void work(async()=>{if(!confirm('Удалить самостоятельное КП № '+item.number+'? Отменить удаление нельзя.'))return;await api('/quotations/'+item.id,'DELETE',{revision:item.revision});await load();})}><ActionIcon name="trash"/></button></div></article>)}</div>
    </>}
    {filter!=='standalone'&&<><h3 className="hub-section-title"><ActionIcon name="folder"/>КП проектов<small>{projects.length}</small></h3>
      {!listing.projects.length&&!busy&&<EmptyState>КП, связанные с проектами, появятся здесь после создания или привязки.</EmptyState>}
      <div className="quotation-cards">{projects.map(item=><article key={item.project_id}><span className="quote-card-icon" aria-hidden="true"><ActionIcon name="folder"/></span><div className="quote-card-copy"><strong>{item.name}</strong><p>КП № {item.number}{item.customer?' · '+item.customer:''}</p><small>Позиций: {item.lines_count}</small></div><div className="quote-card-actions"><button disabled={busy} onClick={()=>void work(()=>onOpenProject(item.project_id))} aria-label={'Открыть КП проекта '+item.name}>Открыть КП проекта</button></div></article>)}</div>
    </>}
    {search&&!hasMatches&&!busy&&<EmptyState icon="search">По запросу ничего не найдено. Попробуйте другой номер, проект или имя клиента.</EmptyState>}
  </section>;
}
