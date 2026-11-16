const {chromium}=require('playwright'),assert=require('node:assert/strict');
const {checked,waitUntil}=require('./workbench-helpers.cjs');
const frontend=process.env.FRAME_TEST_FRONTEND||'http://127.0.0.1:5174',backend=process.env.FRAME_TEST_BACKEND||'http://127.0.0.1:8014';
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),headless:true,args:['--no-sandbox']});try{
 const context=await browser.newContext({viewport:{width:1366,height:768}}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
 await page.route('**/api/**',route=>route.continue({url:route.request().url().replace(frontend,backend)}));
 const api=context.request,base=backend+'/api',created=await checked(await api.post(base+'/quotations',{data:{}})),qid=created.id,number='POPUPS-'+qid;
 await checked(await api.put(base+'/quotations/'+qid,{data:{...created.quotation,number,lines:Array.from({length:100},(_,i)=>({id:'scroll-'+(i+1),name:'Позиция '+(i+1),sku:'S-'+i,manufacturer:'Завод '+i,quantity:1,unit_price:100}))}}));
 await page.goto(frontend);await page.getByRole('button',{name:'Все КП',exact:true}).click();const hub=page.getByRole('region',{name:'Все коммерческие предложения',exact:true});await hub.getByLabel('Поиск КП',{exact:true}).fill(number);await hub.getByRole('button',{name:'Открыть КП '+number,exact:true}).click();
 const editor=page.getByRole('region',{name:'Редактор коммерческого предложения',exact:true}),table=editor.locator('.quotation-table-wrap'),row=n=>editor.locator(`[data-quote-line="scroll-${n}"]`);
 await row(1).waitFor();
 async function noOverlap(anchor){const a=await anchor.boundingBox(),p=await page.locator('[data-search-popup]').boundingBox(),v=page.viewportSize();assert.ok(p&&p.x>=0&&p.y>=0&&p.x+p.width<=v.width+1&&p.y+p.height<=v.height+1,JSON.stringify({a,p,v}));assert.ok(p.y+p.height<=a.y-2||p.y>=a.y+a.height+2,'Popup must never cover the edited control: '+JSON.stringify({a,p}));}
 for(const size of [{width:1366,height:768},{width:1024,height:600}]){
  await page.setViewportSize(size);const brand=editor.getByLabel('Бренд строки 90',{exact:true});await brand.scrollIntoViewIfNeeded();await brand.click();await page.locator('[data-search-popup]').waitFor();await noOverlap(brand);await brand.fill('Зав');await noOverlap(brand);await brand.press('Escape');
  await row(90).getByLabel('Свойства строки 90',{exact:true}).click();const product=row(90).getByLabel('Товар строки 90',{exact:true});await product.scrollIntoViewIfNeeded();await product.click();await page.locator('[data-search-popup]').waitFor();await noOverlap(product);await page.getByRole('combobox',{name:'Поиск в списке: Товар строки 90',exact:true}).press('Escape');await row(90).getByLabel('Свойства строки 90',{exact:true}).click();
 }
 await page.setViewportSize({width:1366,height:768});await row(55).scrollIntoViewIfNeeded();const handle=row(55).getByRole('button',{name:'Перетащить строку 55',exact:true}),h=await handle.boundingBox();
 await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(h.x+h.width/2+12,h.y+h.height/2-12,{steps:8});await waitUntil(async()=>await editor.locator('.quote-row-dragging').count()===1,'Start native row drag');
 const box=await table.boundingBox(),outer=await editor.locator('.quotation-content').boundingBox(),top=Math.max(box.y,outer.y)+8;const before=await table.evaluate(node=>node.scrollTop);assert.ok(before>500);
 await page.mouse.move(box.x+60,top,{steps:10});await waitUntil(async()=>await table.evaluate(node=>node.scrollTop)<before-500,'Fast upward scroll over the sticky table header');
 await waitUntil(async()=>await table.evaluate(node=>node.scrollTop)===0,'Reach first CP rows while dragging',120);
 await waitUntil(async()=>await editor.locator('.quotation-content').evaluate(node=>node.scrollTop)===0,'Reach the top of the editor while dragging',120);
 const first=await row(1).boundingBox();await page.mouse.move(first.x+80,first.y+4,{steps:5});await page.mouse.up();
 await page.screenshot({path:'/tmp/popup-drag-scroll.png'});
 await waitUntil(async()=>await editor.locator('[data-quote-line]').first().getAttribute('data-quote-line')==='scroll-55','Drop the distant row before the first position: '+JSON.stringify(await editor.locator('[data-quote-line]').evaluateAll(nodes=>nodes.slice(0,4).map(n=>n.dataset.quoteLine))));
 await editor.getByRole('button',{name:'Отменить правку КП',exact:true}).click();assert.equal(await editor.locator('[data-quote-line]').first().getAttribute('data-quote-line'),'scroll-1');
 await page.setViewportSize({width:1024,height:600});await row(1).getByLabel('Свойства строки 1',{exact:true}).click();await row(1).getByRole('button',{name:'＋ Товар в базу',exact:true}).click();
 const modal=page.getByRole('dialog',{name:'Новый товар из КП',exact:true});await modal.waitFor();
 for(const label of ['Производитель нового товара КП','Номенклатура нового товара КП']){const anchor=modal.getByRole('combobox',{name:label,exact:true});await anchor.scrollIntoViewIfNeeded();await anchor.click();await page.locator('[data-search-popup]').waitFor();await noOverlap(anchor);if(label.startsWith('Производитель'))await anchor.press('Escape');else await modal.getByRole('combobox',{name:'Поиск в списке: '+label,exact:true}).press('Escape');assert.ok(await modal.isVisible());}
 assert.deepEqual(errors,[]);console.log('PASS: searchable text and select popups avoid the active input at multiple window sizes; native upward dragging scrolls rapidly over sticky headers, reaches first rows, reorders and undoes');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
