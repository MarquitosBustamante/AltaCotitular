/* Lectura local del formulario Balanz. Los documentos nunca se envían a un servidor. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const C = window.AltaCore;
  const base = new URL('./', document.currentScript.src);
  const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
  const keyOf = e => C.valueFor(e, new Proxy({}, { get: (_, k) => k }));
  const labels = {};
  C.SECTIONS.forEach(s => s.fields.forEach(f => {
    if (f.type === 'checks') f.opts.forEach(([k, label]) => labels[k] = label);
    else labels[f.k] = f.l;
  }));
  let reader, template, activeWorker, cancelled = false, busy = false;
  const status = text => $('import-status').textContent = text;
  const checkCancel = () => { if (cancelled) throw new Error('Lectura cancelada. Tus datos no cambiaron.'); };
  async function pdfReader() {
    if (!reader) {
      reader = await import(new URL('pdf.min.mjs', base));
      reader.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', base).href;
    }
    return reader;
  }
  function templateBytes() {
    return Uint8Array.from(atob($('template-pdf').textContent.replace(/\s/g, '')), c => c.charCodeAt(0));
  }
  async function getTemplate() {
    if (!template) template = (await pdfReader()).getDocument({ data: templateBytes(), isEvalSupported: false }).promise;
    return template;
  }
  async function pageItems(page) {
    const result = await page.getTextContent();
    return result.items.filter(i => i.str && clean(i.str)).map(i => ({ text: clean(i.str), x: i.transform[4], y: i.transform[5], w: i.width, h: Math.abs(i.height) }));
  }
  function inside(item, e) {
    const [x0,y0,x1,y1] = e.r;
    return item.x >= x0 - 3 && item.x < x1 && item.y >= y0 - 2 && item.y <= y1 + 2;
  }
  function readRegions(items, layout, add, source) {
    for (const e of layout) {
      const key = keyOf(e);
      if (!key) continue;
      const parts = items.filter(i => inside(i,e)).sort((a,b) => Math.abs(a.y-b.y)>5 ? b.y-a.y : a.x-b.x);
      const value = clean(parts.map(i => i.text).join(' '));
      if (value && (e.t !== 'Btn' || /^[xX✓✔]$/.test(value))) add(key, value, source + (parts.some(i=>i.confidence != null && i.confidence<55) ? ' · Baja confianza' : ''));
    }
  }
  // Usa los rótulos de la carta, no la firma ni el nombre del cotitular del bloque inferior.
  function readLetterHolder(items, add, source) {
    const ordered = [...items].sort((a,b) => Math.abs(a.y-b.y)>4 ? b.y-a.y : a.x-b.x);
    function linesOf(parts) {
      const lines = [];
      for (const item of parts) {
        let line = lines.find(l=>Math.abs(l.y-item.y)<4);
        if (!line) { line={y:item.y,x:item.x,parts:[]};lines.push(line); }
        line.parts.push(item);line.x=Math.min(line.x,item.x);
      }
      return lines.map(l=>({...l,text:clean(l.parts.sort((a,b)=>a.x-b.x).map(i=>i.text).join(' '))})).sort((a,b)=>b.y-a.y);
    }
    const lines = linesOf(ordered);
    const marker = lines.find(l=>/firmadeltitular/.test(norm(l.text)) && !/firmadelcotitular/.test(norm(l.text)));
    const continuation = lines.some(l=>norm(l.text).includes('continuaciondefirmasdetitulares'));
    const letter = lines.some(l=>norm(l.text).includes('altacotitularidad')) || continuation;
    if (!letter || !marker) return false;
    // Si hay columnas de titulares, la primera corresponde al titular principal.
    const sameRowMarkers = items.filter(i=>Math.abs(i.y-marker.y)<4 && /firmadeltitular/.test(norm(i.text))).sort((a,b)=>a.x-b.x);
    const left = sameRowMarkers[0]?.x ?? marker.x;
    const right = sameRowMarkers[1]?.x ?? Infinity;
    const block = linesOf(ordered.filter(i=>i.x>=left-5 && i.x<right-8 && i.y<marker.y-3 && i.y>marker.y-170));
    const acl = block.find(l=>/^aclaracion/.test(norm(l.text)));
    if (!acl) return false;
    const dniRegex = /^(?:D\s*\.?\s*N\s*\.?\s*I\s*\.?|documento)\s*:?\s*/i;
    const dniLine = block.find(l=>l.y<acl.y+2 && dniRegex.test(l.text));
    if (!dniLine) return false;
    const nameLines = block.filter(l=>l.y<=acl.y+2 && l.y>dniLine.y+4);
    const holderName = clean(nameLines.map(l=>l===acl ? l.text.replace(/^aclaraci[oó]n\s*:?\s*/i,'') : l.text).join(' '));
    const inlineDni = dniLine.text.replace(dniRegex,'');
    const belowDni = block.find(l=>l.y<dniLine.y-3 && l.y>dniLine.y-24 && /^[\d.\s-]+$/.test(l.text));
    const holderDni = clean(inlineDni || belowDni?.text || '');
    const confidence = [...nameLines,dniLine].flatMap(l=>l.parts).some(i=>i.confidence!=null && i.confidence<55) ? ' · Baja confianza' : '';
    const origin = source+' · Carta de titularidad'+confidence;
    if (holderName && /[a-záéíóúñü]/i.test(holderName) && !/[_/]|firma|conformidad/i.test(holderName)) add('titular_nombre',holderName,origin);
    if (/^\d{7,8}$/.test(holderDni.replace(/[.\s-]/g,''))) add('titular_dni',holderDni,origin);
    return true;
  }
  function collect() {
    const found = new Map();
    return {
      found,
      add(key, value, source) {
        value = clean(value);
        if (!value || /^(off|undefined|null)$/i.test(value)) return;
        if (!found.has(key)) found.set(key, []);
        if (!found.get(key).some(v => clean(v.value).toLocaleLowerCase('es') === clean(value).toLocaleLowerCase('es'))) found.get(key).push({value, source});
      }
    };
  }
  async function ocr(canvas, pageNo, add, letterSize = null) {
    status('Reconociendo texto de la página ' + pageNo + '… Puede tardar unos segundos.');
    if (!window.Tesseract) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = new URL('tesseract.min.js', base).href;
        script.onload = resolve;
        script.onerror = () => reject(new Error('No se pudo cargar el lector de imágenes. Revisá la conexión y volvé a intentar.'));
        document.head.appendChild(script);
      });
    }
    checkCancel();
    activeWorker = await Tesseract.createWorker('spa', 1, {
      workerPath: new URL('worker.min.js', base).href,
      corePath: base.href.replace(/\/$/, ''), langPath: base.href.replace(/\/$/, ''),
      workerBlobURL: false, cacheMethod: 'none'
    });
    try {
      checkCancel();
      const result = await activeWorker.recognize(canvas, {}, {text:true, blocks:true});
      checkCancel();
      const words = [];
      for (const b of result.data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || []) {
        words.push({text:w.text, x:w.bbox.x0, y:w.bbox.y1, w:w.bbox.x1-w.bbox.x0, h:w.bbox.y1-w.bbox.y0, confidence:w.confidence});
      }
      if (letterSize) {
        const items=words.map(w=>({...w,x:w.x/canvas.width*letterSize.width,y:(1-w.y/canvas.height)*letterSize.height,w:w.w/canvas.width*letterSize.width}));
        readLetterHolder(items,add,'Imagen/OCR · pág. '+pageNo+' (revisar)');
        return;
      }
      const tp = await (await getTemplate()).getPage(pageNo);
      const vp = tp.getViewport({scale:1});
      const statics = await pageItems(tp);
      // El formulario debe verse entero, de frente y sin bordes ajenos a la hoja.
      const items = words.map(w => ({...w, x:w.x/canvas.width*vp.width, y:(1-w.y/canvas.height)*vp.height, w:w.w/canvas.width*vp.width}));
      const staticWords = statics.flatMap(i => {
        const tokens=i.text.split(' '); let offset=0;
        return tokens.map(t => {const item={text:t,x:i.x+offset/i.text.length*i.w,y:i.y};offset+=t.length+1;return item;});
      });
      if (readLetterHolder(items,add,'Imagen/OCR · pág. '+pageNo+' (revisar)')) return;
      const matches = items.filter(i => staticWords.some(t => norm(t.text)===norm(i.text) && Math.abs(t.x-i.x)<15 && Math.abs(t.y-i.y)<8)).length;
      if (matches < 12) throw new Error('No pude ubicar el formulario en la imagen. Usá la hoja completa, derecha y nítida, y comprobá el número de página seleccionado.');
      let values=items.filter(i => i.confidence > 0 && !staticWords.some(t => norm(t.text)===norm(i.text) && Math.abs(t.x-i.x)<15 && Math.abs(t.y-i.y)<8));
      // Una segunda lectura por renglón ayuda con correos y números pequeños.
      const regions=window.LAYOUT.filter(e=>e.p===pageNo && e.t!=='Btn' && values.some(i=>inside(i,e) && i.confidence<55));
      await activeWorker.setParameters({tessedit_pageseg_mode:'7'});
      for(const e of regions) {
        checkCancel();
        const sx=canvas.width/vp.width,sy=canvas.height/vp.height;
        const r=await activeWorker.recognize(canvas,{rectangle:{left:Math.max(0,Math.floor(e.r[0]*sx)),top:Math.max(0,Math.floor((vp.height-e.r[3])*sy)),width:Math.ceil((e.r[2]-e.r[0])*sx),height:Math.ceil((e.r[3]-e.r[1])*sy)}},{text:true});
        if(clean(r.data.text) && r.data.confidence>Math.min(...values.filter(i=>inside(i,e)).map(i=>i.confidence))) {
          values=values.filter(i=>!inside(i,e));
          values.push({text:clean(r.data.text),x:e.r[0]+2,y:(e.r[1]+e.r[3])/2,confidence:r.data.confidence});
        }
      }
      readRegions(values, window.LAYOUT.filter(e=>e.p===pageNo), add, 'Imagen/OCR · pág. '+pageNo+' (revisar)');
    } finally {
      if (activeWorker) { await activeWorker.terminate(); activeWorker=null; }
    }
  }
  async function readPdf(file, add) {
    const pdfjs = await pdfReader();
    const task = pdfjs.getDocument({data: new Uint8Array(await file.arrayBuffer()), isEvalSupported:false});
    let doc;
    try {
      doc = await task.promise;
      if (doc.numPages>100) throw new Error('El PDF tiene más de 100 páginas. Cargá solo las páginas del formulario.');
      const original=await getTemplate();
      for (let n=1;n<=doc.numPages;n++) {
        checkCancel();
        const pageNo=doc.numPages===1 ? Number($('import-page').value) : n;
        const layout=window.LAYOUT.filter(e=>e.p===pageNo);
        status('Leyendo página '+n+' de '+doc.numPages+'…');
        const page=await doc.getPage(n), items=await pageItems(page);
        const annotations=await page.getAnnotations();
        const letterItems=[...items];
        for (const a of annotations) {
          if (!['Tx','Ch'].includes(a.fieldType) || !a.rect || !a.fieldValue) continue;
          const value=clean(Array.isArray(a.fieldValue) ? a.fieldValue.join(' ') : a.fieldValue);
          const x=a.rect[0]+2,y=a.rect[1]+2;
          if (value && !items.some(i=>norm(i.text)===norm(value) && Math.abs(i.x-x)<20 && Math.abs(i.y-y)<15)) letterItems.push({text:value,x,y,w:a.rect[2]-a.rect[0],h:a.rect[3]-a.rect[1]});
        }
        const letterRead=readLetterHolder(letterItems,add,'Texto PDF · pág. '+n);
        if (!layout.length || pageNo>original.numPages) {
          // Las cartas pueden estar fuera de LAYOUT y también llegar escaneadas.
          if (!letterRead && n>=doc.numPages-1) {
            const viewport=page.getViewport({scale:2.5}), size=page.getViewport({scale:1});
            const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
            await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
            await ocr(canvas,n,add,size);canvas.width=canvas.height=0;
          }
          page.cleanup();continue;
        }
        const tp=await original.getPage(pageNo), statics=await pageItems(tp);
        const defaults=await tp.getAnnotations();
        let fields=0;
        for (const a of annotations) {
          if (a.subtype!=='Widget' || !a.fieldName || !a.fieldValue) continue;
          const e=layout.find(e=>e.n===a.fieldName && a.rect && Math.abs(e.r[0]-a.rect[0])<5 && Math.abs(e.r[1]-a.rect[1])<5);
          if (!e) continue;
          const originalField=defaults.find(t=>t.fieldName===a.fieldName && t.rect && Math.abs(t.rect[0]-a.rect[0])<2 && Math.abs(t.rect[1]-a.rect[1])<2);
          if (originalField && JSON.stringify(originalField.fieldValue)===JSON.stringify(a.fieldValue)) continue;
          const key=keyOf(e); if (!key) continue;
          let value=a.fieldValue;
          if (e.t==='Btn') {if (value===false || value==='Off') continue; value='X';}
          if (Array.isArray(value)) value=value.join(' ');
          add(key,value,'Campo PDF · pág. '+pageNo);fields++;
        }
        const sameStatic=i=>statics.some(t=>norm(t.text)===norm(i.text) && Math.abs(t.x-i.x)<2 && Math.abs(t.y-i.y)<2);
        const templateMatches=items.filter(sameStatic).length;
        if (templateMatches>=12) readRegions(items.filter(i=>!sameStatic(i)),layout,add,'Texto PDF · pág. '+pageNo);
        // Un PDF sin texto ni campos necesita OCR; las páginas de condiciones no se procesan.
        if (items.length<12 && !fields) {
          const viewport=page.getViewport({scale:2.5});
          const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
          await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
          await ocr(canvas,pageNo,add);
          canvas.width=canvas.height=0;
        }
        page.cleanup();
      }
    } finally { await task.destroy(); }
  }
  async function readImage(file, add) {
    const bitmap=await createImageBitmap(file);
    try {
      if (bitmap.width*bitmap.height>45000000) throw new Error('La imagen es demasiado grande. Reducila a menos de 45 megapíxeles.');
      const scale=Math.min(1,2500/Math.max(bitmap.width,bitmap.height));
      const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      await ocr(canvas,Number($('import-page').value),add);
      canvas.width=canvas.height=0;
    } finally {bitmap.close();}
  }
  function candidates(found) {
    const output=new Map();
    const add=(k,value,source)=>{
      if (!(k in labels) || value==='') return;
      if (!output.has(k)) output.set(k,[]);
      if (!output.get(k).some(v=>String(v.value)===String(value))) output.get(k).push({value,source});
    };
    const bools={chk_indistinta:['firma','indistinta'],chk_conjunta:['firma','conjunta'],chk_rel_si:['relacion','Sí'],chk_rel_no:['relacion','No'],chk_or_act:['origen_actividad',true],chk_or_venta:['origen_venta',true],chk_or_her:['origen_herencia',true],chk_or_otros:['origen_otros',true],chk_so_si:['sujeto_obligado','Sí'],chk_so_no:['sujeto_obligado','No']};
    for (const [key, values] of found) for (const {value,source} of values) {
      if (bools[key]) {add(...bools[key],source);continue;}
      if (key==='nombre_ficha') {
        const parts=value.split(',');
        add('apellidos',parts[0].trim(),source+(parts.length===1?' · Separar apellido y nombres':''));
        if(parts.length>1) add('nombres',parts.slice(1).join(',').trim(),source);
        continue;
      }
      // No se deducen nombres, titularidad, fechas, declaraciones fiscales ni valores ausentes.
      if (key==='aclaracion' || key==='lugar_fecha' || key==='pais1') continue;
      const dest={nit1:'cuil',pais2:'pais_ext',nit2:'nit_ext',conyuge_tipo:'conyuge_tipo_doc'}[key] || key;
      if (!(dest in labels)) continue;
      const built=C.buildState({raw:{[dest]:value},unknown:[],count:1});
      let converted=built.V[dest];
      if (['tipo_fiscal','relacion','pais_ext','nit_ext','pep_motivo','pep_autoridad','pep_pj'].includes(dest)) converted=value;
      add(dest,converted || value,source);
    }
    return output;
  }
  function review(found) {
    const values=candidates(found), root=$('import-results');root.replaceChildren();
    if (!values.size) {status('No encontré datos para completar. Comprobá que sea el formulario Balanz y que tenga campos con información. Podés seguir cargando los datos a mano.');return;}
    const state=AltaUI.state();
    for (const [key, list] of values) {
      const row=document.createElement('div');row.className='import-row';
      const label=document.createElement('label'), check=document.createElement('input');check.type='checkbox';check.dataset.key=key;
      const issue=C.validate({...state,[key]:list[0].value}, {}, []).find(i=>i.k===key && i.level==='error');
      const uncertain=!!issue || list.some(v=>v.source.includes('Baja confianza'));
      const conflict=list.length>1 || (state[key] && String(state[key])!==String(list[0].value));
      check.checked=!conflict && !uncertain;label.append(check,document.createTextNode(' '+labels[key]));
      const field=C.FIELD_INDEX[key];
      let input;
      if(field && field.type==='select') {
        input=document.createElement('select');
        const opts=[['','Elegí una opción'],...C.OPTIONS[field.opts]];
        for(const [v,t] of opts) input.add(new Option(t,v));
        input.value=list[0].value;
        if(!input.value) {check.checked=false;input.add(new Option('Revisar: '+list[0].value,list[0].value));input.value=list[0].value;}
      } else {input=document.createElement('input');input.type='text';input.value=String(list[0].value);}
      input.className='import-value';input.setAttribute('aria-label',labels[key]+' recuperado');input.dataset.key=key;
      const note=document.createElement('small');
      note.textContent=(issue ? 'Revisar: '+issue.msg+' · ' : '')+list.map(v=>v.source+(list.length>1?': '+v.value:'')).join(' / ')+(conflict?' · Hay diferencias. Elegí el valor y marcá la casilla para aplicarlo.':'');
      if(state[key] && conflict) note.textContent+=' Valor actual: '+state[key];
      row.append(label,input,note);root.appendChild(row);
    }
    $('import-summary').textContent='Recuperé '+values.size+' datos. Revisalos y marcá cuáles querés incorporar. Los demás datos que ya cargaste se conservan.';
    $('import-review').showModal();
    $('import-apply').focus();
    status('Lectura terminada. Revisá los datos recuperados.');
  }
  async function start() {
    const files=[...$('import-files').files];
    if(!files.length) {status('Elegí al menos un PDF o una imagen.');return;}
    if(files.length>10 || files.reduce((n,f)=>n+f.size,0)>50*1024*1024) {status('Cargá hasta 10 archivos, con un máximo de 50 MB en total.');return;}
    if(files.some(f=>!(/\.pdf$/i.test(f.name)||['image/png','image/jpeg','image/webp'].includes(f.type)))) {status('Usá PDF o imágenes JPG, PNG o WebP.');return;}
    if(busy)return;
    busy=true;cancelled=false;$('import-read').disabled=true;$('import-cancel').hidden=false;$('import-files').disabled=true;$('import-page').disabled=true;
    const {found,add}=collect();
    try {
      for(const file of files) {checkCancel();status('Leyendo '+file.name+'…');if(/\.pdf$/i.test(file.name)) await readPdf(file,add);else await readImage(file,add);}
      checkCancel();review(found);
    } catch(e) {status(cancelled?'Lectura cancelada. Tus datos no cambiaron.': e.name==='PasswordException'?'El PDF tiene contraseña. Guardá una copia sin contraseña y volvé a cargarla.':'No se pudo completar la lectura: '+e.message);}
    finally {busy=false;$('import-read').disabled=false;$('import-cancel').hidden=true;$('import-files').disabled=false;$('import-page').disabled=false;}
  }
  $('import-read').addEventListener('click',start);
  $('import-cancel').addEventListener('click',()=>{cancelled=true;status('Cancelando lectura…');});
  $('import-back').addEventListener('click',()=>$('import-review').close());
  $('import-apply').addEventListener('click',()=>{
    const changes={};
    for(const check of $('import-results').querySelectorAll('input[type=checkbox]:checked')) {
      const input=check.closest('.import-row').querySelector('.import-value');
      const field=C.FIELD_INDEX[check.dataset.key];
      if(field && field.type==='select' && !C.OPTIONS[field.opts].some(([value])=>value===input.value)) {input.focus();status('Elegí una opción válida para '+labels[check.dataset.key]+'.');return;}
      const current=AltaUI.state()[check.dataset.key];
      if(typeof current==='boolean') changes[check.dataset.key]=input.value==='true';
      else changes[check.dataset.key]=input.value.trim();
    }
    AltaUI.applyImported(changes);$('import-review').close();
    status('Incorporé '+Object.keys(changes).length+' datos. Revisá el formulario y completá lo que falte antes de descargar el PDF.');
  });
})();
