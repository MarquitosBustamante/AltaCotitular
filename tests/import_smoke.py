import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
import os,tempfile
ROOT=Path(tempfile.mkdtemp(prefix='balanz-import-'))
SITE=os.environ.get('BALANZ_TEST_URL','http://127.0.0.1:8001')
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
  page=await b.new_page(accept_downloads=True)
  errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.on('console',lambda m:print('CONSOLE',m.text[:300]) if m.type=='error' else None)
  await page.goto(SITE+'/Alta_cotitular_Balanz.html')
  # A client completed page 1 only. Page 20 is empty.
  data=await page.evaluate('''async()=>{
    const bytes=Uint8Array.from(atob(document.getElementById('template-pdf').textContent.trim()),c=>c.charCodeAt(0));
    const doc=await PDFLib.PDFDocument.load(bytes),form=doc.getForm();
    for(const [name,value] of Object.entries({'Apellido':'PEREZ, LUCIA ANDREA','Numero de documento':'35123456','email':'lucia@example.com','Domicilio de residencia':'Av. Siempre Viva 742','Localidad':'Rosario','Sexo':'Femenino','Fecha de nacimiento':'04/07/1990'})) form.getTextField(name).setText(value);
    form.getDropdown('Dropdown1').select('D.N.I.');
    return Array.from(await doc.save({updateFieldAppearances:false}));
  }''')
  (ROOT/'client.pdf').write_bytes(bytes(data))
  await page.locator('#import-files').set_input_files(str(ROOT/'client.pdf'))
  await page.locator('#import-read').click()
  await page.locator('#import-review').wait_for(state='visible',timeout=30000)
  rows=await page.locator('.import-value').evaluate_all('(els)=>Object.fromEntries(els.map(e=>[e.dataset.key,e.value]))')
  print('WIDGET RESULTS',json.dumps(rows,ensure_ascii=False))
  assert rows['dni']=='35123456' and rows['nombres']=='LUCIA ANDREA' and rows['apellidos']=='PEREZ',rows
  assert rows['email']=='lucia@example.com',rows
  assert 'pep' not in rows, 'Must not import a template default as client data'
  await page.locator('#import-apply').click()
  state=await page.evaluate('AltaUI.state()')
  assert state['dni']=='35123456' and state['nombres']=='LUCIA ANDREA',state
  # Rebuild from the blank master, then inspect text at page 1 and page 20.
  rebuilt=await page.evaluate('''async()=>{
    const bytes=Uint8Array.from(atob(document.getElementById('template-pdf').textContent.trim()),c=>c.charCodeAt(0));
    const out=await AltaCore.buildPdf(PDFLib,bytes,LAYOUT,AltaUI.state(),LETTERS);
    const pdfjs=await import('./assets/import/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc='./assets/import/pdf.worker.min.mjs';
    const doc=await pdfjs.getDocument({data:out,isEvalSupported:false}).promise;
    const result={};
    for(const n of [1,20]) result[n]=(await (await doc.getPage(n)).getTextContent()).items.map(i=>i.str).join(' ');
    await doc.loadingTask.destroy();return result;
  }''')
  for n in ['1','20']:
   assert 'PEREZ, LUCIA ANDREA' in rebuilt[n] and '35.123.456' in rebuilt[n],rebuilt[n]
  print('PASS: generated PDF repeats name and DNI on pages 1 and 20')
  # Flat PDF with no widgets + raster for OCR.
  flat=await page.evaluate('''async()=>{
    const bytes=Uint8Array.from(atob(document.getElementById('template-pdf').textContent.trim()),c=>c.charCodeAt(0));
    const state=AltaUI.state();
    const out=await AltaCore.buildPdf(PDFLib,bytes,LAYOUT,state,LETTERS);
    const pdfjs=await import('./assets/import/pdf.min.mjs');
    const doc=await pdfjs.getDocument({data:out.slice(),isEvalSupported:false}).promise;
    const pg=await doc.getPage(1),vp=pg.getViewport({scale:2.5});
    const canvas=document.createElement('canvas');canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);
    await pg.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
    const png=canvas.toDataURL();await doc.loadingTask.destroy();
    const single=await PDFLib.PDFDocument.create(),source=await PDFLib.PDFDocument.load(out);
    // Fixture aplanada real: solo texto impreso, sin widgets ni formulario.
    source.getPages().forEach(p=>p.node.delete(PDFLib.PDFName.of('Annots')));
    source.catalog.delete(PDFLib.PDFName.of('AcroForm'));
    single.addPage((await single.copyPages(source,[0]))[0]);
    return {pdf:Array.from(await single.save()),png};
  }''')
  (ROOT/'flat.pdf').write_bytes(bytes(flat['pdf']))
  import base64
  (ROOT/'client.png').write_bytes(base64.b64decode(flat['png'].split(',')[1]))
  for file in ['flat.pdf','client.png']:
   await page.reload()
   await page.locator('#import-files').set_input_files(str(ROOT/file))
   await page.locator('#import-read').click()
   try: await page.locator('#import-review').wait_for(state='visible',timeout=60000)
   except: print('FAILED STATUS',await page.locator('#import-status').inner_text());raise
   rows=await page.locator('.import-value').evaluate_all('(els)=>Object.fromEntries(els.map(e=>[e.dataset.key,e.value]))')
   print(file,'RESULTS',json.dumps(rows,ensure_ascii=False))
   assert rows['dni']=='35123456',rows
   if file=='flat.pdf':
    assert rows['email']=='lucia@example.com',rows
   else:
    # OCR can confuse @ with Q: uncertain/invalid text must require correction.
    check=page.locator('input[type=checkbox][data-key=email]')
    if rows['email']!='lucia@example.com':
     assert not await check.is_checked()
     await page.locator('.import-value[data-key=email]').fill('lucia@example.com')
     await check.check()
     await page.locator('#import-apply').click()
     assert await page.locator('#f-email').input_value()=='lucia@example.com'
     print('PASS: uncertain OCR email requires review and can be corrected')
     continue
   assert 'lucia' in rows['nombres'].lower(),rows
   await page.locator('#import-back').click()
  # Existing edits and extra account holders survive an import unless explicitly selected.
  await page.reload()
  await page.locator('#f-dni').fill('99999999')
  await page.locator('#f-titular_nombre').fill('Titular existente')
  await page.locator('#add-holder').click()
  await page.locator('#f-titular_extra_0_nombre').fill('Segundo titular')
  await page.locator('#import-files').set_input_files(str(ROOT/'client.pdf'))
  await page.locator('#import-read').click()
  await page.locator('#import-review').wait_for(state='visible',timeout=60000)
  assert not await page.locator('input[type=checkbox][data-key=dni]').is_checked()
  await page.locator('#import-apply').click()
  state=await page.evaluate('AltaUI.state()')
  assert state['dni']=='99999999' and state['titular_nombre']=='Titular existente'
  assert state['titulares_adicionales'][0]['nombre']=='Segundo titular'
  print('PASS: import preserves existing edits and additional holders')
  # A scan is a PDF containing only a page image, without text or widgets.
  scan=await page.evaluate('''async data=>{
    const doc=await PDFLib.PDFDocument.create(),image=await doc.embedPng(data);
    const pg=doc.addPage([595.28,841.89]);pg.drawImage(image,{x:0,y:0,width:595.28,height:841.89});
    return Array.from(await doc.save());
  }''',flat['png'])
  (ROOT/'scan.pdf').write_bytes(bytes(scan))
  await page.reload()
  await page.locator('#import-files').set_input_files(str(ROOT/'scan.pdf'))
  await page.locator('#import-read').click()
  await page.locator('#import-review').wait_for(state='visible',timeout=120000)
  assert await page.locator('.import-value[data-key=dni]').input_value()=='35123456'
  await page.locator('#import-back').click()
  assert not (await page.evaluate('AltaUI.state()'))['dni']
  print('PASS: scanned PDF OCR; discarding does not change data')
  # Malformed files and cancellation leave the form untouched and allow retry.
  (ROOT/'broken.pdf').write_bytes(b'%PDF-this-is-not-a-valid-pdf')
  await page.locator('#import-files').set_input_files(str(ROOT/'broken.pdf'))
  await page.locator('#import-read').click()
  await page.wait_for_function("!document.getElementById('import-read').disabled")
  assert 'No se pudo completar' in await page.locator('#import-status').inner_text()
  assert not (await page.evaluate('AltaUI.state()'))['dni']
  await page.locator('#import-files').set_input_files(str(ROOT/'client.png'))
  await page.locator('#import-read').click()
  await page.locator('#import-cancel').click()
  await page.wait_for_function("!document.getElementById('import-read').disabled",timeout=60000)
  assert 'cancelada' in await page.locator('#import-status').inner_text()
  assert not (await page.evaluate('AltaUI.state()'))['dni']
  print('PASS: corrupt file and cancellation do not change data')
  assert not errors,errors
  print('PASS: PDF widgets, flattened PDF, image OCR, rebuilt page 20; no JS errors')
  await b.close()
asyncio.run(main())
