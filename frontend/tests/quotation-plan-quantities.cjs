const {chromium}=require('playwright'),assert=require('node:assert/strict');
const {blankPdf,checked,tool,waitUntil}=require('./workbench-helpers.cjs');
const frontend=process.env.FRAME_TEST_FRONTEND||'http://127.0.0.1:5174',backend=process.env.FRAME_TEST_BACKEND||'http://127.0.0.1:8014';
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),headless:true,args:['--no-sandbox']});try{
 const context=await browser.newContext({viewport:{width:1600,height:1000}}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(String(error)));await page.route('**/api/**',route=>route.continue({url:route.request().url().replace(frontend,backend)}));
 const api=context.request,base=backend+'/api',project=await checked(await api.post(base+'/projects',{data:{name:'CP quantities '+Date.now()}})),pid=project.id;
 const pages=await checked(await api.post(base+`/projects/${pid}/pdf`,{multipart:{file:{name:'plan.pdf',mimeType:'application/pdf',buffer:blankPdf()}}}));
 const data=await checked(await api.get(base+`/projects/${pid}`)),types=await checked(await api.get(base+'/types')),kind=types.find(kind=>kind.name==='Люстра');
 const body={page_id:pages[0].id,layer_id:data.layers.find(layer=>layer.name==='Освещение').id,type_id:kind.id,x:.3,y:.3,parameters:{quantity:2,ip:20}};
 const item=await checked(await api.post(base+`/projects/${pid}/elements`,{data:body}));
 await page.goto(frontend);await page.getByLabel('Проект',{exact:true}).selectOption(String(pid));await page.getByRole('button',{name:'КП',exact:true}).click();
 const editor=page.getByRole('region',{name:'Редактор коммерческого предложения',exact:true}),count=editor.getByLabel('Количество строки 1',{exact:true});
 await count.waitFor();assert.equal(Number(await count.inputValue()),2);
 await editor.getByLabel('Цена строки 1',{exact:true}).fill('100');await editor.getByLabel('Скидка строки 1',{exact:true}).fill('20');await editor.locator('[data-quote-line]').first().locator('summary').click();await editor.getByLabel('Комментарий строки 1',{exact:true}).fill('Сохранить условия');
 await editor.getByRole('button',{name:'Сохранить изменения КП',exact:true}).click();await waitUntil(async()=>!await editor.getByRole('button',{name:'Сохранить изменения КП',exact:true}).isEnabled(),'Save quote');
 const goPlan=()=>page.getByRole('button',{name:'План',exact:true}).click(),goQuote=async expected=>{await page.getByRole('button',{name:'КП',exact:true}).click();await count.waitFor();assert.equal(Number(await count.inputValue()),expected);assert.equal(Number(await editor.getByLabel('Цена строки 1',{exact:true}).inputValue()),100);await editor.locator('[data-quote-line]').first().locator('summary').click();assert.equal(await editor.getByLabel('Комментарий строки 1',{exact:true}).inputValue(),'Сохранить условия');};
 await goPlan();await page.locator(`[data-element-id="${item.id}"] .editable-plan-symbol>g`).click();await tool(page,'Свойства');await page.getByLabel('Количество',{exact:true}).fill('5');
 // Navigation saves the draft; no explicit CP import is requested.
 await goQuote(5);let quote=await checked(await api.get(base+`/projects/${pid}/quotation`));assert.equal(quote.partner.totals.RUB.total,'400.00');
 const second=await checked(await api.post(base+`/projects/${pid}/elements`,{data:{...body,x:.7}}));await goPlan();await goQuote(7);
 assert.equal((await api.delete(base+'/elements/'+second.id)).status(),204);await goPlan();await goQuote(5);
 await goPlan();await page.locator('.sheet>svg').focus();await page.keyboard.press('Control+z');await goQuote(7);
 await editor.getByLabel('Ручное количество строки 1',{exact:true}).check();await count.fill('12');await editor.getByRole('button',{name:'Сохранить изменения КП',exact:true}).click();await waitUntil(async()=>!await editor.getByRole('button',{name:'Сохранить изменения КП',exact:true}).isEnabled(),'Save manual count');
 let applied;await waitUntil(async()=>{applied=await checked(await api.get(base+`/projects/${pid}`));return applied.elements.reduce((sum,e)=>sum+Number(e.parameters.quantity),0)===12;},'CP quantity has reached existing plan objects');assert.equal(applied.elements.length,2);
 assert.equal((await checked(await api.get(base+`/projects/${pid}/quotation`))).lines[0].quantity_override,null);
 await checked(await api.put(base+'/elements/'+item.id,{data:{...body,parameters:{quantity:4,ip:20}}}));await goPlan();await goQuote(7);
 assert.deepEqual(errors,[]);console.log('PASS: plan quantity edit saves on CP navigation, automatic totals/add/delete/undo, preserved prices/comments/discounts and explicit manual quantity override');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
