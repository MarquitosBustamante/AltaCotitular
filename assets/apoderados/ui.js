(() => {
  'use strict';
  const C=window.ApoderadosCore,$=id=>document.getElementById(id);
  let state=C.emptyState(),touched=false,busy=false,cancelled=false,pending=[];
  const controls={};
  const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;};
  function build(){
    for(const section of C.SECTIONS){
      const root=el('section','sec'),head=el('div','sec-head'),grid=el('div','grid');
      head.append(el('h3','',section.title));root.append(head,grid);
      for(const f of section.fields){
        const wrap=el('div','f'+(f.w?' w'+f.w:'')),label=el('label','',f.l);label.htmlFor='a-f-'+f.k;
        let input;
        if(f.type==='select') {input=el('select');input.add(new Option('Elegí una opción',''));for(const option of f.options)input.add(new Option(option,option));}
        else {input=el('input');input.type=f.type==='checkbox'?'checkbox':'text';input.autocomplete='off';input.spellcheck=false;}
        input.id='a-f-'+f.k;
        if(f.ph)input.placeholder=f.ph;
        if(f.list){const list=el('datalist');list.id='a-list-'+f.k;for(const v of f.list)list.append(new Option(v,v));input.setAttribute('list',list.id);wrap.append(list);}
        const msg=el('div','msg');msg.id='a-m-'+f.k;input.setAttribute('aria-describedby',msg.id);
        input.addEventListener(f.type==='select'||f.type==='checkbox'?'change':'input',()=>{
          state[f.k]=f.type==='checkbox'?input.checked:input.value;touched=true;refresh();
        });
        if(f.type==='checkbox'){const check=el('div','checks');label.prepend(input,document.createTextNode(' '));check.append(label);wrap.append(check);}
        else wrap.append(label,input);
        wrap.append(msg);controls[f.k]=input;grid.append(wrap);
      }
      $('a-sheet').append(root);
    }
    const clearRoles=el('button','btn quiet','Dejar carácter pendiente');clearRoles.type='button';
    clearRoles.addEventListener('click',()=>{for(const k of C.ROLE_KEYS)state[k]='';state.caracter_bcv='';state.caracter_fci='';touched=true;sync();});
    $('a-sheet').querySelectorAll('.sec')[1].append(clearRoles);
  }
  function sync(){for(const f of C.FIELDS){if(f.type==='checkbox'){controls[f.k].checked=state[f.k]===true;controls[f.k].indeterminate=false;}else controls[f.k].value=state[f.k];}refresh();}
  function fileName(){return ('Apoderados - '+[state.apellidos,state.nombres].filter(Boolean).join(' ')+' - BCV y BSGFCI.pdf').replace(/[\\/:*?"<>|]/g,' ').replace(/\s+/g,' ');}
  function refresh(){
    const issues=touched?C.validate(state):[],by={};for(const i of issues)by[i.k]=i;
    for(const f of C.FIELDS){const input=controls[f.k],msg=$('a-m-'+f.k),issue=by[f.k];
      input.closest('.f').classList.toggle('is-error',!!issue);input.setAttribute('aria-invalid',issue?'true':'false');msg.textContent=issue?.msg||'';
      const inherited=C.derived(state,f.k);if(!state[f.k]&&inherited&&input.type!=='checkbox')input.placeholder=inherited;
      else if(!f.ph&&input.type!=='checkbox')input.placeholder='';
    }
    $('a-state').className='state'+(touched?(issues.length?' miss':' ok'):'');
    $('a-state').textContent=!touched?'Sin datos todavía':issues.length?issues.length+' datos pendientes':'Listo para descargar';
    $('a-state-sub').textContent=!touched?'Cargá un archivo o pegá el mail.':issues.length?'Los pendientes quedan rellenables en el PDF.':'BCV primero, BSGFCI después.';
    const list=$('a-issues');list.replaceChildren();
    for(const issue of issues){const li=el('li'),btn=el('button');btn.type='button';btn.append(el('b','',issue.label),el('span','',issue.msg));btn.addEventListener('click',()=>{controls[issue.k]?.scrollIntoView({block:'center'});controls[issue.k]?.focus();});li.append(btn);list.append(li);}
    $('a-fname').textContent=touched?fileName():'';$('a-done').hidden=true;
    return issues;
  }
  function applyImported(changes){for(const [key,value]of Object.entries(changes))if(C.FIELD_INDEX[key])state[key]=C.normalize(key,value);touched=true;sync();}
  function review(candidates,unknown=[]){
    pending=C.expandCandidates(candidates);const groups=new Map();for(const c of pending){if(!groups.has(c.key))groups.set(c.key,[]);if(!groups.get(c.key).some(v=>String(v.value)===String(c.value)))groups.get(c.key).push(c);}
    $('a-results').replaceChildren();
    if(!groups.size){$('a-import-status').textContent='No encontré datos para completar. Revisá el archivo o el texto.';return;}
    for(const [key,list] of groups){
      const f=C.FIELD_INDEX[key],row=el('div','import-row'),label=el('label'),check=el('input');check.type='checkbox';check.dataset.key=key;
      const issues=C.validate({...state,[key]:list[0].value}),issue=issues.find(i=>i.k===key),conflict=list.length>1||(state[key]!==''&&String(state[key])!==String(list[0].value));
      check.checked=!conflict&&!issue&&!list.some(c=>/Baja confianza|revisar bloque/i.test(c.source));label.append(check,document.createTextNode(' '+f.l));
      let input;
      if(f.type==='select'){input=el('select');input.add(new Option('Elegí una opción',''));for(const v of f.options)input.add(new Option(v,v));input.value=list[0].value;}
      else if(f.type==='checkbox'){input=el('select');input.add(new Option('Marcado','true'));input.add(new Option('Sin marcar','false'));input.value=String(list[0].value);}
      else{input=el('input');input.type='text';input.value=list[0].value;}
      input.className='import-value';input.dataset.key=key;input.setAttribute('aria-label',f.l+' recuperado');
      const note=el('small','',list.map(c=>c.source+(list.length>1?': '+c.value:'')).join(' / ')+(conflict?' · Hay diferencias. Revisá y marcá la casilla.':'')+(issue?' · '+issue.msg:''));
      if(state[key]!==''&&conflict)note.textContent+=' Valor actual: '+state[key];row.append(label,input,note);$('a-results').append(row);
    }
    $('a-review-summary').textContent=groups.size+' datos recuperados. Revisá cuáles querés aplicar.'+(unknown.length?' Hay '+unknown.length+' etiquetas sin reconocer.':'');
    if(unknown.length){const note=el('p','hint',unknown.join(' · '));$('a-results').append(note);}
    $('a-review').showModal();
  }
  function readMail(){
    if(!$('a-src').value.trim()){$('a-read-status').textContent='Pegá el mail antes de leer los datos.';return;}
    const parsed=C.parseText($('a-src').value);
    review(Object.entries(parsed.values).map(([key,value])=>({key,value,source:'Mail'})),parsed.unknown);
    $('a-read-status').textContent=Object.keys(parsed.values).length+' datos leídos.';
  }
  async function readFiles(){
    if(busy)return;const files=[...$('a-files').files];if(!files.length){$('a-import-status').textContent='Elegí un PDF o una imagen.';return;}
    busy=true;cancelled=false;$('a-import-read').disabled=true;$('a-import-cancel').hidden=false;$('a-files').disabled=true;$('a-page').disabled=true;
    try{const values=await ApoderadosImport.read(files,{page:Number($('a-page').value),onProgress:msg=>$('a-import-status').textContent=msg,isCancelled:()=>cancelled});if(!cancelled){review(values);if(values.length)$('a-import-status').textContent='Lectura terminada. Revisá los datos.';}}
    catch(e){$('a-import-status').textContent=e.message||'No se pudo leer el archivo.';}
    finally{busy=false;$('a-import-read').disabled=false;$('a-import-cancel').hidden=true;$('a-files').disabled=false;$('a-page').disabled=false;}
  }
  function confirmDownload(count){return new Promise(resolve=>{const dlg=$('a-confirm');$('a-confirm-text').textContent='Quedan '+count+' datos pendientes. Podrás completarlos en el PDF antes de firmar.';const finish=value=>{dlg.close();resolve(value);};$('a-confirm-go').onclick=()=>finish(true);$('a-confirm-back').onclick=()=>finish(false);dlg.oncancel=e=>{e.preventDefault();finish(false);};dlg.showModal();});}
  async function generate(){
    touched=true;const issues=refresh();if(issues.length&&!await confirmDownload(issues.length))return;
    const button=$('a-gen');button.disabled=true;button.textContent='Preparando PDF…';
    try{const bytes=await ApoderadosPDF.build(PDFLib,state),url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'})),a=el('a');a.href=url;a.download=fileName();document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);$('a-done').className='done';$('a-done').textContent='Descargado: '+fileName();}
    catch(e){$('a-done').className='done bad';$('a-done').textContent=e.message||'No se pudo generar el PDF.';}
    finally{$('a-done').hidden=false;button.disabled=false;button.textContent='Descargar PDF';}
  }
  build();sync();
  $('a-read').addEventListener('click',readMail);$('a-gen').addEventListener('click',generate);$('a-import-read').addEventListener('click',readFiles);
  $('a-import-cancel').addEventListener('click',()=>{cancelled=true;$('a-import-status').textContent='Cancelando lectura…';});
  $('a-clear').addEventListener('click',()=>{$('a-clear-confirm').showModal();});
  $('a-clear-go').addEventListener('click',()=>{state=C.emptyState();touched=false;$('a-src').value='';$('a-files').value='';$('a-import-status').textContent='';$('a-read-status').textContent='';sync();$('a-clear-confirm').close();});
  $('a-clear-back').addEventListener('click',()=>$('a-clear-confirm').close());
  $('a-src').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();readMail();}});
  $('a-discard').addEventListener('click',()=>$('a-review').close());
  $('a-apply').addEventListener('click',()=>{
    const changes={};for(const check of $('a-results').querySelectorAll('input[type=checkbox]:checked')){const input=check.closest('.import-row').querySelector('.import-value'),key=check.dataset.key;changes[key]=C.FIELD_INDEX[key].type==='checkbox'?input.value==='true':input.value.trim();}
    applyImported(changes);$('a-review').close();$('a-import-status').textContent=Object.keys(changes).length+' datos incorporados.';
  });
  window.ApoderadosUI={state:()=>({...state}),applyImported,readMail,generate};
})();
