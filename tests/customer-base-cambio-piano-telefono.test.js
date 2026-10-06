'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const plan=require('../netlify/functions/_lib/guardian-catalog-kg23.json');
const device=require('../js/customer-base-device');
const core=require('../js/dashboard-report-core');
const {validateCategorySpecificRules}=require('../netlify/functions/crea-vendita-pratica-carrello')._test;
const {validateReview}=require('../netlify/functions/_lib/guardian-catalog-plan');
function contract(name,type){return {categoria_snapshot:'Customer Base',cluster_cliente:'Consumer',nome_offerta_snapshot:name,dispositivo_associato:true,tipo_acquisto:type,imei:'123456789012345',fascia_prezzo:'399.90',finanziaria:type==='Finanziamento'?'Findomestic':null,kolme:false,smartphone_reload:false};}
test('piano revisionato assegna1punto complessivo e abilita dispositivo su entrambe le offerte',()=>{
 const serialized=JSON.stringify(plan),hash=require('node:crypto').createHash('sha256').update(serialized).digest('hex');
 validateReview({reviewed_by:'codex_local',head_sha:'a'.repeat(40),hash,plan_json:serialized},'a'.repeat(40));
 assert.equal(plan.offers.length,2);assert.equal(plan.daily_rows.length,2);
 plan.offers.forEach(o=>{assert.equal(o.punteggio_gara,1);assert.equal(o.punteggio_extra_gara,0);assert.equal(o.abilita_dispositivo,true);});
});
test('Day by Day conta ciascuna combinazione in una sola riga e mantiene i telefoni storici',()=>{
 const rows=[...plan.daily_rows.map(r=>({nome:r.name,regola:r.rule})),...plan.daily_updates.map(r=>({nome:r.expected_name,regola:r.rule}))];
 for(const [suffix,type] of [['Finanziato','Finanziamento'],['VAR','VAR']]) {
  const combo=contract('Cambio Piano + Telefono '+suffix,type);
  assert.deepEqual(rows.filter(r=>core.matchRegola(combo,r.regola)).map(r=>r.nome),['CAMBIO PIANO + TELEFONO '+suffix.toUpperCase()]);
  const historical=contract('Telefono Incluso',type);
  assert.deepEqual(rows.filter(r=>core.matchRegola(historical,r.regola)).map(r=>r.nome),[type==='VAR'?'CB TELEFONO VAR RID':'CB TELEFONO FINANZIATO']);
  assert(!core.matchRegola({...combo,cluster_cliente:'Business'},rows[0].regola));
 }
});
for(const [suffix,type] of [['Finanziato','Finanziamento'],['VAR','VAR']])test('server conserva telefono '+suffix+' e rifiuta assenza/tipo errato',()=>{
 const offer=plan.offers.find(o=>o.nome_offerta.endsWith(suffix)),c=contract(offer.nome_offerta,type);
 validateCategorySpecificRules({contract:c,category:{nome:'Customer Base'},offer,index:0});
 assert.equal(c.imei,'123456789012345');assert.equal(c.tipo_acquisto,type);
 assert.throws(()=>validateCategorySpecificRules({contract:{...c,dispositivo_associato:false},category:{nome:'Customer Base'},offer,index:0}),/telefono associato/);
 assert.throws(()=>validateCategorySpecificRules({contract:{...c,tipo_acquisto:type==='VAR'?'Finanziamento':'VAR'},category:{nome:'Customer Base'},offer,index:0}),/tipo acquisto/);
});
function wizard(name,category='Customer Base',fwa=false) {
 const elements={},refs=new Proxy(elements,{get:(map,key)=>map[key] ||= {value:'',checked:false,disabled:false,classList:{toggle(){},add(){}}}});
 const html=fs.readFileSync(require('node:path').join(__dirname,'../moduli/upload-contratti-vendita.html'),'utf8');
 const start=html.indexOf(' function renderDynamicSections()'),end=html.indexOf(' function getClienteFormData()',start);
 const context={refs,MiroxCustomerBaseDevice:device,getCategoriaName:()=>category,getOffertaName:()=>name,filteredOpzioni:()=>[],shouldShowDevice:()=>true,shouldShowSwitchSim:()=>false,shouldShowOpzione:()=>false,getCurrentDocumentRequirements:()=>({copia_sim_mnp:false,copia_bolletta:false}),isCategory:(a,b)=>a.toLowerCase()===b.toLowerCase(),normalizeSiNo:v=>v,isFwaIndoor:()=>fwa,clearInputFiles(){},uiState:{view:'wizard',step:3},updateScorePreview(){},maybeApplyOcrDevice(){}};
 return {refs,render:()=>vm.runInNewContext(html.slice(start,end)+'\nrenderDynamicSections();',context)};
}
test('wizard reale imposta telefono e finanziamento senza errori di inizializzazione',()=>{
 const ui=wizard('Cambio Piano + Telefono Finanziato');ui.render();
 assert.equal(ui.refs.dispositivoAssociato.value,'true');assert.equal(ui.refs.tipoAcquisto.value,'Finanziamento');assert(ui.refs.dispositivoAssociato.disabled);assert(ui.refs.tipoAcquisto.disabled);
});
test('wizard e validazione non impongono combinazione alle altre offerte e conservano FWA',()=>{
 const ui=wizard('Telefono Incluso');ui.refs.dispositivoAssociato.value='false';ui.render();assert.equal(ui.refs.dispositivoAssociato.disabled,false);
 const fwa=wizard('FWA Indoor','Fisso',true);fwa.render();assert.equal(fwa.refs.tipoAcquisto.value,'VAR');assert(fwa.refs.tipoAcquisto.disabled);
 const c={dispositivo_associato:false};device.validateCombination(c,'Telefono Incluso','Customer Base');assert.equal(c.dispositivo_associato,false);
});
