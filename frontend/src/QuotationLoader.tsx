import {lazy,Suspense,type ComponentProps} from 'react';
const Editor=lazy(()=>import('./QuotationEditor'));
/** Load quotation tools when opened; keep drawing startup independent of them. */
export default function QuotationLoader(props:ComponentProps<typeof Editor>){return <Suspense fallback={<p role="status">Открытие редактора КП…</p>}><Editor {...props}/></Suspense>;}
