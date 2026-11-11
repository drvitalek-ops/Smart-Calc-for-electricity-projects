import definitions from '../../backend/app/assets/plan-symbols.json';
import type {PlanKind} from './planDomain';
export type Glyph={shape:string;strokes?:number[][][];circles?:number[][];squares?:number[][]};
type Rule={category?:string;seed_contains?:string;contains?:string[];contains_all?:string[];glyph:string};
const fold=(value:string)=>value.toLocaleLowerCase('ru').replaceAll('ё','е');
export const glyphs:Record<string,Glyph>=definitions.glyphs;
export function defaultGlyph(kind?:PlanKind):string{
  if(!kind)return '';
  const name=fold(kind.name+' '+(kind.seed_key??''));
  for(const rule of definitions.rules as Rule[]){
    if(rule.category&&rule.category!==kind.category)continue;
    if(rule.seed_contains&&!fold(kind.seed_key??'').includes(fold(rule.seed_contains)))continue;
    if(rule.contains&&!rule.contains.some(value=>name.includes(fold(value))))continue;
    if(rule.contains_all&&!rule.contains_all.every(value=>name.includes(fold(value))))continue;
    return rule.glyph;
  }
  return '';
}
export function symbolAppearance(parameters:Record<string,unknown>,kind?:PlanKind,power=false){
  const chosen=typeof parameters.plan_shape==='string'?parameters.plan_shape:'';
  const glyph=chosen?(['socket','switch','lamp','sensor'].includes(chosen)?chosen:''):(power?'power':defaultGlyph(kind));
  return {shape:chosen||glyphs[glyph]?.shape||(power?'rectangle':'circle'),glyph:parameters.plan_icon?'':glyph};
}
export function symbolInk(color:string){
  const channels=[1,3,5].map(index=>parseInt(color.slice(index,index+2),16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);
  const light=.2126*channels[0]+.7152*channels[1]+.0722*channels[2];
  return light>.22?'#152a34':'#ffffff';
}
