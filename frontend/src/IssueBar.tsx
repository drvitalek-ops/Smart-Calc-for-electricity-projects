import {useEffect,useRef,useState} from 'react';
import {matchesSearch} from './SearchSelect';
import './BulkTools.css';
export type WorkIssueTarget={id:string;label:string;detail:string;action:()=>void};
export type WorkIssue={id:string;group:string;title:string;detail:string;severity?:'error'|'warning'|'info';action?:()=>void;actionLabel?:string;targets?:WorkIssueTarget[]};
function IssuePositions({title,targets,onNavigate}:{title:string;targets:WorkIssueTarget[];onNavigate:(action:()=>void)=>void}){
 const [query,setQuery]=useState(''),[page,setPage]=useState(0);
 const filtered=targets.filter(target=>matchesSearch(target.label+' '+target.detail,query)),pages=Math.max(1,Math.ceil(filtered.length/20)),current=Math.min(page,pages-1);
 return <section className="work-issue-targets" aria-label={'Позиции: '+title}>
  <p>Затронутые позиции: {targets.length}</p>
  {targets.length>10&&<label>Найти позицию<input type="search" aria-label={'Поиск позиций: '+title} value={query} placeholder="Номер, название, категория, помещение…" onChange={event=>{setQuery(event.target.value);setPage(0);}}/></label>}
  <ul>{filtered.slice(current*20,(current+1)*20).map(target=><li key={target.id}><button type="button" onClick={()=>onNavigate(target.action)}><strong>{target.label}</strong><span>{target.detail}</span></button></li>)}</ul>
  {!filtered.length&&<p>Позиции по запросу не найдены.</p>}
  {pages>1&&<nav aria-label={'Страницы позиций: '+title}><button type="button" disabled={!current} onClick={()=>setPage(current-1)}>Назад</button><span>{current+1} / {pages} · позиций: {filtered.length}</span><button type="button" disabled={current>=pages-1} onClick={()=>setPage(current+1)}>Далее</button></nav>}
 </section>;
}
export default function IssueBar({label,issues}:{label:string;issues:WorkIssue[]}){
 const [open,setOpen]=useState(false),[filter,setFilter]=useState(''),[page,setPage]=useState(0),root=useRef<HTMLDetailsElement>(null);
 const groups=[...new Set(issues.map(issue=>issue.group))],filtered=issues.filter(issue=>!filter||issue.group===filter),pages=Math.max(1,Math.ceil(filtered.length/20)),current=Math.min(page,pages-1);
 useEffect(()=>{if(!open)return;const close=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[open]);
 if(!issues.length)return null;
 return <details ref={root} className="work-issue-bar" aria-label={label} data-severity={issues.some(i=>i.severity==='error')?'error':issues.every(i=>i.severity==='info')?'info':'warning'} open={open} onToggle={event=>{if(event.currentTarget.open!==open)setOpen(event.currentTarget.open);}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);root.current?.querySelector('summary')?.focus();}}}>
  <summary><span role="status" aria-live="polite">{label}: {groups.map(group=>group==='Выбраны разные объекты'?group:group+' — '+issues.filter(i=>i.group===group).length).join(', ')}</span></summary>
  <div className="work-issue-panel" aria-label={'Расшифровка: '+label}><p className="hint">Замечания помогают проверить данные. Откройте позицию, чтобы исправить её. Предупреждения не запрещают работу.</p><div className="work-issue-filters">{['',...groups].map(group=><button type="button" key={group} aria-pressed={filter===group} onClick={()=>{setFilter(group);setPage(0);}}>{group||'Все замечания'}</button>)}</div>
   <ul>{filtered.slice(current*20,(current+1)*20).map(issue=><li key={issue.id} data-severity={issue.severity??'warning'}>{issue.action?<button type="button" onClick={()=>{setOpen(false);issue.action?.();}}><strong>{issue.title}</strong><span>{issue.detail}</span><small className="work-issue-action">{issue.actionLabel??'Перейти к исправлению'}</small></button>:<div><strong>{issue.title}</strong><span>{issue.detail}</span></div>}{Boolean(issue.targets?.length)&&<IssuePositions title={issue.title} targets={issue.targets!} onNavigate={action=>{setOpen(false);action();}}/>}</li>)}</ul>
   <nav aria-label={'Страницы: '+label}><button type="button" disabled={!current} onClick={()=>setPage(current-1)}>Назад</button><span>{current+1} / {pages} · замечаний: {filtered.length}</span><button type="button" disabled={current>=pages-1} onClick={()=>setPage(current+1)}>Далее</button></nav>
  </div>
 </details>;
}
