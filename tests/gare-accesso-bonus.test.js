'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../js/dashboard-report-core');
const {O,M,extraMetric,contract,repeat,complete,render} = require('./gare-accesso-fixture.cjs');
const bonusState = (contrattiMese,extra={}) => ({contrattiMese,metricheGara:[extraMetric],
  resolveOperatore:id=>id==='alias-o'?O:id,...extra});
const access = (list,period='2026-11',extra) => core.accessoBonusGare(bonusState(list,extra),O,period);
const punti = risultato => risultato.soglie.find(s=>s.id==='extra_gara_piva').attuale;
const metric = {id:6,nome:'PARTITA IVA',tabella:'gara_individuale',tipo_conteggio:'individuale',tipo_compenso:'squadra',regola:{cluster:'Business'}};
const goal = {metrica_id:6,operatore_id:null,anno:2026,mese:11,obiettivo:45,
  compenso_regola:{tipo:'scaglioni',scaglioni:[{da:35,importo:150,tipo_calcolo:'flat'}]}};
test('quattro requisiti personali con confine esatto e Fisso Business incluso nel Fisso totale',()=>{
  assert.deepEqual(access(complete()).soglie.map(s=>[s.id,s.obiettivo,s.attuale,s.raggiunta]),[
    ['fisso',10,10,true],['energia',10,10,true],['extra_gara_piva',10,10,true],['fisso_business',1,1,true]
  ]);
  assert.equal(access(complete()).ammesso,true);
  for(const index of [0,10,20,9]) {
    const list=complete();list.splice(index,1);
    assert.equal(access(list).ammesso,false,'manca anche una sola soglia');
  }
  assert.equal(access([...complete(),...repeat(50,'Mobile','Business',{operatore_id:M})].filter(c=>c.categoria_snapshot!=='Energia')).ammesso,false);
});
test('la soglia personale usa gli stessi punteggi e filtri dell’Extra Gara P.IVA',()=>{
  const business = (id,categoria,punteggio,extra={}) => contract(categoria,'Business',
    {id,punteggio_extra_gara_totale:punteggio,...extra});
  const list=[
    business('mobile','Mobile',1.25,{operatore_id:'alias-o'}),
    business('energia','Energia',1.5),
    business('fisso','Fisso',1.25),
    business('assicurazioni','Assicurazioni',1),
    business('cerea','Mobile',20,{codice_rivenditore:core.CEREA}),
    business('reinserimento','Mobile',20,{stato_inserimento:'reinserimento'}),
    business('altro-operatore','Mobile',20,{operatore_id:M}),
    business('consumer','Mobile',20,{cluster_cliente:'Consumer'}),
    business('rifiutata','Energia',20),
    business('annullata','Energia',20),
    business('fisso-pendente','Fisso',20),
    business('fisso-ko','Fisso',20),
    business('firmato-nel-mese','Allarmi',20),
    business('da-attivare','Allarmi',20)
  ];
  const statoPostVendita={
    fisso:new Map([['fisso','In Attivazione'],['fisso-ko','KO']]),
    energia:new Map([['rifiutata','Rifiutato'],['annullata','Annullato']]),
    allarmi:new Map([['allarme-precedente','OK'],['firmato-nel-mese','OK'],['da-attivare','In Attivazione']])
  };
  const allarmiAttivatiMese=[business('allarme-precedente','Allarmi',5,{data_contratto:'2026-10-28T10:00:00Z'})];
  const state=bonusState(list,{anno:2026,mese:11,operatoriAttiviMese:[{id:O}],obiettivi:[],
    statoPostVendita,allarmiAttivatiMese});
  assert.equal(punti(core.accessoBonusGare(state,O,'2026-11')),10);
  assert.equal(core.monthlyRows(state,'2026-11-27')[0].punteggio,10);
  assert.equal(punti(access(list,'2026-11',{statoPostVendita})),5,'un OK senza attivazione nel mese non vale');
  assert.equal(punti(access(list,'2026-11',{metricheGara:[],statoPostVendita,allarmiAttivatiMese})),0);
  const html=render({contracts:list,statoPostVendita,allarmiAttivatiMese});
  assert.match(html,/<td>Extra Gara P\.IVA<\/td><td>10 \/ 8,75 punti<\/td><td class="esito-ko">KO/);
});
test('10 pezzi con meno di 10 punti non bastano e i centesimi raggiungono la soglia esatta',()=>{
  const base=complete().filter(c=>c.categoria_snapshot!=='Mobile');
  const discreti=repeat(10,'Mobile','Business',{punteggio_extra_gara_totale:0});
  assert.equal(access([...base,...discreti]).ammesso,false);
  const points=[...base,contract('Customer Base','Business',{punteggio_extra_gara_totale:9.99})];
  assert.equal(punti(access(points)),9.99);
  assert.equal(access(points).ammesso,false);
  const exact=[...points,contract('Mobile','Business',{punteggio_extra_gara_totale:0.01})];
  assert.equal(punti(access(exact)),10);
  assert.equal(access(exact).ammesso,true);
});
test('nessuna retroattivita: ottobre senza requisiti; da novembre anche nei prossimi anni, UUID fuori periodo esclusi',()=>{
  assert.deepEqual(access([],'2026-10'),{applicabile:false,ammesso:true,soglie:[]});
  for(const periodo of ['2026-11','2026-12','2027-01','2100-12']) assert.equal(access([],periodo).ammesso,false);
  const result=core.accessoBonusGare(bonusState(complete().map(c=>({...c,operatore_id:'0284cf55-d97a-4709-9ece-d3f4894b80a7'}))),
    '0284cf55-d97a-4709-9ece-d3f4894b80a7','2026-11');
  assert.ok(result.soglie.every(s=>s.attuale===0));
  assert.throws(()=>access([],'novembre'),/Periodo/);
});
test('bonus squadra 150 visibile con 5 punti Extra personali, totale0 e indicatore sulla riga Partita IVA',()=>{
  const contracts=[...complete().filter(c=>c.categoria_snapshot!=='Mobile'),...repeat(5,'Mobile','Business'),
    ...repeat(29,'Mobile','Business',{operatore_id:M})];
  const result=core.valutaGara(metric,goal,contracts,O,id=>id,'2026-11');
  assert.equal(result.attualeSquadra,35);assert.equal(result.euro,150);
  const html=render({contracts,metrics:[metric],goals:[goal]});
  assert.match(html,/PARTITA IVA <span class="gara-accesso-warning"[^>]*>!<\/span>/);
  assert.match(html,/Extra Gara P\.IVA 5\/10 punti/);
  assert.match(html,/class="compenso">€ 150</);
  assert.match(html,/compenso-tot">€ 0</);
  assert.match(html,/<td>Extra Gara P\.IVA<\/td><td>10 \/ 5 punti<\/td><td class="esito-ko">KO/);
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
  const personalGoal={metrica_id:2,operatore_id:O,anno:2026,mese:11,compenso_regola:{tipo:'per_pezzo',per_pezzo:5}};
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
test('indicatore solo se una riga della stessa scheda guadagna almeno1EUR, anche dopo la riga col requisito mancante',()=>{
  const fixed={id:4,nome:'FISSO',tabella:'gara_individuale',regola:{categoria:'Fisso'}};
  const paid={id:2,nome:'TELEFONI FINANZIATI GA',tabella:'gara_individuale',regola:{categoria:'Mobile'}};
  const fixedGoal={metrica_id:4,operatore_id:O,anno:2026,mese:11,compenso_regola:{tipo:'per_pezzo',per_pezzo:10}};
  for(const amount of [0,0.99,1,5]){
    const paidGoal={...fixedGoal,metrica_id:2,compenso_regola:{tipo:'per_pezzo',per_pezzo:amount}};
    for(const metrics of [[fixed,paid],[paid,fixed]]){
      const html=render({contracts:[contract('Mobile')],metrics,goals:[fixedGoal,paidGoal]});
      if(amount>=1)assert.match(html,/FISSO <span class="gara-accesso-warning"/);
      else assert.doesNotMatch(html,/gara-accesso-warning/);
      assert.match(html,/compenso-tot">€ 0</);
      assert.match(html,/class="esito-ko">KO/,'il riepilogo rimane anche senza guadagni');
    }
  }
  const html=render({contracts:[contract('Mobile')],metrics:[fixed,paid],goals:[fixedGoal,
    {...fixedGoal,metrica_id:2,compenso_regola:{tipo:'per_pezzo',per_pezzo:5}}],
    operators:[{id:O,nome:'Operatore di prova'},{id:M,nome:'Matteo'}]});
  const cards=html.split('<div class="gara-card"').slice(1);
  assert.match(cards[0],/gara-accesso-warning/);
  assert.doesNotMatch(cards[1],/gara-accesso-warning/,'il guadagno di un altro operatore non attiva il simbolo');
});
test('due compensi inferiori a1EUR o una semplice etichetta non attivano gli avvisi',()=>{
  const fixed={id:4,nome:'FISSO',tabella:'gara_individuale',regola:{categoria:'Fisso'}};
  const paid={id:2,nome:'ALTRA GARA',tabella:'gara_individuale',regola:{categoria:'Mobile'}};
  const other={...paid,id:8,nome:'TERZA GARA'};
  const makeGoal=(metrica_id,rule)=>({metrica_id,operatore_id:O,anno:2026,mese:11,compenso_regola:rule});
  const html=render({contracts:[contract('Mobile')],metrics:[fixed,paid,other],goals:[
    makeGoal(2,{tipo:'per_pezzo',per_pezzo:0.5}),makeGoal(8,{tipo:'per_pezzo',per_pezzo:0.5})]});
  assert.doesNotMatch(html,/gara-accesso-warning/);
  const labelled=render({contracts:[contract('Mobile')],metrics:[fixed,paid],goals:[
    makeGoal(2,{tipo:'per_pezzo',per_pezzo:5,label:'DECURTAZIONE'})]});
  assert.match(labelled,/badge-dec">DECURTAZIONE/);
  assert.doesNotMatch(labelled,/gara-accesso-warning/);
});
