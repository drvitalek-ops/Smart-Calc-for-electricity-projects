import type {Item,Kind,Page} from './App';
import type {Box as PlanBounds} from './planGeometry';
import {isPowerSupply} from './planDomain';
export function planLabel(item:Item,kind?:Kind,short=false){
 const name=String(item.parameters.display_name||kind?.name||'Объект'),label=(short&&name.length>32?name.slice(0,29)+'…':name)+' #'+item.id;
 return label+(kind?.unit==='шт'&&Number(item.parameters.quantity??1)!==1?' · '+item.parameters.quantity+' шт':'')+(item.parameters.power_watts?' · '+item.parameters.power_watts+' Вт':'');
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
export function planLabelText(item:Item,kind?:Kind,short=false){return planLabel(item,kind,short)+((item.geometry?.points?.length??0)>1?' · '+String(item.parameters.length)+' м':'');}
function wrapLabel(text:string,size:number,width:number):string[]{
 if(textWidth(text,size)<=width)return [text];
 const chars=Array.from(text),lines:string[]=[];let start=0;
 while(start<chars.length){
  let low=1,high=chars.length-start;
  while(low<high){const middle=Math.ceil((low+high)/2);if(textWidth(chars.slice(start,start+middle).join(''),size)<=width)low=middle;else high=middle-1;}
  let end=start+low;
  if(end<chars.length){for(let i=end-1;i>start;i--)if(/\s/.test(chars[i])){end=i+1;break;}}
  lines.push(chars.slice(start,end).join(''));start=end;
 }return lines;
}
/** One geometry for SVG rendering, local drag previews and overlap culling.
 * Coordinates are isotropic sheet units; visible camera bounds are normalized. */
export function planLabelLayout(item:Item,kind:Kind|undefined,page:Page|undefined,selected:boolean,scale:number,aspect:number,visible?:PlanBounds){
 const anchor=item.geometry?.points?.[0]??item,line=(item.geometry?.points?.length??0)>1;
 const ax=(.5+(anchor.x-.5)*(page?.scale??1)+(page?.offset_x??0))*1000,ay=(.5+(anchor.y-.5)*(page?.scale??1)+(page?.offset_y??0))*1000/aspect;
 let left=0,right=1000,top=0,bottom=1000/aspect;
 if(visible){const l=Math.max(left,visible.x1*1000),r=Math.min(right,visible.x2*1000),t=Math.max(top,visible.y1*1000/aspect),b=Math.min(bottom,visible.y2*1000/aspect);
  // Keep off-screen anchors off-screen; do not pull their labels into the view.
  if(r>l&&b>t&&ax>=l&&ax<=r&&ay>=t&&ay<=b){left=l;right=r;top=t;bottom=b;}
 }
 const margin=Math.min(4,(right-left)/8,(bottom-top)/8);left+=margin;right-=margin;top+=margin;bottom-=margin;
 const gap=(line?18:(isPowerSupply(kind)?19:12)*Number(item.parameters.plan_size??1))*scale,text=planLabelText(item,kind,!selected);
 let fontSize=Number(item.parameters.plan_label_size??7)*2;
 const fullWidth=textWidth(text,fontSize),spaceRight=Math.max(1,right-ax-gap),spaceLeft=Math.max(1,ax-gap-left),side=fullWidth<=spaceRight?'right':fullWidth<=spaceLeft?'left':spaceRight>=spaceLeft?'right':'left';
 const availableWidth=Math.min(right-left,side==='right'?spaceRight:spaceLeft),availableHeight=bottom-top;
 let lines=[text],width=fullWidth,lineHeight=fontSize*1.4,height=fontSize*1.3;
 for(let attempt=0;attempt<10;attempt++){
  lines=wrapLabel(text,fontSize,availableWidth);width=Math.max(...lines.map(line=>textWidth(line,fontSize)));lineHeight=fontSize*1.4;height=fontSize*1.3+(lines.length-1)*lineHeight;
  if(width<=availableWidth&&height<=availableHeight)break;
  fontSize*=Math.min(.95,availableWidth/Math.max(1,width),Math.sqrt(availableHeight/Math.max(1,height))*.95);
 }
 const x=Math.max(left,Math.min(right-width,side==='right'?ax+gap:ax-gap-width));
 let y=ay+(line?-10*scale-(lines.length-1)*lineHeight:5);
 if(y-fontSize<top)y=ay+10*scale+fontSize;
 if(y+(lines.length-1)*lineHeight+fontSize*.3>bottom)y=ay-10*scale-(lines.length-1)*lineHeight-fontSize*.3;
 y=Math.max(top+fontSize,Math.min(bottom-fontSize*.3-(lines.length-1)*lineHeight,y));
 return {x:x-ax,y:y-ay,fontSize,lineHeight,lines,side,box:{left:x,top:y-fontSize,right:x+width,bottom:y+(lines.length-1)*lineHeight+fontSize*.3}};
}
/** Cull final label boxes with a spatial grid instead of DOM layout reads. */
export function visiblePlanLabels(items:Item[],types:ReadonlyMap<number,Kind>,pages:ReadonlyMap<number,Page>,selection:ReadonlySet<number>,scale:number,aspect:number,pixelScale:number,bounds?:PlanBounds){
 const visible=new Set<number>(),grid=new Map<string,Box[]>(),cell=128,pad=3/Math.max(.05,pixelScale);
 const cells=(b:Box)=>{const keys:string[]=[];for(let x=Math.floor(b.left/cell);x<=Math.floor(b.right/cell);x++)for(let y=Math.floor(b.top/cell);y<=Math.floor(b.bottom/cell);y++)keys.push(x+','+y);return keys;};
 const ordered=[...items.filter(i=>selection.has(i.id)),...items.filter(i=>!selection.has(i.id))];
 for(const item of ordered){
  if(item.parameters.plan_label_visible===false)continue;
  const placed=planLabelLayout(item,types.get(item.type_id),pages.get(item.page_id),selection.has(item.id),scale,aspect,bounds).box;
  const box={left:placed.left-pad,top:placed.top-pad,right:placed.right+pad,bottom:placed.bottom+pad},keys=cells(box);
  const collision=keys.some(key=>(grid.get(key)??[]).some(b=>box.left<b.right&&box.right>b.left&&box.top<b.bottom&&box.bottom>b.top));
  if(collision&&!selection.has(item.id))continue;
  visible.add(item.id);for(const key of keys){const boxes=grid.get(key)??[];boxes.push(box);grid.set(key,boxes);}
 }return visible;
}
