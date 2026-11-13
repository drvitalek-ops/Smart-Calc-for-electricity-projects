const {chromium}=require('playwright'),assert=require('node:assert/strict');
const {checked,waitUntil}=require('./workbench-helpers.cjs');
const frontend=process.env.FRAME_TEST_FRONTEND||'http://127.0.0.1:5174',backend=process.env.FRAME_TEST_BACKEND||'http://127.0.0.1:8014';
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),headless:true,args:['--no-sandbox']});try{
 const context=await browser.newContext({viewport:{width:1600,height:1000}}),page=await context.newPage(),errors=[],calculations=[];
 page.on('pageerror',error=>errors.push(String(error)));page.on('request',request=>{if(request.url().endsWith('/calculate'))calculations.push(request);});
 await page.route('**/api/**',route=>route.continue({url:route.request().url().replace(frontend,backend)}));
 const api=context.request,base=backend+'/api',created=await checked(await api.post(base+'/quotations',{data:{}})),qid=created.id,number='FIELDS-'+qid;
 await checked(await api.put(base+'/quotations/'+qid,{data:{...created.quotation,number,lines:[{id:'first',name:'Настенный светильник',sku:'OLD-SKU',manufacturer:'Старый бренд',room:'Кухня',comment:'Старый комментарий',quantity:2,unit_price:11060},{id:'second',name:'Лента',sku:'LED-02',manufacturer:'Arlight',unit:'м',quantity:'3.5',unit_price:100}]}}));
 const editor=page.getByRole('region',{name:'Редактор коммерческого предложения',exact:true}),row=editor.locator('[data-quote-line="first"]');
 async function open(){await page.goto(frontend);await page.getByRole('button',{name:'Все КП',exact:true}).click();const hub=page.getByRole('region',{name:'Все коммерческие предложения',exact:true});await hub.getByLabel('Поиск КП',{exact:true}).fill(number);await hub.getByRole('button',{name:'Открыть КП '+number,exact:true}).click();await row.getByLabel('Артикул строки 1',{exact:true}).waitFor();}
 await open();
 assert.equal(await row.locator('.quotation-row-meta').getByLabel('Артикул строки 1',{exact:true}).inputValue(),'OLD-SKU');assert.equal(await row.locator('.quotation-row-meta').getByLabel('Бренд строки 1',{exact:true}).inputValue(),'Старый бренд');
 assert.equal(await row.getByLabel('Помещение строки 1',{exact:true}).count(),0);assert.equal(await row.getByLabel('Комментарий строки 1',{exact:true}).count(),0);
 assert.ok((await row.boundingBox()).height<=95,'The closed row should stay compact');
 await row.getByLabel('Артикул строки 1',{exact:true}).fill('NEW-SKU');await row.getByLabel('Бренд строки 1',{exact:true}).fill('Новый бренд');await editor.getByLabel('Цена строки 2',{exact:true}).click();
 await row.getByLabel('Свойства строки 1',{exact:true}).click();assert.equal(await row.getByLabel('Помещение строки 1',{exact:true}).inputValue(),'Кухня');assert.equal(await row.getByLabel('Комментарий строки 1',{exact:true}).inputValue(),'Старый комментарий');
 await row.getByLabel('Помещение строки 1',{exact:true}).fill('Спальня');await row.getByLabel('Комментарий строки 1',{exact:true}).fill('Новый комментарий');await row.getByLabel('Свойства строки 1',{exact:true}).click();
 const save=editor.getByRole('button',{name:'Сохранить изменения КП',exact:true});await save.click();await waitUntil(async()=>!await save.isEnabled(),'Save reordered editor fields');
 const saved=await checked(await api.get(base+'/quotations/'+qid));assert.equal(saved.lines[0].sku,'NEW-SKU');assert.equal(saved.lines[0].manufacturer,'Новый бренд');assert.equal(saved.lines[0].room,'Спальня');assert.equal(saved.lines[0].comment,'Новый комментарий');assert.equal(calculations.length,0,'Moving or editing metadata must not recalculate money');
 await open();assert.equal(await row.getByLabel('Артикул строки 1',{exact:true}).inputValue(),'NEW-SKU');assert.equal(await row.getByLabel('Бренд строки 1',{exact:true}).inputValue(),'Новый бренд');assert.equal(await row.getByLabel('Комментарий строки 1',{exact:true}).count(),0);
 const search=editor.getByLabel('Поиск позиций КП',{exact:true});await search.fill('Новый бренд');assert.equal(await editor.locator('[data-quote-line]').count(),1);await search.fill('Новый комментарий');assert.equal(await editor.locator('[data-quote-line]').count(),1);await search.fill('');
 await page.screenshot({path:process.env.QUOTE_FIELDS_SCREENSHOT||'/tmp/quotation-fields.png'});await page.setViewportSize({width:1024,height:768});assert.ok(await row.locator('.quotation-row-meta').getByLabel('Бренд строки 1',{exact:true}).isVisible());
 assert.deepEqual(errors,[]);console.log('PASS: SKU/brand visible in compact rows, room/comments only in properties, existing values preserved, edits/search/reload and no monetary recalculation');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
