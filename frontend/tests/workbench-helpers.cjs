const assert=require('node:assert/strict');
function blankPdf(width=1000,height=700){
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << >> >>`];
  let source='%PDF-1.7\n',offsets=[0];
  objects.forEach((body,index)=>{offsets.push(Buffer.byteLength(source));source+=`${index+1} 0 obj\n${body}\nendobj\n`;});
  const xref=Buffer.byteLength(source);source+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(value=>String(value).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(source);
}
async function checked(response){assert.ok(response.ok(),`${response.status()} ${(await response.text()).slice(0,300)}`);return response.json();}
async function tool(page,name){const button=page.getByRole('button',{name:'Инструмент: '+name,exact:true});if(await button.getAttribute('aria-pressed')!=='true')await button.click();}
async function waitUntil(fn,message,attempts=60){for(let i=0;i<attempts;i++){if(await fn())return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error(message);}
module.exports={blankPdf,checked,tool,waitUntil};
