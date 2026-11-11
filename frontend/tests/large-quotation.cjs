// Keep a maximum-size CP editable without mounting 5000 copies of every picker.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const {checked,waitUntil}=require('./workbench-helpers.cjs');
const frontend=process.env.FRAME_TEST_FRONTEND||'http://127.0.0.1:5174',backend=process.env.FRAME_TEST_BACKEND||'http://127.0.0.1:8014';
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),headless:true,args:['--no-sandbox']});try{
 const context=await browser.newContext({viewport:{width:1366,height:768}}),page=await context.newPage(),errors=[],calculations=[];
 page.on('pageerror',e=>errors.push(String(e)));await page.route('**/api/**',route=>route.continue({url:route.request().url().replace(frontend,backend)}));
 page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/calculate'))calculations.push(request.postDataJSON());});
 const api=context.request,base=backend+'/api',created=await checked(await api.post(base+'/quotations',{data:{}})),qid=created.id,number='LARGE-'+qid;
 const quote={...created.quotation,number,global_discount:'10',lines:Array.from({length:5000},(_,i)=>({id:'large-'+i,name:'Товар '+(i+1),sku:'ITEM-'+(i+1),quantity:'2',unit:'шт',unit_price:'100',currency:'RUB'}))};
 await checked(await api.put(base+'/quotations/'+qid,{data:quote}));
 await page.goto(frontend);await page.getByRole('button',{name:'Все КП',exact:true}).click();const hub=page.getByRole('region',{name:'Все коммерческие предложения',exact:true});await hub.getByLabel('Поиск КП',{exact:true}).fill(number);await hub.getByRole('button',{name:'Открыть КП '+number,exact:true}).click();
 const editor=page.getByRole('region',{name:'Редактор коммерческого предложения',exact:true});await editor.getByLabel('Цена строки 1',{exact:true}).waitFor();
 assert.equal(await editor.locator('.quotation-table tbody>tr').count(),100);assert.ok(await page.locator('body *').count()<22000,'Large CP must keep a bounded DOM');
 assert.ok(await editor.locator('.quotation-pagination').innerText().then(text=>text.includes('из 5000')));
 const query=editor.getByLabel('Поиск позиций КП',{exact:true});await query.fill('ITEM-5000');await editor.getByLabel('Наименование строки 5000',{exact:true}).fill('Светильник вручную');
 await page.waitForTimeout(500);assert.equal(calculations.length,0,'Renaming must not recalculate prices or resend images');
 await editor.getByLabel('Цена строки 5000',{exact:true}).fill('125.50');
 await waitUntil(()=>calculations.length>0,'Price calculation request');
 assert.equal(calculations.at(-1).lines.length,5000);assert.ok(!('name' in calculations.at(-1).lines[0]));assert.ok(JSON.stringify(calculations.at(-1)).length<650000);
 await query.fill('');await editor.getByRole('button',{name:'Далее',exact:true}).click();await editor.getByLabel('Цена строки 101',{exact:true}).waitFor();
 assert.equal(await editor.locator('.quotation-table tbody>tr').count(),100);
 const save=page.waitForResponse(response=>response.url().endsWith('/quotations/'+qid)&&response.request().method()==='PUT');await editor.getByRole('button',{name:'Сохранить КП',exact:true}).click();assert.equal((await save).status(),200);
 const stored=await checked(await api.get(base+'/quotations/'+qid));assert.equal(stored.lines.length,5000);assert.equal(stored.lines[4999].name,'Светильник вручную');assert.equal(stored.lines[4999].unit_price,'125.50');
 assert.equal(stored.client.totals.RUB.total,'1000051.00');assert.equal(stored.partner.totals.RUB.total,'900045.90');
 assert.deepEqual(errors,[]);console.log('PASS: 5000-row CP, bounded DOM/pickers, global-index editing/search/pagination, lean recalculation, exact client/partner money and full save');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
