const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const frontend=process.env.FRAME_TEST_FRONTEND||'http://127.0.0.1:5174';
const backend=process.env.FRAME_TEST_BACKEND||'http://127.0.0.1:8014';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:1560,height:1000},permissions:['clipboard-read','clipboard-write']}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(String(error)));page.on('dialog',dialog=>dialog.accept());
  await page.route('**/api/**',route=>route.continue({url:route.request().url().replace(frontend,backend)}));
  const api=context.request,base=backend+'/api',token=String(Date.now());
  const project=await(await api.post(base+'/projects',{data:{name:'Фото и категории '+token}})).json();
  await page.goto(frontend);await page.getByLabel('Проект',{exact:true}).selectOption(String(project.id));
  await page.getByRole('button',{name:'Каталог и цены',exact:true}).first().click();
  const catalog=page.getByRole('dialog',{name:'Каталог оборудования',exact:true});
  await catalog.getByRole('button',{name:'Категории',exact:true}).click();
  const category='Спецкатегория '+token;
  await catalog.getByLabel('Название категории',{exact:true}).fill(category);
  await catalog.getByLabel('Описание категории',{exact:true}).fill('Создана без позиций');
  const categorySaved=page.waitForResponse(r=>r.url().endsWith('/categories')&&r.request().method()==='POST');
  await catalog.getByRole('button',{name:'Добавить категорию',exact:true}).click();assert.equal((await categorySaved).status(),201);
  await catalog.getByText(category,{exact:true}).waitFor();
  await catalog.getByRole('button',{name:'Номенклатура',exact:true}).click();
  const picker=catalog.getByLabel('Категория номенклатуры',{exact:true});
  await picker.click();assert.equal(await picker.inputValue(),'');assert.ok(await catalog.getByRole('option').count()>5,'Opening a selected category must show the full list');
  await picker.fill(category.slice(0,12));await catalog.getByRole('option',{name:category,exact:true}).click();
  await picker.click();assert.equal(await picker.inputValue(),'');assert.ok(await catalog.getByRole('option').count()>5,'Reopening must discard the old filter');
  await catalog.getByRole('option',{name:category,exact:true}).click();
  const kindName='Любой товар '+token;await catalog.getByLabel('Название номенклатуры',{exact:true}).fill(kindName);
  const kindSaved=page.waitForResponse(r=>r.url().endsWith('/types')&&r.request().method()==='POST');
  await catalog.getByRole('button',{name:'Добавить позицию',exact:true}).click();const kind=await(await kindSaved).json();assert.ok(kind.id);
  await catalog.getByRole('button',{name:'Товары и цены',exact:true}).click();
  const productForm=catalog.locator('.product-editor form');
  await productForm.getByLabel('Название',{exact:true}).fill('Фото товара '+token);
  await productForm.getByLabel('Тип',{exact:true}).selectOption(String(kind.id));
  // Paste text on a closed select: only clipboard text becomes the search query.
  await page.evaluate(async text=>navigator.clipboard.writeText(text),kindName);
  const type=productForm.getByLabel('Тип',{exact:true});await type.focus();await page.keyboard.press('Control+V');
  const search=catalog.getByRole('combobox',{name:'Поиск в списке: Тип',exact:true});await search.waitFor();assert.equal(await search.inputValue(),kindName);await search.press('Enter');
  await type.click();assert.ok(await catalog.getByRole('listbox',{name:'Тип',exact:true}).getByRole('option').count()>5);await catalog.getByRole('combobox',{name:'Поиск в списке: Тип',exact:true}).press('Escape');
  async function copyPhoto(color){await page.evaluate(async color=>{const c=document.createElement('canvas');c.width=80;c.height=60;const ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,80,60);const blob=await new Promise(resolve=>c.toBlob(resolve,'image/png'));await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);},color);}
  async function dropPhoto(target,color){await target.evaluate((node,color)=>{const canvas=document.createElement('canvas');canvas.width=60;canvas.height=80;const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,60,80);const raw=atob(canvas.toDataURL('image/png').split(',')[1]);const data=new DataTransfer();data.items.add(new File([Uint8Array.from(raw,c=>c.charCodeAt(0))],'drop.png',{type:'image/png'}));document.querySelector('header').dispatchEvent(new DragEvent('dragenter',{bubbles:true,cancelable:true,dataTransfer:data}));for(const name of ['dragenter','dragover','drop'])node.dispatchEvent(new DragEvent(name,{bubbles:true,cancelable:true,dataTransfer:data}));},color);}
  // An image paste while the name input is focused belongs to this product; the text remains intact.
  await copyPhoto('#21c567');await productForm.getByLabel('Название',{exact:true}).focus();await page.keyboard.press('Control+V');
  await productForm.locator('.image-field img').waitFor();assert.equal(await productForm.getByLabel('Название',{exact:true}).inputValue(),'Фото товара '+token);
  const first=await productForm.locator('.image-field img').getAttribute('src');
  await dropPhoto(productForm.locator('.image-field'),'#3366ee');await page.waitForFunction(previous=>document.querySelector('.product-editor .image-field img')?.getAttribute('src')!==previous,first);
  assert.equal(await page.locator('.pdf-drop-overlay').count(),0,'An image drop must not open the project PDF importer');
  const photo=await productForm.locator('.image-field img').getAttribute('src');
  const productSaved=page.waitForResponse(r=>r.url().endsWith('/products')&&r.request().method()==='POST');
  await productForm.getByRole('button',{name:'Добавить товар',exact:true}).click();assert.equal((await productSaved).status(),201);
  await catalog.getByText('Товар добавлен',{exact:true}).waitFor();
  const products=(await(await api.get(base+'/catalog')).json()).products;assert.equal(products.find(p=>p.name==='Фото товара '+token).parameters.image,photo);
  await catalog.getByRole('button',{name:'Закрыть каталог',exact:true}).click();
  await page.getByRole('button',{name:'КП',exact:true}).click();
  const editor=page.getByRole('region',{name:'Редактор коммерческого предложения',exact:true});
  await editor.getByRole('button',{name:'＋ Добавить строку КП',exact:true}).click();
  const row=editor.locator('[data-quote-line]').first();await copyPhoto('#f08020');await row.getByLabel('Наименование строки 1',{exact:true}).focus();await page.keyboard.press('Control+V');await row.locator('.quotation-line-name img').waitFor();await row.locator('summary').click();await row.locator('.image-field img').waitFor();
  const rowPhoto=await row.locator('.image-field img').getAttribute('src');await dropPhoto(row.locator('.image-field'),'#7733ee');await page.waitForFunction(previous=>document.querySelector('[data-quote-line] .image-field img')?.getAttribute('src')!==previous,rowPhoto);
  await row.getByRole('button',{name:'＋ Товар в базу',exact:true}).click();
  const productModal=page.getByRole('dialog',{name:'Новый товар из КП',exact:true});
  await productModal.getByLabel('Номенклатура нового товара КП',{exact:true}).selectOption(String(kind.id));
  await productModal.getByLabel('Производитель нового товара КП',{exact:true}).fill('Производитель фото '+token);
  const beforePaste=await productModal.locator('.image-field img').getAttribute('src');
  await copyPhoto('#d4a522');await productModal.getByLabel('Название нового товара КП',{exact:true}).focus();await page.keyboard.press('Control+V');await page.waitForFunction(previous=>document.querySelector('[aria-label="Новый товар из КП"] .image-field img')?.getAttribute('src')!==previous,beforePaste);
  const modalPhoto=await productModal.locator('.image-field img').getAttribute('src');
  await productModal.getByRole('button',{name:'Создать и привязать товар',exact:true}).click();await productModal.waitFor({state:'detached'});
  await row.locator('.quotation-line-name img').waitFor();assert.equal(await row.locator('.quotation-line-name img').getAttribute('src'),modalPhoto);
  await editor.getByRole('button',{name:'Предпросмотр',exact:true}).click();await editor.locator('.quotation-pdf-page').waitFor();assert.ok((await editor.locator('.quotation-pdf-page').getAttribute('src')).startsWith('blob:'));
  await editor.locator('.quotation-paper').screenshot({path:'/tmp/quotation-pdf-preview.png'});
  const quotePath=base+'/projects/'+project.id+'/quotation';const saved=await(await api.get(quotePath)).json();
  const response=await api.put(quotePath,{data:{...saved,lines:Array.from({length:40},(_,i)=>({id:'preview-'+i,name:'Строка предпросмотра '+(i+1),quantity:'2',unit_price:'100'}))}});assert.equal(response.status(),200);
  await page.reload();await page.getByLabel('Проект',{exact:true}).selectOption(String(project.id));await page.getByRole('button',{name:'КП',exact:true}).click();await editor.getByRole('button',{name:'Предпросмотр',exact:true}).click();
  await editor.locator('.quotation-pdf-page').waitFor();await editor.getByRole('button',{name:'Далее',exact:true}).click();await editor.getByAltText('Страница 2 PDF КП',{exact:true}).waitFor();
  await editor.getByRole('button',{name:'Назад',exact:true}).click();await editor.getByAltText('Страница 1 PDF КП',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);console.log('Photo clipboard/drop, editable categories, fresh search and actual PDF preview: OK');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
