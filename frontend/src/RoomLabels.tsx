import {memo,useMemo} from 'react';
import type {Page,Point} from './App';
type Room={id:number;name:string;polygon?:Point[]|null};
function inside(p:Point,points:Point[]){let yes=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;}
function distance(p:Point,points:Point[]){if(!inside(p,points))return -1;let best=Infinity;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));best=Math.min(best,Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy));}return best;}
const cache=new WeakMap<Point[],Map<string,{x:number;y:number;size:number;lines:string[];width:number;height:number}>>();
function placement(room:Room,page:Page){const source=room.polygon!;let entries=cache.get(source);if(!entries){entries=new Map();cache.set(source,entries);}const key=JSON.stringify([room.name,page.width,page.height,page.scale,page.offset_x,page.offset_y]);const old=entries.get(key);if(old)return old;
  const aspect=page.width/page.height,points=source.map(p=>({x:(.5+(p.x-.5)*page.scale+page.offset_x)*1000,y:(.5+(p.y-.5)*page.scale+page.offset_y)*1000/aspect}));
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  let center={x:(minX+maxX)/2,y:(minY+maxY)/2},best=distance(center,points),step=Math.max(maxX-minX,maxY-minY)/20;
  if(step<=0)return null;
  for(let x=minX;x<=maxX;x+=step)for(let y=minY;y<=maxY;y+=step){const score=distance({x,y},points);if(score>best){best=score;center={x,y};}}
  for(let round=0;round<7;round++){step/=2;const current=center;for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){const candidate={x:current.x+dx*step,y:current.y+dy*step},score=distance(candidate,points);if(score>best){best=score;center=candidate;}}}
  const ctx=document.createElement('canvas').getContext('2d')!;let result=null;
  for(let size=14;size>=5;size-=.5){ctx.font=`600 ${size}px "Segoe UI",sans-serif`;let lines:string[]=[''];const limit=Math.min(maxX-minX-8,best*3.3);
    for(const word of room.name.trim().split(/\s+/)){const i=lines.length-1,next=(lines[i]+' '+word).trim();if(lines[i]&&ctx.measureText(next).width>limit)lines.push(word);else lines[i]=next;}
    const width=Math.max(...lines.map(line=>ctx.measureText(line).width))+8,height=lines.length*size*1.2+6;
    const fits=lines.length<=3&&[-.5,0,.5].every(dx=>[-.5,0,.5].every(dy=>inside({x:center.x+width*dx,y:center.y+height*dy},points)));
    if(fits){result={...center,size,lines,width,height};break;}
  }
  if(result){if(entries.size>8)entries.clear();entries.set(key,result);}return result;
}
export default memo(function RoomLabels({rooms,page,editing}:{rooms:Room[];page:Page;editing:number|null}){
  const labels=useMemo(()=>{const occupied:{x:number;y:number;width:number;height:number}[]=[];return rooms.filter(room=>room.id!==editing&&room.polygon?.length).flatMap(room=>{const p=placement(room,page);if(!p||occupied.some(o=>Math.abs(p.x-o.x)<(p.width+o.width)/2&&Math.abs(p.y-o.y)<(p.height+o.height)/2))return [];occupied.push(p);return [{room,p}];});},[rooms,page,editing]);
  return <g className="room-labels" pointerEvents="none">{labels.map(({room,p})=><g key={room.id} data-room-label={room.id} transform={`translate(${p.x} ${p.y*page.width/page.height}) scale(1 ${page.width/page.height})`}><title>{room.name}</title><text textAnchor="middle" fill="#334155" stroke="white" strokeWidth="3" paintOrder="stroke" fontFamily="Segoe UI,sans-serif" fontWeight="600" fontSize={p.size}>{p.lines.map((line,i)=><tspan key={i} x="0" y={(i-(p.lines.length-1)/2)*p.size*1.2+p.size*.35}>{line}</tspan>)}</text></g>)}</g>;
});
