(function () {
  'use strict';
  let cached = null, revision = 0, pending = null, preview = null, reading = null;
  const e = value => window.MiroxSafe.escapeHtml(String(value || ''));
  function comparisonHtml(comparison) {
    if (!comparison) return '';
    return '<p><strong>' + e(comparison.campo_anagrafica) + ':</strong> ' + e(comparison.nome_anagrafica || 'Non compilato') + '</p>'
      + '<p><strong>Nome letto dal documento:</strong> ' + e((comparison.nomi_documenti || []).join(' / ') || 'Non leggibile') + '</p>'
      + (comparison.fiscale_atteso ? '<p><strong>Codice fiscale atteso:</strong> ' + e(comparison.fiscale_atteso) + '</p><p><strong>Codice fiscale letto:</strong> ' + e((comparison.fiscali_documenti || []).join(' / ') || 'Non letto dal documento') + '</p>' : '')
      + (comparison.nome_informativo ? '<p>Il nome OCR è informativo. Il controllo dell’identità usa il codice fiscale e la validità del documento alla firma.</p>'
        : '<p>Confronta questi valori con il testo stampato sul documento per distinguere un errore di trascrizione da un dato anagrafico da correggere.</p>');
  }
  function showError(error) {
    if (!error?.identityComparison) return false;
    window.MiroxUI._build({ title: 'Controllo identita', bodyHtml: '<p>' + e(error.message) + '</p>' + comparisonHtml(error.identityComparison) });
    return true;
  }
  const keyFor = async (files, customer, date, pdaPaths, pacchetto) => JSON.stringify([window.MiroxIdentitaCore.customer(customer),customer.cluster, date, pdaPaths,pacchetto,
    await Promise.all(files.map(async file => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))).map(b => b.toString(16).padStart(2, '0')).join('')))]);
  async function call(body) {
    const controller=typeof AbortController==='function'?new AbortController():null;
    let timer;
    const request=(async()=>{
      const options=body instanceof FormData?{method:'POST',body}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)};
      if(controller)options.signal=controller.signal;
      const response=await window.MiroxApi.fetch('/.netlify/functions/verifica-identita-upload',options);
      const result=await response.json().catch(()=>({}));
      if(!response.ok||!result.success)throw Object.assign(new Error(result.error||'Controllo identita non disponibile.'), { code: result.code });
      if(!result.token||!result.result||!['coerente','manuale','da_confermare','da_correggere'].includes(result.result.stato))throw new Error('Risposta del controllo non valida.');
      return result;
    })();
    if(typeof setTimeout!=='function')return request;
    try{return await Promise.race([request,new Promise((_,reject)=>{timer=setTimeout(()=>{controller?.abort();reject(new Error('Il servizio non ha risposto in tempo.'));},45000);})]);}
    finally{clearTimeout(timer);}
  }
  async function manualPreview(result, files, requireCitizenship, active, confirm, barcodeOptions = null) {
    const barcode = Boolean(barcodeOptions);
    const digests = await Promise.all(files.map(async file => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))).map(b => b.toString(16).padStart(2, '0')).join('')));
    const urls = [];let ownPreview=null;
    try {
      if(!active())return null;
      files.forEach(file => urls.push(URL.createObjectURL(file)));
      return await new Promise(resolve => {
        let done = false, saving = false;
        const loaded = new Set(), opened = new Set(), acknowledged = new Set();
        const expiry = result.scadenza && result.scadenza >= result.data_firma ? result.scadenza : '';
        const messages = [...(result.errors || []), ...(result.uncertain || [])];
        const m = window.MiroxUI._build({ title: 'Anteprima e conferma manuale del documento', large: true,
          bodyHtml: '<p>' + (barcode ? (barcodeOptions.business
            ? 'Confronta il documento con il delegato indicato sulla PDA WindTre.'
            : 'Confronta il documento con l’intestatario del contratto.') : 'Il controllo automatico richiede una verifica manuale.') + '</p>'
            + (messages.length ? '<ul>' + messages.map(text => '<li>' + e(text) + '</li>').join('') + '</ul>' : '')
            + comparisonHtml(result.confronto) + (result.pacchetto?.tessera_sanitaria?'<p>Verifica anche la presenza della tessera sanitaria fronte e retro della stessa persona.</p>':'')
            + (result.confronto_crm?'<p><strong>Dati da controllare</strong></p><p>Cliente nel modulo: '+e(result.confronto_crm.nome_modulo)+' ('+e(result.confronto_crm.cluster_modulo)+').</p><p>Cliente salvato nel CRM: '+e(result.confronto_crm.nome_crm)+' ('+e(result.confronto_crm.cluster_crm)+').</p><p>CF/P.IVA: '+e(result.confronto_crm.codice_fiscale)+'. La conferma si riferisce ai dati del modulo, che saranno salvati con il normale invio della pratica.</p>':'')
            + files.map((file, index) => '<section><h3>Documento ' + (index + 1) + ': ' + e(file.name || 'Documento di riconoscimento') + '</h3>'
              + '<iframe data-identity-preview="' + index + '" title="Anteprima documento ' + (index + 1) + '" src="' + e(urls[index]) + '#view=FitH" style="display:block;width:100%;height:480px;border:1px solid #E3E8EE"></iframe>'
              + '<p><a data-identity-open="'+index+'" href="' + e(urls[index]) + '" target="_blank" rel="noopener">Apri il documento a dimensione intera</a></p>'
              + '<label><input type="checkbox" data-identity-viewed="'+index+'" disabled> Ho aperto e verificato questo PDF a dimensione intera.</label></section>').join('')
            + '<p>Se l’anteprima non viene visualizzata, apri ogni PDF a dimensione intera e indica di averlo verificato.</p>'
            + (barcode ? '<p>' + (barcodeOptions.business ? 'Azienda' : 'Intestatario') + ': <strong>' + e(result.cliente_nome) + '</strong></p>'
              + '<p>CF atteso' + (barcodeOptions.business ? ' sulla PDA' : '') + ': <strong>' + e(result.fiscale_atteso || 'Da verificare') + '</strong></p>'
              + '<p>CF letto dal codice a barre: <strong>' + e((result.fiscali_letti || []).join(' / ') || 'Illeggibile') + '</strong></p>'
              : '<p><strong>Confermi che il documento visualizzato nella preview è quello del cliente in anagrafica? Verificalo prima di confermare.</strong></p>'
                + '<p>Cliente: <strong>'+e(result.cliente_nome||result.confronto?.nome_anagrafica)+'</strong>. CF/P.IVA: <strong>'+e(result.cliente_fiscale||result.confronto?.fiscale_atteso)+'</strong>.</p>'
                + '<label>Scadenza verificata sul documento <input type="date" data-identity-expiry value="' + e(expiry) + '"></label>')
            + (result.richiede_cf_rappresentante?'<label>CF del rappresentante verificato su documento e PDA Business <input type="text" data-identity-representative maxlength="16" value="'+e(result.cf_rappresentante)+'"></label><p>Conferma anche che il CF personale riportato sulla PDA Business e sul documento appartiene alla stessa persona.</p>':'')
            + (requireCitizenship ? '<label>Cittadinanza <select data-identity-country><option value="">Seleziona</option><option value="ue"' + (result.cittadinanza === 'ue' ? ' selected' : '') + '>Italiana o di un Paese UE</option><option value="extra_ue"' + (result.cittadinanza === 'extra_ue' ? ' selected' : '') + '>Extra UE</option></select></label><p>Conta la cittadinanza, non residenza o Paese di rilascio.</p>' : '')
            + (barcode ? '<p>La conferma registra che hai verificato tutti i PDF e che il documento appartiene alla persona indicata.</p>'
              : '<p>Con Sì confermi di aver controllato tutti i PDF, che il documento appartiene al cliente e che è completo e valido alla data di firma. La conferma viene registrata e sostituisce l’esito OCR dell’identità.</p>')
            + '<p data-identity-preview-status role="status">Caricamento anteprima...</p>',
          footerHtml: '<button type="button" class="mx-btn" data-identity-cancel>' + (barcode ? 'Carica nuovamente il documento' : 'No, annulla') + '</button>'
            + '<button type="button" class="mx-btn mx-btn-primary" data-identity-save disabled>' + (barcode ? 'Confermo che il documento è corretto' : 'Sì, confermo e proseguo') + '</button>',
          onClose: () => { if (!done) { done=true;resolve(null); } } });
        ownPreview=m;preview=m;
        m.body.style.maxHeight = '68vh'; m.body.style.overflowY = 'auto';
        const save = m.foot.querySelector('[data-identity-save]');
        const message = m.body.querySelector('[data-identity-preview-status]');
        const allViewed=()=>files.every((_,i)=>loaded.has(i)||acknowledged.has(i));
        const update=()=>{save.disabled=saving||!allViewed();if(!saving)message.textContent=allViewed()?'Documenti pronti: verificali prima di confermare.':'Carica le anteprime oppure apri i PDF a dimensione intera e conferma di averli verificati.';};
        m.body.querySelectorAll('[data-identity-preview]').forEach((frame, index) => {
          frame.addEventListener('load', () => {
            if(done||!active())return;
            loaded.add(index);
            update();
          });
          frame.addEventListener('error', () => { if(done||!active())return;loaded.delete(index);update(); });
        });
        const viewed=Array.from(m.body.querySelectorAll('[data-identity-viewed]'));
        m.body.querySelectorAll('[data-identity-open]').forEach((link,index)=>link.addEventListener('click',()=>{if(done||!active())return;opened.add(index);viewed[index].disabled=false;}));
        viewed.forEach((checkbox,index)=>checkbox.addEventListener('change',()=>{if(done||!active())return;if(checkbox.checked&&opened.has(index))acknowledged.add(index);else acknowledged.delete(index);update();}));
        m.foot.querySelector('[data-identity-cancel]').addEventListener('click', () => {
          m.close();
          if (barcode) barcodeOptions.reload();
        });
        save.addEventListener('click', async () => {
          if (done || saving || !active() || !allViewed()) return;
          const scadenza = barcode ? undefined : m.body.querySelector('[data-identity-expiry]').value;
          if (!barcode && (!scadenza || scadenza < result.data_firma)) { await window.MiroxUI.alert('Indica una scadenza verificata e valida alla data di firma.'); return; }
          const cittadinanza = requireCitizenship ? m.body.querySelector('[data-identity-country]').value : result.cittadinanza || null;
          if (requireCitizenship && !cittadinanza) { await window.MiroxUI.alert('Seleziona la cittadinanza per verificare se serve il permesso di soggiorno.'); return; }
          const representative=result.richiede_cf_rappresentante?m.body.querySelector('[data-identity-representative]').value.trim().toUpperCase():null;
          if(result.richiede_cf_rappresentante&&!/^[A-Z0-9]{16}$/.test(representative)){await window.MiroxUI.alert('Riporta il CF personale del rappresentante dopo averlo verificato su documento e PDA Business.');return;}
          saving=true;save.disabled=true;message.textContent='Registrazione della conferma manuale...';
          try{
            const data=await confirm({action:'confirm_preview',preview_visualizzata:true,preview_sha256:digests,scadenza,cittadinanza,
              ...(representative?{cf_rappresentante_verificato:representative,rappresentante_verificato:true}:{})});
            if(done||!active())return;
            done=true;m.close();resolve(data);
          }catch(error){if(done||!active())return;message.textContent='Conferma non registrata: '+(error.message||'servizio non disponibile')+' Puoi riprovare senza ricaricare i documenti.';}
          finally{saving=false;if(!done)save.disabled=!allViewed();}
        });
      });
    } finally { if(preview===ownPreview)preview=null;urls.forEach(url => URL.revokeObjectURL(url)); }
  }
  function barcodeNotice(title) {
    return new Promise(resolve => {
      const m = window.MiroxUI._build({ title, bodyHtml: '<p>Apri l’anteprima per verificare il documento o caricarlo nuovamente.</p>',
        footerHtml: '<button type="button" class="mx-btn mx-btn-primary" data-identity-ok>OK</button>', onClose: () => resolve(false) });
      preview = m;
      m.foot.querySelector('[data-identity-ok]').addEventListener('click', () => { resolve(true); m.close(); });
    }).finally(() => { preview = null; });
  }
  function chooseCitizenship() {
    return new Promise(resolve => {
      const m = window.MiroxUI._build({ title: 'Cittadinanza per dispositivo VAR',
        bodyHtml: '<p>Indica la cittadinanza del cliente per determinare se serve il permesso di soggiorno.</p>',
        footerHtml: '<button type="button" class="mx-btn" data-group="ue">Italia o altro Paese UE</button><button type="button" class="mx-btn mx-btn-primary" data-group="extra_ue">Extra UE</button>',
        onClose: () => resolve(null) });
      preview = m;
      for (const group of ['ue', 'extra_ue']) {
        m.foot.querySelector('[data-group="' + group + '"]').addEventListener('click', () => { resolve(group); m.close(); });
      }
    }).finally(() => { preview = null; });
  }
  const cancelled = () => Object.assign(new Error('Controllo del documento interrotto.'), { identityCancelled: true });
  async function ensureBarcode({ files, customer, pdaPaths = [], requireCitizenship, current = () => true, reload = () => {} }) {
    if (!files.length) throw new Error('Carica il documento di riconoscimento.');
    if (files.reduce((sum, file) => sum + file.size, 0) > 4 * 1024 * 1024) throw new Error('I PDF del documento superano 4 MB complessivi. Carica una scansione PDF più leggera.');
    const stamp = revision;
    const active = () => stamp === revision && current();
    const key = await keyFor(files, customer, 'barcode', pdaPaths, null);
    if (!active()) throw cancelled();
    const status = document.getElementById('identitaControlloEsito');
    const business = window.MiroxIdentitaCore.customer(customer).business;
    const form = decision => {
      const body = new FormData();
      body.append('cliente', JSON.stringify(customer));
      body.append('action', decision ? 'barcode_manual' : 'barcode');
      if (business) body.append('pda_paths', JSON.stringify(pdaPaths));
      for (const file of files) body.append('file', file);
      if (decision) body.append('conferma', JSON.stringify(decision));
      return body;
    };
    let data = cached?.key === key && Date.now() - cached.at < 3.5 * 3600000 ? cached : null;
    if (!data) {
      cached = null;
      if (status) status.textContent = 'Lettura in corso';
      const loader = window.MiroxUI._build({
        title: 'Lettura in corso',
        bodyHtml: '<div class="mx-loading"><div class="mx-spinner" aria-hidden="true"></div></div>',
        closable: false
      });
      reading = loader;
      try { data = await call(form()); }
      catch (error) {
        if (!active()) throw cancelled();
        if (error.code === 'pda_conflict') throw error;
        data = { result: { stato: 'da_confermare', barcode_stato: 'illeggibile',
          cliente_nome: customer.ragione_sociale, fiscale_atteso: business ? null : customer.cf_piva,
          richiede_cf_rappresentante: business && pdaPaths.length > 0 } };
      } finally {
        if (reading === loader) {
          reading = null;
          loader.close();
        }
      }
      if (!active()) throw cancelled();
      if (!['coerente', 'manuale'].includes(data.result.stato)) {
        const title = data.result.barcode_stato === 'diverso' ? 'Codice fiscale non coincidente'
          : data.result.barcode_stato === 'illeggibile' ? 'Impossibile leggere il codice a barre' : 'Verifica manuale del documento';
        if (status) status.textContent = title;
        if (!await barcodeNotice(title) || !active()) throw cancelled();
        const confirm = decision => data.token ? call({ token: data.token, ...decision }) : call(form(decision));
        data = await manualPreview(data.result, files, requireCitizenship, active, confirm, { business, reload });
        if (!data || !active()) throw cancelled();
        if (data.result.stato !== 'manuale') throw new Error('Conferma manuale non registrata.');
      }
      cached = { key, at: Date.now(), token: data.token, result: data.result };
    }
    if (requireCitizenship && !cached.result.cittadinanza) {
      const group = await chooseCitizenship();
      if (!group || !active()) throw cancelled();
      const confirmed = await call({ token: data.token, action: 'barcode_citizenship', cittadinanza: group });
      if (!active()) throw cancelled();
      cached = { key, at: Date.now(), token: confirmed.token, result: confirmed.result };
    }
    if (status) status.textContent = cached.result.stato === 'manuale' ? 'Documento confermato manualmente.' : 'Codice fiscale coincidente.';
    return cached;
  }
  async function ensure({ files, customer, date, pdaPaths = [], pacchetto=null, requireCitizenship = false, current = () => true }) {
    if (!files.length) throw new Error('Carica il documento di riconoscimento.');
    if(files.reduce((sum,file)=>sum+(Number(file.size)||0),0)>4*1024*1024)throw new Error('I PDF del documento superano 4 MB complessivi. Prepara una scansione PDF più leggera mantenendo il testo leggibile.');
    if (!date) throw new Error('Indica la data effettiva di firma per il controllo identita.');
    const stamp = revision;
    const key = await keyFor(files, customer, date, pdaPaths,pacchetto);
    if (stamp !== revision || !current()) throw new Error('Dati o documenti cambiati durante il controllo. Ripeti la verifica.');
    if (cached?.key === key && Date.now() - cached.at < 3.5 * 3600000 && (!requireCitizenship || cached.result.cittadinanza)) return cached;
    cached = null;
    const formFor=decision=>{
      const form=new FormData();form.append('cliente',JSON.stringify(customer));form.append('data_firma',date);
      if(pacchetto)form.append('pacchetto',JSON.stringify(pacchetto));
      if(window.MiroxIdentitaCore.customer(customer).business)form.append('pda_paths',JSON.stringify(pdaPaths));
      files.forEach(file=>form.append('file',file));
      if(decision){form.append('action','manual_preview');form.append('conferma',JSON.stringify(decision));}
      return form;
    };
    const active = () => stamp === revision && current();
    const status = document.getElementById('identitaControlloEsito');
    const unread = uncertain => ({result:{stato:'da_confermare',errors:[],uncertain,data_firma:date,scadenza:null,cittadinanza:null,pacchetto,
        cliente_nome:window.MiroxIdentitaCore.customer(customer).business?customer.nome_referente:customer.ragione_sociale,cliente_fiscale:customer.cf_piva,
        richiede_cf_rappresentante:window.MiroxIdentitaCore.customer(customer).business&&pdaPaths.length>0}});
    let data;
    if (status) status.textContent = 'Controllo identita in corso...';
    try { data = await call(formFor()); }
    catch {
      if(!active())throw new Error('Dati o documenti cambiati durante il controllo. Ripeti la verifica.');
      data = unread(['La verifica automatica non e conclusa. Controlla personalmente il documento e conferma per proseguire.']);
    }
    if (!active()) throw new Error('Dati o documenti cambiati durante il controllo. Ripeti la verifica.');
    if (data.result.stato !== 'coerente' || requireCitizenship && !data.result.cittadinanza) {
      if (status) status.textContent = 'Controlla l’anteprima e conferma manualmente il documento per proseguire.';
      const confirmed = await manualPreview({...data.result,cliente_nome:window.MiroxIdentitaCore.customer(customer).business?customer.nome_referente:customer.ragione_sociale,cliente_fiscale:customer.cf_piva}, files, requireCitizenship, active,async decision=>{
        let confirmed;
        if(data.token){try{confirmed=await call({token:data.token,...decision});}catch{/* Recupero senza OCR, anche con token scaduto o risposta persa. */}}
        if(!confirmed)confirmed=await call(formFor(decision));
        if(confirmed.result.stato!=='manuale')throw new Error('Conferma manuale non registrata.');
        return confirmed;
      });
      if (!active()) throw new Error('Dati cambiati: ripeti il controllo identita.');
      if (!confirmed) {
        if (status && active()) status.textContent = 'Controllo manuale annullato: documento non confermato.';
        throw new Error('Conferma manuale del documento annullata.');
      }
      if (!active()) throw new Error('Dati cambiati: ripeti il controllo identita.');
      data=confirmed;
    }
    if (!active()) throw new Error('Dati cambiati: ripeti il controllo identita.');
    cached = { key, at: Date.now(), token: data.token, result: data.result };
    if (status) status.textContent = data.result.stato === 'manuale' ? 'Controllo identita confermato manualmente e registrato.'
      : data.result.criterio_identita === 'barcode_fiscale' ? 'Codice fiscale decodificato dal codice a barre coincidente e documento valido alla firma.'
      : data.result.criterio_identita === 'cf_rappresentante_pda' ? 'Codice fiscale del documento coincidente con il rappresentante della PDA Business e documento valido alla firma.'
        : data.result.criterio_identita === 'codice_fiscale' ? 'Codice fiscale coincidente con l’anagrafica e documento valido alla data di firma indicata.'
        : 'Identita coerente con l’anagrafica e valida alla data di firma indicata.';
    return cached;
  }
  function invalidate() {
    cached = null;
    revision++;
    if (preview) preview.close();
    if (reading) {
      reading.close();
      reading = null;
    }
  }
  window.MiroxIdentitaUpload = { ensure(options) {
    const files=Array.from(options.files||[]);
    const key=JSON.stringify([window.MiroxIdentitaCore.customer(options.customer),options.customer?.cluster,options.date,options.pdaPaths||[],options.pacchetto||null,Boolean(options.requireCitizenship),Boolean(options.barcode)]);
    if(pending&&pending.revision===revision&&pending.key===key&&pending.files.length===files.length&&pending.files.every((f,i)=>f===files[i])&&pending.current())return pending.promise;
    if(pending&&pending.revision===revision)invalidate();
    const entry={revision,key,files,current:options.current||(()=>true)};
    entry.promise=(options.barcode ? ensureBarcode : ensure)({...options,files}).finally(()=>{if(pending===entry)pending=null;});pending=entry;return entry.promise;
  }, get: () => cached, showError, invalidate };
})();
