"""Regresión de Apoderados: unión, mail, campos pendientes, importación y descarga.

Requiere el sitio servido con `python3 -m http.server 8001` y Playwright/Chromium.
Los archivos de prueba contienen únicamente datos sintéticos.
"""
import asyncio
import base64
import os
import tempfile
from pathlib import Path
from playwright.async_api import async_playwright

SITE = os.environ.get('BALANZ_TEST_URL', 'http://127.0.0.1:8001')
MAIL = '''DATOS DE LA CUENTA
Comitente: 123456
Cuotapartista: 654321
Titular: Juan Carlos Gomez
Lugar: Rosario
Fecha: 04/11/2026
Carácter: Apoderado
DATOS PERSONALES
Apellidos: Perez
Nombres: Lucia Andrea
Tipo de documento: DNI
DNI: 35123456
País y autoridad de emisión: Argentina - RENAPER
Nacionalidad: Argentina
Fecha de nacimiento: 04/07/1990
Lugar de nacimiento: Rosario
Sexo: Femenino
Estado civil: Soltera
Actividad principal: Contadora
Tipo de identificador fiscal: CUIL
CUIL: 27-35123456-9
Condición ante el IVA: Consumidor final
Inscripción en ganancias: No inscripto
Email: lucia@example.com
Domicilio: Av. Siempre Viva 742
Código postal: 2000
Localidad: Rosario
Provincia: Santa Fe
País: Argentina
Teléfono: 3415551234
PEP: No'''

async def main():
 async with async_playwright() as p:
  browser = await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
  page = await browser.new_page(accept_downloads=True)
  errors = []
  page.on('pageerror', lambda e: errors.append(str(e)))
  await page.goto(SITE + '/Alta_cotitular_Balanz.html')
  await page.wait_for_function('window.ApoderadosCore && window.ApoderadosPDF && window.ApoderadosImport && window.ApoderadosUI')
  await page.locator('#tab-apoderados').click()
  assert await page.locator('#mode-apoderados').is_visible()
  result = await page.evaluate('''async mail => {
    const C=ApoderadosCore, parsed=C.parseText(mail), state=Object.assign(C.emptyState(),parsed.values);
    const values=parsed.values;
    const lib=await import('./assets/import/pdf.min.mjs');lib.GlobalWorkerOptions.workerSrc='./assets/import/pdf.worker.min.mjs';
    const norm=s=>s.normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
    async function inspect(bytes) {
      const task=lib.getDocument({data:bytes,isEvalSupported:false});
      try {const doc=await task.promise, pages=[];
        for(let n=1;n<=doc.numPages;n++) {
          const page=await doc.getPage(n);
          pages.push({text:(await page.getTextContent()).items.map(i=>i.str).join(' '),fields:(await page.getAnnotations()).filter(a=>a.subtype==='Widget').map(a=>({name:a.fieldName,value:a.fieldValue,readonly:a.readOnly,type:a.fieldType}))});
        }
        return pages;
      }finally{await task.destroy();}
    }
    const bytes=await ApoderadosPDF.build(PDFLib,state);
    window.apoderadoTestBytes=bytes.slice();
    const pages=await inspect(bytes.slice());
    const pepYes={...state,pep:'Sí',pep_nombre:'Marta Duarte',pep_tipo_doc:'Pasaporte',pep_dni:'AB123456',pep_autoridad:'Uruguay',pep_motivo:'Directora',pep_pj:'Organismo Ejemplo',pep_tipo_fiscal:'C.U.I.T.',pep_id:'30-12345678-9',aclaracion:'Lucia Declarante',dni_firma:'39111222'};
    const pepPages=await inspect(await ApoderadosPDF.build(PDFLib,pepYes));
    const emptyBytes=await ApoderadosPDF.build(PDFLib,C.emptyState());
    const emptyDoc=await PDFLib.PDFDocument.load(emptyBytes);
    const emptyFields=emptyDoc.getForm().getFields().map(f=>({name:f.getName(),value:f.getText?.()??f.getSelected?.()??f.isChecked?.()}));
    const partial={...state,email:'',pep:'',dni:'',cp:'',pais:''};
    const partialBytes=await ApoderadosPDF.build(PDFLib,partial);
    const editable=await PDFLib.PDFDocument.load(partialBytes),form=editable.getForm(),font=await editable.embedFont(PDFLib.StandardFonts.Helvetica);
    const emailFields=C.LAYOUT.filter(e=>e.key==='email');
    for(const entry of emailFields) {form.getTextField(entry.id).setText('cliente@example.com');form.getTextField(entry.id).updateAppearances(font);}
    const saved=await inspect(await editable.save({updateFieldAppearances:false}));
    const compound=C.LAYOUT.filter(e=>e.key==='documento').map(e=>({id:e.id,p:e.p,answer:C.valueFor(e,partial),exists:form.getFields().some(f=>f.getName()===e.id),text:form.getFields().find(f=>f.getName()===e.id)?.getText?.()}));
    const pea=C.LAYOUT.filter(e=>e.key==='pep').map(e=>({id:e.id,value:form.getDropdown(e.id).getSelected()}));
    return {values,pages,pepPages,empty:C.emptyState(),emptyFields,layout:C.LAYOUT,compound,pea,saved,state};
  }''', MAIL)
  values=result['values']
  assert values['comitente']=='123456' and values['cuotapartista']=='654321',values
  assert values['apellidos']=='Perez' and values['nombres']=='Lucia Andrea',values
  assert values['email']=='lucia@example.com' and values['pep']=='No',values
  assert values['bcv_apoderado'] is True and values['fci_apoderado'] is True,values
  expected={'denominacion':'Juan Carlos Gomez','lugar':'Rosario','fecha':'04/11/2026','tipo_doc':'D.N.I.','dni':'35123456','autoridad':'Argentina - RENAPER','nacionalidad':'Argentina','fecha_nac':'04/07/1990','lugar_nac':'Rosario','sexo':'Femenino','estado_civil':'Soltera','actividad':'Contadora','tipo_fiscal':'C.U.I.L.','cuil':'27-35123456-9','iva':'Consumidor final','ganancias':'No inscripto','domicilio':'Av. Siempre Viva 742','cp':'2000','localidad':'Rosario','provincia':'Santa Fe','pais':'Argentina','telefono':'3415551234'}
  assert all(values.get(k)==v for k,v in expected.items()),values
  assert all(values[k] is False for k in ['bcv_autorizado','bcv_representante','bcv_web','fci_representante','fci_web']),values
  assert result['empty']['pep']=='' and result['empty']['fecha']=='',result['empty']
  assert result['empty']['bcv_apoderado']=='',result['empty']
  assert len(result['layout'])==83 and len(result['emptyFields'])==83
  assert len({f['name'] for f in result['emptyFields']})==83
  pages=result['pages']
  assert len(pages)==6
  normalized=lambda s: ''.join(c for c in s.lower() if c.isalnum())
  assert 'balanzcapitalvalores' in normalized(pages[0]['text'])
  assert 'balanzsociedadgerente' in normalized(pages[3]['text'])
  for index in [0,3]:
   text=pages[index]['text']
   assert 'Perez' in text and 'Lucia Andrea' in text,text
   assert 'lucia@example.com' in text,text
  assert '123456' in pages[1]['text'] and '654321' in pages[4]['text']
  for index in [1,4]:
   text=result['pepPages'][index]['text']
   assert all(v in text for v in ['Marta Duarte','Pasaporte','AB123456','Uruguay','Directora','Organismo Ejemplo','30-12345678-9']),text
  for index in [2,5]:
   text=result['pepPages'][index]['text']
   assert 'Lucia Declarante' in text and '39111222' in text,text
  for entry in result['compound']:
   assert not entry['answer']['complete'] and entry['exists'],entry
   assert entry['text'],entry
  assert all(not entry['value'] for entry in result['pea']),result['pea']
  for index in [0,3]:
   assert any(f['value']=='cliente@example.com' and not f['readonly'] for f in result['saved'][index]['fields'])
  print('PASS: mail con cuentas, identidad, roles y PEP; sin inferir fecha, rol ni PEP cuando faltan')
  print('PASS: PDF de seis páginas BCV → BSGFCI, datos repetidos y 83 campos independientes en blanco')
  print('PASS: PEP Sí conserva sus documentos y detalles; aclaración y DNI del declarante conservan valores distintos')
  print('PASS: campos pendientes y compuestos parciales se pueden rellenar, guardar y volver a abrir')

  # El mismo DNI puede aparecer como «tipo y número» en p1 y solo número en p3.
  independence=await page.evaluate('''async()=>{
    const C=ApoderadosCore, out=await ApoderadosPDF.build(PDFLib,C.emptyState());
    const doc=await PDFLib.PDFDocument.load(out),form=doc.getForm(),layout=C.LAYOUT;
    const sample=layout.filter(e=>e.p===1&&e.key==='documento')[0],different=layout.filter(e=>e.p===3&&e.n!=='Firma'&&/DNI/.test(e.n))[0];
    form.getTextField(sample.id).setText('Pasaporte AB1234567');
    return {a:form.getTextField(sample.id).getText(),b:form.getTextField(different.id).getText(),aId:sample.id,bId:different.id};
  }''')
  assert independence['aId']!=independence['bId'] and not independence['b'],independence
  print('PASS: documentos/aclaraciones de distinta posición no comparten accidentalmente el mismo campo')

  # Lectura directa de anexos originales por separado y del PDF unido generado.
  imported=await page.evaluate('''async()=>{
    const result={};
    for(const [name,offset] of [['bcv',0],['bsgfci',3]]) {
      const response=await fetch('./assets/apoderados/'+name+'.pdf');
      const doc=await PDFLib.PDFDocument.load(await response.arrayBuffer()),form=doc.getForm();
      form.getTextField('APELLIDO').setText('Perez');form.getTextField('NOMBRES').setText('Lucia Andrea');
      const email=ApoderadosCore.LAYOUT.find(e=>e.p===offset+1&&e.key==='email');form.getTextField(email.n).setText('lucia@example.com');
      const bytes=await doc.save({updateFieldAppearances:false});
      result[name]=await ApoderadosImport.read([new File([bytes],name+'.pdf',{type:'application/pdf'})],{page:1});
    }
    result.joined=await ApoderadosImport.read([new File([window.apoderadoTestBytes],'unido.pdf',{type:'application/pdf'})],{page:1});
    return result;
  }''')
  for name,records in imported.items():
   assert any(r['key']=='apellidos' and r['value']=='Perez' for r in records),(name,records)
   assert any(r['key']=='email' and r['value']=='lucia@example.com' for r in records),(name,records)
   assert not any(r['key']=='firma_pendiente' for r in records),(name,records)
  print('PASS: PDF BCV, PDF BSGFCI y PDF unido se identifican e importan; las firmas no se interpretan como datos')

  # OCR con imagen y escaneo de una primera página enteramente sintética.
  ocr=await page.evaluate('''async()=>{
    const lib=await import('./assets/import/pdf.min.mjs');const task=lib.getDocument({data:window.apoderadoTestBytes.slice(),isEvalSupported:false});
    const doc=await task.promise,page=await doc.getPage(1),vp=page.getViewport({scale:2.5});
    const canvas=document.createElement('canvas');canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);
    await page.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const image=await ApoderadosImport.read([new File([blob],'imagen.png',{type:'image/png'})],{page:1});
    const scanned=await PDFLib.PDFDocument.create(),png=await scanned.embedPng(await blob.arrayBuffer()),pg=scanned.addPage([595,841]);
    pg.drawImage(png,{x:0,y:0,width:595,height:841});
    const scan=await ApoderadosImport.read([new File([await scanned.save()],'escaneo.pdf',{type:'application/pdf'})],{page:1});
    await task.destroy();return {image,scan};
  }''')
  for name,records in ocr.items():
   assert any(r['key']=='apellidos' and 'perez' in str(r['value']).lower() for r in records),(name,records)
   assert any(r['key']=='nombres' and 'lucia' in str(r['value']).lower() for r in records),(name,records)
  print('PASS: imagen y PDF escaneado recuperan los nombres impresos mediante OCR')

  # Recorrido visible: mail, revisión del archivo y descarga real del PDF.
  await page.locator('#a-src').fill(MAIL)
  await page.locator('#a-read').click()
  await page.locator('#a-review').wait_for(state='visible')
  await page.locator('#a-apply').click()
  assert await page.locator('#a-f-apellidos').input_value()=='Perez'
  assert await page.locator('#a-f-email').input_value()=='lucia@example.com'
  with tempfile.TemporaryDirectory(prefix='balanz-apoderados-') as tmp:
   encoded=await page.evaluate('''()=>{const bytes=window.apoderadoTestBytes;let chunks=[];for(let n=0;n<bytes.length;n+=32768)chunks.push(String.fromCharCode(...bytes.subarray(n,n+32768)));return btoa(chunks.join(''));}''')
   path=Path(tmp)/'unido.pdf';path.write_bytes(base64.b64decode(encoded))
   await page.locator('#a-files').set_input_files(str(path))
   await page.locator('#a-import-read').click()
   await page.locator('#a-review').wait_for(state='visible',timeout=120000)
   await page.locator('#a-apply').click()
   async def confirm_if_needed():
    try:
     await page.locator('#a-confirm').wait_for(state='visible',timeout=2000)
     await page.locator('#a-confirm-go').click()
    except Exception:
     pass
   async with page.expect_download(timeout=60000) as event:
    await page.locator('#a-gen').click()
    await confirm_if_needed()
   download=await event.value
   assert await download.failure() is None
   await download.save_as(Path(tmp)/'resultado.pdf')
   assert (Path(tmp)/'resultado.pdf').read_bytes().startswith(b'%PDF-')
  await page.locator('#tab-full').click();assert await page.locator('#mode-full').is_visible()
  await page.locator('#btn-example').click();assert await page.locator('#f-nombres').input_value()
  await page.locator('#tab-blank').click();assert await page.locator('#mode-blank').is_visible()
  await page.locator('#tab-apoderados').click();assert await page.locator('#a-f-apellidos').input_value()=='Perez'
  assert not errors,errors
  print('PASS: mail, revisión de archivo, descarga real y cambio de pestañas sin perder datos ni errores JavaScript')
  await browser.close()

asyncio.run(main())
