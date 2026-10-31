'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../moduli/upload-contratti-vendita.html'),'utf8');
function wizard(contracts,post) {
  const tables={vendita_contratti:contracts,post};
  const db={from(table) {
    const filters=[];
    const q={select(){return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},in(k,v){filters.push(r=>v.includes(r[k]));return q;},
      gte(k,v){filters.push(r=>r[k]>=v);return q;},lt(k,v){filters.push(r=>r[k]<v);return q;},order(){return q;},
      then(resolve,reject){return Promise.resolve({data:tables[table].filter(r=>filters.every(f=>f(r))),error:null}).then(resolve,reject);}};
    return q;
  }};
  const ctx=vm.createContext({db,console:{log(){},warn(){},error(){}},
    CATEGORIE_REINSERIMENTO_CONFIG:{Fisso:{table:'post',stati:['KO','In Attivazione']},Energia:{table:'post',stati:['Annullato']}},
    computeReinserimentoWindow:()=>({startIso:'2026-10-01',endIso:'2026-11-01'})});
  vm.runInContext(source.slice(source.indexOf(' async function checkReinserimento('),source.indexOf(' function describeReinserimentoCandidate(')),ctx);
  return category=>ctx.checkReinserimento('customer','category',category);
}
const contract=(id,patch={})=>({id,anagrafica_id:'customer',categoria_id:'category',data_contratto:'2026-10-08T12:00:00Z',
  stato_inserimento:'inserimento',reinserimento_di_contratto_id:null,reinserimento_fisso_finalizzato:false,...patch});
const reinsert=(id,parent,patch={})=>contract(id,{stato_inserimento:'reinserimento',reinserimento_di_contratto_id:parent,
  reinserimento_fisso_finalizzato:true,...patch});
test('wizard Fisso propone solo ultimo tentativo idoneo e conserva gli originali indipendenti',async()=>{
  const contracts=[contract('old'),reinsert('second','old'),reinsert('draft','second',{reinserimento_fisso_finalizzato:false}),
    contract('independent'),contract('last-month',{data_contratto:'2026-09-30T12:00:00Z'})];
  const post=contracts.map(c=>({contratto_id:c.id,stato:'KO'}));
  const candidates=await wizard(contracts,post)('Fisso');
  assert.deepEqual(Array.from(candidates,c=>c.contratto_id),['second','independent']);
  post.find(p=>p.contratto_id==='second').stato='Attivo';
  assert.deepEqual(Array.from(await wizard(contracts,post)('Fisso'),c=>c.contratto_id),['independent']);
});
test('wizard Energia conserva la regola precedente senza catene',async()=>{
  const contracts=[contract('old'),reinsert('second','old')];
  const post=contracts.map(c=>({contratto_id:c.id,stato:'Annullato'}));
  assert.deepEqual(Array.from(await wizard(contracts,post)('Energia'),c=>c.contratto_id),['old']);
});
