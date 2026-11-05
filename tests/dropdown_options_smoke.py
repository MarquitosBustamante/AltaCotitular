"""Los PDFs pendientes no ofrecen opciones vacías y conservan las respuestas sin elegir."""
import asyncio, os
from playwright.async_api import async_playwright

SITE=os.environ.get('BALANZ_TEST_URL','http://127.0.0.1:8001')

async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
  page=await browser.new_page()
  await page.goto(SITE+'/Alta_cotitular_Balanz.html')
  result=await page.evaluate('''async()=>{
    const {PDFDocument,PDFDropdown,PDFOptionList,PDFName,PDFString,StandardFonts}=PDFLib;
    const bytes=Uint8Array.from(atob(document.getElementById('template-pdf').textContent.trim()),c=>c.charCodeAt(0));
    const source=await PDFDocument.load(bytes);
    const lists=d=>d.getForm().getFields().filter(f=>f instanceof PDFDropdown||f instanceof PDFOptionList);
    const original=Object.fromEntries(lists(source).map(f=>[f.getName(),{options:f.getOptions().filter(v=>v.trim()),selected:f.getSelected()}]));
    const cases={
      completo:await AltaCore.buildPdf(PDFLib,bytes,LAYOUT,AltaCore.emptyState(),LETTERS),
      parcial:await AltaCore.buildPdf(PDFLib,bytes,LAYOUT,{...AltaCore.emptyState(),iva:'Consumidor final',tipo_doc:'D.N.I.',pep:'Sí'},LETTERS),
      cliente:await AltaCore.buildBlankPdf(PDFLib,bytes,LAYOUT,LETTERS,AltaCore.emptyBlank()),
      apoderados:await ApoderadosPDF.build(PDFLib,ApoderadosCore.emptyState())
    };
    const records={};
    for(const [mode,data]of Object.entries(cases)){
      const doc=await PDFDocument.load(data),fields=lists(doc),font=await doc.embedFont(StandardFonts.Helvetica);
      const before=fields.map(f=>({name:f.getName(),options:f.getOptions(),selected:f.getSelected(),defaultValue:f.acroField.dict.lookup(PDFName.of('DV'))?.toString()}));
      for(const f of fields){const option=f.getOptions()[0];if(option){f.select(option);f.updateAppearances(font);}}
      const saved=await PDFDocument.load(await doc.save({updateFieldAppearances:false}));
      records[mode]={before,after:lists(saved).map(f=>({name:f.getName(),selected:f.getSelected()}))};
    }
    // Pares exportación/etiqueta: ninguno de los dos componentes puede estar vacío.
    const paired=await PDFDocument.create();paired.addPage();
    const choice=paired.getForm().createDropdown('paired');
    const entries=[['','Elegir'],['hidden',' '],['yes','Sí'],['no','No']];
    choice.acroField.dict.set(PDFName.of('Opt'),paired.context.obj(entries.map(row=>row.map(value=>PDFString.of(value)))));
    choice.acroField.dict.set(PDFName.of('V'),PDFString.of('no'));
    choice.acroField.dict.set(PDFName.of('I'),paired.context.obj([3]));
    choice.acroField.dict.set(PDFName.of('DV'),PDFString.of(' '));
    AltaCore.removeBlankPdfOptions(PDFLib,paired);
    const pairState={options:choice.getOptions(),selected:choice.getSelected(),indices:choice.acroField.dict.lookup(PDFName.of('I')).asArray().map(n=>n.asNumber()),hasDefault:choice.acroField.dict.has(PDFName.of('DV'))};
    return {original,records,pairState};
  }''')
  for mode,record in result['records'].items():
   assert record['before'],mode
   for field in record['before']:
    assert field['options'] and all(o.strip() for o in field['options']),(mode,field)
    if mode!='apoderados':
     baseline=result['original'][field['name']]
     assert field['options']==baseline['options'],(mode,field)
     if baseline['selected'] and not any(s.strip() for s in baseline['selected']):
      assert not field['selected'] and not field.get('defaultValue'),(mode,field)
    else:
     assert field['options']==['si','no'] and not field['selected'],field
   for field,edited in zip(record['before'],record['after']):
    assert edited['selected']==[field['options'][0]],(mode,field,edited)
   print('PASS:',mode,'·',len(record['before']),'desplegables sin opciones vacías; opciones conservadas y editables al guardar')
  assert result['pairState']=={'options':['Sí','No'],'selected':['no'],'indices':[1],'hasDefault':False},result['pairState']
  print('PASS: pares exportación/etiqueta conservados; selección real e índices preservados')
  await browser.close()

asyncio.run(main())
