'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../js/dashboard-report-core');
const {V,M,contract,repeat,complete,render} = require('./gare-accesso-fixture.cjs');
const access = (list,period='2026-11') => core.accessoBonusGare(list,V,id=>id==='alias-v'?V:id,period);
const metric = {id:6,nome:'PARTITA IVA',tabella:'gara_individuale',tipo_conteggio:'individuale',tipo_compenso:'squadra',regola:{cluster:'Business'}};
const goal = {metrica_id:6,operatore_id:null,anno:2026,mese:11,obiettivo:45,
  compenso_regola:{tipo:'scaglioni',scaglioni:[{da:35,importo:150,tipo_calcolo:'flat'}]}};
test('quattro requisiti personali con confine esatto e Fisso Business incluso nel Fisso totale',()=>{
  assert.deepEqual(access(complete()).soglie.map(s=>[s.id,s.obiettivo,s.attuale,s.raggiunta]),[
    ['fisso',10,10,true],['energia',10,10,true],['mobile_business',10,10,true],['fisso_business',1,1,true]
  ]);
  assert.equal(access(complete()).ammesso,true);
  for(const index of [0,10,20,9]) {
    const list=complete();list.splice(index,1);
    assert.equal(access(list).ammesso,false,'manca anche una sola soglia');
  }
  assert.equal(access([...complete(),...repeat(50,'Mobile','Business',{operatore_id:M})].filter(c=>c.categoria_snapshot!=='Energia')).ammesso,false);
});
test('accesso conta pezzi senza pesi, alias e tutti i Mobile Business; esclude Consumer, CB e reinserimenti',()=>{
  const names=['Professional Staff','Professional Full','Professional Country','Professional Dati','FWA Indoor','TIED','UNTIED','Nuova offerta'];
  const list=complete().filter(c=>c.categoria_snapshot!=='Mobile');
  list.push(...names.map(nome_offerta_snapshot=>contract('Mobile','Business',{nome_offerta_snapshot,operatore_id:'alias-v'})),
    ...repeat(2,'Mobile','Business',{codice_rivenditore:core.CEREA}),
    ...repeat(20,'Mobile'),...repeat(20,'Customer Base','Business'),
    ...repeat(20,'Mobile','Business',{stato_inserimento:'reinserimento'}),
    ...repeat(20,'Mobile','Business',{operatore_id:M}));
  list[0]={...list[0],nome_opzione_snapshot:'Seconda linea',punteggio_gara_totale:100};
  list.push(contract('Fisso','Business',{stato_inserimento:'reinserimento',reinserimento_fisso_finalizzato:true}));
  const result=access(list);
  assert.equal(result.ammesso,true);
  assert.deepEqual(result.soglie.map(s=>s.attuale),[10,10,10,1]);
});
test('nessuna retroattivita: ottobre senza requisiti; da novembre anche nei prossimi anni, UUID fuori periodo esclusi',()=>{
  assert.deepEqual(access([],'2026-10'),{applicabile:false,ammesso:true,soglie:[]});
  for(const periodo of ['2026-11','2026-12','2027-01','2100-12']) assert.equal(access([],periodo).ammesso,false);
  const result=core.accessoBonusGare(complete().map(c=>({...c,operatore_id:'0284cf55-d97a-4709-9ece-d3f4894b80a7'})),
    '0284cf55-d97a-4709-9ece-d3f4894b80a7',id=>id,'2026-11');
  assert.ok(result.soglie.every(s=>s.attuale===0));
  assert.throws(()=>access([],'novembre'),/Periodo/);
});
test('bonus squadra 150 visibile con 5 SIM personali, totale0 e indicatore sulla riga Partita IVA',()=>{
  const contracts=[...complete().filter(c=>c.categoria_snapshot!=='Mobile'),...repeat(5,'Mobile','Business'),
    ...repeat(29,'Mobile','Business',{operatore_id:M})];
  const result=core.valutaGara(metric,goal,contracts,V,id=>id,'2026-11');
  assert.equal(result.attualeSquadra,35);assert.equal(result.euro,150);
  const html=render({contracts,metrics:[metric],goals:[goal]});
  assert.match(html,/PARTITA IVA <span class="gara-accesso-warning"[^>]*>!<\/span>/);
  assert.match(html,/P\.iva Mobile 5\/10 pz/);
  assert.match(html,/class="compenso">€ 150</);
  assert.match(html,/compenso-tot">€ 0</);
  assert.match(html,/<td>P\.iva Mobile<\/td><td>10 \/ 5 pz\.<\/td><td class="esito-ko">KO/);
  assert.equal((html.match(/class="esito-ok">OK/g)||[]).length,3);
  assert.match(html,/Totale a zero/);
  // La scheda intera viene esportata, compreso il riepilogo che segue il totale.
  assert.ok(html.indexOf('gara-accesso"')>html.indexOf('compenso-tot'));
  const october=render({contracts:contracts.map(c=>({...c,operatore_id:M})),metrics:[metric],
    goals:[{...goal,mese:10}],month:10,operators:[{id:M,nome:'Matteo'}]});
  assert.match(october,/compenso-tot">€ 150</);
  assert.doesNotMatch(october,/gara-accesso-warning|SOGLIE MINIME PER ACCESSO BONUS/);
});
test('totale sbloccato solo a tutte le soglie; somma bonus personali e squadra senza cambiare le righe',()=>{
  const contracts=[...complete(),...repeat(24,'Mobile','Business',{operatore_id:M})];
  const personal={id:2,nome:'TELEFONI FINANZIATI GA',tabella:'gara_individuale',regola:{categoria:'Mobile',cluster:'Business'}};
  const personalGoal={metrica_id:2,operatore_id:V,anno:2026,mese:11,compenso_regola:{tipo:'per_pezzo',per_pezzo:5}};
  const html=render({contracts,metrics:[metric,personal],goals:[goal,personalGoal]});
  assert.match(html,/class="compenso">€ 150</);assert.match(html,/class="compenso">€ 50</);
  assert.match(html,/compenso-tot">€ 200</);
  assert.doesNotMatch(html,/gara-accesso-warning|esito-ko/);
  assert.equal((html.match(/class="esito-ok">OK/g)||[]).length,4);
  const blocked=render({contracts:contracts.filter(c=>c.categoria_snapshot!=='Energia'),metrics:[metric,personal],goals:[goal,personalGoal]});
  assert.match(blocked,/class="compenso">€ 150</);assert.match(blocked,/class="compenso">€ 50</);
  assert.match(blocked,/compenso-tot">€ 0</);
});
test('ogni singola soglia mancante azzera anche il bonus squadra, senza azzerare la sua riga',()=>{
  const completeList=complete();
  const cases=[
    completeList.filter((_,i)=>i!==0),
    completeList.filter((_,i)=>i!==10),
    completeList.filter((_,i)=>i!==20),
    completeList.map(c=>c.categoria_snapshot==='Fisso'?{...c,cluster_cliente:'Consumer'}:c)
  ];
  for(const list of cases){
    const html=render({contracts:[...list,...repeat(40,'Mobile','Business',{operatore_id:M})],metrics:[metric],goals:[goal]});
    assert.match(html,/class="compenso">€ 150</);
    assert.match(html,/compenso-tot">€ 0</);
    assert.equal((html.match(/class="esito-ko">KO/g)||[]).length,1);
  }
});
test('minimo Fisso10: 9 decurtazione,10 compenso; gli scaglioni e il mese storico restano configurati separatamente',()=>{
  const rule={tipo:'scaglioni',decurtazione_soglia:10,scaglioni:[{da:0,a:20,importo:10,tipo_calcolo:'per_pezzo'}]};
  assert.deepEqual(core.calcolaCompenso(9,rule),{euro:0,label:'DECURTAZIONE'});
  assert.deepEqual(core.calcolaCompenso(10,rule),{euro:100,label:''});
  assert.equal(core.calcolaCompenso(8,{...rule,decurtazione_soglia:7}).euro,80);
});
