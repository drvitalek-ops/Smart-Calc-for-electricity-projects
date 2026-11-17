import {useState} from 'react';
import {ActionIcon,ToolButton} from './ToolRail';
import type {Layer} from './App';
import type {LayerGroup} from './planGroups';
import './LayerTree.css';
type Props={layers:Layer[];groups:ReadonlyMap<number,LayerGroup[]>;active:number|null;busy:boolean;savingGroups:boolean;onSelect:(id:number)=>void;onRename:(layer:Layer)=>void;onToggle:(layer:Layer,key:'visible'|'locked'|'export')=>void;onGroups:(layer:Layer,hidden:string[])=>void;onGroupToggle:(layer:Layer,key:string,visible:boolean)=>void};
export default function LayerTree({layers,groups,active,busy,savingGroups,onSelect,onRename,onToggle,onGroups,onGroupToggle}:Props){
  const [expanded,setExpanded]=useState<ReadonlySet<number>>(new Set());
  function expand(id:number,toggle=false){setExpanded(current=>{const next=new Set(current);if(toggle&&next.has(id))next.delete(id);else next.add(id);return next;});}
  return <div className="layer-tree">{layers.map(layer=>{const entries=groups.get(layer.id)??[],hidden=new Set(layer.hidden_groups??[]),shown=entries.filter(group=>!hidden.has(group.key)).length,disabled=busy&&!savingGroups;
    return <section className="layer-tree-item" key={layer.id}>
      <div className={'layer '+(layer.id===active?'active':'')}>
        <button className="layer-expand" type="button" aria-label={'Группы слоя '+layer.name} aria-expanded={expanded.has(layer.id)} onClick={()=>expand(layer.id,true)}><svg viewBox="0 0 16 16" aria-hidden="true"><path d={expanded.has(layer.id)?'m3 5 5 5 5-5':'m5 3 5 5-5 5'} fill="none" stroke="currentColor" strokeWidth="1.5"/></svg></button>
        <button className="layer-title" title={layer.name} aria-label={"Выбрать слой "+layer.name} onClick={()=>{onSelect(layer.id);expand(layer.id);}}><span>{layer.name}</span></button>
        <ToolButton icon="edit" aria-label={'Переименовать слой '+layer.name} title="Переименовать слой" disabled={busy} onClick={()=>onRename(layer)}/>
        <button title="Видимость" aria-label={(layer.visible?'Скрыть слой ':'Показать слой ')+layer.name} disabled={busy} onClick={()=>onToggle(layer,'visible')}><ActionIcon name={layer.visible?'eye':'eyeOff'}/></button>
        <button title="Блокировка" aria-label={(layer.locked?'Разблокировать слой ':'Заблокировать слой ')+layer.name} disabled={busy} onClick={()=>onToggle(layer,'locked')}><ActionIcon name={layer.locked?'lock':'unlock'}/></button>
        <label className="layer-export" title="Включение в ведомость"><input aria-label={'Экспорт '+layer.name} title="Включение в ведомость" type="checkbox" checked={layer.export} disabled={busy} onChange={()=>onToggle(layer,'export')}/></label>
      </div>
      {expanded.has(layer.id)&&<div className="layer-groups" role="group" aria-label={'Видимость групп: '+layer.name}>
        <div className="layer-group-actions"><button type="button" disabled={disabled||shown===entries.length} onClick={()=>onGroups(layer,[])}>Показать все</button><button type="button" disabled={disabled||shown===0} onClick={()=>onGroups(layer,[...new Set([...hidden,...entries.map(group=>group.key)])])}>Скрыть все</button></div>
        {!layer.visible&&<p className="hint">Слой скрыт. Выбор групп сохранится после его включения.</p>}
        <div className="layer-group-list">{entries.map(group=><label key={group.key} className={hidden.has(group.key)?'group-hidden':''}><input type="checkbox" aria-label={'Показывать '+group.label+' в слое '+layer.name} checked={!hidden.has(group.key)} disabled={disabled} onChange={event=>onGroupToggle(layer,group.key,event.target.checked)}/><i aria-hidden="true" style={{background:group.color}}/><span>{group.label}</span><small>{group.count}</small></label>)}</div>
        <p className="hint">Видно групп: {shown}/{entries.length}. Галочки управляют отображением. Количества и ведомость сохраняются.</p>
      </div>}
    </section>;
  })}</div>;
}
