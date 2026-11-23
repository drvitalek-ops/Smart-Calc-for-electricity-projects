import {decimalValue} from './DecimalInput';
type Item={id:string;name:string;sku:string;manufacturer:string;description:string;ip?:string;product_id:number|null;type_id:number|null;unit:string;currency:string;unit_price:string;image:string;source_ids?:number[];overrides?:string[]};
const folded=(value:string)=>value.trim().replace(/\s+/g,' ').toLocaleLowerCase('ru').replaceAll('ё','е');
export function priceIdentity(line:Item){
 const common=[line.unit,line.currency];
 const description=line.source_ids?.length&&!line.overrides?.includes('description')?line.description.split('\n').filter(part=>!part.startsWith('Питает ленты: ')).join('\n'):line.description;
 return JSON.stringify(line.sku.trim()?['sku',folded(line.sku),folded(line.manufacturer),...common]:line.product_id?['product',line.product_id,...common]:['position',line.type_id,folded(line.name),folded(line.manufacturer),folded(description),folded(line.ip??'').replace(/^ip\s*/,''),...common]);
}
export function priceConflicts(lines:Item[]){
 const prices=new Map<string,Set<number>>();
 for(const line of lines){const value=decimalValue(line.unit_price);if(value!==null&&value>0){const key=priceIdentity(line);const values=prices.get(key)??new Set<number>();values.add(value);prices.set(key,values);}}
 return lines.filter(line=>decimalValue(line.unit_price)===0&&(prices.get(priceIdentity(line))?.size??0)>1);
}
export function exportIssues(lines:Item[]){return lines.flatMap((line,index)=>{
 const missing=[decimalValue(line.unit_price)===0?'цена':'',!line.image.trim()?'фото':'',!line.sku.trim()?'артикул':''].filter(Boolean);
 return missing.length?[{id:line.id,index,name:line.name,missing}]:[];
});}
export function exportAlarm(lines:Item[]){
 const issues=exportIssues(lines);if(!issues.length)return '';
 const counts=['цена','фото','артикул'].map(field=>field+': '+issues.filter(item=>item.missing.includes(field)).length).join('; ');
 return 'Внимание! В КП есть незаполненные данные.\nОтсутствуют — '+counts+'.\n\n'+issues.slice(0,6).map(item=>'№ '+(item.index+1)+' '+item.name.slice(0,60)+' — '+item.missing.join(', ')).join('\n')+(issues.length>6?'\nИ ещё '+(issues.length-6)+' позиций.':'')+'\n\nСформировать PDF всё равно? Отмена — вернуться к заполнению.';
}
