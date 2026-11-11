import {forwardRef,memo,useImperativeHandle} from 'react';
import useRafState from './useRafState';
import {ActionIcon} from './ToolRail';
import type {Point,Page} from './App';
export type PlanStatusHandle={update:(point:Point|null)=>void};
type Props={page?:Page;mode:string;hint:string;count:number;selected:number;snap:boolean;ortho:boolean;onSnap:()=>void;onOrtho:()=>void;length:number|null};
const number=(value:number)=>value.toLocaleString('ru-RU',{maximumFractionDigits:0});
export default memo(forwardRef<PlanStatusHandle,Props>(function PlanStatusBar({page,mode,hint,count,selected,snap,ortho,onSnap,onOrtho,length},ref){
  const [point,setPoint]=useRafState<Point|null>(null);
  useImperativeHandle(ref,()=>({update:setPoint}),[setPoint]);
  const metric=page?.meters_per_point,coordinates=page&&point?(metric?`X ${number(point.x*page.width*metric*1000)} · Y ${number(point.y*page.height*metric*1000)} мм`:`X ${(point.x*100).toFixed(1)} · Y ${(point.y*100).toFixed(1)} %`):'X — · Y —';
  return <div className="plan-status-bar" aria-label="Состояние плана">
    <span className="plan-mode" title={hint}><ActionIcon name={mode.includes('Линия')?'measure':mode.includes('Помещение')?'room':mode.includes('Размещение')?'plus':'cursor'}/>{mode}</span>
    <span className="plan-status-hint">{hint}</span>
    {length!==null&&<span className="plan-live-length">{length.toLocaleString('ru-RU',{maximumFractionDigits:3})} м</span>}
    <span className="plan-coordinate" aria-label="Координаты курсора">{coordinates}</span>
    <span className="plan-object-count">{selected?`Выбрано ${selected}`:`Объектов ${count}`}</span>
    <button type="button" title="Привязка к узлам · F3; Alt временно отключает" aria-label="Привязка к узлам" aria-pressed={snap} onClick={onSnap}><ActionIcon name="magnet"/><span>F3</span></button>
    <button type="button" title="Ортогональный режим · F8; Shift временно включает" aria-label="Ортогональный режим" aria-pressed={ortho} onClick={onOrtho}><ActionIcon name="ortho"/><span>F8</span></button>
  </div>;
}));
