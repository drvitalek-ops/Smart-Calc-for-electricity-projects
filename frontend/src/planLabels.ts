import type {Item,Kind,Page} from './App';
import {isPowerSupply} from './planDomain';
export function planLabel(item:Item,kind?:Kind,short=false){
 const name=String(item.parameters.display_name||kind?.name||'Объект'),label=(short&&name.length>32?name.slice(0,29)+'…':name)+' #'+item.id;
 return label+(item.parameters.power_watts?' · '+item.parameters.power_watts+' Вт':'');
}
const widths=new Map<string,number>();let context:CanvasRenderingContext2D|null|undefined;
function textWidth(text:string,size:number){
 const key=size+'|'+text,hit=widths.get(key);if(hit!==undefined)return hit;
 if(context===undefined)context=typeof document==='undefined'?null:document.createElement('canvas').getContext('2d');
 if(context)context.font=`550 ${size}px "Segoe UI", Inter, system-ui, sans-serif`;
 const width=context?.measureText(text).width??text.length*size*.65;
 if(widths.size>2048)widths.clear();widths.set(key,width);return width;
}
type Box={left:number;top:number;right:number;bottom:number};
/** Cull labels in isotropic sheet coordinates, with a spatial grid instead of DOM layout reads. */
export function visiblePlanLabels(items:Item[],types:ReadonlyMap<number,Kind>,pages:ReadonlyMap<number,Page>,selection:ReadonlySet<number>,scale:number,aspect:number,pixelScale:number){
 const visible=new Set<number>(),grid=new Map<string,Box[]>(),cell=128,pad=3/Math.max(.05,pixelScale);
 const cells=(b:Box)=>{const keys:string[]=[];for(let x=Math.floor(b.left/cell);x<=Math.floor(b.right/cell);x++)for(let y=Math.floor(b.top/cell);y<=Math.floor(b.bottom/cell);y++)keys.push(x+','+y);return keys;};
 const ordered=[...items.filter(i=>selection.has(i.id)),...items.filter(i=>!selection.has(i.id))];
 for(const item of ordered){
  if(item.parameters.plan_label_visible===false)continue;
  const p=pages.get(item.page_id),anchor=item.geometry?.points?.[0]??item,line=(item.geometry?.points?.length??0)>1,font=Number(item.parameters.plan_label_size??7)*2;
  const x=(.5+(anchor.x-.5)*(p?.scale??1)+(p?.offset_x??0))*1000+(line?18*scale:(isPowerSupply(types.get(item.type_id))?19:12)*scale*Number(item.parameters.plan_size??1)),baseline=(.5+(anchor.y-.5)*(p?.scale??1)+(p?.offset_y??0))*1000/aspect+(line?-10*scale:5);
  const text=planLabel(item,types.get(item.type_id),!selection.has(item.id))+(line?' · '+String(item.parameters.length)+' м':'');
  const box={left:x-pad,top:baseline-font-pad,right:x+textWidth(text,font)+pad,bottom:baseline+font*.3+pad},keys=cells(box);
  const collision=keys.some(key=>(grid.get(key)??[]).some(b=>box.left<b.right&&box.right>b.left&&box.top<b.bottom&&box.bottom>b.top));
  if(collision&&!selection.has(item.id))continue;
  visible.add(item.id);for(const key of keys){const boxes=grid.get(key)??[];boxes.push(box);grid.set(key,boxes);}
 }return visible;
}
