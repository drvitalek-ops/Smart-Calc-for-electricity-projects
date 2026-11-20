import {useEffect,useRef,useState} from 'react';
import './BulkTools.css';
export type WorkIssue={id:string;group:string;title:string;detail:string;severity?:'error'|'warning'|'info';action?:()=>void};
export default function IssueBar({label,issues}:{label:string;issues:WorkIssue[]}){
 const [open,setOpen]=useState(false),[filter,setFilter]=useState(''),[page,setPage]=useState(0),root=useRef<HTMLDetailsElement>(null);
 const groups=[...new Set(issues.map(issue=>issue.group))],filtered=issues.filter(issue=>!filter||issue.group===filter),pages=Math.max(1,Math.ceil(filtered.length/20)),current=Math.min(page,pages-1);
 useEffect(()=>{if(!open)return;const close=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[open]);
 if(!issues.length)return null;
 return <details ref={root} className="work-issue-bar" aria-label={label} data-severity={issues.some(i=>i.severity==='error')?'error':issues.every(i=>i.severity==='info')?'info':'warning'} open={open} onToggle={event=>{if(event.currentTarget.open!==open)setOpen(event.currentTarget.open);}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);root.current?.querySelector('summary')?.focus();}}}>
  <summary><span role="status" aria-live="polite">{label}: {groups.map(group=>group==='Выбраны разные объекты'?group:group+' — '+issues.filter(i=>i.group===group).length).join(', ')}</span></summary>
  <div className="work-issue-panel" aria-label={'Расшифровка: '+label}><p className="hint">Замечания помогают проверить данные. Откройте позицию, чтобы исправить её. Предупреждения не запрещают работу.</p><div className="work-issue-filters">{['',...groups].map(group=><button type="button" key={group} aria-pressed={filter===group} onClick={()=>{setFilter(group);setPage(0);}}>{group||'Все замечания'}</button>)}</div>
   <ul>{filtered.slice(current*20,(current+1)*20).map(issue=><li key={issue.id} data-severity={issue.severity??'warning'}>{issue.action?<button type="button" onClick={()=>{setOpen(false);issue.action?.();}}><strong>{issue.title}</strong><span>{issue.detail}</span></button>:<div><strong>{issue.title}</strong><span>{issue.detail}</span></div>}</li>)}</ul>
   <nav aria-label={'Страницы: '+label}><button type="button" disabled={!current} onClick={()=>setPage(current-1)}>Назад</button><span>{current+1} / {pages} · замечаний: {filtered.length}</span><button type="button" disabled={current>=pages-1} onClick={()=>setPage(current+1)}>Далее</button></nav>
  </div>
 </details>;
}
