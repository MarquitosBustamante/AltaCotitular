"""Los datos impresos quedan fijos; los campos pendientes siguen editables."""
import asyncio, os
from playwright.async_api import async_playwright

SITE=os.environ.get('BALANZ_TEST_URL','http://127.0.0.1:8001')

async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
  page=await browser.new_page(accept_downloads=True)
  errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto(SITE+'/Alta_cotitular_Balanz.html')
  result=await page.evaluate('''async()=>{
    const bytes=Uint8Array.from(atob(document.getElementById('template-pdf').textContent.trim()),c=>c.charCodeAt(0));
    const state=AltaCore.emptyState();
    Object.assign(state,{apellidos:'Perez',nombres:'Lucia',dni:'35123456',tipo_doc:'D.N.I.',cuil:'27351234569',firma:'indistinta'});
    const out=await AltaCore.buildPdf(PDFLib,bytes,LAYOUT,state,LETTERS);
    const lib=await import('./assets/import/pdf.min.mjs');lib.GlobalWorkerOptions.workerSrc='./assets/import/pdf.worker.min.mjs';
    async function inspect(data){
      const task=lib.getDocument({data,isEvalSupported:false});
      try {const doc=await task.promise,result={};
        for(const n of [1,2,3,20,22]) {
          const page=await doc.getPage(n);
          result[n]={text:(await page.getTextContent()).items.map(i=>i.str).join(' '),fields:(await page.getAnnotations()).filter(a=>a.subtype==='Widget').map(a=>({name:a.fieldName,value:a.fieldValue,readonly:a.readOnly,rect:a.rect}))};
        }
        return result;
      }finally{await task.destroy();}
    }
    const first=await inspect(out.slice());
    const editable=await PDFLib.PDFDocument.load(out),form=editable.getForm();
    const font=await editable.embedFont(PDFLib.StandardFonts.Helvetica);
    form.getTextField('email').setText('cliente@example.com');
    form.getTextField('email2').setText('cliente@example.com');
    form.getTextField('Apellido Conyuge').setText('Gomez');
    form.getTextField('NIT!2').setText('EXTERIOR123');
    form.getDropdown('Dropdown52').select('Consumidor final');
    for(const n of ['email','email2','Apellido Conyuge','NIT!2']) form.getTextField(n).updateAppearances(font);
    form.getDropdown('Dropdown52').updateAppearances(font);
    const edited=await inspect(await editable.save({updateFieldAppearances:false}));
    const names=form.getFields().map(f=>f.getName());
    const empty=await AltaCore.buildPdf(PDFLib,bytes,LAYOUT,AltaCore.emptyState(),LETTERS);
    const emptyDoc=await PDFLib.PDFDocument.load(empty);
    const blank=await AltaCore.buildBlankPdf(PDFLib,bytes,LAYOUT,LETTERS,AltaCore.emptyBlank());
    const blankDoc=await PDFLib.PDFDocument.load(blank);
    return {first,edited,names,emptyNames:emptyDoc.getForm().getFields().map(f=>f.getName()),blankNames:blankDoc.getForm().getFields().map(f=>f.getName())};
  }''')
  for n in ['1','20']:
   assert 'PEREZ, LUCIA' in result['first'][n]['text']
   assert '35.123.456' in result['first'][n]['text']
   fields=result['first'][n]['fields']
   assert not any(f['name'] in ['Apellido','Apellido2','Numero de documento','Numero de documento2','Dropdown1','Check Box5','Check Box6'] for f in fields)
   assert any(f['name'] in ['email','email2'] and not f['readonly'] for f in fields)
  assert 'Text33' not in result['names'] and 'Text53' not in result['names']
  assert 'Check Box36' in result['names'] # Una respuesta aún ausente se puede marcar.
  assert 'Check Box5' not in result['names'] and 'Check Box6' not in result['names']
  assert any(f['name']=='email' and f['value']=='cliente@example.com' for f in result['edited']['1']['fields'])
  assert any(f['name']=='email2' and f['value']=='cliente@example.com' for f in result['edited']['20']['fields'])
  assert any(f['name']=='Apellido Conyuge' and f['value']=='Gomez' for f in result['edited']['1']['fields'])
  assert any(f['name']=='Dropdown52' and 'Consumidor final' in f['value'] for f in result['edited']['1']['fields'])
  # El mismo nombre aparece en tres lugares con distinto significado: solo se quita el ya impreso.
  assert any(f['name']=='NIT!2' and f['value']=='EXTERIOR123' for f in result['edited']['3']['fields'])
  nit_fields=[f for f in result['edited']['22']['fields'] if f['name']=='NIT!2']
  assert len(nit_fields)==1 and nit_fields[0]['rect'][1]<670
  assert '27-35123456-9' in result['edited']['22']['text']
  assert all(name in result['emptyNames'] and name in result['blankNames'] for name in ['email','email2','Apellido Conyuge','Dropdown52'])
  print('PASS: datos impresos fijos; texto, cónyuge, listas y casillas pendientes editables; IDs internos retirados')
  print('PASS: se pueden rellenar, guardar y volver a leer los pendientes, sin cubrir datos impresos')
  print('PASS: campos de nombre compartido conservan solo las casillas aún vacías; modo cliente conserva sus campos')
  # Usar el botón real de descarga, incluida la confirmación por datos faltantes.
  await page.locator('#btn-gen').click()
  await page.locator('#dlg').wait_for(state='visible')
  assert 'rellenables' in await page.locator('#dlg-text').inner_text()
  async with page.expect_download() as download:
   await page.locator('#dlg-go').click()
  file=await download.value
  assert await file.failure() is None
  assert 'Descargado' in await page.locator('#done').inner_text()
  assert not errors,errors
  print('PASS: descarga real del PDF parcial desde la interfaz; sin errores JavaScript')
  await browser.close()

asyncio.run(main())
