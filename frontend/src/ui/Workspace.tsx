import type {ReactNode} from 'react';
import {ActionIcon} from '../ToolRail';
import {PlanSymbol} from '../PlanAppearance';
import {isPowerSupply,type PlanKind} from '../planDomain';

export function WorkspaceHeading({title,eyebrow,description,icon='folder',actions,className=''}:{title:string;eyebrow:string;description?:string;icon?:string;actions?:ReactNode;className?:string}){
  return <div className={'workspace-heading '+className}>
    <div className="workspace-heading-main"><span className="workspace-heading-icon" aria-hidden="true"><ActionIcon name={icon}/></span><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2>{description&&<p className="workspace-description">{description}</p>}</div></div>
    {actions&&<div className="workspace-heading-actions">{actions}</div>}
  </div>;
}
export function WorkspaceMetric({label,value,icon='list'}:{label:string;value:number;icon?:string}){
  return <article className="workspace-metric"><span className="workspace-metric-icon" aria-hidden="true"><ActionIcon name={icon}/></span><div><small>{label}</small><strong>{value.toLocaleString('ru-RU')}</strong></div></article>;
}
export function EmptyState({icon='folder',children}:{icon?:string;children:ReactNode}){
  return <div className="workspace-empty"><ActionIcon name={icon}/><p>{children}</p></div>;
}
export function KindThumbnail({kind,parameters={},color}:{kind?:PlanKind;parameters?:Record<string,unknown>;color?:string}){
  return <span className="kind-thumbnail" aria-hidden="true">{kind?<svg viewBox="-20 -20 40 40"><PlanSymbol kind={kind} parameters={{...parameters,plan_size:1}} color={color??'#526874'} radius={9} power={isPowerSupply(kind)}/></svg>:<ActionIcon name="objects"/>}</span>;
}

export function PanelHeading({title,caption,icon}:{title:string;caption:string;icon:string}){
  return <div className="panel-heading"><span aria-hidden="true"><ActionIcon name={icon}/></span><div><h3>{title}</h3><small>{caption}</small></div></div>;
}
