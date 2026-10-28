'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Pda=require('../js/vendita-pda-core'),{sectionFields}=require('../netlify/functions/_lib/pda-pdf-text'),{normalizeResult}=require('../netlify/functions/ocr-pda')._test;
const mobile={codice_contratto:'C001',costo_offerta_mensile:10,portabilita:false,numero_telefono:'3331234567'};
const sim=(options,number='3331234567')=>'DATI DELLA SIM WINDTRE\nNumero di telefono: '+number+'\nPiano Telefonico: Professional Staff XL\nOpzioni/servizi: '+options+'\nCosto attivazione offerta: rate\nData: 28/10/2026';
test('Cloud solo nella SIM contrattuale: prevalidazione ignorata e condizioni generali non provano presenza',()=>{
 const pre='DATI DELLA SIM WINDTRE\nNumero di telefono: 3491234567\nDATI PREVALIDAZIONE\nData: 28/10/2026\n';
 const out=sectionFields(pre+sim('Servizio 5G - Professional\nCloud'));
 assert.equal(out.professional_cloud,true);assert.equal(out.numero_sim,'3331234567');
 assert.equal(sectionFields(sim('Professional Cloud \uFFFF')).professional_cloud,true);
 assert.equal(sectionFields(sim('Servizio 5G')+'\nCONDIZIONI PROFESSIONAL CLOUD\nTesto informativo').professional_cloud,false);
 assert.equal(sectionFields(pre+'CONDIZIONI PROFESSIONAL CLOUD\nTesto').professional_cloud,undefined);
});
test('Cloud assente da testo incompleto non diventa No; discordanza resta da verificare',()=>{
 assert.equal(sectionFields(sim('5G'),false).professional_cloud,undefined);
 assert.equal(sectionFields('DATI DELLA SIM WINDTRE\nPiano Telefonico: Professional XL\nOpzioni/servizi: 5G').professional_cloud,undefined);
 assert.equal(sectionFields(sim('Professional Cloud')+'\n'+sim('Solo 5G')).professional_cloud,null);
 assert.equal(normalizeResult({professional_cloud:false}).professional_cloud,false);assert.equal(normalizeResult({}).professional_cloud,null);
});
test('validazione: scope Business Mobile, decisione obbligatoria con Si, nullable per storico',()=>{
 for(const action of Pda.CLOUD_ACTIONS){const out=Pda.validate({...mobile,professional_cloud:true,professional_cloud_gestione:action},'Mobile',{cluster:'Business',requireCloud:true});assert.equal(out.professional_cloud_gestione,action);}
 assert.throws(()=>Pda.validate({...mobile,professional_cloud:true},'Mobile',{cluster:'Business'}),/gestione/);
 assert.throws(()=>Pda.validate({...mobile,professional_cloud:false,professional_cloud_gestione:Pda.CLOUD_ACTIONS[0]},'Mobile',{cluster:'Business'}),/non valida/);
 for(const [cat,cluster] of [['Mobile','Consumer'],['Mobile','Turista'],['Fisso','Consumer'],['Customer Base','Business']])assert.throws(()=>Pda.validateCloud({professional_cloud:false},cat,cluster),/solo per/);
 assert.throws(()=>Pda.validateCloud({},'Mobile','Business',true),/Seleziona/);
 assert.equal(Pda.validateCloud({},'Mobile','Business').professional_cloud,null);
 assert.equal(Pda.hasMobileData({professional_cloud:true}),false);
});
function fixture(value='false',actionValue=''){
 const confirmations=[],dialogs=[],saves=[],listeners={},root={dataset:{},isConnected:true};let stamp='pda1|offer1';
 const make=(value='',field)=>({value,dataset:field?{pdaField:field}:{},handlers:{},addEventListener(type,fn){this.handlers[type]=fn;},dispatchEvent(e){this.handlers[e.type]?.(e);saves.push([cloud.value,action.value]);return true;}});
 const cloud=make(value,'professional_cloud'),action=make(actionValue,'professional_cloud_gestione'),button=make(),management={};
 root.querySelector=s=>s.includes('"professional_cloud"')?cloud:s.includes('"professional_cloud_gestione"')?action:s==='[data-cloud-management]'?management:s==='[data-cloud-choose]'?button:null;
 root.querySelectorAll=()=>[cloud,action];
 const source=fs.readFileSync(path.join(__dirname,'../js/vendita-pda-ui.js'),'utf8');
 const window={MiroxPda:Pda,MiroxSafe:{escapeHtml:v=>String(v).replace(/</g,'&lt;')},MiroxUI:{confirm(message){return new Promise(resolve=>confirmations.push({message,resolve}));},_build(options){
 const callbacks={};const modal={options,foot:{querySelector:s=>({addEventListener(type,fn){callbacks[s]=fn;}})},close(){options.onClose();},choose(key){callbacks[key]();}};dialogs.push(modal);return modal;
 }}};
 vm.runInNewContext(source,{window,Event:class{constructor(type,options){this.type=type;this.bubbles=options?.bubbles;}},setTimeout});
 window.MiroxPdaUI.bindForm(root,{context:()=>stamp});
 return {api:window.MiroxPdaUI,root,cloud,action,button,management,confirmations,dialogs,saves,setStamp:v=>stamp=v,async change(v){cloud.value=v;await cloud.handlers.change();},async changeAction(v){action.value=v;await action.handlers.change();}};
}
const tick=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
test('HTML Cloud visibile anche AI solo per Business Mobile, riepilogo mostra anche No',()=>{
 const {api}=fixture();const data={professional_cloud:false,cluster_cliente:'Business',codice_contratto:'C001'};
 assert.match(api.formHtml(data,'Mobile',{wizard:true,reading:'ai'}),/data-pda-field="professional_cloud"/);
 for(const [cat,cluster] of [['Mobile','Consumer'],['Fisso','Consumer'],['Customer Base','Business']])assert.doesNotMatch(api.formHtml({...data,cluster_cliente:cluster},cat),/data-pda-field="professional_cloud"/);
 assert.match(api.summary(data,{wizard:true}),/Professional Cloud.*No/);
 const history=fs.readFileSync(path.join(__dirname,'../moduli/storico_cliente.html'),'utf8');assert.match(history,/v !== false \|\| k === 'professional_cloud'/);
});
test('Si automatico apre una sola scelta dedicata; chiudere non inventa una decisione',async()=>{
 const ui=fixture('true');assert.equal(ui.dialogs.length,1);assert.equal(ui.action.value,'');
 ui.dialogs[0].close();await tick();assert.equal(ui.cloud.value,'true');assert.equal(ui.action.value,'');assert.equal(ui.saves.length,0);
 assert.throws(()=>Pda.validateCloud(ui.api.readForm(ui.root),'Mobile','Business',true),/gestione/);
});
for(const key of ['[data-cloud-keep]','[data-cloud-stop]'])test('popup registra '+key,async()=>{
 const ui=fixture('true');ui.dialogs[0].choose(key);await tick();
 assert.equal(ui.action.value,key.includes('keep')?'Mantieni attiva':'Richiedi disattivazione');assert.equal(ui.saves.length,1);
});
for(const accepted of [false,true])test('Si a No '+(accepted?'confermato':'annullato')+' conserva decisione fino al consenso',async()=>{
 const ui=fixture('true','Mantieni attiva'),run=ui.change('false');assert.equal(ui.cloud.value,'true');assert.equal(ui.action.value,'Mantieni attiva');assert.equal(ui.saves.length,0);
 ui.confirmations[0].resolve(accepted);await run;
 assert.equal(ui.cloud.value,accepted?'false':'true');assert.equal(ui.action.value,accepted?'':'Mantieni attiva');assert.equal(ui.saves.length,accepted?1:0);
});
test('No a Si richiede prima conferma e poi decisione; chiusura mantiene No',async()=>{
 const ui=fixture(),run=ui.change('true');ui.confirmations[0].resolve(true);await tick();assert.equal(ui.dialogs.length,1);assert.equal(ui.cloud.value,'false');
 ui.dialogs[0].close();await run;assert.equal(ui.cloud.value,'false');assert.equal(ui.action.value,'');assert.equal(ui.saves.length,0);
});
test('gestione modificabile con conferma, annullamento non cambia il valore',async()=>{
 const ui=fixture('true','Mantieni attiva'),run=ui.changeAction('Richiedi disattivazione');assert.equal(ui.action.value,'Mantieni attiva');ui.confirmations[0].resolve(false);await run;assert.equal(ui.action.value,'Mantieni attiva');assert.equal(ui.saves.length,0);
 const yes=ui.changeAction('Richiedi disattivazione');ui.confirmations[1].resolve(true);await yes;assert.equal(ui.action.value,'Richiedi disattivazione');
});
test('doppio cambio e risposta tardiva non mutano altra PDA/offerta/cluster o editor chiuso',async()=>{
 for(const stale of ['context','detached','new-fields']){
  const ui=fixture('true','Mantieni attiva'),run=ui.change('false');await ui.change('false');assert.equal(ui.confirmations.length,1);
  if(stale==='context')ui.setStamp('pda2|offer2');if(stale==='detached')ui.root.isConnected=false;
  if(stale==='new-fields'){const original=ui.root.querySelector;ui.root.querySelector=s=>s.includes('"professional_cloud"')?{}:original(s);}
  ui.confirmations[0].resolve(true);await run;assert.equal(ui.cloud.value,'true');assert.equal(ui.action.value,'Mantieni attiva');assert.equal(ui.saves.length,0);
 }
});
test('input select non salva cambi prima della conferma',()=>{
 const ui=fixture();let stopped=0;ui.cloud.handlers.input({stopPropagation(){stopped++;}});ui.action.handlers.input({stopPropagation(){stopped++;}});assert.equal(stopped,2);
});
test('No a Si confermato salva presenza e decisione insieme',async()=>{
 const ui=fixture(),run=ui.change('true');ui.confirmations[0].resolve(true);await tick();ui.dialogs[0].choose('[data-cloud-stop]');await run;
 assert.equal(ui.cloud.value,'true');assert.equal(ui.action.value,'Richiedi disattivazione');assert.equal(ui.saves.length,1);
});
test('restore e nuova PDA: coppia Cloud preservata, cambio cluster la rimuove',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../moduli/upload-contratti-vendita.html'),'utf8'),a=source.indexOf(' function renderPdaFields(data)'),b=source.indexOf(' async function checkPendingCode()',a),root={dataset:{},addEventListener(){}};let data;
 const refs={cluster:{value:'Business'}},ctx={refs,document:{getElementById:()=>root},getCategoriaName:()=> 'Mobile',queueDraftSave(){},window:{MiroxPda:Pda,MiroxPdaUI:{formHtml(v){data=v;return '';},bindForm(){},readForm(){return data;}}}};
 vm.runInNewContext(source.slice(a,b)+';this.render=renderPdaFields;this.read=readPdaFields;',ctx);
 ctx.render({...mobile,professional_cloud:true,professional_cloud_gestione:'Richiedi disattivazione'});const draft=ctx.read();ctx.render(draft);assert.equal(ctx.read().professional_cloud_gestione,'Richiedi disattivazione');
 refs.cluster.value='Consumer';ctx.render();assert.equal(ctx.read().professional_cloud,null);assert.equal(ctx.read().professional_cloud_gestione,null);assert.equal(ctx.read().codice_contratto,'C001');
 refs.cluster.value='Business';ctx.render({});assert.equal(ctx.read().professional_cloud,null);
});
test('payload wizard e normalizzazione create conservano Cloud e gestione',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../moduli/upload-contratti-vendita.html'),'utf8'),a=source.indexOf(' function buildInvioPayload()'),b=source.indexOf(' async function inviaPratica()',a);
 const item={...mobile,professional_cloud:true,professional_cloud_gestione:'Mantieni attiva',codice_cliente:'P0001',categoria_nome:'Mobile',categoria_id:'cat',offerta_id:'offer',flags:{},files:{}};
 const ctx={window:{MiroxPda:Pda},state:{cart:{contratti:[item]}},getClienteFormData:()=>({cluster:'Business'}),validateClienteData(){},praticaFiles:{documento_identita:[{}]},runtimeState:{},refs:{originePratica:{value:'spontaneo'},operatoreId:{value:'operator'}},CODICE_RIVENDITORE_DEFAULT:'9001415852'};
 vm.runInNewContext(source.slice(a,b)+';this.payload=buildInvioPayload;',ctx);const dto=ctx.payload().contratti[0];
 assert.equal(dto.professional_cloud,true);assert.equal(dto.professional_cloud_gestione,'Mantieni attiva');
 const normalized=require('../netlify/functions/crea-vendita-pratica-carrello')._test.normalizeContractInput(dto,0);assert.equal(normalized.professional_cloud,true);assert.equal(normalized.professional_cloud_gestione,'Mantieni attiva');
});
for(const category of ['Mobile','Fisso'])for(const cluster of ['Business','Consumer'])test('editor backend '+category+' applica scope '+cluster+' e preserva stato/punti',async()=>{
 const {updatePda}=require('../netlify/functions/gestisci-vendita-contratto')._test,id='10000000-0000-4000-8000-000000000001';let patch;
 const current={id,categoria_snapshot:category,cluster_cliente:cluster,stato_controllo:'controllato',punteggio_gara_totale:5};
 const db={from(table){assert.equal(table,'vendita_contratti');const q={select(){return q;},eq(){return q;},update(v){patch=v;return q;},async maybeSingle(){return {data:patch?{...current,...patch}:current};}};return q;}};
 const result=await updatePda({supabase:db,auth:{profilo:{id}},body:{contratto_id:id,contratto:{professional_cloud:true,professional_cloud_gestione:'Richiedi disattivazione',cluster_cliente:'Business',punteggio_gara_totale:999}}});
 assert.equal(result.statusCode,cluster==='Business'?200:400);
 if(cluster==='Business'){const saved=JSON.parse(result.body).contratto;assert.equal(saved.professional_cloud,true);assert.equal(saved.professional_cloud_gestione,'Richiedi disattivazione');assert.equal(saved.stato_controllo,'controllato');assert.equal(saved.punteggio_gara_totale,5);assert.equal(patch.cluster_cliente,undefined);}
 else assert.equal(patch,undefined);
});
test('assenza PDF e visione AI discordanti non diventano un No automatico',()=>{
 const {mergePdfResult}=require('../netlify/functions/ocr-pda')._test;
 assert.equal(mergePdfResult({professional_cloud:true},{professional_cloud:false}).professional_cloud,null);
 assert.equal(mergePdfResult({},{professional_cloud:false}).professional_cloud,null);
 assert.equal(mergePdfResult({professional_cloud:false},{professional_cloud:false}).professional_cloud,false);
 assert.equal(mergePdfResult({professional_cloud:false},{professional_cloud:true}).professional_cloud,true);
});
const fixedOptions=value=>'PROPOSTA DI CONTRATTO\nOpzioni aggiuntive\nCodice Migrazione:\nChiamate illimitate - '+value+'\nLe numerazioni aggiuntive associate alla linea saranno disattivate.\nCondizioni Professional Cloud\nTesto generale';
test('Fisso: legge Cloud solo in Opzioni aggiuntive, non nelle condizioni generali',()=>{
 assert.equal(sectionFields(fixedOptions('Professional\nCloud')).professional_cloud,true);
 assert.equal(sectionFields(fixedOptions('Servizio standard')).professional_cloud,false);
 assert.equal(sectionFields('Condizioni Professional Cloud\nSolo informazioni generali').professional_cloud,undefined);
 assert.equal(sectionFields('Opzioni aggiuntive\nLista troncata').professional_cloud,undefined);
 assert.equal(sectionFields(fixedOptions('Servizio standard'),false).professional_cloud,undefined);
 assert.equal(sectionFields(fixedOptions('Professional Cloud')+'\n'+fixedOptions('Servizio standard')).professional_cloud,null);
});
test('Fisso Business: validazione conserva Cloud e gestione, azzera soltanto i dati specifici Mobile',()=>{
 const out=Pda.validate({...mobile,professional_cloud:true,professional_cloud_gestione:'Richiedi disattivazione'},'Fisso',{cluster:'Business',requireCloud:true});
 assert.equal(out.professional_cloud,true);assert.equal(out.professional_cloud_gestione,'Richiedi disattivazione');assert.equal(out.numero_telefono,null);assert.equal(out.costo_offerta_mensile,null);
 assert.throws(()=>Pda.validate({codice_contratto:'F001'},'Fisso',{cluster:'Business',requireCloud:true}),/Seleziona/);
 for(const flag of [true,false]){
  const {api}=fixture();const data={professional_cloud:flag,cluster_cliente:'Business',codice_contratto:'F001'};
  for(const wizard of [true,false]){const html=api.formHtml(data,'Fisso',{wizard,reading:'ai'});assert.match(html,/data-pda-field="professional_cloud"/);assert.doesNotMatch(html,/data-pda-field="numero_telefono"/);}
 }
});
test('Fisso nel payload create conserva la coppia Cloud senza trasformarla in dati Mobile',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../moduli/upload-contratti-vendita.html'),'utf8'),a=source.indexOf(' function buildInvioPayload()'),b=source.indexOf(' async function inviaPratica()',a);
 const item={codice_contratto:'F001',professional_cloud:true,professional_cloud_gestione:'Mantieni attiva',codice_cliente:'P0001',categoria_nome:'Fisso',categoria_id:'cat',offerta_id:'offer',flags:{},files:{}};
 const ctx={window:{MiroxPda:Pda},state:{cart:{contratti:[item]}},getClienteFormData:()=>({cluster:'Business'}),validateClienteData(){},praticaFiles:{documento_identita:[{}]},runtimeState:{},refs:{originePratica:{value:'spontaneo'},operatoreId:{value:'operator'}},CODICE_RIVENDITORE_DEFAULT:'9001415852'};
 vm.runInNewContext(source.slice(a,b)+';this.payload=buildInvioPayload;',ctx);const dto=ctx.payload().contratti[0];assert.equal(dto.professional_cloud,true);assert.equal(dto.professional_cloud_gestione,'Mantieni attiva');assert.equal(dto.numero_telefono,null);
 const normalized=require('../netlify/functions/crea-vendita-pratica-carrello')._test.normalizeContractInput(dto,0);assert.equal(normalized.professional_cloud,true);assert.equal(normalized.professional_cloud_gestione,'Mantieni attiva');
});
