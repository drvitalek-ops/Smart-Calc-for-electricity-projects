export type PlanKind={name:string;category:string;unit?:string;seed_key?:string|null};
export function isElectrical(kind?:PlanKind){return kind?.category==='Электроустановки'&&kind.unit==='шт';}
export function isPowerSupply(kind?:PlanKind){return kind?.seed_key==='LED-подсветка:Блок питания LED-ленты'||Boolean(kind?.seed_key?.startsWith('power-supply:'))||kind?.category==='LED-подсветка'&&kind.name.toLocaleLowerCase().includes('блок питания');}
export function isLedStrip(kind?:PlanKind){return kind?.category==='LED-подсветка'&&kind.unit==='м';}
export function isTrack(kind?:PlanKind){return kind?.name.toLocaleLowerCase().includes('трек')??false;}
