import {decimalIssue} from './DecimalInput';
export type QuoteNumberIssue={id?:string;index?:number;field:'quantity'|'unit_price'|'discount'|'global_discount';label:string;message:string};
type NumericQuote={global_discount:string;lines:{id:string;quantity:string;unit_price:string;discount:string|null}[]};
export function quoteNumberIssues(quote:NumericQuote|null):QuoteNumberIssue[]{
 if(!quote)return [];
 const issues:QuoteNumberIssue[]=[],global=decimalIssue(quote.global_discount,0,100,2);
 if(global)issues.push({field:'global_discount',label:'Общая скидка',message:global});
 quote.lines.forEach((line,index)=>{
  const fields:[QuoteNumberIssue['field'],string,unknown,number,number,number,boolean?][]=[['quantity','Количество',line.quantity,.001,1000000,3,true],['unit_price','Цена за единицу',line.unit_price,0,1000000000,2]];
  if(line.discount!==null&&line.discount!=='')fields.push(['discount','Скидка',line.discount,0,100,2]);
  for(const [field,label,value,min,max,places,positive] of fields){const message=decimalIssue(value,min,max,places,positive);if(message)issues.push({id:line.id,index,field,label:'Строка КП № '+(index+1)+' — '+label,message});}
 });return issues;
}
