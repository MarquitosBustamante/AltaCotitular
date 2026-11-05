/* PDF de apoderados: BCV primero y BSGFCI después, con pendientes editables. */
(() => {
  'use strict';
  const base = new URL('./', document.currentScript.src);
  let templatePromise;
  async function templateBytes() {
    if (!templatePromise) templatePromise = fetch(new URL('template.pdf', base)).then(response => {
      if (!response.ok) throw new Error('No se pudo cargar la plantilla de apoderados. Volvé a intentar.');
      return response.arrayBuffer();
    }).catch(error => { templatePromise = null; throw error; });
    return new Uint8Array((await templatePromise).slice(0));
  }
  function text(value) {
    return String(value ?? '').normalize('NFC').replace(/[\r\n\t\u00a0]/g, ' ')
      .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, '-').trim();
  }
  function fit(font, value, entry) {
    const [x0,y0,x1,y1] = entry.r;
    const width = x1 - x0 - 4, height = y1 - y0 - 2;
    let size = Math.min(9, height / 0.85);
    try {
      while (size > 5.5 && font.widthOfTextAtSize(value,size) > width) size = Math.max(5.5,size - 0.25);
      if (size < 5.5 || font.widthOfTextAtSize(value,size) > width) {
        throw new Error('El texto del campo «' + (entry.label || entry.n) + '» es demasiado largo para el PDF. Acortalo antes de descargar.');
      }
      return size;
    } catch (error) {
      if (/demasiado largo/.test(error.message)) throw error;
      throw new Error('El campo «' + (entry.label || entry.n) + '» contiene caracteres que no se pueden imprimir en este PDF. Revisá el texto.');
    }
  }
  function removeAnsweredFields(doc, PDFLib, ids) {
    const {PDFName,PDFDict,PDFArray,PDFString,PDFHexString} = PDFLib;
    const acro = doc.catalog.lookupMaybe(PDFName.of('AcroForm'),PDFDict);
    const fields = acro?.lookupMaybe(PDFName.of('Fields'),PDFArray);
    if (!fields) return;
    const dead = new Set();
    for (let i=fields.size()-1;i>=0;i--) {
      const ref=fields.get(i),field=doc.context.lookup(ref);
      const t=field.get(PDFName.of('T'));
      const name=t instanceof PDFString || t instanceof PDFHexString ? t.decodeText() : '';
      if (ids.has(name)) {dead.add(ref.toString());fields.remove(i);}
    }
    for (const page of doc.getPages()) {
      const annots=page.node.Annots();if(!annots)continue;
      const keep=annots.asArray().filter(ref=>!dead.has(ref.toString()));
      if(keep.length) page.node.set(PDFName.of('Annots'),doc.context.obj(keep));
      else page.node.delete(PDFName.of('Annots'));
    }
    if(!fields.size())doc.catalog.delete(PDFName.of('AcroForm'));
  }
  async function build(PDFLib,state) {
    const core=window.ApoderadosCore;
    if(!core || !Array.isArray(core.LAYOUT) || !core.LAYOUT.length || typeof core.valueFor!=='function') throw new Error('No se pudo cargar el formulario de apoderados. Recargá la página.');
    const {PDFDocument,StandardFonts,rgb} = PDFLib;
    const doc=await PDFDocument.load(await templateBytes());
    const form=doc.getForm(),font=await doc.embedFont(StandardFonts.Helvetica);
    const pages=doc.getPages(),answered=new Set(),black=rgb(0,0,0);
    for (const entry of core.LAYOUT) {
      // La firma nunca se toma de información pegada o del PDF de un cliente.
      const result=/^firma$/i.test(entry.n) ? {value:'',complete:false} : core.valueFor(entry,state);
      const value=text(result?.value),complete=result?.complete===true;
      const field=form.getField(entry.id);
      if(entry.t==='Btn') {
        if(complete) {
          if(value) {
            const [x0,y0,x1,y1]=entry.r,size=Math.min(11,y1-y0-2),width=font.widthOfTextAtSize('X',size);
            pages[entry.p-1].drawText('X',{x:(x0+x1-width)/2,y:y0+(y1-y0-size*0.72)/2,size,font,color:black});
          }
          answered.add(entry.id);
        } else if(field instanceof PDFLib.PDFCheckBox) field.uncheck();
        continue;
      }
      if(!value) {
        if(field instanceof PDFLib.PDFTextField) {field.setText('');field.updateAppearances(font);}
        else if(field instanceof PDFLib.PDFDropdown) {field.clear();field.updateAppearances(font);}
        continue;
      }
      const size=fit(font,value,entry);
      if(complete) {
        const [x0,y0,,y1]=entry.r;
        pages[entry.p-1].drawText(value,{x:x0+2,y:y0+(y1-y0-size*0.72)/2,size,font,color:black});
        answered.add(entry.id);
      } else if(field instanceof PDFLib.PDFTextField) {
        field.setText(value);field.setFontSize(size);field.updateAppearances(font);
      } else if(field instanceof PDFLib.PDFDropdown) {
        if(!field.getOptions().includes(value)) throw new Error('Revisá la opción del campo «'+(entry.label || entry.n)+'» antes de descargar.');
        field.select(value);field.setFontSize(size);field.updateAppearances(font);
      }
    }
    removeAnsweredFields(doc,PDFLib,answered);
    window.AltaCore.removeBlankPdfOptions(PDFLib,doc);
    return doc.save({updateFieldAppearances:false});
  }
  window.ApoderadosPDF={build};
})();
