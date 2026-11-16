const {chromium}=require('playwright'),assert=require('node:assert/strict');
const {blankPdf,checked,waitUntil}=require('./workbench-helpers.cjs');
const frontend=process.env.FRAME_TEST_FRONTEND||'http://127.0.0.1:5174',backend=process.env.FRAME_TEST_BACKEND||'http://127.0.0.1:8014';
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),headless:true,args:['--no-sandbox']});try{
 const context=await browser.newContext({viewport:{width:1600,height:1000}}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(String(error)));await page.route('**/api/**',route=>route.continue({url:route.request().url().replace(frontend,backend)}));
 const api=context.request,base=backend+'/api',project=await checked(await api.post(base+'/projects',{data:{name:'Room distribution '+Date.now()}})),pid=project.id;
 const pages=await checked(await api.post(base+`/projects/${pid}/pdf`,{multipart:{file:{name:'plan.pdf',mimeType:'application/pdf',buffer:blankPdf()}}}));
 const data=await checked(await api.get(base+`/projects/${pid}`)),types=await checked(await api.get(base+'/types')),kind=types.find(kind=>kind.name==='Люстра');
 const rooms=[];for(const name of ['Кухня','Спальня'])rooms.push(await checked(await api.post(base+`/projects/${pid}/rooms`,{data:{name}})));
 const body={page_id:pages[0].id,layer_id:data.layers.find(layer=>layer.name===kind.category).id,type_id:kind.id,x:.3,y:.3,parameters:{quantity:2,ip:20}};
 for(let i=0;i<2;i++)await checked(await api.post(base+`/projects/${pid}/elements`,{data:{...body,room_id:rooms[i].id,x:.3+i*.4,parameters:{quantity:i+2,ip:20}}}));
 await page.goto(frontend);await page.getByLabel('Проект',{exact:true}).selectOption(String(pid));await page.getByRole('button',{name:'КП',exact:true}).click();
 const editor=page.getByRole('region',{name:'Редактор коммерческого предложения',exact:true}),actions=editor.locator('.quotation-room-actions'),rows=editor.locator('[data-quote-line]');
 await actions.waitFor();assert.equal(await rows.count(),1);assert.ok((await actions.textContent()).includes('Общее КП'));assert.equal(Number(await editor.getByLabel('Количество строки 1',{exact:true}).inputValue()),5);
 // Unsaved commercial terms must be saved once and carried into both room rows.
 await editor.getByLabel('Цена строки 1',{exact:true}).fill('100');await editor.getByLabel('Скидка строки 1',{exact:true}).fill('10');await editor.getByLabel('Бренд строки 1',{exact:true}).fill('Мой бренд');
 await actions.getByRole('button',{name:'Распределить по помещениям',exact:true}).click();
 await waitUntil(async()=>await rows.count()===2,'Split actual room rows');
 let quote=await checked(await api.get(base+`/projects/${pid}/quotation`));assert.equal(quote.room_layout,'rooms');assert.deepEqual(quote.lines.map(line=>[line.room,Number(line.quantity)]),[['Кухня',2],['Спальня',3]]);assert.equal(quote.partner.totals.RUB.total,'450.00');assert.ok(quote.lines.every(line=>line.manufacturer==='Мой бренд'&&Number(line.unit_price)===100&&Number(line.discount)===10));
 assert.ok((await editor.locator('[data-quote-group]').allTextContents()).some(text=>text.includes('Кухня')));
 await page.screenshot({path:process.env.QUOTE_ROOMS_SCREENSHOT||'/tmp/quotation-room-layout.png'});
 await actions.getByRole('button',{name:'Объединить помещения',exact:true}).click();await waitUntil(async()=>await rows.count()===1,'Combine room rows');
 quote=await checked(await api.get(base+`/projects/${pid}/quotation`));assert.equal(quote.room_layout,'combined');assert.equal(quote.lines[0].room,'');assert.equal(Number(quote.lines[0].quantity),5);assert.equal(quote.partner.totals.RUB.total,'450.00');
 await page.reload();await page.getByLabel('Проект',{exact:true}).selectOption(String(pid));await page.getByRole('button',{name:'КП',exact:true}).click();await actions.waitFor();assert.equal(await rows.count(),1);assert.ok((await actions.textContent()).includes('Общее КП'));
 assert.deepEqual(errors,[]);console.log('PASS: new CP combined across rooms, one-click room distribution saves drafts/prices/brand/discount, actual quantities and room headers, reverse action and persistence');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
