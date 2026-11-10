const {chromium}=require('playwright');
// Run against an isolated backend: NODE_PATH=<playwright node_modules> node frontend/tests/frames.cjs
const frontend=process.env.FRAME_TEST_FRONTEND || 'http://127.0.0.1:5174';
const backend=process.env.FRAME_TEST_BACKEND || 'http://127.0.0.1:8014';
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE || chromium.executablePath(),headless:true,args:['--no-sandbox']});
 try {
 const context=await browser.newContext({viewport:{width:1600,height:1100}});
 const page=await context.newPage(); const errors=[];const writes=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.route('**/api/**',route=>route.continue({url:route.request().url().replace(frontend,backend)}));
 page.on('request',r=>{if(r.method()==='PUT'&&r.url().includes('/elements/'))writes.push(r.postDataJSON());});
 const api=context.request, base=backend+'/api';
 const project=await (await api.post(base+'/projects',{data:{name:'Frame regression '+Date.now()}})).json();
 const pid=project.id;
 const sheets=await (await api.post(base+`/projects/${pid}/pdf`,{multipart:{file:{name:'plan.pdf',mimeType:'application/pdf',buffer:Buffer.from('JVBERi0xLjcKJcK1wrYKJSBXcml0dGVuIGJ5IE11UERGIDEuMjguMgoKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFIvSW5mbzw8L1Byb2R1Y2VyKE11UERGIDEuMjguMik+Pj4+CmVuZG9iagoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0NvdW50IDEvS2lkc1s0IDAgUl0+PgplbmRvYmoKCjMgMCBvYmoKPDw+PgplbmRvYmoKCjQgMCBvYmoKPDwvVHlwZS9QYWdlL01lZGlhQm94WzAgMCA1OTUgODQyXS9Sb3RhdGUgMC9SZXNvdXJjZXMgMyAwIFIvUGFyZW50IDIgMCBSPj4KZW5kb2JqCgp4cmVmCjAgNQowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwNDIgMDAwMDAgbiAKMDAwMDAwMDEyMCAwMDAwMCBuIAowMDAwMDAwMTcyIDAwMDAwIG4gCjAwMDAwMDAxOTMgMDAwMDAgbiAKCnRyYWlsZXIKPDwvU2l6ZSA1L1Jvb3QgMSAwIFIvSURbPEMyOUIyMEMyQjRDMkJDNTZDMzhBMkIxMjE4QzI4M0MyPjwxMUMwRDIyMDM3NzE0QkMxRjgyRDE0RDA3ODUxNUM1Mj5dPj4Kc3RhcnR4cmVmCjI4NAolJUVPRgo=','base64')}}})).json();
 const p=await (await api.get(base+`/projects/${pid}`)).json();
 const types=await (await api.get(base+'/types')).json();
 const type=types.find(x=>x.name==='Розетка одинарная');
 for(let i=0;i<2;i++)assert.equal((await api.post(base+`/projects/${pid}/elements`,{data:{page_id:sheets[0].id,layer_id:p.layers[0].id,type_id:type.id,room_id:null,product_id:null,x:.25+i*.15,y:.3,parameters:{quantity:1,ip:20},geometry:{}}})).status(),201);
 async function tool(name){const button=page.getByRole('button',{name:'Инструмент: '+name,exact:true});if(await button.getAttribute('aria-pressed')!=='true')await button.click();}
 await page.goto(frontend);
 await page.getByLabel('Проект',{exact:true}).selectOption(String(pid));
 await page.locator('.point-symbol').first().waitFor();
 const getElements=async()=> (await (await api.get(base+`/projects/${pid}`)).json()).elements;
 await page.locator('.point-symbol').first().click();
 await tool('Рамки');await page.getByRole('button',{name:'Назначить рамку',exact:true}).click();
 await page.locator('.frame-group-outline').waitFor();
 await page.waitForTimeout(1600);
 let elements=await getElements();
 assert.ok(elements[0].parameters.frame_group,'Frame vanished after autosave; PUT requests: '+JSON.stringify(writes));
 assert.equal(await page.locator('.frame-group-outline').count(),1);
 assert.equal(writes.length,0,'Frame assignment must not trigger an element autosave');
 await tool('Свойства');await page.getByLabel('Комментарий').fill('Property edit preserves frame');
 await page.waitForTimeout(1400);
 assert.ok((await getElements())[0].parameters.frame_group);
 await tool('Рамки');await page.getByRole('button',{name:'Убрать рамку',exact:true}).click();
 await page.waitForTimeout(1600);
 assert.ok((await getElements()).every(x=>!x.parameters.frame_group),'Removed frame was restored by autosave');
 // An edit immediately followed by assignment must not be lost.
 await tool('Свойства');await page.getByLabel('Комментарий').fill('Pending edit before assignment');
 await tool('Рамки');await page.getByRole('button',{name:'Назначить рамку',exact:true}).click();
 await page.waitForTimeout(1600);
 elements=await getElements();
 assert.equal(elements[0].comment,'Pending edit before assignment');
 assert.ok(elements[0].parameters.frame_group);
 await tool('Рамки');await page.getByRole('button',{name:'Убрать рамку',exact:true}).click();
 await page.waitForTimeout(1600);
 await page.locator('.point-symbol').nth(1).click({modifiers:['Control']});
 await page.locator('.point-symbol').nth(1).click({button:'right'});
 await page.getByRole('button',{name:'Объединить в рамку · 2',exact:true}).click();
 await page.waitForTimeout(1600);
 elements=await getElements();
 assert.ok(elements.every(x=>x.parameters.frame_group===elements[0].parameters.frame_group && x.parameters.frame_posts===2));
 assert.equal((await (await api.get(base+`/projects/${pid}/report`)).json()).summary.frame_total,1);
 await page.reload();
 await page.getByLabel('Проект',{exact:true}).selectOption(String(pid));
 await page.locator('.frame-group-outline').waitFor();
 await page.locator('.point-symbol').first().click({button:'right'});
 await page.getByRole('button',{name:'Убрать из рамки',exact:true}).click();
 await page.waitForTimeout(1600);
 assert.ok((await getElements()).every(x=>!x.parameters.frame_group));
 assert.equal(await page.locator('.frame-group-outline').count(),0);
 assert.deepEqual(errors,[]);
 console.log('PASS: single and multi-object frames, pending edits, property autosave, reload, removal via both controls');
 await browser.close();
 }finally {if(browser.isConnected())await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
