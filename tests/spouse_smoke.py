"""Regresión de carga manual, mail, PDF y generación de los cuatro campos del cónyuge."""
import asyncio, os, tempfile
from pathlib import Path
from playwright.async_api import async_playwright

SITE = os.environ.get('BALANZ_TEST_URL', 'http://127.0.0.1:8001')

async def main():
 async with async_playwright() as p:
  browser = await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
  page = await browser.new_page()
  errors = []
  page.on('pageerror', lambda e: errors.append(str(e)))
  await page.goto(SITE + '/Alta_cotitular_Balanz.html')
  for key in ['conyuge_apellido', 'conyuge_nombre', 'conyuge_tipo_doc', 'conyuge_dni']:
   assert await page.locator('#f-' + key).is_visible(), key
  issues = await page.evaluate('AltaCore.validate(AltaUI.state(),{},[])')
  assert not any(i['k'].startswith('conyuge_') for i in issues if i['k'])
  await page.locator('#f-estado_civil').fill('Casada')
  issues = await page.evaluate('AltaCore.validate(AltaUI.state(),{},[])')
  assert {i['k'] for i in issues if i['k'] and i['k'].startswith('conyuge_')} == {'conyuge_apellido', 'conyuge_nombre', 'conyuge_tipo_doc', 'conyuge_dni'}
  await page.locator('#f-conyuge_apellido').fill('Gomez')
  await page.locator('#f-conyuge_nombre').fill('Juan Carlos')
  await page.locator('#f-conyuge_tipo_doc').select_option('Pasaporte')
  await page.locator('#f-conyuge_dni').fill('AB1234567')
  assert not any(i['k'] and i['k'].startswith('conyuge_') for i in await page.evaluate('AltaCore.validate(AltaUI.state(),{},[])'))
  # Changing marital status cannot silently discard explicitly supplied spouse data.
  await page.locator('#f-estado_civil').fill('')
  assert await page.evaluate('AltaCore.pdfValues(AltaUI.state()).conyuge_dni') == 'AB1234567'
  print('PASS: spouse fields always visible; optional when empty, required when applicable; passport preserved')
  # Type, number, names all reach the corresponding fields on both repeated pages.
  texts = await page.evaluate('''async () => {
    const bytes=Uint8Array.from(atob(document.getElementById('template-pdf').textContent.trim()),c=>c.charCodeAt(0));
    const out=await AltaCore.buildPdf(PDFLib,bytes,LAYOUT,AltaUI.state(),LETTERS);
    const lib=await import('./assets/import/pdf.min.mjs');
    lib.GlobalWorkerOptions.workerSrc='./assets/import/pdf.worker.min.mjs';
    const task=lib.getDocument({data:out,isEvalSupported:false});
    try {const doc=await task.promise,result={};
      for(const n of [1,20]) result[n]=(await (await doc.getPage(n)).getTextContent()).items.map(i=>i.str).join(' ');
      return result;
    } finally {await task.destroy();}
  }''')
  for n in ['1','20']:
   for value in ['Gomez','Juan Carlos','Pasaporte','AB1234567']:
    assert value in texts[n], (n,value)
  print('PASS: all four spouse fields printed on PDF pages 1 and 20')
  # An incomplete client PDF has spouse data only on page 1, no marital status.
  data = await page.evaluate('''async () => {
    const bytes=Uint8Array.from(atob(document.getElementById('template-pdf').textContent.trim()),c=>c.charCodeAt(0));
    const doc=await PDFLib.PDFDocument.load(bytes),form=doc.getForm();
    for(const [name,value] of Object.entries({'Apellido Conyuge':'GOMEZ','Nombre Conyuge':'JUAN CARLOS','Tipo de documento conyug':'Pasaporte','Numero de documento conyug':'AB1234567'})) form.getTextField(name).setText(value);
    return Array.from(await doc.save({updateFieldAppearances:false}));
  }''')
  with tempfile.TemporaryDirectory(prefix='balanz-spouse-') as temp:
   file=Path(temp)/'client.pdf';file.write_bytes(bytes(data))
   await page.reload()
   await page.locator('#import-files').set_input_files(str(file))
   await page.locator('#import-read').click()
   await page.locator('#import-review').wait_for(state='visible',timeout=60000)
   assert await page.locator('.import-value[data-key=conyuge_tipo_doc]').input_value() == 'Pasaporte'
   assert await page.locator('.import-value[data-key=conyuge_dni]').input_value() == 'AB1234567'
   await page.locator('#import-apply').click()
   assert await page.locator('#f-conyuge_apellido').input_value() == 'Gomez'
   assert await page.locator('#f-conyuge_nombre').input_value() == 'Juan Carlos'
   assert await page.locator('#f-conyuge_tipo_doc').input_value() == 'Pasaporte'
   assert await page.locator('#f-conyuge_dni').input_value() == 'AB1234567'
   assert await page.locator('#f-estado_civil').input_value() == ''
  print('PASS: PDF imports all spouse data without inventing marital status')
  # Mail accepts explicit document types and the existing DNI label.
  await page.locator('#src').fill('Apellido del cónyuge: Gomez\nNombre del cónyuge: Juan Carlos\nTipo de documento del cónyuge: Pasaporte\nNúmero de documento del cónyuge: AB1234567')
  await page.locator('#btn-read').click()
  assert await page.locator('#f-conyuge_tipo_doc').input_value() == 'Pasaporte'
  assert await page.locator('#f-conyuge_dni').input_value() == 'AB1234567'
  await page.locator('#src').fill('DNI del cónyuge: 30123456')
  await page.locator('#btn-read').click()
  assert await page.locator('#f-conyuge_tipo_doc').input_value() == 'D.N.I.'
  assert await page.evaluate('AltaCore.pdfValues(AltaUI.state()).conyuge_dni') == '30.123.456'
  await page.locator('#f-conyuge_dni').fill('123')
  assert any(i['k']=='conyuge_dni' and '7 u 8' in i['msg'] for i in await page.evaluate('AltaCore.validate(AltaUI.state(),{},[])'))
  print('PASS: spouse mail parsing, DNI formatting and validation')
  assert not errors, errors
  await browser.close()

asyncio.run(main())
