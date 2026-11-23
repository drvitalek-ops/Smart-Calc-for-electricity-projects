const {chromium}=require('playwright'),assert=require('node:assert/strict');
const {blankPdf,checked,waitUntil}=require('./workbench-helpers.cjs');
const front=process.env.FRAME_TEST_FRONTEND||'http://127.0.0.1:5174',back=process.env.FRAME_TEST_BACKEND||'http://127.0.0.1:8014';
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),headless:true,args:['--no-sandbox']});try{
 const context=await browser.newContext({viewport:{width:1600,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',dialog=>dialog.accept());await context.route('**/api/**',route=>route.continue({url:route.request().url().replace(front,back)}));
 const api=context.request,base=back+'/api',stamp=Date.now(),types=await checked(await api.get(base+'/types')),power=types.find(t=>t.name==='Блок питания LED-ленты'),tape=types.find(t=>t.name==='LED-линия');
 const project=await checked(await api.post(base+'/projects',{data:{name:'Grouping '+stamp}})),pid=project.id,pages=await checked(await api.post(base+`/projects/${pid}/pdf`,{multipart:{file:{name:'plan.pdf',mimeType:'application/pdf',buffer:blankPdf()}}})),plan=await checked(await api.get(base+`/projects/${pid}`));
 const maker=await checked(await api.post(base+'/manufacturers',{data:{name:'Grouping maker '+stamp}})),product=await checked(await api.post(base+'/products',{data:{name:'Power supply '+stamp,sku:'PSU-'+stamp,manufacturer_id:maker.id,type_id:power.id,unit:'шт',price:100}}));
 const rooms=[];for(const name of ['Кухня','Спальня'])rooms.push(await checked(await api.post(base+`/projects/${pid}/rooms`,{data:{name}})));
 for(let i=0;i<6;i++){
  const body={page_id:pages[0].id,layer_id:plan.layers.find(l=>l.name===power.category).id,room_id:rooms[i<3?0:1].id,x:.2,y:.3};
  const strip=await checked(await api.post(base+`/projects/${pid}/elements`,{data:{...body,type_id:tape.id,parameters:{length:1,zone:String(i)}}}));
  await checked(await api.post(base+`/projects/${pid}/elements`,{data:{...body,type_id:power.id,product_id:product.id,parameters:{quantity:1,power_watts:60,led_strip_ids:[strip.id]}}}));
 }
 await page.goto(front);await page.getByLabel('Проект',{exact:true}).selectOption(String(pid));await page.getByRole('button',{name:'КП',exact:true}).click();
 const editor=page.getByRole('region',{name:'Редактор коммерческого предложения',exact:true}),actions=editor.locator('.quotation-room-actions');await actions.waitFor();
 let quote=await checked(await api.get(base+`/projects/${pid}/quotation`)),rows=quote.lines.filter(l=>l.product_id===product.id);assert.equal(rows.length,1);assert.equal(Number(rows[0].quantity),6);
 const index=quote.lines.findIndex(l=>l.product_id===product.id)+1;assert.equal(Number(await editor.getByLabel('Количество строки '+index,{exact:true}).inputValue()),6);await editor.getByLabel('Скидка строки '+index,{exact:true}).fill('10');
 await actions.getByRole('button',{name:'Распределить по помещениям',exact:true}).click();await waitUntil(async()=>(await checked(await api.get(base+`/projects/${pid}/quotation`))).room_layout==='rooms','Room distribution saved');
 quote=await checked(await api.get(base+`/projects/${pid}/quotation`));rows=quote.lines.filter(l=>l.product_id===product.id);assert.deepEqual(rows.map(l=>[l.room,Number(l.quantity)]),[['Кухня',3],['Спальня',3]]);assert.equal(quote.partner.totals.RUB.total,'540.00');
 assert.deepEqual((await editor.locator('[data-quote-group]').allTextContents()).map(t=>t.trim()),['Кухня','Спальня']);
 await actions.getByRole('button',{name:'Объединить помещения',exact:true}).click();await waitUntil(async()=>(await checked(await api.get(base+`/projects/${pid}/quotation`))).room_layout==='combined','Combined quote saved');
 quote=await checked(await api.get(base+`/projects/${pid}/quotation`));rows=quote.lines.filter(l=>l.product_id===product.id);assert.equal(rows.length,1);assert.equal(Number(rows[0].quantity),6);assert.equal(quote.partner.totals.RUB.total,'540.00');
 // Selecting a product on the second identical manual draft first saves/merges
 // those rows. The subsequent binding must target the retained row's identity.
 await page.getByRole('button',{name:'Все КП',exact:true}).click();await page.getByRole('button',{name:'＋ Создать КП без проекта',exact:true}).click();await editor.waitFor();
 for(let i=1;i<=2;i++){await editor.getByRole('button',{name:'＋ Добавить строку КП',exact:true}).click();await editor.getByLabel('Наименование строки '+i,{exact:true}).fill('Одинаковая ручная позиция');}
 await editor.getByLabel('Свойства строки 2',{exact:true}).click();await editor.getByLabel('Товар строки 2',{exact:true}).click();await page.getByRole('option').filter({hasText:product.name}).click();
 await waitUntil(async()=>await editor.locator('[data-quote-line]').count()===1&&(await editor.getByLabel('Наименование строки 1',{exact:true}).inputValue())===product.name,'Merged draft row receives selected product');assert.equal(Number(await editor.getByLabel('Количество строки 1',{exact:true}).inputValue()),2);assert.equal(Number(await editor.getByLabel('Цена строки 1',{exact:true}).inputValue()),100);
 assert.deepEqual(errors,[]);console.log('PASS: six linked identical supplies → one quantity 6 row → one quantity 3 row per room → combined, preserved money and draft product binding after duplicate merge');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
