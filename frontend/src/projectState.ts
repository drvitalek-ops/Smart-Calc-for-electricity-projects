import type {Project} from './App';
function shareRows<T extends {id:number}>(previous:T[],next:T[]):T[]{
  const old=new Map(previous.map(item=>[item.id,item]));let unchanged=previous.length===next.length;
  const shared=next.map((item,index)=>{const candidate=old.get(item.id);const value=candidate&&JSON.stringify(candidate)===JSON.stringify(item)?candidate:item;if(value!==previous[index])unchanged=false;return value;});
  return unchanged?previous:shared;
}
/** API refreshes preserve references for unchanged objects, making memoized SVG
 * items cheap even when the backend returns a complete project snapshot. */
export function shareProject(previous:Project|null,next:Project):Project{
  if(previous?.id!==next.id)return next;
  return {...next,pages:shareRows(previous.pages,next.pages),layers:shareRows(previous.layers,next.layers),rooms:shareRows(previous.rooms,next.rooms),elements:shareRows(previous.elements,next.elements)};
}
