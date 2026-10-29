(function () {
  'use strict';
  const Core = window.MiroxPlanning, $ = id => document.getElementById(id), esc = MiroxSafe.escapeHtml;
  const admin = document.body.dataset.planningAdmin === 'true';
  const endpoint = '/.netlify/functions/gestisci-planning';
  let config, configVersion = 0, profiles = [], documentData = null, row = null;
  let dirty = false, staffDirty = false, busy = false, currentDay = null, view = 'calendar';
  function status(message,error=false) { $('planningStatus').textContent=message;$('planningStatus').classList.toggle('is-error',error); }
  function rotationPending() {
    return admin && documentData && $('firstMondayOff').value !== (documentData.firstMondayOff || '');
  }
  function monthUnavailable() { return !documentData || $('planningMonth').value !== documentData.month; }
  function requireCurrentMonth() {
    if (monthUnavailable()) throw new Error('Apri il mese selezionato prima di modificare o esportare il planning.');
    if (rotationPending()) throw new Error('Applica la nuova alternanza ai turni prima di continuare.');
  }
  function controls() {
    document.querySelectorAll('.planning-page button, .planning-page input, .planning-page select, .planning-page textarea').forEach(el=>{el.disabled=busy;});
    if (admin) {
      const unavailable = monthUnavailable(), pending = rotationPending();
      $('saveMonth').disabled = busy || unavailable || pending || !dirty;
      $('publishMonth').disabled = busy || unavailable || pending || !documentData?.firstMondayOff || (!dirty && row?.pubblicato_versione === row?.versione);
      $('generateMonth').disabled = busy || unavailable || !config;
      for (const id of ['firstMondayOff','pdfSource','pdfEmployee','hoursEmployee']) $(id).disabled = busy || unavailable;
      document.querySelectorAll('[data-export], [data-day]').forEach(el=>{el.disabled=busy || unavailable || pending;});
      for (const id of ['addEmployee','saveStaff']) $(id).disabled = busy || !config;
    } else $('personalPdf').disabled = busy || monthUnavailable();
  }
  async function request(params,post=false) {
    const response=await MiroxApi.fetch(post?endpoint:`${endpoint}?${new URLSearchParams(params)}`,post?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(params)}:{cache:'no-store'});
    if(!response.ok){const body=await response.json();throw new Error(body.error||'Operazione non riuscita');}
    return response;
  }
  async function run(operation){if(busy)return;busy=true;controls();try{await operation();}catch(e){status(e.message,true);}finally{busy=false;controls();}}
  async function confirmDiscard(){return !dirty||await MiroxUI.confirm('Ci sono modifiche al planning non salvate. Vuoi abbandonarle?');}
  function dateLabel(date){return `${Core.WEEKDAYS[Core.weekday(date)]} ${date.slice(8)}/${date.slice(5,7)}`;}
  function dayHeading(date){const holiday=Core.holiday(date);return `<strong>${esc(Core.WEEKDAYS[Core.weekday(date)])}</strong><span class="day-date">${esc(date.slice(8)+'/'+date.slice(5,7))}</span>${holiday?`<span class="holiday-label">${esc(holiday)}</span>`:''}`;}
  function monthLabel(value){return new Date(`${value}-01T12:00:00Z`).toLocaleDateString('it-IT',{month:'long',year:'numeric',timeZone:'Europe/Rome'});}
  function shiftLabel(day){return Core.formatSlots(Core.availableSlots(day))||(day.closed?'Chiusura':day.absences.length?'Assente':'Riposo');}
  function publication(){
    const published=row?.pubblicato_versione;
    $('publicationState').classList.toggle('published',!!published&&!dirty&&published===row.versione);
    $('publicationState').textContent=dirty?'Bozza da salvare':published===row?.versione&&published?'Approvato':published?'Revisione in bozza':'Bozza';
  }
  function markDirty(){dirty=true;publication();controls();}
  function options(select){const selected=select.value;select.innerHTML=documentData.employees.map(e=>`<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('');if(documentData.employees.some(e=>e.id===selected))select.value=selected;}
  function renderCalendar(){
    if(!documentData)return;
    $('calendarTitle').textContent=`Planning di ${monthLabel(documentData.month)}`;
    $('firstMondayOff').value=documentData.firstMondayOff||'';
    const firstMonday=Core.dates(documentData.month).find(d=>Core.weekday(d)===1);
    $('rotationHelp').textContent=`Settimana da lunedì ${firstMonday.slice(8)}/${firstMonday.slice(5,7)}. Chi ha il lunedì mattina libero lavora sabato pomeriggio; la settimana dopo si scambiano. Applicare gli orari sostituisce la bozza del mese.`;
    $('planningWarnings').textContent=documentData.firstMondayOff?'Festività evidenziate. Conferma le eventuali chiusure nel dettaglio del giorno. I riposi non sono ferie.':'Alternanza da assegnare: i turni mostrano le fasce di base, senza le mezze giornate libere. Scegli l’assegnazione e applica gli orari prima di pubblicare.';
    $('planningCalendar').innerHTML=`<thead><tr><th>Giorno</th>${documentData.employees.map(e=>`<th>${esc(e.name)}</th>`).join('')}</tr></thead><tbody>${Core.dates(documentData.month).map(date=>`<tr class="${Core.weekday(date)===0||Core.holiday(date)?'nonworking':''}"><td>${dayHeading(date)}</td>${documentData.employees.map(e=>{const day=documentData.entries.find(d=>d.date===date&&d.employeeId===e.id);return `<td><button class="shift-button" data-day="${esc(date)}" data-employee="${esc(e.id)}" aria-label="Modifica ${esc(e.name)} ${esc(dateLabel(date))}">${esc(shiftLabel(day))}${day.absences.length?`<small>${esc(day.absences.map(a=>a.type).join(', '))} · ${Core.hours(Core.absenceMinutes(day))}</small>`:''}${day.extraMinutes?`<small>Extra ${Core.hours(day.extraMinutes)}</small>`:''}</button></td>`;}).join('')}</tr>`).join('')}</tbody>`;
    options($('pdfEmployee'));options($('hoursEmployee'));publication();renderHours();
  }
  function renderHours(){
    if(!documentData)return;
    const id=$('hoursEmployee').value,s=Core.summary(documentData,id);
    $('hoursSummary').innerHTML=[['Previste',s.planned],['Ordinarie (anche stimate)',s.ordinary],['Straordinari',s.extra],['Ferie',s.ferie],['Permessi',s.permessi],['Malattia',s.malattia]].map(([label,n])=>`<div><span>${esc(label)}</span><strong>${Core.hours(n)}</strong></div>`).join('');
    $('hoursTable').innerHTML=`<thead><tr>${['Giorno','Previste','Ordinarie','Extra','Ferie','Permessi','Malattia','Codice malattia'].map(t=>`<th>${t}</th>`).join('')}</tr></thead><tbody>${documentData.entries.filter(d=>d.employeeId===id).map(d=>{const planned=Core.slotMinutes(d.slots),ordinary=d.workedMinutes??planned-Core.absenceMinutes(d);return `<tr><td><button class="shift-button" data-day="${esc(d.date)}" data-employee="${esc(id)}">${esc(dateLabel(d.date))}</button></td><td>${Core.hours(planned)}</td><td>${Core.hours(ordinary)}${d.workedMinutes===null&&ordinary?'<small class="day-date">Da confermare</small>':''}</td><td>${Core.hours(d.extraMinutes)}</td>${Core.TYPES.map(t=>`<td>${Core.hours(Core.absenceMinutes(d,t))}</td>`).join('')}<td>${esc(d.absences.filter(a=>a.type==='malattia'&&a.code).map(a=>a.code).join(', '))}</td></tr>`;}).join('')}</tbody>`;
  }
  function renderPersonal(){
    $('personalContent').hidden=!documentData;
    if(!documentData){$('personalName').textContent='';$('personalTable').replaceChildren();return;}
    $('personalName').textContent=`${documentData.employees[0].name} · ${monthLabel(documentData.month)}`;
    $('personalTable').innerHTML=`<thead><tr><th>Giorno</th><th>Orario</th><th>Indicazioni</th></tr></thead><tbody>${documentData.entries.map(d=>`<tr class="${Core.weekday(d.date)===0||Core.holiday(d.date)?'nonworking':''}"><td>${dayHeading(d.date)}</td><td>${esc(Core.formatSlots(d.slots)||'-')}</td><td>${esc(d.closed?'Chiusura':d.absentMinutes?`Assenza ${Core.hours(d.absentMinutes)}`:!d.slots.length?'Riposo':'')}</td></tr>`).join('')}</tbody>`;
  }
  async function loadConfig() {
    const data = await (await request({action:'config'})).json();
    const nextConfig = Core.validateConfig(data.config);
    if (!Array.isArray(data.profiles)) throw new Error('Configurazione ricevuta non valida. Riprova.');
    config = nextConfig; configVersion = data.version; profiles = data.profiles; renderStaff();
  }
  async function loadMonth(){
    const previousMonth = documentData?.month;
    try {
      const value = Core.month($('planningMonth').value);
      if (admin && !await confirmDiscard()) { $('planningMonth').value = previousMonth; return; }
      if (admin && !config) await loadConfig();
      const data = await (await request({action:'month',month:value})).json();
      if (admin) {
        const nextRow = data.row;
        const nextDocument = nextRow ? Core.validateDocument(nextRow.bozza) : Core.generate(value,config);
        if (nextDocument.month !== value || !Array.isArray(data.audit) || (nextRow && (!Number.isSafeInteger(nextRow.versione) || nextRow.versione < 1))) {
          throw new Error('Il planning ricevuto non corrisponde al mese richiesto o non è valido.');
        }
        // Documento e versione CAS cambiano insieme, solo dopo la validazione completa.
        row = nextRow; documentData = nextDocument; dirty = !row;
        renderCalendar(); $('planningAudit').replaceChildren();
        for (const audit of data.audit) {
          const p=document.createElement('p');p.textContent=`${new Date(audit.created_at).toLocaleString('it-IT',{timeZone:'Europe/Rome'})} · ${audit.azione} · versione ${audit.versione}`;$('planningAudit').append(p);
        }
        status(row ? `Mese caricato. ${row.pubblicato_at ? 'Ultima approvazione: '+new Date(row.pubblicato_at).toLocaleString('it-IT',{timeZone:'Europe/Rome'}) : 'Non ancora pubblicato ai dipendenti.'}` : 'Nuovo mese: scegli l’alternanza, controlla i turni e salva la bozza.');
      } else {
        if (data.document && data.document.month !== value) throw new Error('Il planning ricevuto non corrisponde al mese richiesto.');
        documentData = data.document; renderPersonal();
        status(documentData ? `Approvato il ${new Date(data.publishedAt).toLocaleString('it-IT',{timeZone:'Europe/Rome'})}` : 'Il planning di questo mese non è ancora disponibile.');
      }
    } catch (error) {
      if (admin && previousMonth) $('planningMonth').value = previousMonth;
      if (!admin) { documentData = null; renderPersonal(); }
      throw error;
    }
  }
  function showView(next){view=next;for(const [name,id] of [['calendar','calendarView'],['hours','hoursView'],['staff','staffView']])$(id).hidden=next!==name;document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===next)));}
  function openDay(date,id){
    if(busy || monthUnavailable() || rotationPending())return;
    currentDay=documentData.entries.find(d=>d.date===date&&d.employeeId===id);
    $('dayTitle').textContent=`${documentData.employees.find(e=>e.id===id).name} · ${dateLabel(date)}`;
    $('daySlots').value=currentDay.slots.map(p=>p.join('-')).join('; ');$('dayClosed').checked=currentDay.closed;
    $('dayWorked').value=currentDay.workedMinutes===null?'':currentDay.workedMinutes/60;$('dayExtra').value=currentDay.extraMinutes/60;$('dayNote').value=currentDay.note;$('dayError').textContent='';
    $('dayAbsences').replaceChildren();currentDay.absences.forEach(addAbsence);$('dayDialog').showModal();$('daySlots').focus();
  }
  function addAbsence(a={type:'ferie',fullDay:true,start:null,end:null,code:''}){
    const line=document.createElement('div');line.className='planning-absence';
    line.innerHTML=`<div class="planning-form-grid"><label>Causale<select data-field="type">${Core.TYPES.map(t=>`<option value="${t}">${t[0].toUpperCase()+t.slice(1)}</option>`).join('')}</select></label><label>Durata<select data-field="duration"><option value="full">Intera giornata prevista</option><option value="hours">Intervallo orario</option></select></label><label data-range>Dalle<input data-field="start" type="time" value="${esc(a.start||'09:00')}"></label><label data-range>Alle<input data-field="end" type="time" value="${esc(a.end||'12:00')}"></label></div><label data-code>Codice malattia (facoltativo)<input data-field="code" maxlength="80" value="${esc(a.code)}"></label><button type="button" class="absence-remove">Rimuovi assenza</button>`;
    line.querySelector('[data-field=type]').value=a.type;line.querySelector('[data-field=duration]').value=a.fullDay?'full':'hours';
    const update=()=>{line.querySelectorAll('[data-range]').forEach(e=>{e.hidden=line.querySelector('[data-field=duration]').value==='full';});line.querySelector('[data-code]').hidden=line.querySelector('[data-field=type]').value!=='malattia';};
    line.addEventListener('change',update);line.querySelector('button').addEventListener('click',()=>line.remove());update();$('dayAbsences').append(line);
  }
  function duration(value){const n=Number(value)*60;if(!Number.isFinite(n)||Math.abs(n-Math.round(n))>0.00001)throw new Error('Inserisci ore corrispondenti a minuti interi (es. 1,5 per un’ora e mezza)');return Math.round(n);}
  function applyDay(event){
    event.preventDefault();
    try{
      const absences=[...$('dayAbsences').children].map(line=>{const get=k=>line.querySelector(`[data-field=${k}]`).value,type=get('type'),fullDay=get('duration')==='full';return {type,fullDay,start:fullDay?null:get('start'),end:fullDay?null:get('end'),code:type==='malattia'?get('code'):''};});
      const updated={...currentDay,slots:$('dayClosed').checked?[]:Core.parseSlots($('daySlots').value),closed:$('dayClosed').checked,absences,workedMinutes:$('dayWorked').value===''?null:duration($('dayWorked').value),extraMinutes:duration($('dayExtra').value),note:$('dayNote').value};
      const candidate=Core.clone(documentData);candidate.entries[candidate.entries.findIndex(d=>d.date===currentDay.date&&d.employeeId===currentDay.employeeId)]=updated;
      documentData=Core.validateDocument(candidate);markDirty();renderCalendar();$('dayDialog').close();status('Giornata aggiornata nella bozza. Salva per conservarla.');
    }catch(e){$('dayError').textContent=e.message;}
  }
  function renderStaff(){
    $('staffCards').innerHTML=config.employees.map(e=>`<article data-staff="${esc(e.id)}"><h3>${esc(e.name)}</h3><label>Nome<input data-key="name" value="${esc(e.name)}" maxlength="80"></label><label>Account Mirox<select data-key="profileId"><option value="">Non collegato</option>${profiles.map(p=>`<option value="${esc(p.id)}"${p.id===e.profileId?' selected':''}>${esc(p.nome||p.username||p.id)}</option>`).join('')}</select></label><label>Ore contrattuali settimanali<input data-key="contractMinutes" type="number" min="0" max="168" step="any" value="${e.contractMinutes/60}"></label><div class="planning-form-grid"><label>Dal mese<input data-key="from" type="month" min="2026-11" value="${esc(e.from)}"></label><label>Ultimo mese (facoltativo)<input data-key="until" type="month" min="2026-11" value="${esc(e.until||'')}"></label></div><h3>Settimana di base</h3><p>Orari inizio-fine separati da punto e virgola; vuoto = riposo. Le mezze giornate alternate si applicano nel planning.</p>${[1,2,3,4,5,6,0].map(w=>`<label class="week-field">${esc(Core.WEEKDAYS[w].slice(0,3))}<input data-week="${w}" value="${esc(e.week[w].map(p=>p.join('-')).join('; '))}" aria-label="${esc(Core.WEEKDAYS[w]+' '+e.name)}"></label>`).join('')}</article>`).join('');
    for(const e of config.employees){if(e.profileId&&!profiles.some(p=>p.id===e.profileId)){const option=document.createElement('option');option.value=e.profileId;option.textContent='Account non più attivo: ricollegare';option.selected=true;document.querySelector(`[data-staff="${e.id}"] [data-key=profileId]`).append(option);}}
  }
  function readStaff(){return Core.validateConfig({employees:[...$('staffCards').children].map(card=>{const old=config.employees.find(e=>e.id===card.dataset.staff),get=key=>card.querySelector(`[data-key=${key}]`).value;return {...old,name:get('name'),profileId:get('profileId')||null,contractMinutes:duration(get('contractMinutes')),from:get('from'),until:get('until')||null,week:old.week.map((_,i)=>Core.parseSlots(card.querySelector(`[data-week="${i}"]`).value))};})});}
  async function saveStaff(){const next=readStaff();const result=await(await request({action:'config_save',config:next,version:configVersion},true)).json();config=result.config;configVersion=result.version;staffDirty=false;renderStaff();status('Configurazione salvata. I mesi esistenti conservano i propri turni.');}
  async function saveMonth(publish){
    requireCurrentMonth();
    if(publish&&!await MiroxUI.confirm('Approvi questa versione? I dipendenti collegati potranno consultare i propri turni.'))return;
    const data=await(await request({action:publish?'publish':'save',month:documentData.month,version:row?.versione||0,document:documentData},true)).json();row=data.row;dirty=false;publication();
    const auditEntry=document.createElement('p');auditEntry.textContent=`${new Date(row.updated_at||Date.now()).toLocaleString('it-IT',{timeZone:'Europe/Rome'})} · ${publish?'pubblicazione':'salvataggio'} · versione ${row.versione}`;$('planningAudit').prepend(auditEntry);while($('planningAudit').children.length>20)$('planningAudit').lastElementChild.remove();
    status(publish?'Planning approvato e disponibile ai dipendenti collegati.':'Bozza salvata. I dipendenti continuano a vedere l’ultima versione approvata.');
  }
  async function exportPdf(type){
    requireCurrentMonth();
    if(admin&&(dirty||!row))throw new Error('Salva la bozza prima di esportare il PDF.');
    const source=admin?(type==='hours'?'draft':$('pdfSource').value):'published';
    const id=admin?(type==='hours'?$('hoursEmployee').value:$('pdfEmployee').value):documentData.employees[0].id;
    const response=await request({action:'pdf',month:documentData.month,type,source,...(type==='collective'?{}:{employeeId:id})});
    const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download=`planning-${documentData.month}-${type==='collective'?'collettivo':id+(type==='hours'?'-ore':'')}-${source}.pdf`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);status('PDF scaricato. Puoi inviarlo al destinatario.');
  }
  async function init(){
    const profile=await Auth.richiediAuth();if(!profile)return;
    if(admin&&profile.ruolo!=='admin'){await MiroxUI.alert('Accesso riservato agli amministratori.');window.location.href='dashboard.html';return;}
    const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Rome'}).slice(0,7);$('planningMonth').value=today<'2026-11'?'2026-11':today;
    $('loadMonth').addEventListener('click',()=>run(loadMonth));
    $('planningMonth').addEventListener('change',()=>{controls();if(monthUnavailable())status('Premi Apri mese per caricare il periodo selezionato.');});
    if(admin){
      document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>showView(button.dataset.view)));
      $('saveMonth').addEventListener('click',()=>run(()=>saveMonth(false)));$('publishMonth').addEventListener('click',()=>run(()=>saveMonth(true)));
      $('generateMonth').addEventListener('click',()=>run(async()=>{if(staffDirty)throw new Error('Salva prima la configurazione dei dipendenti.');if(!await MiroxUI.confirm('Applicare gli orari ricorrenti sostituisce tutti i turni e cancella assenze, consuntivi e note della bozza di questo mese. Continuare?'))return;documentData=Core.generate(documentData.month,config,$('firstMondayOff').value||null);markDirty();renderCalendar();status('Orari applicati alla bozza. Controlla e salva.');}));
      $('hoursEmployee').addEventListener('change',()=>{renderHours();controls();});
      $('firstMondayOff').addEventListener('change',()=>{controls();if(rotationPending())status('Alternanza modificata: premi Applica orari e alternanza per aggiornare i turni.');});
      document.querySelectorAll('[data-export]').forEach(button=>button.addEventListener('click',()=>run(()=>exportPdf(button.dataset.export))));
      for(const table of ['planningCalendar','hoursTable'])$(table).addEventListener('click',event=>{const button=event.target.closest('[data-day]');if(button)openDay(button.dataset.day,button.dataset.employee);});
      $('dayForm').addEventListener('submit',applyDay);$('closeDay').addEventListener('click',()=>$('dayDialog').close());$('cancelDay').addEventListener('click',()=>$('dayDialog').close());$('addAbsence').addEventListener('click',()=>addAbsence());
      $('saveStaff').addEventListener('click',()=>run(saveStaff));$('staffCards').addEventListener('input',()=>{staffDirty=true;});$('staffCards').addEventListener('change',()=>{staffDirty=true;});
      $('addEmployee').addEventListener('click',()=>run(async()=>{const next=readStaff();const name=await MiroxUI.prompt({title:'Nuovo dipendente',label:'Nome del dipendente'});if(!name)return;const id=`dipendente-${Date.now().toString(36)}`;next.employees.push({id,name,profileId:null,contractMinutes:2400,from:$('planningMonth').value,until:null,week:[[],[],[],[],[],[],[]]});config=Core.validateConfig(next);staffDirty=true;renderStaff();status('Dipendente aggiunto alla configurazione da salvare. Imposta gli orari e collega il suo account.');}));
      await run(loadMonth);
    }else{$('personalPdf').addEventListener('click',()=>run(()=>exportPdf('personal')));await run(loadMonth);}
    controls();
  }
  window.addEventListener('beforeunload',event=>{if(dirty||staffDirty){event.preventDefault();event.returnValue='';}});
  init().catch(e=>status(e.message,true));
})();
