import {PLAN_RADIUS} from './planSymbols';
import {memo,useMemo} from 'react';
import {visiblePlanLabels,planLabel} from './planLabels';
import type {Item,Kind,Page,Layer,Point} from './App';
import {PlanSymbol,PointMarker,GlyphDefinitions} from './PlanAppearance';
import {isLedStrip,isPowerSupply,isTrack} from './planDomain';

type Handlers={
  onContextMenu:(item:Item,event:React.MouseEvent<SVGGElement>)=>void;
  onDoubleClick:(item:Item)=>void;
  onPointerDown:(item:Item,event:React.PointerEvent<SVGGElement>)=>void;
  onNodeDrag:(item:Item,index:number,point:Point,event:React.PointerEvent<SVGElement>)=>void;
};
type Props=Handlers&{elements:Item[];types:ReadonlyMap<number,Kind>;pages:ReadonlyMap<number,Page>;layers:ReadonlyMap<number,Layer>;
  selection:ReadonlySet<number>;draft:Item|null;scale:number;labels:boolean;linking:boolean;picked:ReadonlySet<number>;busy:boolean;aspect:number;dense:boolean;adaptive:boolean;pixelScale:number;grip:number};
type ObjectProps=Handlers&{item:Item;kind?:Kind;page?:Page;selected:boolean;locked:boolean;scale:number;labels:boolean;linking:boolean;picked:boolean;busy:boolean;aspect:number;grip:number;simplified:boolean};
const transformPoint=(point:Point,page?:Page)=>({x:.5+(point.x-.5)*(page?.scale??1)+(page?.offset_x??0),y:.5+(point.y-.5)*(page?.scale??1)+(page?.offset_y??0)});
function angle(points:Point[],index:number,aspect:number){const a=points[index===points.length-1?index-1:index],b=points[index===points.length-1?index:index+1];return Math.atan2((b.y-a.y)/aspect,b.x-a.x)*180/Math.PI;}

const PlanObject=memo(function PlanObject({item,kind,page,selected,locked,scale,labels,linking,picked,busy,aspect,grip,simplified,onContextMenu,onDoubleClick,onPointerDown,onNodeDrag}:ObjectProps){
  const points=item.geometry?.points??[],transformed=points.map(point=>transformPoint(point,page));
  const opacity=selected?1:page?.opacity??1,color=picked?'#2563eb':String(item.parameters.plan_color??kind?.color??'#64748b');
  const target=linking&&isLedStrip(kind),label=planLabel(item,kind,!selected);
  const labelProps={className:'object-label',fontSize:Number(item.parameters.plan_label_size??7)*2,fill:String(item.parameters.plan_label_color??'#0f172a'),stroke:'white',strokeWidth:3,paintOrder:'stroke' as const};
  const showLabel=labels&&item.parameters.plan_label_visible!==false;
  const handlers={onContextMenu:(event:React.MouseEvent<SVGGElement>)=>onContextMenu(item,event),
    onDoubleClick:(event:React.MouseEvent<SVGGElement>)=>{event.preventDefault();event.stopPropagation();onDoubleClick(item);},
    onPointerDown:(event:React.PointerEvent<SVGGElement>)=>{if(event.button!==0)return;event.preventDefault();event.stopPropagation();onPointerDown(item,event);}};
  const targetClass=target?'supply-strip-target '+(picked?'supply-strip-picked':''):'';
  if(points.length>1){
    const coords=transformed.map(p=>`${p.x*1000},${p.y*1000}`).join(' '),anchor=transformed[0],editable=selected&&!linking&&!locked,track=isTrack(kind);
    return <g data-element-id={item.id} className={(selected?'selected-line-object ':'')+targetClass} opacity={opacity} {...handlers}>
      <polyline className={target?'supply-strip-hit':'line-hit-area'} points={coords} fill="none" stroke="transparent" strokeWidth={24} vectorEffect="non-scaling-stroke"/>
      {selected&&!linking&&<polyline className="selection-line-halo" points={coords} fill="none" stroke="#0284c7" strokeWidth={18} strokeOpacity={.45} vectorEffect="non-scaling-stroke"/>}
      <polyline points={coords} fill="none" stroke={color} strokeWidth={picked?6:Number(item.parameters.line_width??2)*1.5} strokeDasharray={item.parameters.line_dash==='dashed'?'12 8':item.parameters.line_dash==='dotted'?'2 7':undefined} vectorEffect="non-scaling-stroke"/>
      {track&&transformed.map((point,index)=><path key={'arrow'+index} className="track-arrow" d={`M ${-10*scale} ${-6*scale} L ${10*scale} 0 L ${-10*scale} ${6*scale} Z`}
        transform={`translate(${point.x*1000} ${point.y*1000}) scale(1,${aspect}) rotate(${angle(transformed,index,aspect)})`} fill={color} stroke="white" strokeWidth={1} vectorEffect="non-scaling-stroke"/>)}
      {editable&&transformed.map((point,index)=><g key={index} transform={`translate(${point.x*1000} ${point.y*1000}) scale(1,${aspect})`}>
        <rect className="line-node-hit" x={-grip} y={-grip} width={2*grip} height={2*grip} fill="transparent" onPointerDown={event=>{if(event.button!==0||busy)return;event.stopPropagation();onNodeDrag(item,index,point,event);}}/>
        <rect className="line-node" x={-grip/2} y={-grip/2} width={grip} height={grip} fill="white" stroke="#0284c7" strokeWidth={1.5} vectorEffect="non-scaling-stroke" pointerEvents="none"/>
      </g>)}
      {Boolean(item.parameters.plan_icon||item.parameters.plan_shape)&&<g transform={`translate(${anchor.x*1000},${anchor.y*1000}) scale(1,${aspect})`}><PlanSymbol parameters={item.parameters} color={color} radius={12*scale}/></g>}
      {showLabel&&<g transform={`translate(${anchor.x*1000},${anchor.y*1000}) scale(1,${aspect})`}><text {...labelProps} x={18*scale} y={-10*scale}>{label} · {String(item.parameters.length)} м</text></g>}
    </g>;
  }
  const marker=transformPoint(item,page);
  return <g data-element-id={item.id} className={(selected?'selected-point-object ':'')+targetClass} opacity={opacity} transform={`translate(${marker.x*1000},${marker.y*1000}) scale(1,${aspect})`} {...handlers}>
    <title>{planLabel(item,kind)}{locked?' · Слой заблокирован':''}</title>
    <PointMarker details={!simplified} shared kind={kind} parameters={item.parameters} scale={scale} powerSupply={isPowerSupply(kind)} color={color} selected={linking?picked:selected} icon={String(item.parameters.plan_icon??'').trim()}/>
    {showLabel&&<text {...labelProps} x={(isPowerSupply(kind)?19:12)*scale*Number(item.parameters.plan_size??1)} y={5}>{label}</text>}
  </g>;
});
export default memo(function PlanScene({elements,types,pages,layers,selection,draft,scale,labels,linking,picked,busy,aspect,dense,adaptive,pixelScale,grip,...handlers}:Props){
  const labelIds=useMemo(()=>adaptive&&labels?visiblePlanLabels(elements.map(item=>draft?.id===item.id?draft:item),types,pages,selection,scale,aspect,pixelScale):null,[elements,draft,types,pages,selection,scale,aspect,pixelScale,adaptive,labels]);
  return <><GlyphDefinitions/>{elements.map(original=>{const item=draft?.id===original.id?draft:original;return <PlanObject key={item.id} item={item} kind={types.get(item.type_id)} page={pages.get(item.page_id)} locked={Boolean(layers.get(item.layer_id)?.locked)} selected={selection.has(item.id)} scale={scale} labels={labels&&(!dense||selection.has(item.id))&&(!labelIds||labelIds.has(item.id))} grip={selection.has(item.id)?grip:0} simplified={!selection.has(item.id)&&(dense||adaptive&&PLAN_RADIUS*scale*Number(item.parameters.plan_size??1)*pixelScale<5)} linking={linking} picked={picked.has(item.id)} busy={busy} aspect={aspect} {...handlers}/>;})}</>;
});
