import {memo} from 'react';
import {glyphs,symbolAppearance,symbolInk} from './planSymbols';
import type {PlanKind} from './planDomain';
type Parameters=Record<string,unknown>;
export const PlanSymbol=memo(function PlanSymbol({parameters={},color='#38bdf8',radius=8,power=false,selected=false,preview=false,kind,shared=false,details=true}:{parameters?:Parameters;color?:string;radius?:number;power?:boolean;selected?:boolean;preview?:boolean;kind?:PlanKind;shared?:boolean;details?:boolean}) {
  const r=radius*Number(parameters.plan_size??1),{shape,glyph}=symbolAppearance(parameters,kind,power),icon=String(parameters.plan_icon??''),rotation=Number(parameters.plan_rotation??0);
  // Custom filled markers and the red power-supply rectangle remain explicit choices.
  const solid=Boolean(power||parameters.plan_shape||icon),ink=solid?symbolInk(color):color,fill=solid?color:'#ffffff';
  const points:Record<string,number[][]>={square:[[-1,-1],[1,-1],[1,1],[-1,1]],rectangle:[[-1.6,-.65],[1.6,-.65],[1.6,.65],[-1.6,.65]],diamond:[[0,-1.3],[1.3,0],[0,1.3],[-1.3,0]],triangle:[[0,-1.3],[1.2,1],[-1.2,1]],hexagon:Array.from({length:6},(_,i)=>[Math.cos(i*Math.PI/3),Math.sin(i*Math.PI/3)]),cross:[[-.35,-1],[.35,-1],[.35,-.35],[1,-.35],[1,.35],[.35,.35],[.35,1],[-.35,1],[-.35,.35],[-1,.35],[-1,-.35],[-.35,-.35]]};
  const detail=glyphs[glyph],outline={fill,stroke:solid?(selected?'#0f172a':'white'):color,strokeWidth:solid?1.2:1.4,vectorEffect:'non-scaling-stroke' as const};
  return <g className="editable-plan-symbol" data-glyph={glyph||'custom'} data-presentation={solid?'solid':'outline'}><g transform={`rotate(${rotation})`} strokeLinejoin="round">
    {points[shape]?shape==='rectangle'?<rect {...outline} className={power&&!preview?'power-supply-symbol':undefined} x={-1.6*r} y={-.65*r} width={3.2*r} height={1.3*r} rx={power?0:r*.1}/>:shape==='square'?<rect {...outline} x={-r} y={-r} width={2*r} height={2*r} rx={r*.08}/>:<polygon {...outline} points={points[shape].map(([x,y])=>`${x*r},${y*r}`).join(' ')}/>:<circle {...outline} r={r}/>}
    {!details?null:shared&&detail?<use pointerEvents="none" href={'#plan-glyph-'+glyph} transform={`scale(${r})`} color={ink} fill="none" stroke="currentColor" strokeWidth={1.1}/>:<g pointerEvents="none" fill="none" stroke={ink} strokeWidth={1.1} strokeLinecap="round" strokeLinejoin="round">
      {detail?.strokes?.map((segment,index)=><polyline key={'s'+index} vectorEffect="non-scaling-stroke" points={segment.map(([x,y])=>`${x*r},${y*r}`).join(' ')}/>)}
      {detail?.circles?.map(([x,y,size],index)=><circle key={'c'+index} vectorEffect="non-scaling-stroke" cx={x*r} cy={y*r} r={size*r}/>)}
      {detail?.squares?.map(([x,y,size],index)=><rect key={'q'+index} vectorEffect="non-scaling-stroke" x={(x-size)*r} y={(y-size)*r} width={size*2*r} height={size*2*r}/>)}
    </g>}
  </g>{icon&&details&&<text pointerEvents="none" className="custom-icon" textAnchor="middle" dominantBaseline="central" fill={ink} fontSize={Math.min(r*1.4,r*3/Math.max(1,icon.length))}>{icon}</text>}</g>;
});
export const GlyphDefinitions=memo(function GlyphDefinitions(){
  return <defs>{Object.entries(glyphs).map(([name,glyph])=><g id={'plan-glyph-'+name} key={name} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
    {glyph.strokes?.map((stroke,index)=><polyline vectorEffect="non-scaling-stroke" key={'s'+index} points={stroke.map(point=>point.join(',')).join(' ')}/>)}
    {glyph.circles?.map(([x,y,r],index)=><circle vectorEffect="non-scaling-stroke" key={'c'+index} cx={x} cy={y} r={r}/>)}
    {glyph.squares?.map(([x,y,r],index)=><rect vectorEffect="non-scaling-stroke" key={'q'+index} x={x-r} y={y-r} width={2*r} height={2*r}/>)}
  </g>)}</defs>;
});
