/* Estado y correspondencias de los anexos de apoderados BCV / BSGFCI. */
(() => {
  'use strict';
  const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
  const norm=v=>clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\([^)]*\)/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
  const f=(k,l,extra={})=>({k,l,...extra});
  const TYPES=['D.N.I.','Pasaporte','D.N.I. extranjeros','Libreta de enrolamiento','Libreta cívica','Cédula de identidad'];
  const FISCAL=['C.U.I.T.','C.U.I.L.','C.D.I.','C.I.E.','N° de identificación fiscal'];
  const SECTIONS=[
    {id:'cuenta',title:'Cuentas y solicitud',fields:[f('comitente','Cuenta comitente BCV',{req:true}),f('cuotapartista','Cuenta cuotapartista BSGFCI',{req:true}),f('denominacion','Titular / denominación de la cuenta',{w:2,req:true}),f('lugar','Lugar',{req:true}),f('fecha','Fecha',{ph:'dd/mm/aaaa',req:true,date:true})]},
    {id:'roles',title:'Carácter de la incorporación',fields:[
      f('bcv_apoderado','BCV · Apoderado',{type:'checkbox'}),f('bcv_autorizado','BCV · Autorizado (consulta)',{type:'checkbox'}),f('bcv_representante','BCV · Representante legal',{type:'checkbox'}),f('bcv_web','BCV · Autorizado web',{type:'checkbox'}),
      f('fci_apoderado','BSGFCI · Apoderado',{type:'checkbox'}),f('fci_representante','BSGFCI · Representante legal',{type:'checkbox'}),f('fci_web','BSGFCI · Autorizado web',{type:'checkbox'}),
      f('caracter_bcv','Carácter en el texto BCV',{w:2}),f('caracter_fci','Carácter en el texto BSGFCI',{w:2})]},
    {id:'personal',title:'Datos personales del apoderado',fields:[
      f('apellidos','Apellido',{w:2,req:true}),f('nombres','Nombre/s',{w:2,req:true}),f('tipo_doc','Tipo de documento',{list:TYPES,req:true}),f('dni','Número de documento',{req:true}),f('autoridad','País / autoridad de emisión',{w:2,req:true}),
      f('nacionalidad','Nacionalidad',{req:true}),f('fecha_nac','Fecha de nacimiento',{date:true,ph:'dd/mm/aaaa',req:true}),f('lugar_nac','Lugar de nacimiento',{req:true}),f('sexo','Sexo',{list:['Femenino','Masculino','X'],req:true}),f('estado_civil','Estado civil',{list:['Soltero/a','Casado/a','Divorciado/a','Viudo/a','Conviviente'],req:true}),f('actividad','Actividad principal',{list:['Empleado/a','Profesional independiente','Comerciante','Jubilado/a','Estudiante','Rentista','Desempleado/a'],w:2,req:true})]},
    {id:'fiscal',title:'Información fiscal',fields:[f('tipo_fiscal','Tipo de identificador fiscal',{list:FISCAL,req:true}),f('cuil','CUIT / CUIL / CDI',{req:true}),f('iva','Condición ante el IVA',{list:['Consumidor final','Responsable monotributo','Responsable inscripto','Exento','No responsable'],req:true}),f('ganancias','Inscripción en Ganancias',{list:['Inscripto','No inscripto','Exento'],req:true})]},
    {id:'contacto',title:'Domicilio y contacto',fields:[f('email','Email',{w:2,req:true}),f('telefono','Teléfono',{w:2,req:true}),f('domicilio','Calle, número, piso y departamento',{w:4,req:true}),f('cp','Código postal',{req:true}),f('localidad','Localidad',{req:true}),f('provincia','Provincia',{req:true}),f('pais','País',{req:true})]},
    {id:'pep',title:'Declaración jurada PEP',fields:[f('pep','Persona expuesta políticamente',{type:'select',options:['Sí','No'],req:true,w:2}),f('pep_lugar_fecha','Lugar y fecha (DDJJ)',{w:2}),f('pep_nombre','Nombre y apellido (detalle PEP)',{w:2,pep:true}),f('pep_tipo_doc','Tipo de documento (PEP)',{list:TYPES,pep:true}),f('pep_dni','Número de documento (PEP)',{pep:true}),f('pep_autoridad','País / autoridad de emisión (PEP)',{w:2,pep:true}),f('pep_motivo','Motivo / cargo / organismo',{w:2,pep:true}),f('pep_pj','Denominación de la persona jurídica',{w:2,pep:true}),f('pep_tipo_fiscal','Tipo de identificador fiscal (PEP)',{list:FISCAL,pep:true}),f('pep_id','Número de identificador fiscal (PEP)',{pep:true})]},
    {id:'aclaracion',title:'Aclaración de la declaración',fields:[f('aclaracion','Nombre y apellido del declarante',{w:2}),f('dni_firma','Documento del declarante',{w:2})]}
  ];
  const FIELDS=SECTIONS.flatMap(s=>s.fields.map(f=>({...f,section:s.id}))), FIELD_INDEX=Object.fromEntries(FIELDS.map(f=>[f.k,f]));
  const emptyState=()=>Object.fromEntries(FIELDS.map(f=>[f.k,'']));
  function normalize(key,value) {
    if(FIELD_INDEX[key]?.type==='checkbox') return value===true||/^(si|s|true|x|1)$/.test(norm(value))?true:value===false||/^(no|false|0)$/.test(norm(value))?false:'';
    let v=clean(value);
    if(key==='pep') return /^(si|s|yes)$/.test(norm(v))?'Sí':/^(no|n)$/.test(norm(v))?'No':v;
    if(key==='email') return v.toLowerCase();
    if(key==='tipo_doc'||key==='pep_tipo_doc') {
      const n=norm(v);
      if(n==='dni'||n==='documento nacional de identidad')return 'D.N.I.';
      if(n==='pasaporte')return 'Pasaporte';
      if(n==='le')return 'Libreta de enrolamiento';if(n==='lc')return 'Libreta cívica';
    }
    if(key==='tipo_fiscal'||key==='pep_tipo_fiscal') {const n=norm(v).replace(/ /g,'');if(['cuit','cuil','cdi','cie'].includes(n))return n.toUpperCase().split('').join('.')+'.';}
    if(['fecha','fecha_nac'].includes(key)&&v) {const p=AltaCore._test.parseDate(v);return p.ok?p.value:v;}
    return v;
  }
  const ROLE_KEYS=['bcv_apoderado','bcv_autorizado','bcv_representante','bcv_web','fci_apoderado','fci_representante','fci_web'];
  function fullName(s){return [s.nombres,s.apellidos].map(clean).filter(Boolean).join(' ');}
  function role(s,block){return ROLE_KEYS.filter(k=>k.startsWith(block+'_')&&s[k]===true).map(k=>({apoderado:'Apoderado',autorizado:'Autorizado',representante:'Representante legal',web:'Autorizado web'})[k.split('_')[1]]).join(' / ');}
  function derived(s,k){
    if(clean(s[k]))return clean(s[k]);
    if(k==='aclaracion')return fullName(s);
    if(k==='dni_firma')return clean(s.dni);
    if(k==='caracter_bcv')return role(s,'bcv');if(k==='caracter_fci')return role(s,'fci');
    if(k==='pep_lugar_fecha')return [s.lugar,s.fecha].map(clean).filter(Boolean).join(', ');
    if(k.startsWith('pep_')&&s.pep==='Sí')return ({pep_nombre:fullName(s),pep_tipo_doc:s.tipo_doc,pep_dni:s.dni,pep_autoridad:s.autoridad,pep_tipo_fiscal:s.tipo_fiscal,pep_id:s.cuil})[k]||'';
    return '';
  }
  function valueFor(e,s){
    const k=e.key;
    if(k==='firma_pendiente')return {value:'',complete:false};
    if(e.t==='Btn'){const block=k.split('_')[0];const answered=ROLE_KEYS.some(key=>key.startsWith(block+'_')&&s[key]===true);return {value:s[k]===true?'X':'',complete:answered&&typeof s[k]==='boolean'};}
    const compound={documento:['tipo_doc','dni'],fiscal:['tipo_fiscal','cuil'],cp_localidad:['cp','localidad'],provincia_pais:['provincia','pais']}[k];
    if(compound)return {value:compound.map(k=>clean(s[k])).filter(Boolean).join(k==='provincia_pais'?' / ':' '),complete:compound.every(k=>clean(s[k]))};
    if(k==='pep_lugar_fecha')return {value:derived(s,k),complete:!!s[k]||!!(s.lugar&&s.fecha)};
    const value=derived(s,k)||clean(s[k]);
    if(k==='aclaracion'&&!s[k])return {value,complete:!!(s.nombres&&s.apellidos)};
    return {value:k==='pep'?value==='Sí'?'si':value==='No'?'no':value:value,complete:!!value};
  }
  function expandCandidates(candidates){
    const out=[];
    function push(c,key,value){if(value!==''&&value!=null)out.push({...c,key,value:normalize(key,value)});}
    for(const c of candidates){let v=clean(c.value),m;
      if(c.key==='documento'||c.key==='fiscal'){
        const isDoc=c.key==='documento';
        const re=isDoc?/^(D\s*\.?\s*N\s*\.?\s*I\.?|pasaporte|libreta de enrolamiento|libreta c[ií]vica|c[eé]dula de identidad)\s*[:\-]?\s*(.*)$/i:/^(C\s*\.?\s*U\s*\.?\s*I\s*\.?\s*[TL]\.?|C\s*\.?\s*D\s*\.?\s*I\.?|C\s*\.?\s*I\s*\.?\s*E\.?)\s*[:\-]?\s*(.*)$/i;
        if((m=v.match(re))){push(c,isDoc?'tipo_doc':'tipo_fiscal',m[1]);if(m[2])push(c,isDoc?'dni':'cuil',m[2]);}
        else push(c,isDoc?'dni':'cuil',v);
      }else if(c.key==='cp_localidad'){
        if((m=v.match(/^([A-Z]?\d{4}[A-Z]{0,3})\s*[,/ -]\s*(.+)$/i))){push(c,'cp',m[1]);push(c,'localidad',m[2]);}else push(c,'localidad',v);
      }else if(c.key==='provincia_pais'){
        if((m=v.match(/^(.+?)\s*\/\s*(.+)$/))){push(c,'provincia',m[1]);push(c,'pais',m[2]);}else push(c,'provincia',v);
      }else if(FIELD_INDEX[c.key])push(c,c.key,c.value);
    }
    const seen=new Set();return out.filter(c=>{const id=JSON.stringify([c.key,c.value]);if(seen.has(id))return false;seen.add(id);return true;});
  }
  const ALIASES={
    comitente:'comitente','cuenta comitente':'comitente','numero de comitente':'comitente','cuenta bcv':'comitente',cuotapartista:'cuotapartista','cuenta cuotapartista':'cuotapartista','cuenta bsgfci':'cuotapartista',titular:'denominacion','nombre del titular':'denominacion','titular de la cuenta':'denominacion','denominacion de la cuenta':'denominacion',denominacion:'denominacion',lugar:'lugar',fecha:'fecha',
    apellido:'apellidos',apellidos:'apellidos',nombre:'nombres',nombres:'nombres','nombre s':'nombres','nombre y apellido':'aclaracion','nombre completo':'aclaracion',
    'tipo de documento':'tipo_doc','tipo documento':'tipo_doc',dni:'dni','numero de documento':'dni','documento':'documento','tipo y numero de documento':'documento','tipo y n documento':'documento','pais autoridad de emision':'autoridad','pais y autoridad de emision':'autoridad','autoridad de emision':'autoridad',
    nacionalidad:'nacionalidad','fecha de nacimiento':'fecha_nac','lugar de nacimiento':'lugar_nac',sexo:'sexo',genero:'sexo','estado civil':'estado_civil','actividad principal':'actividad',actividad:'actividad',ocupacion:'actividad',profesion:'actividad',
    'tipo de identificador fiscal':'tipo_fiscal','tipo fiscal':'tipo_fiscal','cuit cuil cdi':'fiscal','cuil o cuit':'fiscal',cuil:'cuil',cuit:'cuil',cdi:'cuil','identificador fiscal':'fiscal','numero fiscal':'cuil',iva:'iva','condicion ante el iva':'iva','condicion frente al iva':'iva',ganancias:'ganancias','inscripcion en ganancias':'ganancias','impuesto a las ganancias':'ganancias',
    email:'email','e mail':'email',mail:'email','correo electronico':'email',domicilio:'domicilio','domicilio real':'domicilio',direccion:'domicilio','calle numero piso departamento':'domicilio','calle n piso dto':'domicilio','codigo postal':'cp',cp:'cp',localidad:'localidad','codigo postal localidad':'cp_localidad',provincia:'provincia',pais:'pais','provincia pais':'provincia_pais',telefono:'telefono',celular:'telefono','telefono celular':'telefono',
    pep:'pep','persona expuesta politicamente':'pep','condicion pep':'pep','lugar y fecha':'pep_lugar_fecha','nombre y apellido pep':'pep_nombre','tipo de documento pep':'pep_tipo_doc','documento pep':'pep_dni','dni pep':'pep_dni','numero de documento pep':'pep_dni','pais autoridad pep':'pep_autoridad','autoridad de emision pep':'pep_autoridad','motivo pep':'pep_motivo',motivo:'pep_motivo',cargo:'pep_motivo',organismo:'pep_motivo','denominacion de la persona juridica':'pep_pj','persona juridica':'pep_pj','tipo fiscal pep':'pep_tipo_fiscal','numero fiscal pep':'pep_id',aclaracion:'aclaracion','dni firma':'dni_firma','documento del declarante':'dni_firma'
  };
  Object.assign(ALIASES,{
    'nombre del apoderado':'nombres','nombres del apoderado':'nombres','apellido del apoderado':'apellidos','apellidos del apoderado':'apellidos','dni del apoderado':'dni','numero de documento del apoderado':'dni','tipo de documento del apoderado':'tipo_doc',
    'nombre y apellido del apoderado':'aclaracion','apellido y nombre':'aclaracion','apellido y nombres':'aclaracion','nombre y apellido del titular':'denominacion','apellido y nombre del titular':'denominacion',
    'numero de cuenta comitente':'comitente','nro de comitente':'comitente','comitente nro':'comitente','numero de cuenta cuotapartista':'cuotapartista','nro de cuotapartista':'cuotapartista','cuotapartista nro':'cuotapartista',
    'pais y autoridad de emision pep':'pep_autoridad','motivo cargo organismo':'pep_motivo','cargo organismo':'pep_motivo','tipo de identificador fiscal pep':'pep_tipo_fiscal','identificador fiscal pep':'pep_id'
  });
  for(const f of FIELDS)ALIASES[norm(f.l)]=f.k;
  function parseText(text){
    const raw=[],unknown=[];
    const roles=(scope,value)=>{
      const n=norm(value);if(!n)return;
      const recognized=/apoderad|representante|autorizad/.test(n);if(!recognized){unknown.push('Carácter: '+value);return;}
      for(const block of scope){for(const k of ROLE_KEYS.filter(k=>k.startsWith(block+'_')))raw.push({key:k,value:false,source:'Mail'});
        const set=k=>raw.push({key:block+'_'+k,value:true,source:'Mail'});
        if(/apoderad/.test(n))set('apoderado');if(/representante/.test(n))set('representante');if(/autorizad.*web/.test(n))set('web');else if(/autorizad/.test(n)){if(block==='bcv')set('autorizado');else unknown.push('Autorizado BSGFCI: indicá si es Autorizado web.');}
      }
    };
    for(const line of String(text||'').split(/\r?\n/)){
      const match=line.replace(/^\s*(?:[>•*]+\s*)/,'').replace(/^\s*\d{1,2}[.)]\s*/,'').match(/^\s*([^:]+):\s*(.*?)\s*$/);if(!match||!match[2])continue;
      const label=norm(match[1]),value=match[2];
      if(['caracter','rol','tipo de incorporacion','tipo de alta'].includes(label)){roles(['bcv','fci'],value);continue;}
      if(['caracter bcv','rol bcv'].includes(label)){roles(['bcv'],value);raw.push({key:'caracter_bcv',value,source:'Mail'});continue;}
      if(['caracter bsgfci','rol bsgfci','caracter fci'].includes(label)){roles(['fci'],value);raw.push({key:'caracter_fci',value,source:'Mail'});continue;}
      const key=ALIASES[label];if(!key){unknown.push(match[1]+': '+value);continue;}
      raw.push({key,value,source:'Mail'});
      if(['dni','dni del apoderado','cuit','cuil','cdi'].includes(label))raw.push({key:label.startsWith('dni')?'tipo_doc':'tipo_fiscal',value:label.startsWith('dni')?'dni':label,source:'Mail'});
    }
    const values={};for(const c of expandCandidates(raw))values[c.key]=c.value;
    return {values,unknown};
  }
  function validate(s){
    const issues=[];const add=(k,msg)=>issues.push({k,label:FIELD_INDEX[k]?.l||k,msg,level:'error'});
    for(const f of FIELDS)if((f.req||f.pep&&s.pep==='Sí'&&!['pep_pj'].includes(f.k))&&!clean(derived(s,f.k)||s[f.k]))add(f.k,'Falta completar.');
    for(const block of ['bcv','fci'])if(!ROLE_KEYS.some(k=>k.startsWith(block+'_')&&s[k]===true))add(block+'_apoderado','Indicá el carácter de la incorporación.');
    for(const k of ['fecha','fecha_nac'])if(s[k]&&!AltaCore._test.parseDate(s[k]).ok)add(k,'Usá una fecha válida: dd/mm/aaaa.');
    if(s.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.email))add('email','Revisá el email.');
    if(s.pep&&!['Sí','No'].includes(s.pep))add('pep','Elegí Sí o No.');
    if(s.tipo_doc==='D.N.I.'&&s.dni&&!/^\d{7,8}$/.test(s.dni.replace(/[.\s-]/g,'')))add('dni','El DNI debe tener 7 u 8 dígitos.');
    return issues;
  }
  window.ApoderadosCore={SECTIONS,FIELDS,FIELD_INDEX,ROLE_KEYS,LAYOUT:window.ApoderadosLayout||[],emptyState,normalize,parseText,expandCandidates,valueFor,derived,validate};
})();
