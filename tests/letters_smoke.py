"""Las cartas finales recuperan titular y DNI sin tomar al cotitular ni la firma."""
import asyncio, os, tempfile, base64
from pathlib import Path
from playwright.async_api import async_playwright
SITE=os.environ.get('BALANZ_TEST_URL','http://127.0.0.1:8001')
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
  page=await browser.new_page();errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto(SITE+'/Alta_cotitular_Balanz.html')
  fixtures=await page.evaluate('''async()=>{
    const bytes=Uint8Array.from(atob(document.getElementById('template-pdf').textContent.trim()),c=>c.charCodeAt(0));
    const s=AltaCore.emptyState();Object.assign(s,{titular_nombre:'Juan Carlos Gomez',titular_dni:'25111222',nombres:'Lucia',apellidos:'Perez',dni:'35123456',tipo_doc:'D.N.I.',comitente:'123456',cuotapartista:'654321'});
    const complete=await AltaCore.buildPdf(PDFLib,bytes,LAYOUT,s,LETTERS);
    const source=await PDFLib.PDFDocument.load(complete),pages=source.getPages();
    const font=await source.embedFont(PDFLib.StandardFonts.Helvetica);
    for(const [i,pg] of pages.slice(-2).entries()) {
      const signatureY=LETTERS[i].static.find(s=>s.t==='Firma del Titular').y+25;
      // Firma sintética: contiene un nombre distinto del escrito bajo «Aclaración».
      pg.drawText('FIRMADO: OTRO NOMBRE',{x:85,y:signatureY,size:9,font});
      pg.drawLine({start:{x:90,y:signatureY+6},end:{x:220,y:signatureY+15},thickness:2});
    }
    const signed=await source.save({updateFieldAppearances:false});
    const letters=await PDFLib.PDFDocument.create();
    for(const pg of await letters.copyPages(source,[pages.length-2,pages.length-1])) letters.addPage(pg);
    const missing=AltaCore.emptyState();Object.assign(missing,{nombres:'Lucia',apellidos:'Perez',dni:'35123456'});
    const blankHolder=await AltaCore.buildPdf(PDFLib,bytes,LAYOUT,missing,LETTERS);
    const blankSource=await PDFLib.PDFDocument.load(blankHolder),editableLetters=await PDFLib.PDFDocument.create();
    for (const pg of await editableLetters.copyPages(blankSource,[blankSource.getPageCount()-2,blankSource.getPageCount()-1])) editableLetters.addPage(pg);
    for (const [i,pg] of editableLetters.getPages().entries()) for (const [key,value] of Object.entries({titular_nombre:s.titular_nombre,titular_dni:s.titular_dni})) {
      const q=LETTERS[i].values[key],f=editableLetters.getForm().createTextField(key+'_'+i);
      f.setText(value);f.addToPage(pg,{x:q.x,y:q.y-2,width:key==='titular_nombre'?400:150,height:13,borderWidth:0});
    }
    // Las dos cartas discrepan: la revisión debe exigir elegir el valor correcto.
    const conflict=await PDFLib.PDFDocument.load(signed),last=conflict.getPages().at(-1);
    last.drawRectangle({x:80,y:375,width:460,height:42,color:PDFLib.rgb(1,1,1)});
    // Para que no queden textos ocultos bajo el rectángulo, reemplazar la última carta por otra.
    conflict.removePage(conflict.getPageCount()-1);
    const different=await AltaCore.buildPdf(PDFLib,bytes,LAYOUT,{...s,titular_nombre:'Maria Fernandez',titular_dni:'27111222'},LETTERS);
    const differentDoc=await PDFLib.PDFDocument.load(different);
    conflict.addPage((await conflict.copyPages(differentDoc,[differentDoc.getPageCount()-1]))[0]);
    // Una carta escaneada no contiene texto seleccionable.
    const lib=await import('./assets/import/pdf.min.mjs');lib.GlobalWorkerOptions.workerSrc='./assets/import/pdf.worker.min.mjs';
    const task=lib.getDocument({data:signed.slice(),isEvalSupported:false});const read=await task.promise;
    const pg=await read.getPage(read.numPages),vp=pg.getViewport({scale:2.5});
    const canvas=document.createElement('canvas');canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);
    await pg.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
    const scan=await PDFLib.PDFDocument.create(),image=await scan.embedPng(canvas.toDataURL());
    const scanned=scan.addPage([595.304,841.89]);scanned.drawImage(image,{x:0,y:0,width:595.304,height:841.89});
    await task.destroy();
    function encoded(bytes) {let chunks=[];for(let n=0;n<bytes.length;n+=32768)chunks.push(String.fromCharCode(...bytes.subarray(n,n+32768)));return btoa(chunks.join(''));}
    return {editable:encoded(await editableLetters.save()),signed:encoded(signed),letters:encoded(await letters.save()),missing:encoded(blankHolder),conflict:encoded(await conflict.save({updateFieldAppearances:false})),scan:encoded(await scan.save())};
  }''')
  with tempfile.TemporaryDirectory(prefix='balanz-letters-') as temp:
   root=Path(temp)
   for name,data in fixtures.items(): (root/(name+'.pdf')).write_bytes(base64.b64decode(data))
   async def load(name):
    await page.reload()
    await page.locator('#import-files').set_input_files(str(root/(name+'.pdf')))
    await page.locator('#import-read').click()
    await page.wait_for_function("!document.getElementById('import-read').disabled",timeout=120000)
    assert await page.locator('#import-review').is_visible(),await page.locator('#import-status').inner_text()
   for name in ['signed','letters','editable','scan']:
    await load(name)
    rows=await page.locator('.import-value').evaluate_all('(es)=>Object.fromEntries(es.map(e=>[e.dataset.key,e.value]))')
    assert rows.get('titular_nombre')=='Juan Carlos Gomez',(name,rows)
    assert rows.get('titular_dni')=='25111222',(name,rows)
    assert 'OTRO NOMBRE' not in rows['titular_nombre']
    if name=='scan':
     await page.locator('input[type=checkbox][data-key=titular_nombre]').check()
     await page.locator('input[type=checkbox][data-key=titular_dni]').check()
    await page.locator('#import-apply').click()
    assert await page.locator('#f-titular_nombre').input_value()=='Juan Carlos Gomez'
    assert await page.locator('#f-titular_dni').input_value()=='25111222'
    print('PASS: titular y DNI recuperados de',name,'sin confundir firma ni cotitular')
    if name=='signed':
     regenerated=await page.evaluate('''async()=>{
       const bytes=Uint8Array.from(atob(document.getElementById('template-pdf').textContent.trim()),c=>c.charCodeAt(0));
       const out=await AltaCore.buildPdf(PDFLib,bytes,LAYOUT,AltaUI.state(),LETTERS);
       const lib=await import('./assets/import/pdf.min.mjs'),task=lib.getDocument({data:out,isEvalSupported:false});
       try{const d=await task.promise;return (await (await d.getPage(d.numPages)).getTextContent()).items.map(i=>i.str).join(' ');}finally{await task.destroy();}
     }''')
     assert 'Juan Carlos Gomez' in regenerated and '25.111.222' in regenerated
     assert 'FIRMADO: OTRO NOMBRE' not in regenerated
     print('PASS: el PDF nuevo incluye al titular recuperado y no conserva la firma anterior')
   await load('missing')
   assert await page.locator('.import-value[data-key=titular_nombre]').count()==0
   assert await page.locator('.import-value[data-key=titular_dni]').count()==0
   print('PASS: no se inventa titular a partir del cotitular cuando falta la aclaración')
   await load('conflict')
   assert not await page.locator('input[type=checkbox][data-key=titular_nombre]').is_checked()
   assert not await page.locator('input[type=checkbox][data-key=titular_dni]').is_checked()
   assert 'Maria Fernandez' in await page.locator('#import-results').inner_text()
   print('PASS: discrepancias entre las dos cartas requieren revisión')
  assert not errors,errors
  await browser.close()
asyncio.run(main())
