const {chromium}=require('playwright'),assert=require('node:assert/strict');
const {blankPdf,checked,tool,waitUntil}=require('./workbench-helpers.cjs');
const frontend=process.env.FRAME_TEST_FRONTEND||'http://127.0.0.1:5174',backend=process.env.FRAME_TEST_BACKEND||'http://127.0.0.1:8014';
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),headless:true,args:['--no-sandbox']});try{
 const context=await browser.newContext({viewport:{width:1600,height:1000}}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(String(error)));await page.route('**/api/**',route=>route.continue({url:route.request().url().replace(frontend,backend)}));
 const api=context.request,base=backend+'/api',project=await checked(await api.post(base+'/projects',{data:{name:'Minimal symbols '+Date.now()}})),pid=project.id;
 const pages=await checked(await api.post(base+`/projects/${pid}/pdf`,{multipart:{file:{name:'plan.pdf',mimeType:'application/pdf',buffer:blankPdf(1000,700)}}})),data=await checked(await api.get(base+`/projects/${pid}`)),types=await checked(await api.get(base+'/types'));
 const fixtures={'Встроенный светильник':'recessed','Накладной светильник':'surface','Люстра':'chandelier','Бра':'sconce','Подвес':'pendant','Spot':'spot','Линейное освещение':'linear','Wall washer':'wall_washer'};
 const placed=[],lights=data.layers.find(layer=>layer.name==='Освещение'),electrical=data.layers.find(layer=>layer.name==='Электроустановки');
 for(const [i,name] of [...Object.keys(fixtures),'Розетка одинарная','Выключатель','Диммер'].entries()){
  const kind=types.find(type=>type.name===name);const item=await checked(await api.post(base+`/projects/${pid}/elements`,{data:{page_id:pages[0].id,layer_id:kind.category==='Освещение'?lights.id:electrical.id,type_id:kind.id,x:.12+(i%4)*.21,y:.2+Math.floor(i/4)*.22,parameters:{quantity:1,ip:20}}}));placed.push({item,kind});
 }
 await page.goto(frontend);await page.getByLabel('Проект',{exact:true}).selectOption(String(pid));await page.locator('[data-element-id]').first().waitFor();
 for(const {item,kind} of placed){const node=page.locator(`[data-element-id="${item.id}"] .editable-plan-symbol`);assert.equal(await node.getAttribute('data-presentation'),'outline');if(fixtures[kind.name])assert.equal(await node.getAttribute('data-glyph'),fixtures[kind.name]);}
 const circle=page.locator(`[data-element-id="${placed[0].item.id}"] .editable-plan-symbol>g>circle`),bounds=await circle.boundingBox();assert.ok(bounds.width<15&&Math.abs(bounds.width-bounds.height)<.5,'Default symbols must be smaller and proportionate');assert.equal(await circle.getAttribute('fill'),'#ffffff');
 assert.equal(new Set(placed.slice(0,8).map(({kind})=>kind.color)).size,8);
 for(let i=0;i<4;i++)await page.getByRole('button',{name:'Уменьшить план',exact:true}).click();
 assert.equal(await page.locator('[data-element-id] .object-label').count(),0,'Distant labels should not overlap');assert.equal(await page.locator('[data-element-id] use').count(),0,'Distant icons omit small details');
 await page.getByRole('button',{name:'Сброс',exact:true}).click();
 await circle.click();await tool(page,'Свойства');await page.getByLabel('Комментарий',{exact:true}).fill('Saved before hiding fixture');
 await tool(page,'Слои');const right=page.getByRole('complementary',{name:'Слои и страницы',exact:true});await right.getByRole('button',{name:'Группы слоя Освещение',exact:true}).click();
 const groups=right.getByRole('group',{name:'Видимость групп: Освещение',exact:true});
 const labels=['Встраиваемые светильники','Накладные светильники','Бра'].map(name=>'Показывать '+name+' в слое Освещение');
 // Queue several changes in the same event loop to expose stale-state races.
 await groups.evaluate((node,labels)=>{for(const label of labels)node.querySelector(`input[aria-label="${label}"]`).click();},labels);
 await waitUntil(async()=>{const p=await checked(await api.get(base+`/projects/${pid}`));return p.layers.find(layer=>layer.id===lights.id).hidden_groups.length===3&&p.elements.find(item=>item.id===placed[0].item.id).comment==='Saved before hiding fixture';},'Rapid group choices or pending edit did not persist');
 await waitUntil(async()=>await page.locator('[data-element-id]').count()===8,'Three fixture groups should disappear');
 assert.equal(await page.locator('.selected-point-object').count(),0,'A hidden group must not keep a selected object');
 const saved=await checked(await api.get(base+`/projects/${pid}`));assert.equal(saved.elements.length,11);const report=await checked(await api.get(base+`/projects/${pid}/report`));assert.equal(report.rows.reduce((sum,row)=>sum+row.quantity,0),11);
 await right.getByRole('button',{name:'Группы слоя Электроустановки',exact:true}).click();const eui=right.getByRole('group',{name:'Видимость групп: Электроустановки',exact:true});await eui.getByLabel('Показывать Розетки в слое Электроустановки',{exact:true}).uncheck();
 await waitUntil(async()=>await page.locator('[data-element-id]').count()===7,'EUI group should hide independently');
 await page.locator('.sheet>svg').focus();await page.keyboard.press('Control+a');assert.equal(await page.locator('.selected-point-object').count(),7);
 await page.reload();await page.getByLabel('Проект',{exact:true}).selectOption(String(pid));await page.locator('[data-element-id]').first().waitFor();assert.equal(await page.locator('[data-element-id]').count(),7,'Filters must survive reload');
 await tool(page,'Слои');await right.getByRole('button',{name:'Группы слоя Освещение',exact:true}).click();await groups.getByRole('button',{name:'Показать все',exact:true}).click();await waitUntil(async()=>await page.locator('[data-element-id]').count()===10,'Show all restores only its layer');
 await page.waitForFunction(()=>!document.querySelector('header button[aria-label="Настройки"]')?.disabled);
 await page.locator('.sheet>svg').focus();await page.keyboard.press('Control+z');await waitUntil(async()=>await page.locator('[data-element-id]').count()===7,'Layer filters must support undo');await page.keyboard.press('Control+Shift+z');await waitUntil(async()=>await page.locator('[data-element-id]').count()===10,'Layer filter redo');
 await page.screenshot({path:process.env.PLAN_GROUP_SCREENSHOT||'/tmp/plan-groups.png'});
 const other=await checked(await api.post(base+'/projects',{data:{name:'Independent group visibility'}}));assert.ok((await checked(await api.get(base+'/projects/'+other.id))).layers.every(layer=>layer.hidden_groups.length===0));
 assert.deepEqual(errors,[]);console.log('PASS: minimal outlined symbols, eight fixture families/colors, zoom detail and label reduction, nested layer groups, rapid multi-hide, draft save, EUI isolation, report invariance, reload and undo/redo');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
