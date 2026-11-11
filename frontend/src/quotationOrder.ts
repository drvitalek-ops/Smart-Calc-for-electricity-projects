/** Move by stable IDs so filtering never reorders or drops hidden rows. */
export function moveQuoteLine<T extends {id:string}>(lines:T[],id:string,target:string,after=false):T[]{
  if(id===target)return lines;
  const item=lines.find(line=>line.id===id);if(!item||!lines.some(line=>line.id===target))return lines;
  const next=lines.filter(line=>line.id!==id),index=next.findIndex(line=>line.id===target)+(after?1:0);
  next.splice(index,0,item);return next.every((line,i)=>line===lines[i])?lines:next;
}
export const QUOTE_LINE_DRAG='application/x-smart-calc-quotation-line';
