/* Importación de apoderados: los resultados se revisan antes de aplicarse al formulario. */
(() => {
  'use strict';
  const base = new URL('./', document.currentScript.src);
  const common = new URL('../import/', base);
  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const norm = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const core = () => window.ApoderadosCore;
  let readerPromise, tesseractPromise;
  const templates = new Map();

  async function pdfReader() {
    if (!readerPromise) readerPromise = import(new URL('pdf.min.mjs', common)).then(reader => {
      reader.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', common).href;
      return reader;
    }).catch(error => { readerPromise = null; throw error; });
    return readerPromise;
  }
  async function templatePage(pageNo) {
    const block = pageNo > 3 ? 'bsgfci' : 'bcv';
    if (!templates.has(block)) {
      const promise = (async () => {
        const lib = await pdfReader();
        const response = await fetch(new URL(block + '.pdf', base));
        if (!response.ok) throw new Error('No se pudo cargar la plantilla ' + block.toUpperCase() + '. Volvé a intentar.');
        const task = lib.getDocument({ data: new Uint8Array(await response.arrayBuffer()), isEvalSupported: false });
        return task.promise;
      })().catch(error => { templates.delete(block); throw error; });
      templates.set(block, promise);
    }
    return (await templates.get(block)).getPage((pageNo - 1) % 3 + 1);
  }
  async function textItems(page) {
    const content = await page.getTextContent();
    return content.items.filter(item => item.str && clean(item.str)).map(item => ({
      text: clean(item.str), x: item.transform[4], y: item.transform[5],
      w: item.width, h: Math.abs(item.height)
    }));
  }
  const layoutFor = page => (core()?.LAYOUT || []).filter(entry => entry.p === page && entry.key && entry.t !== 'Sig' && !entry.signature && !['firma','firma_pendiente'].includes(entry.key));
  const inRect = (item, rect) => item.x >= rect[0] - 3 && item.x < rect[2] && item.y >= rect[1] - 2 && item.y <= rect[3] + 2;
  function rowText(items) {
    return clean([...items].sort((a, b) => Math.abs(a.y - b.y) > 5 ? b.y - a.y : a.x - b.x).map(item => item.text).join(' '));
  }
  function sameRect(a, b, tolerance = 3) { return a && b && a.length === 4 && a.every((v, i) => Math.abs(v - b[i]) < tolerance); }
  function widgetMatch(annotation, entry) {
    if (!sameRect(annotation.rect, entry.r)) return false;
    const names = [entry.n, entry.id, entry.pdfName].filter(Boolean);
    // Unir PDFs puede cambiar nombres; la posición exacta dentro de la página sigue siendo inequívoca.
    return names.includes(annotation.fieldName) || sameRect(annotation.rect, entry.r, 1);
  }
  function checked(value) { return value === true || (!!value && !/^(off|false|0|no|undefined|null)$/i.test(String(value))); }
  function entryValue(entry, value) {
    if (entry.t === 'Btn') return checked(value) ? (entry.option ?? true) : null;
    return Array.isArray(value) ? value.join(' ') : value;
  }
  function classify(items, annotations = []) {
    const text = norm(items.map(item => item.text).join(' '));
    if (text.includes('balanzsociedadgerente') || text.includes('elcuotapartista')) return 3;
    if (text.includes('balanzcapitalvalores') || text.includes('elcomitente')) return 0;
    const names = annotations.map(annotation => annotation.fieldName);
    if (names.includes('Text18') || names.includes('Text19') || names.includes('PAÍSAUTORIDAD DE EMISIÓN')) return 3;
    if (names.includes('Text5') || names.includes('Text6') || names.includes('PAIS AUTORIDAD')) return 0;
    return null;
  }
  function makeContext(options) {
    const candidates = [];
    const seen = new Set();
    const context = {
      options, worker: null,
      progress(message) { options.onProgress?.(message); },
      check() { if (options.isCancelled?.()) throw new Error('Lectura cancelada. Los datos no cambiaron.'); },
      add(entry, rawValue, source, lowConfidence = false) {
        if (!entry?.key || entry.signature || entry.t === 'Sig' || ['firma','firma_pendiente'].includes(entry.key)) return;
        let value = entryValue(entry, rawValue);
        if (value === null || value === undefined || value === '') return;
        if (typeof value !== 'boolean') {
          value = clean(value);
          if (!value || /^(off|undefined|null)$/i.test(value) || /^[_\s]+$/.test(value)) return;
        }
        if (typeof core()?.normalize === 'function') value = core().normalize(entry.key, value);
        if (value === null || value === undefined || value === '') return;
        const id = JSON.stringify([entry.key, value]);
        if (seen.has(id)) return;
        seen.add(id);
        candidates.push({ key: entry.key, value, source: source + (lowConfidence ? ' · Baja confianza' : '') });
      },
      candidates
    };
    return context;
  }
  function readRegions(items, entries, context, source) {
    for (const entry of entries) {
      const parts = items.filter(item => inRect(item, entry.r));
      const value = rowText(parts);
      if (!value) continue;
      if (entry.t === 'Btn' && !/^[xX✓✔]$/.test(value)) continue;
      context.add(entry, entry.t === 'Btn' ? true : value, source, parts.some(item => item.confidence != null && item.confidence < 55));
    }
  }
  function subtractTemplate(items, statics, ocr = false) {
    if (!ocr) return items.filter(item => !statics.some(original => norm(item.text) === norm(original.text) && Math.abs(item.x - original.x) < 2 && Math.abs(item.y - original.y) < 2));
    const words = statics.flatMap(item => {
      let offset = 0;
      return item.text.split(' ').map(token => {
        const word = { text: token, x: item.x + offset / item.text.length * item.w, y: item.y };
        offset += token.length + 1;
        return word;
      });
    });
    return items.filter(item => item.confidence > 0 && !words.some(word => norm(item.text) === norm(word.text) && Math.abs(item.x - word.x) < 15 && Math.abs(item.y - word.y) < 8));
  }
  async function tesseract() {
    if (window.Tesseract) return window.Tesseract;
    if (!tesseractPromise) tesseractPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('tesseract.min.js', common).href;
      script.onload = () => resolve(window.Tesseract);
      script.onerror = () => { tesseractPromise = null; reject(new Error('No se pudo cargar el lector de imágenes. Volvé a intentar.')); };
      document.head.appendChild(script);
    });
    return tesseractPromise;
  }
  async function recognize(canvas, context, pageNo) {
    context.check();
    context.progress('Reconociendo texto' + (pageNo ? ' · página ' + pageNo : '') + '…');
    if (!context.worker) {
      const lib = await tesseract();
      context.check();
      context.worker = await lib.createWorker('spa', 1, {
        workerPath: new URL('worker.min.js', common).href,
        corePath: common.href.replace(/\/$/, ''), langPath: common.href.replace(/\/$/, ''),
        workerBlobURL: false, cacheMethod: 'none'
      });
    }
    context.check();
    await context.worker.setParameters({ tessedit_pageseg_mode: '3' });
    const result = await context.worker.recognize(canvas, {}, { text: true, blocks: true });
    context.check();
    const words = [];
    for (const block of result.data.blocks || []) for (const paragraph of block.paragraphs || []) for (const line of paragraph.lines || []) for (const word of line.words || []) {
      words.push({ text: word.text, x: word.bbox.x0, y: word.bbox.y1, w: word.bbox.x1 - word.bbox.x0, h: word.bbox.y1 - word.bbox.y0, confidence: word.confidence });
    }
    return words;
  }
  async function render(page) {
    const viewport = page.getViewport({ scale: 2.5 });
    if (viewport.width * viewport.height > 45000000) throw new Error('La página es demasiado grande para leerla. Reducí su tamaño y volvé a cargarla.');
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return canvas;
  }
  async function readOcr(canvas, pageNo, context, source, recognized = null) {
    const template = await templatePage(pageNo), vp = template.getViewport({ scale: 1 });
    const words = recognized || await recognize(canvas, context, pageNo);
    const items = words.map(word => ({ ...word, x: word.x / canvas.width * vp.width, y: (1 - word.y / canvas.height) * vp.height, w: word.w / canvas.width * vp.width, h: word.h / canvas.height * vp.height }));
    const statics = await textItems(template);
    const defaults = await template.getAnnotations();
    let values = subtractTemplate(items, statics, true);
    // Reconocer la hoja evita tomar datos de un documento distinto en rectángulos coincidentes.
    const originalWords = statics.flatMap(item => item.text.split(' ')).map(norm).filter(word => word.length > 3);
    const matches = items.filter(item => originalWords.includes(norm(item.text))).length;
    if (matches < 12) throw new Error('No pude ubicar el formulario de apoderados. Usá la hoja completa y nítida, y comprobá la página seleccionada.');
    const entries = layoutFor(pageNo);
    // Una palabra se asigna por su centro vertical a una sola casilla. Las filas
    // contiguas no deben compartir la última línea del apellido con los nombres.
    const owner = item => entries.filter(entry => entry.t !== 'Btn' && item.x >= entry.r[0] - 2 && item.x < entry.r[2] && item.y + item.h / 2 >= entry.r[1] && item.y + item.h / 2 <= entry.r[3]).sort((a,b) => Math.abs(item.y + item.h / 2 - (a.r[1] + a.r[3]) / 2) - Math.abs(item.y + item.h / 2 - (b.r[1] + b.r[3]) / 2))[0];
    readRegions(values, entries.filter(entry => entry.t === 'Btn'), context, source);
    await context.worker.setParameters({ tessedit_pageseg_mode: '7' });
    for (const entry of entries.filter(entry => entry.t !== 'Btn')) {
      context.check();
      const parts = values.filter(item => owner(item) === entry);
      if (!parts.length) continue;
      let text = rowText(parts), confidence = Math.min(...parts.map(item => item.confidence));
      // El OCR de una hoja con renglones suele omitir partes del DNI aunque
      // marque como seguras las palabras restantes. Releer la casilla completa
      // recupera esos tramos sin intentar leer casillas vacías.
      {
        const [x0,y0,x1,y1] = entry.r, sx = canvas.width / vp.width, sy = canvas.height / vp.height;
        const left = Math.max(0, Math.ceil(x0 * sx)), top = Math.max(0, Math.ceil((vp.height - y1) * sy));
        const width = Math.min(canvas.width - left, Math.floor((x1 - x0) * sx));
        const height = Math.min(canvas.height - top, Math.floor((y1 - y0) * sy));
        if (width > 0 && height > 0) {
          const crop = document.createElement('canvas'); crop.width = width + 16; crop.height = height + 16;
          try {
            const ctx = crop.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, crop.width, crop.height);
            ctx.drawImage(canvas, left, top, width, height, 8, 8, width, height);
            // Los bordes de las casillas se superponen al pie de las letras.
            // Quitar solamente las líneas que atraviesan casi toda la casilla
            // permite leer números sin convertir esos bordes en caracteres.
            const pixels = ctx.getImageData(8, 8, width, height), data = pixels.data;
            const isDark = (x,y) => { const i = (y * width + x) * 4; return data[i] + data[i + 1] + data[i + 2] < 450; };
            const rows = [], columns = [];
            for (let y = 0; y < height; y++) { let count = 0; for (let x = 0; x < width; x++) if (isDark(x,y)) count++; if (count / width > .75) rows.push(y); }
            for (let x = 0; x < width; x++) { let count = 0; for (let y = 0; y < height; y++) if (isDark(x,y)) count++; if (count / height > .95) columns.push(x); }
            for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (rows.includes(y) || columns.includes(x)) { const i = (y * width + x) * 4; data[i] = data[i + 1] = data[i + 2] = 255; }
            ctx.putImageData(pixels, 8, 8);
            const result = await context.worker.recognize(crop, {}, { text: true });
            context.check();
            const cropped = clean(result.data.text);
            if (cropped && result.data.confidence >= 55 && norm(cropped).length >= norm(text).length && (result.data.confidence > confidence || norm(cropped).length > norm(text).length)) { text = cropped; confidence = result.data.confidence; }
          } finally { crop.width = crop.height = 0; }
        }
      }
      if (!text || /^[\s_.,|\-–—]+$/.test(text)) continue;
      const blank = defaults.find(annotation => widgetMatch(annotation, entry));
      if (blank && norm(Array.isArray(blank.fieldValue) ? blank.fieldValue.join(' ') : blank.fieldValue) === norm(text)) continue;
      context.add(entry, text, source, confidence < 55);
    }
  }

  async function readPdf(file, context) {
    const lib = await pdfReader();
    const task = lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
    try {
      const doc = await task.promise;
      if (doc.numPages > 100) throw new Error('El PDF tiene más de 100 páginas. Cargá solo el formulario de apoderados.');
      const selected = Number(context.options.page) || 1;
      const cache = new Map();
      async function getPageData(n) {
        if (!cache.has(n)) {
          const page = await doc.getPage(n);
          cache.set(n, { page, items: await textItems(page), annotations: await page.getAnnotations() });
        }
        return cache.get(n);
      }
      const offsets = new Map();
      for (let n = 1; n <= Math.min(doc.numPages, 6); n++) {
        context.check();
        let pageNo;
        let uncertain = false, canvas = null, recognized = null;
        const { page, items, annotations } = await getPageData(n);
        if (doc.numPages < 3) pageNo = selected + n - 1;
        else {
          const chunk = Math.floor((n - 1) / 3);
          if (!offsets.has(chunk)) {
            const first = await getPageData(chunk * 3 + 1);
            let offset = classify(first.items, first.annotations);
            if (offset === null && first.items.length < 12) {
              const firstCanvas = await render(first.page);
              const words = await recognize(firstCanvas, context, chunk * 3 + 1);
              offset = classify(words);
              if (n === chunk * 3 + 1) { canvas = firstCanvas; recognized = words; }
              else firstCanvas.width = firstCanvas.height = 0;
            }
            if (offset === null) { offset = doc.numPages >= 6 ? chunk * 3 : selected > 3 ? 3 : 0; uncertain = true; }
            offsets.set(chunk, { offset, uncertain });
          }
          const block = offsets.get(chunk); uncertain = block.uncertain;
          pageNo = block.offset + (n - 1) % 3 + 1;
        }
        if (pageNo < 1 || pageNo > 6 || !layoutFor(pageNo).length) { page.cleanup(); continue; }
        context.progress('Leyendo ' + file.name + ' · página ' + n + ' de ' + doc.numPages + '…');
        const label = (pageNo > 3 ? 'BSGFCI' : 'BCV') + ' · pág. ' + ((pageNo - 1) % 3 + 1) + (uncertain ? ' · Bloque según selección (revisar)' : '');
        const entries = layoutFor(pageNo), original = await templatePage(pageNo);
        const statics = await textItems(original), defaults = await original.getAnnotations();
        let count = 0;
        for (const annotation of annotations) {
          if (annotation.subtype !== 'Widget' || annotation.fieldType === 'Sig' || annotation.fieldValue == null) continue;
          const entry = entries.find(entry => widgetMatch(annotation, entry));
          if (!entry) continue;
          const blank = defaults.find(item => sameRect(item.rect, annotation.rect) && item.fieldName === entry.n);
          if (blank && JSON.stringify(blank.fieldValue) === JSON.stringify(annotation.fieldValue)) continue;
          const before = context.candidates.length;
          context.add(entry, annotation.fieldValue, label + ' · Campo PDF', uncertain);
          if (context.candidates.length > before) count++;
        }
        const templateMatches = items.filter(item => statics.some(original => norm(item.text) === norm(original.text) && Math.abs(item.x - original.x) < 2 && Math.abs(item.y - original.y) < 2)).length;
        if (templateMatches >= 12) readRegions(subtractTemplate(items, statics), entries, context, label + ' · Texto PDF' + (uncertain ? ' · Baja confianza' : ''));
        if (items.length < 12 && !count) {
          canvas ||= await render(page);
          try { await readOcr(canvas, pageNo, context, label + ' · Imagen/OCR (revisar)', recognized); }
          finally { canvas.width = canvas.height = 0; }
        } else if (canvas) canvas.width = canvas.height = 0;
        page.cleanup();
      }
    } catch (error) {
      if (error?.name === 'PasswordException') throw new Error('El PDF tiene contraseña. Cargá una copia sin contraseña.');
      throw error;
    } finally { await task.destroy(); }
  }
  async function readImage(file, context) {
    const bitmap = await createImageBitmap(file);
    try {
      if (bitmap.width * bitmap.height > 45000000) throw new Error('La imagen supera 45 megapíxeles. Reducí su tamaño y volvé a cargarla.');
      const scale = Math.min(1, 2500 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
      try {
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        await readOcr(canvas, Number(context.options.page) || 1, context, file.name + ' · Imagen/OCR (revisar)');
      } finally { canvas.width = canvas.height = 0; }
    } finally { bitmap.close(); }
  }
  async function read(files, options = {}) {
    if (!core()?.LAYOUT?.length) throw new Error('El formulario de apoderados todavía no está disponible.');
    const list = [...files];
    if (!list.length) throw new Error('Elegí al menos un PDF o una imagen.');
    if (list.length > 10 || list.reduce((sum, file) => sum + file.size, 0) > 50 * 1024 * 1024) throw new Error('Cargá hasta 10 archivos y 50 MB en total.');
    if (list.some(file => !/\.pdf$/i.test(file.name) && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) throw new Error('Usá PDF o imágenes JPG, PNG o WebP.');
    const context = makeContext(options);
    try {
      for (const file of list) {
        context.check();
        context.progress('Leyendo ' + file.name + '…');
        if (/\.pdf$/i.test(file.name)) await readPdf(file, context);
        else await readImage(file, context);
      }
      context.check();
      return context.candidates;
    } finally { if (context.worker) await context.worker.terminate(); }
  }
  window.ApoderadosImport = { read };
})();
