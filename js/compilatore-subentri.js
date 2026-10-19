(function () {
  'use strict';
  const Core = window.MiroxSubentri;
  const ENDPOINT = '/.netlify/functions/gestisci-subentri';
  const $ = id => document.getElementById(id);
  const form = $('subentroForm');
  const roles = {cedente:{version:0,resolved:false,row:null},subentrante:{version:0,resolved:false,row:null}};
  const titleCase = value => value[0].toUpperCase()+value.slice(1);
  let active = false, busy = false, choosing = false, duplicate = null, pending = null, generatedId = null;
  let historyPage = 1, historyVersion = 0, historyLoaded = false, historyBusy = false;
  function today() {
    const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part=>[part.type,part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }
  function el(tag, cls, text) { const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node; }
  function setValue(name,value) { const input=form.elements.namedItem(name);if(input && value!==null && value!==undefined)input.value=String(value); }
  function buildFields() {
    document.querySelectorAll('[data-fields]').forEach(container=>{
      for(const [key,label,max,rule,optional] of Core.FIELDS[container.dataset.fields]) {
        const field=el('div','field');const input=el('input');input.id=key;input.name=key;input.maxLength=rule==='iban'?42:max;
        input.type=rule==='data'?'date':rule==='telefono'?'tel':'text';input.required=!optional;
        if(rule==='data'&&key!=='data')input.max=today();
        if(['cap','piva','cliente'].includes(rule))input.inputMode='numeric';
        const patterns={cap:'[0-9]{5}',piva:'[0-9]{11}',cliente:'[0-9]{1,10}',cf:'[A-Za-z0-9]{16}',provincia:'[A-Za-z]{2}'};
        if(patterns[rule])input.pattern=patterns[rule];
        const caption=el('label','',label+(optional?'':' *'));caption.htmlFor=key;field.append(caption,input);container.append(field);
      }
    });
    for(const [key,label] of Object.entries(Core.CONSENSI)) {
      const row=el('fieldset','unframed consent-row');row.append(el('legend','',label+' *'));const pair=el('div','radio-pair');
      for(const [value,caption] of [['true','Sì'],['false','No']]) {
        const labelNode=el('label');const input=el('input');input.type='radio';input.name=`consenso_${key}`;input.value=value;input.required=true;
        labelNode.append(input,document.createTextNode(caption));pair.append(labelNode);
      }
      row.append(pair);$('consentRows').append(row);
    }
    for(const [key,label] of Object.entries(Core.DOCUMENTI)) {
      const field=el('div','field document-field');const caption=el('label','',label+' *');const input=el('input');input.type='file';input.multiple=true;input.accept='.pdf,.jpg,.jpeg,.png';input.id=`file_${key}`;input.dataset.kind=key;caption.htmlFor=input.id;
      const status=el('p','file-state');status.id=`files_${key}`;status.setAttribute('aria-live','polite');
      input.addEventListener('change',()=>{pending=null;status.textContent=[...input.files].map(file=>`${file.name} (${(file.size/1024/1024).toFixed(2)} MiB)`).join(' · ');});
      field.append(caption,input,status);$('documentRows').append(field);
    }
  }
  function updateConditional() {
    $('impresaFields').hidden=$('cedente_tipo').value!=='impresa';$('impresaFields').disabled=$('impresaFields').hidden;
    $('bankFields').hidden=$('pagamento').value!=='iban';$('bankFields').disabled=$('bankFields').hidden;
    const mode=form.querySelector('[name="modalita_compilazione"]:checked')?.value;
    const sending=mode==='invia_pratica';
    $('documentSection').hidden=!sending;$('documentSection').disabled=!sending;
    for(const kind of Object.keys(Core.DOCUMENTI)) {
      const input=$(`file_${kind}`);input.required=sending;
      if(!sending){input.value='';$(`files_${kind}`).textContent='';}
    }
    $('generateButton').textContent=sending?'Invia pratica':mode==='standard'?'Genera e archivia PDF':'Prosegui';
  }
  function updateNumberRows() {
    const rows=[...$('numberRows').children];
    rows.forEach((row,index)=>{const input=row.querySelector('input');input.id=`mobile_${index}`;row.querySelector('label').htmlFor=input.id;row.querySelector('label').textContent=`Numero mobile ${index+1} *`;row.querySelector('button').disabled=rows.length===1;row.querySelector('button').setAttribute('aria-label',`Rimuovi numero mobile ${index+1}`);});
    $('addNumber').disabled=rows.length>=Core.MAX_NUMERI;
    const pages=Math.ceil(rows.length/4);$('pageCount').textContent=`${rows.length} ${rows.length===1?'numero':'numeri'} · ${pages} ${pages===1?'pagina':'pagine'} del modulo`;
  }
  function addNumber(value='') {
    if($('numberRows').children.length>=Core.MAX_NUMERI)return;
    const row=el('div','number-row');const field=el('div','field');const input=el('input');input.type='tel';input.name='numero_mobile';input.maxLength=30;input.required=true;input.value=value;
    const remove=el('button','sub-button','Rimuovi');remove.type='button';remove.addEventListener('click',()=>{if(busy)return;row.remove();pending=null;updateNumberRows();});
    field.append(el('label'),input);row.append(field,remove);$('numberRows').append(row);updateNumberRows();
  }
  function resetForm() {
    form.reset();$('compilerFields').disabled=false;$('generatedResult').hidden=true;$('formCard').hidden=true;
    $('generationState').textContent='';document.querySelectorAll('.file-state').forEach(node=>{node.textContent='';});
    $('numberRows').replaceChildren();addNumber();setValue('data',today());updateConditional();pending=null;generatedId=null;
  }
  function clearRole(role) {
    const state=roles[role];state.version++;state.resolved=false;state.row=null;
    setSearchState(role,'');$(`results${titleCase(role)}`).replaceChildren();
    $(`search${titleCase(role)}`).querySelector('button').disabled=false;
    renderSelectedCustomer(role);
  }
  function setSearchState(role,message) {
    const status=$(`state${titleCase(role)}`);
    status.textContent=message;status.hidden=!message||!!roles[role].row;
  }
  function renderSelectedCustomer(role) {
    const title=titleCase(role),row=roles[role].row;
    $(`search${title}`).hidden=!!row;$(`description${title}`).hidden=!!row;
    $(`selected${title}`).hidden=!row;
    $(`name${title}`).textContent=row?.display_name||'';
    $(`code${title}`).textContent=row?`${role==='cedente'?'P.IVA':'Codice fiscale'}: ${row.cf_piva.toUpperCase()}`:'';
    $(`state${title}`).hidden=!!row||!$(`state${title}`).textContent;
  }
  function cancelSelection(role) {
    if(busy)return;
    clearRole(role);resetForm();
    const input=$(`query${titleCase(role)}`);input.value='';input.focus();
  }
  function reset(toCategories=false) {
    if(busy)return;
    active=false;duplicate=null;for(const role of Object.keys(roles)){clearRole(role);$(`query${titleCase(role)}`).value='';}
    resetForm();$('searchSection').hidden=true;$('categorySelector').hidden=!toCategories;$('worldSelector').hidden=toCategories;
    switchTab('compiler');
  }
  async function chooseCategory(source=null) {
    if(busy||choosing)return;
    choosing=true;
    const list=Object.values(Core.DOCUMENTI).map(label=>`<li>${MiroxSafe.escapeHtml(label)}</li>`).join('');
    const accepted=await MiroxUI.confirm(`<p>Documentazione da allegare:</p><ul class="sub-doc-list">${list}</ul><p>Obbligatoria solo scegliendo Invia pratica. La compilazione standard non richiede allegati.</p>`,{html:true,title:'Subentro da Microbusiness a Privato',okText:'Prosegui',cancelText:'Indietro'});
    choosing=false;if(!accepted)return;
    reset(true);active=true;duplicate=source;$('categorySelector').hidden=true;$('searchSection').hidden=false;
    if(source) { $('queryCedente').value=source.cedente_partita_iva||'';$('querySubentrante').value=source.subentrante_codice_fiscale||''; }
    $('queryCedente').focus();
  }
  function prefill(role,row) {
    if(!row)return;
    for(const [name,value] of Object.entries(row.prefill||{}))setValue(`${role}_${name}`,value);
    if(role==='cedente') {setValue('cedente_tipo','impresa');setValue('cedente_telefono_impresa',row.prefill.telefono);}
  }
  function resolveRole(role,row) {
    if(!active||busy)return;
    roles[role].resolved=true;roles[role].row=row;$(`results${titleCase(role)}`).replaceChildren();
    setSearchState(role,row?'':'Nessuna anagrafica trovata. Compila i dati manualmente.');
    renderSelectedCustomer(role);
    if(!Object.values(roles).every(state=>state.resolved))return;
    resetForm();for(const key of Object.keys(roles))prefill(key,roles[key].row);
    const sameClients=duplicate && roles.cedente.row && roles.subentrante.row && roles.cedente.row.cf_piva.toUpperCase()===duplicate.cedente_partita_iva && roles.subentrante.row.cf_piva.toUpperCase()===duplicate.subentrante_codice_fiscale;
    if(sameClients) {
      for(const [name,value] of Object.entries(duplicate))if(typeof value==='string')setValue(name,value);
      $('numberRows').replaceChildren();duplicate.numeri.forEach(number=>addNumber(number));
      MiroxUI.toast('Dati duplicati. Verifica numeri e date, indica i consensi e scegli come procedere.','success');
    } else if(duplicate) MiroxUI.toast('La duplicazione richiede le stesse anagrafiche. Compila con i dati dei clienti selezionati.','info');
    duplicate=null;updateConditional();$('formCard').hidden=false;$('formCard').scrollIntoView({behavior:'smooth',block:'start'});
  }
  async function search(role) {
    if(!active||busy)return;
    clearRole(role);resetForm();
    const state=roles[role],version=state.version;const input=$(`query${titleCase(role)}`);const button=$(`search${titleCase(role)}`).querySelector('button');
    let query;
    try {query=Core.validateSearchIdentifier(role,input.value);input.value=query;}
    catch(error){setSearchState(role,error.message);input.focus();return;}
    button.disabled=true;setSearchState(role,'Ricerca in corso...');
    try {
      const result=await api(`${ENDPOINT}?action=search_anagrafica&ruolo=${role}&q=${encodeURIComponent(query)}`);
      if(!active||version!==state.version)return;
      if(!Array.isArray(result.anagrafiche)||result.anagrafiche.some(item=>!item||typeof item.id!=='string'||typeof item.display_name!=='string'||typeof item.cf_piva!=='string'||!item.prefill||typeof item.prefill!=='object'||Array.isArray(item.prefill)))throw new Error('Risposta di ricerca non valida');
      for(const item of result.anagrafiche) {
        if(Core.validateSearchIdentifier(role,item.cf_piva)!==query)throw new Error('Risposta di ricerca non valida');
      }
      if(!result.anagrafiche.length){resolveRole(role,null);return;}
      setSearchState(role,'Seleziona l’anagrafica corretta.');
      for(const item of result.anagrafiche) {
        const resultButton=el('button','search-result');resultButton.type='button';resultButton.append(el('strong','',item.display_name),el('small','',item.cf_piva));
        resultButton.addEventListener('click',()=>{if(version===state.version)resolveRole(role,item);});$(`results${titleCase(role)}`).append(resultButton);
      }
    } catch(error) {if(version===state.version&&active)setSearchState(role,`Ricerca non riuscita: ${error.message}. Riprova per proseguire.`);}
    finally {if(version===state.version)button.disabled=false;}
  }
  async function api(url,body) {
    const response=await MiroxApi.fetch(url,body?{method:'POST',...(body instanceof FormData?{}:{headers:{'Content-Type':'application/json'}}),body:body instanceof FormData?body:JSON.stringify(body)}:undefined);
    const result=await response.json();if(!response.ok||!result.success)throw new Error(result.error||'Operazione non riuscita');return result;
  }
  function copySubscriber() {
    for(const field of Core.FIELDS.sottoscrittore) {const suffix=field[0].replace('sottoscrittore_','');setValue(field[0],form.elements.namedItem(`subentrante_${suffix}`)?.value||'');}
  }
  function copyAccount() {
    setValue('conto_intestatario',`${$('sottoscrittore_nome').value} ${$('sottoscrittore_cognome').value}`.trim());
    for(const key of ['via','civico','cap','comune','provincia'])setValue(`conto_${key}`,$(`sottoscrittore_${key}`).value);
    setValue('conto_cf_piva',$('sottoscrittore_codice_fiscale').value);
  }
  function payload() {
    const raw=Object.fromEntries(new FormData(form));raw.tipo=Core.TYPE;raw.numeri=[...form.querySelectorAll('[name="numero_mobile"]')].map(input=>input.value);raw.consensi={};
    for(const key of Object.keys(Core.CONSENSI)) {const value=form.querySelector(`[name="consenso_${key}"]:checked`)?.value;raw.consensi[key]=value===undefined?undefined:value==='true';}
    return Core.validatePayload(raw);
  }
  function selectedFiles() {
    const files=[];
    for(const kind of Object.keys(Core.DOCUMENTI)) {
      const group=[...$(`file_${kind}`).files];if(!group.length||group.length>4)throw new Error(`Allega da uno a quattro file per: ${Core.DOCUMENTI[kind]}`);
      for(const file of group) {
        if(!file.size||file.size>4*1024*1024)throw new Error(`${file.name}: massimo 4 MiB per file`);
        const mime={'pdf':'application/pdf','jpg':'image/jpeg','jpeg':'image/jpeg','png':'image/png'}[file.name.toLowerCase().split('.').pop()];
        if(!mime||(file.type&&file.type!==mime))throw new Error(`${file.name}: usa PDF, JPEG o PNG`);
        files.push({kind,file,mime});
      }
    }
    return files;
  }
  function setBusy(value) {
    busy=value;$('compilerFields').disabled=value;
    document.querySelectorAll('[data-reset],[data-categories],.search-form button,.search-form input,.cancel-selection,[data-tab]').forEach(node=>{node.disabled=value;});
  }
  async function generate(event) {
    event.preventDefault();if(busy||generatedId||!active||!Object.values(roles).every(state=>state.resolved))return;
    if(!form.reportValidity())return;
    let data,files,mode;
    try {mode=Core.validateMode(form.querySelector('[name="modalita_compilazione"]:checked')?.value);data=payload();files=mode==='invia_pratica'?selectedFiles():[];}catch(error){await MiroxUI.alert(error.message,{type:'error'});return;}
    setBusy(true);
    try {
      const fingerprint=JSON.stringify({data,mode});
      if(!pending||pending.fingerprint!==fingerprint) {
        $('generationState').textContent=mode==='invia_pratica'?'Preparazione dei documenti...':'Preparazione del modulo...';
        const entries=[];
        for(const {kind,file,mime} of files) {
          const bytes=await file.arrayBuffer();const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
          entries.push({file,manifest:{id:crypto.randomUUID(),tipo:kind,nome:file.name,mime,size:file.size,sha256:hash}});
        }
        pending={id:crypto.randomUUID(),fingerprint,entries,uploaded:new Set()};
      }
      await api(ENDPOINT,{action:'create',id:pending.id,subentro:data,modalita_compilazione:mode,documenti:pending.entries.map(entry=>entry.manifest)});
      for(let i=0;i<pending.entries.length;i++) {
        const entry=pending.entries[i];if(pending.uploaded.has(entry.manifest.id))continue;
        $('generationState').textContent=`Caricamento allegato ${i+1} di ${pending.entries.length}...`;
        const upload=new FormData();upload.append('id',pending.id);upload.append('document_id',entry.manifest.id);upload.append('file',entry.file,entry.file.name);
        await api(ENDPOINT,upload);pending.uploaded.add(entry.manifest.id);
      }
      $('generationState').textContent=mode==='invia_pratica'?'Verifica degli allegati e generazione del modulo...':'Generazione del modulo...';
      const result=await api(ENDPOINT,{action:'finalize',id:pending.id});generatedId=result.subentro.id;historyLoaded=false;
      $('generatedDescription').textContent=`Modulo generato in ${result.subentro.numero_pagine} ${result.subentro.numero_pagine===1?'pagina':'pagine'}. ${mode==='invia_pratica'?'Il PDF e gli allegati sono disponibili':'Il PDF è disponibile'} anche nello storico.`;
      $('viewGeneratedDocs').hidden=mode==='standard';
      $('generationState').textContent='Generazione completata.';$('generatedResult').hidden=false;$('generatedResult').scrollIntoView({behavior:'smooth',block:'center'});
    } catch(error) {$('generationState').textContent=mode==='invia_pratica'?'Operazione non completata. Puoi riprovare: gli allegati già caricati sono conservati.':'Operazione non completata. Puoi riprovare.';await MiroxUI.alert(error.message,{type:'error'});}
    finally {setBusy(false);if(generatedId)$('compilerFields').disabled=true;updateConditional();}
  }
  async function openPdf(id,documentId) {
    const popup=window.open('','_blank');if(popup)popup.opener=null;
    try {const result=await api(ENDPOINT,{action:'signed_url',id,...(documentId?{document_id:documentId}:{})});const url=MiroxSafe.safeUrl(result.signed_url);if(!url)throw new Error('Link non valido');if(popup)popup.location.href=url;else await MiroxUI.alert('Il browser ha bloccato la nuova scheda. Consenti i popup e riprova.');}
    catch(error){if(popup)popup.close();await MiroxUI.alert(error.message,{type:'error'});}
  }
  async function showDocuments(id) {
    try {
      const result=await api(ENDPOINT,{action:'documents',id});
      const items=[];
      for(const entry of result.documenti) {const signed=await api(ENDPOINT,{action:'signed_url',id,document_id:entry.id});items.push({name:entry.nome,displayName:`${Core.DOCUMENTI[entry.tipo]||'Documento'} · ${entry.nome}`,url:signed.signed_url,extension:{'image/jpeg':'jpg','image/png':'png','application/pdf':'pdf'}[entry.mime]||'pdf'});}
      MiroxUI.allegati({title:'Documentazione del subentro',items});
    } catch(error){await MiroxUI.alert(error.message,{type:'error'});}
  }
  function switchTab(tab) {
    if(busy)return;
    $('compilerPanel').hidden=tab!=='compiler';$('historyPanel').hidden=tab!=='history';document.querySelectorAll('[data-tab]').forEach(button=>button.classList.toggle('active',button.dataset.tab===tab));
    if(tab==='history'&&!historyLoaded)loadHistory(true);
  }
  async function duplicateItem(id) {
    if(choosing||busy)return;
    try {const result=await api(ENDPOINT,{action:'duplicate_data',id});await chooseCategory(result.subentro);}catch(error){await MiroxUI.alert(error.message,{type:'error'});}
  }
  function historyRow(item) {
    const row=el('tr');const type=el('td','','Mobile · Microbusiness a Privato');type.append(el('small','',item.modalita_compilazione==='standard'?'Compilazione standard':'Invia pratica'));row.append(type);
    const cedente=el('td','',item.cedente_nome);cedente.append(el('small','',item.cedente_partita_iva));row.append(cedente);
    const subentrante=el('td','',`${item.subentrante_nome} ${item.subentrante_cognome}`);subentrante.append(el('small','',item.subentrante_codice_fiscale));row.append(subentrante);
    row.append(el('td','',(item.numeri||[]).join(', ')));
    const when=el('td','',new Intl.DateTimeFormat('it-IT',{timeZone:'Europe/Rome',dateStyle:'short',timeStyle:'short'}).format(new Date(item.created_at)));when.append(el('small','',item.created_by_nome));row.append(when);
    const cell=el('td');const actions=el('div','actions');
    const buttons=[['Visualizza PDF',()=>openPdf(item.id)],...(item.modalita_compilazione==='standard'?[]:[['Allegati',()=>showDocuments(item.id)]]),['Duplica dati',()=>duplicateItem(item.id)]];
    for(const [label,fn] of buttons) {const button=el('button','sub-button',label);button.type='button';button.addEventListener('click',fn);actions.append(button);}
    cell.append(actions);row.append(cell);return row;
  }
  async function loadHistory(reset=false) {
    if(historyBusy)return;
    if(reset){historyPage=1;$('historyRows').replaceChildren();historyVersion++;}
    const version=historyVersion;historyBusy=true;$('historyState').textContent='Caricamento...';$('loadMore').hidden=true;$('refreshHistory').disabled=true;
    try {
      const result=await api(`${ENDPOINT}?page=${historyPage}`);if(version!==historyVersion)return;
      if(!Array.isArray(result.subentri))throw new Error('Risposta storico non valida');
      result.subentri.forEach(item=>$('historyRows').append(historyRow(item)));historyLoaded=true;
      $('historyState').textContent=$('historyRows').children.length?'':'Nessun subentro ancora generato.';$('loadMore').hidden=!result.has_more;historyPage++;
    } catch(error){$('historyState').textContent=`Storico non disponibile: ${error.message}. Premi Aggiorna per riprovare.`;}
    finally {historyBusy=false;$('refreshHistory').disabled=false;}
  }
  buildFields();resetForm();
  $('chooseMobile').addEventListener('click',()=>{if(busy)return;$('worldSelector').hidden=true;$('categorySelector').hidden=false;});
  $('chooseMicrobusinessPrivato').addEventListener('click',()=>chooseCategory());
  document.querySelectorAll('[data-reset]').forEach(button=>button.addEventListener('click',()=>reset(false)));
  document.querySelectorAll('[data-categories]').forEach(button=>button.addEventListener('click',()=>reset(true)));
  document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>switchTab(button.dataset.tab)));
  for(const role of Object.keys(roles)) {
    $(`cancel${titleCase(role)}`).addEventListener('click',()=>cancelSelection(role));
    $(`search${titleCase(role)}`).addEventListener('submit',event=>{event.preventDefault();search(role);});
    $(`query${titleCase(role)}`).addEventListener('input',()=>{if(busy)return;clearRole(role);resetForm();});
  }
  form.addEventListener('submit',generate);form.addEventListener('input',()=>{if(!busy)pending=null;});form.addEventListener('change',()=>{if(!busy)pending=null;});
  $('cedente_tipo').addEventListener('change',updateConditional);$('pagamento').addEventListener('change',updateConditional);
  form.querySelectorAll('[name="modalita_compilazione"]').forEach(input=>input.addEventListener('change',updateConditional));
  $('addNumber').addEventListener('click',()=>{addNumber();pending=null;});$('copySubscriber').addEventListener('click',()=>{copySubscriber();pending=null;});$('copyAccount').addEventListener('click',()=>{copyAccount();pending=null;});
  $('viewGenerated').addEventListener('click',()=>openPdf(generatedId));$('viewGeneratedDocs').addEventListener('click',()=>showDocuments(generatedId));
  $('refreshHistory').addEventListener('click',()=>loadHistory(true));$('loadMore').addEventListener('click',()=>loadHistory());
  Auth.richiediAuth().catch(()=>MiroxUI.alert('Impossibile verificare la sessione. Ricarica la pagina.',{type:'error'}));
})();
