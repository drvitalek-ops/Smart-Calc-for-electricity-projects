import {memo} from 'react';
import {glyphs,symbolAppearance,symbolInk} from './planSymbols';
import type {PlanKind} from './planDomain';
type Parameters=Record<string,unknown>;
export const PlanSymbol=memo(function PlanSymbol({parameters={},color='#38bdf8',radius=12,power=false,selected=false,preview=false,kind,shared=false,details=true}:{parameters?:Parameters;color?:string;radius?:number;power?:boolean;selected?:boolean;preview?:boolean;kind?:PlanKind;shared?:boolean;details?:boolean}) {
  const r=radius*Number(parameters.plan_size??1),{shape,glyph}=symbolAppearance(parameters,kind,power),icon=String(parameters.plan_icon??''),rotation=Number(parameters.plan_rotation??0),ink=symbolInk(color);
  const points:Record<string,number[][]>={square:[[-1,-1],[1,-1],[1,1],[-1,1]],rectangle:[[-1.6,-.65],[1.6,-.65],[1.6,.65],[-1.6,.65]],diamond:[[0,-1.3],[1.3,0],[0,1.3],[-1.3,0]],triangle:[[0,-1.3],[1.2,1],[-1.2,1]],hexagon:Array.from({length:6},(_,i)=>[Math.cos(i*Math.PI/3),Math.sin(i*Math.PI/3)]),cross:[[-.35,-1],[.35,-1],[.35,-.35],[1,-.35],[1,.35],[.35,.35],[.35,1],[-.35,1],[-.35,.35],[-1,.35],[-1,-.35],[-.35,-.35]]};
  const detail=glyphs[glyph];
  return <g className="editable-plan-symbol" data-glyph={glyph||'custom'}><g transform={`rotate(${rotation})`} fill={color} stroke={selected?'#0f172a':'white'} strokeWidth={selected?2.5:1.6} strokeLinejoin="round">
    {points[shape]?shape==='rectangle'?<rect fill={color} className={power&&!preview?'power-supply-symbol':undefined} x={-1.6*r} y={-.65*r} width={3.2*r} height={1.3*r} rx={power?0:r*.13}/>:shape==='square'?<rect x={-r} y={-r} width={2*r} height={2*r} rx={r*.17}/>:<polygon fill={color} points={points[shape].map(([x,y])=>`${x*r},${y*r}`).join(' ')}/>:<circle fill={color} r={r}/>}
    {!details?null:shared&&detail?<use href={'#plan-glyph-'+glyph} transform={`scale(${r})`} color={ink} fill="none" stroke="currentColor" strokeWidth={Math.max(.8/r,.12)}/>:<g fill="none" stroke={ink} strokeWidth={Math.max(.8,r*.12)} strokeLinecap="round" strokeLinejoin="round">
      {detail?.strokes?.map((segment,index)=><polyline key={'s'+index} points={segment.map(([x,y])=>`${x*r},${y*r}`).join(' ')}/>)}
      {detail?.circles?.map(([x,y,size],index)=><circle key={'c'+index} cx={x*r} cy={y*r} r={size*r}/>)}
      {detail?.squares?.map(([x,y,size],index)=><rect key={'q'+index} x={(x-size)*r} y={(y-size)*r} width={size*2*r} height={size*2*r}/>)}
    </g>}

  </g>{icon&&<text className="custom-icon" textAnchor="middle" dominantBaseline="central" fill={ink} fontSize={Math.min(r*1.4,r*3/Math.max(1,icon.length))}>{icon}</text>}</g>;
});

export const GlyphDefinitions=memo(function GlyphDefinitions(){
  return <defs>{Object.entries(glyphs).map(([name,glyph])=><g id={'plan-glyph-'+name} key={name} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
    {glyph.strokes?.map((stroke,index)=><polyline key={'s'+index} points={stroke.map(point=>point.join(',')).join(' ')}/>)}
    {glyph.circles?.map(([x,y,r],index)=><circle key={'c'+index} cx={x} cy={y} r={r}/>)}
    {glyph.squares?.map(([x,y,r],index)=><rect key={'q'+index} x={x-r} y={y-r} width={2*r} height={2*r}/>)}
  </g>)}</defs>;
});
