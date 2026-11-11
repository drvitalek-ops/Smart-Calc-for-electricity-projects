import {memo,useState} from 'react';
import type {Kind} from './App';
import {PlanSymbol} from './PlanAppearance';
import {isPowerSupply} from './planDomain';
export type LegendEntry={key:string;name:string;color:string;symbol:string;kind?:Kind;parameters?:Record<string,unknown>;count:number;posts?:number};
export default memo(function PlanLegend({entries}:{entries:LegendEntry[]}){
  const [expanded,setExpanded]=useState(false);
  return <section className="plan-legend" aria-label="Обозначения плана"><button type="button" className="plan-legend-toggle" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>
    <span className="legend-mini-symbols" aria-hidden="true">{entries.slice(0,3).map(entry=><i key={entry.key} style={{background:entry.color}}/>)}</span><strong>Обозначения</strong><small>{entries.length}</small><span>{expanded?'⌃':'⌄'}</span></button>
    {expanded&&<div className="plan-legend-list">{entries.map(entry=><div key={entry.key} className="plan-legend-entry">
      <svg viewBox="-22 -18 44 36" aria-hidden="true">{entry.posts?<><rect x="-17" y="-10" width="34" height="20" rx="3" fill="none" stroke={entry.color} strokeWidth="2"/>{Array.from({length:Math.min(entry.posts,6)},(_,index)=><circle key={index} cx={-13+(index+.5)*26/(entry.posts??1)} cy="0" r={Math.min(4,10/(entry.posts??1))} fill={entry.color}/>)}</>:entry.kind?.unit==='м'?<line x1="-16" x2="16" y1="0" y2="0" stroke={entry.color} strokeWidth="3" strokeLinecap="round"/>:<PlanSymbol kind={entry.kind} parameters={entry.parameters} color={entry.color} radius={11} power={isPowerSupply(entry.kind)}/>}</svg>
      <span>{entry.name}</span><small>{entry.count}</small>
    </div>)}</div>}
  </section>;
});
