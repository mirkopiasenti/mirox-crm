const {parseHTML}=require('linkedom');
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const Core=require(process.cwd()+'/js/planning-core');
const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
async function setup(admin,state){
 const {window,document}=parseHTML(fs.readFileSync(admin?'admin-planning.html':'planning-personale.html','utf8'));
 // linkedom non implementa il setter nativo di select.value e il dialog modale.
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{get(){return [...this.options].find(o=>o.hasAttribute('selected'))?.value||this.options[0]?.value||'';},set(value){[...this.options].forEach(o=>o.toggleAttribute('selected',o.value===value));},configurable:true});
 window.HTMLElement.prototype.showModal=function(){this.open=true;};window.HTMLElement.prototype.close=function(){this.open=false;};window.HTMLElement.prototype.focus=function(){};
 const request=async(url,opts={})=>{const params=opts.body?JSON.parse(opts.body):Object.fromEntries(new URL(url,'https://mirox-crm.it').searchParams);state.requests.push(params);
 let data;
 if(state.failAction===params.action || (params.action==='month'&&state.failMonth===params.month))return {ok:false,status:503,json:async()=>({error:'Errore simulato di lettura'})};
 if(params.action==='config')data={config:state.config||Core.defaultConfig(),version:0,profiles:[]};
 else if(params.action==='month')data=admin?{row:state.monthRows?.[params.month]??state.row,audit:[]}:{document:state.row?.pubblicato?Core.publicDocument(state.row.pubblicato,'matteo'):null,publishedAt:'2026-10-29T20:00:00Z'};
 else if(params.action==='save'||params.action==='publish'){state.row={...state.row,versione:(state.row?.versione||0)+1,bozza:Core.clone(params.document)};if(params.action==='publish')Object.assign(state.row,{pubblicato:Core.clone(params.document),pubblicato_versione:state.row.versione});data={row:state.row};}
 return {ok:true,json:async()=>Core.clone(data)};};
 const context={window,document,console,URL,URLSearchParams,Date,setTimeout,clearTimeout,MiroxSafe:{escapeHtml},MiroxApi:{fetch:request},Auth:{richiediAuth:async()=>({ruolo:admin?'admin':'operatore'})},MiroxUI:{confirm:async()=>true,prompt:async()=>null,alert:async()=>{}}};window.MiroxPlanning=Core;
 vm.runInNewContext(fs.readFileSync('js/planning.js','utf8'),context);await settle();return {window,document,context};
}
(async()=>{
 const state={row:null,requests:[]};const {document,window}=await setup(true,state),$=id=>document.getElementById(id),click=async el=>{el.dispatchEvent(new window.Event('click',{bubbles:true}));await settle();};
 assert.equal($('planningCalendar').querySelectorAll('tbody tr').length,30);assert.equal($('publishMonth').disabled,true);
 $('firstMondayOff').value='matteo';await click($('generateMonth'));assert.equal($('publishMonth').disabled,false);
 await click(document.querySelector('[data-day="2026-11-03"][data-employee="matteo"]'));assert.equal($('dayDialog').open,true);
 await click($('addAbsence'));let line=$('dayAbsences').firstElementChild;line.querySelector('[data-field=type]').value='malattia';line.querySelector('[data-field=duration]').value='hours';line.querySelector('[data-field=start]').value='10:00';line.querySelector('[data-field=end]').value='11:00';line.querySelector('[data-field=code]').value='CODICE-TEST';$('dayWorked').value='6';$('dayExtra').value='0.5';
 $('dayForm').dispatchEvent(new window.Event('submit',{cancelable:true}));await settle();assert.equal($('dayDialog').open,false);assert.equal($('dayError').textContent,'');
 await click($('saveMonth'));assert.equal(state.row.bozza.entries.find(e=>e.date==='2026-11-03'&&e.employeeId==='matteo').extraMinutes,30);
 await click($('publishMonth'));assert.ok(state.row.pubblicato);
 await click(document.querySelector('[data-day="2026-11-04"][data-employee="matteo"]'));$('daySlots').value='12:30-09:30';$('dayForm').dispatchEvent(new window.Event('submit',{cancelable:true}));await settle();assert.ok($('dayError').textContent);$('dayDialog').close();
 const personal=await setup(false,state);const table=personal.document.getElementById('personalTable');assert.equal(table.querySelectorAll('tbody tr').length,30);assert.ok(table.textContent.includes('Assenza 1:00'));assert.ok(!table.textContent.includes('CODICE-TEST'));assert.ok(!table.textContent.includes('Vincenzo'));assert.ok(!table.textContent.includes('malattia'));
 // La modifica del selettore non deve autorizzare la pubblicazione dei vecchi turni.
 const pendingState={row:{versione:5,pubblicato_versione:4,bozza:Core.generate('2026-11',Core.defaultConfig(),'matteo')},requests:[]};
 const pending=await setup(true,pendingState),pendingDoc=pending.document;
 pendingDoc.getElementById('firstMondayOff').value='vincenzo';pendingDoc.getElementById('firstMondayOff').dispatchEvent(new pending.window.Event('change',{bubbles:true}));await settle();
 assert.equal(pendingDoc.getElementById('publishMonth').disabled,true,'Alternanza non applicata: approvazione bloccata');
 pendingDoc.getElementById('firstMondayOff').value='matteo';pendingDoc.getElementById('firstMondayOff').dispatchEvent(new pending.window.Event('change',{bubbles:true}));await settle();
 assert.equal(pendingDoc.getElementById('publishMonth').disabled,false);
 // Un mese malformato non deve sostituire la versione CAS del mese ancora aperto.
 pendingState.monthRows={'2026-12':{versione:99,bozza:{...Core.generate('2026-12',Core.defaultConfig(),'matteo'),entries:[]}}};
 pendingDoc.getElementById('planningMonth').value='2026-12';pendingDoc.getElementById('loadMonth').dispatchEvent(new pending.window.Event('click'));await settle();
 assert.equal(pendingDoc.getElementById('planningMonth').value,'2026-11','Ripristina mese effettivamente aperto dopo errore');
 const edit=pendingDoc.querySelector('[data-day="2026-11-04"][data-employee="matteo"]');edit.dispatchEvent(new pending.window.Event('click',{bubbles:true}));await settle();
 pendingDoc.getElementById('dayNote').value='Preservare la versione 5';pendingDoc.getElementById('dayForm').dispatchEvent(new pending.window.Event('submit',{cancelable:true}));await settle();
 pendingDoc.getElementById('saveMonth').dispatchEvent(new pending.window.Event('click'));await settle();
 assert.equal(pendingState.requests.filter(p=>p.action==='save').at(-1).version,5);
 // Il primo errore di configurazione deve essere recuperabile con Apri mese.
 const retryState={row:null,requests:[],failAction:'config'},retry=await setup(true,retryState);
 assert.equal(retry.document.getElementById('generateMonth').disabled,true);
 retryState.failAction=null;retry.document.getElementById('loadMonth').dispatchEvent(new retry.window.Event('click'));await settle();
 assert.equal(retry.document.getElementById('planningCalendar').querySelectorAll('tbody tr').length,30);
 // Un errore sulla vista personale deve rimuovere il risultato precedente e il download.
 state.failMonth='2026-12';personal.document.getElementById('planningMonth').value='2026-12';personal.document.getElementById('loadMonth').dispatchEvent(new personal.window.Event('click'));await settle();
 assert.equal(personal.document.getElementById('personalContent').hidden,true);
 assert.equal(personal.document.getElementById('personalTable').children.length,0,'Nessun dato del mese precedente nel DOM dopo errore');
 assert.equal(personal.document.getElementById('personalPdf').disabled,true);
 console.log('DOM senza browser: generazione, assenze/ore, pubblicazione, errori e retry, cambio mese/CAS, alternanza da applicare e pulizia della vista personale verificati.');
})().catch(e=>{console.error(e);process.exitCode=1;});
