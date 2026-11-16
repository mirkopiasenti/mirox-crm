'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const { createRequire } = require('node:module');
const crypto = require('node:crypto');
const Core = require('../js/contratto-note-core');
const Notes = require('../netlify/functions/_lib/contract-notes');
const Permissions = require('../js/mirox-permissions-core');
const { authorizePages } = require('../netlify/functions/_lib/page-permissions');
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const CONTRACT = id(1), OTHER = id(2), AUTHOR = id(3), REQUEST = id(4);
const DATE = '2026-11-16T12:00:00.123456+00:00';
function fixture() {
  const contracts = [{ id: CONTRACT, categoria_snapshot: 'Mobile', stato_controllo: 'controllato', updated_at: DATE, note_controllo: 'Esito originale', punteggio_gara_totale: 5 }, { id: OTHER }];
  const rows = new Map(), calls = [], state = { fail: '', race: false, loseReply: false, failInsert: false };
  const tables = { vendita_contratti: contracts, profili: [{ id: AUTHOR, nome: 'Autore autenticato', attivo: true, ruolo: 'operatore' }],
    mirox_permessi_utente: [{ utente_id: AUTHOR, pagine: { verifica_contratti: true, segnalazioni: false }, versione: 1 }] };
  const db = { from(table) {
    const filters = [], call = { table }; let single = false, insert, limit = Infinity, cursor;
    const q = { select(columns) { call.columns = columns; return q; }, eq(k,v) { filters.push([k,v]); return q; },
      maybeSingle() { single = true; return q; }, single() { single = true; return q; }, order() { return q; },
      limit(n) { limit = n; return q; }, or(value) { call.or = value; cursor = value; return q; }, insert(value) { insert = value; call.insert = value; return q; },
      then(resolve,reject) {
        calls.push(call);
        if (state.fail === table) return Promise.resolve({ error: new Error('private error') }).then(resolve,reject);
        if (insert) {
          if (state.failInsert) return Promise.resolve({ error: { code: 'PGRST000' } }).then(resolve,reject);
          const row = { ...insert, id: insert.id.toLowerCase(), contratto_id: insert.contratto_id.toLowerCase(), created_at: DATE };
          const exists = rows.has(row.id); if (!exists) rows.set(row.id,row);
          return Promise.resolve(exists || state.race ? { error: { code: '23505' } } : state.loseReply ? { error: new Error('Reply lost') } : { data: { ...row } }).then(resolve,reject);
        }
        let data = (table === 'vendita_note_contratto' ? [...rows.values()] : tables[table]).filter(row => filters.every(([k,v]) => row[k] === (k.endsWith('id') ? v.toLowerCase() : v)));
        if (table === 'vendita_note_contratto') {
          data.sort((a,b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
          if (cursor) {
            const m = cursor.match(/^created_at.lt.([^,]+),and\(created_at.eq.([^,]+),id.lt.([^)]+)\)$/);
            assert.ok(m);data = data.filter(r => r.created_at < m[1] || (r.created_at === m[2] && r.id < m[3]));
          }
        }
        data = data.slice(0,limit).map(r => ({ ...r }));
        return Promise.resolve({ data: single ? data[0] || null : data }).then(resolve,reject);
      } }; return q;
  } };
  const auth = { ok: true, user: { id: AUTHOR }, profilo: tables.profili[0] };
  const params = extra => ({ supabase: db, auth, body: { contratto_id: CONTRACT, request_id: REQUEST, testo: ' Nota di prova\nSeconda riga ', ...extra } });
  const sourcePath = require.resolve('../netlify/functions/gestisci-vendita-contratto'), realRequire = createRequire(sourcePath), mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(sourcePath,'utf8'), { module: mod, exports: mod.exports, console, require(name) {
    if (name === './_lib/require-auth') return { getAdminClient: () => db, requireAuth: async (event,options) => {
      if (event.headers?.authorization !== 'Bearer synthetic') return { ok: false, status: 401, error: 'JWT mancante' };
      return authorizePages(db,auth,Permissions.endpointPages(options.endpoint,event));
    } };
    if (name === './_lib/verifica-worker') throw new Error('Le note non devono attivare il verificatore');
    return realRequire(name);
  } });
  const send = async (extra = {}, token = true) => {
    const r = await mod.exports.handler({ httpMethod: 'POST', headers: token ? { authorization: 'Bearer synthetic' } : {}, body: JSON.stringify({ action: 'add_nota_contratto', ...params(extra).body }) });
    return { status: r.statusCode, ...JSON.parse(r.body) };
  };
  return { db, auth, tables, contracts, rows, calls, state, params, send };
}

test('note: validazione condivisa conserva righe, richiede testo e limita la lunghezza', () => {
  assert.equal(Core.normalize(' \n Prima\nSeconda \n '),'Prima\nSeconda');
  assert.equal(Core.normalize('a'.repeat(4000)).length,4000);
  for (const value of ['', ' \n\t ', null, {}, 'a'.repeat(4001), '\u0000']) assert.throws(() => Core.normalize(value));
});
test('note: tutte le categorie e gli stati, compresi i contratti vecchi/verificati, mantengono intatti i dati', async () => {
  for (const categoria of ['Mobile','Fisso','Customer Base','Energia','Assicurazioni','Allarme']) for (const stato of ['da_controllare','controllato']) {
    const f = fixture(); Object.assign(f.contracts[0],{ categoria_snapshot: categoria, stato_controllo: stato });
    const before = JSON.stringify(f.contracts);
    const r = await f.send({ autore_nome: 'Falso autore', autore_id: id(99), created_at: '2000-01-01' });
    assert.equal(r.status,200);assert.equal(r.nota.autore_nome,'Autore autenticato');assert.equal(r.nota.created_at,DATE);assert.equal(r.nota.testo,'Nota di prova\nSeconda riga');
    assert.equal(JSON.stringify(f.contracts),before);assert.equal(f.rows.size,1);
    assert.deepEqual([...new Set(f.calls.filter(c => c.insert).map(c => c.table))],['vendita_note_contratto']);
    assert.equal(f.tables.mirox_permessi_utente[0].pagine.segnalazioni,false);
  }
});
test('note: replay, conflitto concorrente e risposta persa non duplicano né riscrivono lo storico', async () => {
  for (const mode of ['', 'race', 'loseReply']) {
    const f = fixture();if(mode)f.state[mode]=true;
    if(mode==='loseReply')await assert.rejects(Notes.add(f.params()),/confermare/);else await Notes.add(f.params());
    f.state.loseReply=false;f.auth.profilo.nome='Nuovo nome';
    const r = await Notes.add(f.params());assert.equal(f.rows.size,1);assert.equal(r.nota.autore_nome,'Autore autenticato');
    await assert.rejects(Notes.add(f.params({testo:'Testo differente'})),e=>e.statusCode===409);
    await assert.rejects(Notes.add(f.params({contratto_id:OTHER})),e=>e.statusCode===409);
    await assert.rejects(Notes.add({...f.params(),auth:{user:{id:id(99)},profilo:{nome:'Altro autore'}}}),e=>e.statusCode===409);
    assert.equal(f.rows.size,1);
  }
});
test('note: assenza, input invalido e errori lettura/salvataggio non diventano falsi successi', async () => {
  const f=fixture();assert.deepEqual(await Notes.list(f.params()),{note:[],next_cursor:null});
  for(const body of [{contratto_id:'bad'},{contratto_id:id(99)},{request_id:'bad'},{testo:' '},{testo:'a'.repeat(4001)}])await assert.rejects(Notes.add(f.params(body)),e=>[400,404].includes(e.statusCode));
  for(const cursor of [{id:REQUEST,created_at:'bad'}, {id:'bad',created_at:DATE}, {id:REQUEST,created_at:DATE+',id.gt.0'}])await assert.rejects(Notes.list(f.params({cursor})),e=>e.statusCode===400);
  f.state.fail='vendita_note_contratto';await assert.rejects(Notes.list(f.params()),/caricare/);await assert.rejects(Notes.add(f.params()),/verificare/);
  f.state.fail='';f.state.failInsert=true;await assert.rejects(Notes.add(f.params()),/confermare/);assert.equal(f.rows.size,0);
});
test('note: cursore stabile e filtro contratto non perdono annotazioni quando ne arriva una nuova', async () => {
  const f=fixture();for(let n=100;n<157;n++)f.rows.set(id(n),{id:id(n),contratto_id:CONTRACT,testo:String(n),autore_nome:'Operatore',created_at:DATE});
  f.rows.set(id(999),{id:id(999),contratto_id:OTHER,testo:'Altro cliente',autore_nome:'Operatore',created_at:DATE});
  const first=await Notes.list(f.params());assert.equal(first.note.length,50);assert.ok(first.next_cursor);
  f.rows.set(id(998),{id:id(998),contratto_id:CONTRACT,testo:'Appena aggiunta',autore_nome:'Operatore',created_at:'2026-11-16T13:00:00.123456+00:00'});
  const second=await Notes.list(f.params({cursor:first.next_cursor}));assert.equal(second.note.length,7);assert.equal(second.next_cursor,null);
  const all=first.note.concat(second.note);assert.equal(new Set(all.map(n=>n.id)).size,57);assert.ok(all.every(n=>n.contratto_id===CONTRACT));
});
test('note: ACL Verifica fresca anche dopo revoca e nessun accesso con i soli Storico o Segnalazioni', async () => {
  const f=fixture();assert.equal((await f.send({},false)).status,401);assert.equal(f.calls.length,0);
  assert.equal((await f.send()).status,200);f.calls.length=0;
  for(const pages of [{segnalazioni:true},{storico_cliente:true},{}]) {
    f.tables.mirox_permessi_utente[0].pagine=pages;
    for(const action of ['get_note_contratto','add_nota_contratto'])assert.equal((await f.send({action})).status,403);
  }
  assert.ok(f.calls.every(c=>['profili','mirox_permessi_utente'].includes(c.table)));assert.equal(f.rows.size,1);
});

function uiFixture() {
  const memory=new Map(), calls=[], busy=[], state={failRead:false,failSave:false,more:null};
  const window={MiroxContrattoNoteCore:Core,crypto:{randomUUID:crypto.randomUUID},sessionStorage:{getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/mirox-safe'),'utf8'),{window});
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/verifica-note-contratto'),'utf8'),{window});
  function mount(contrattoId=CONTRACT) {
    const fields={};
    const host={innerHTML:'',querySelector(key){return fields[key]||=( {value:'',textContent:'',innerHTML:'',disabled:false,hidden:false,handlers:{},addEventListener(name,fn){this.handlers[name]=fn;},emit(name){return this.handlers[name]?.();}} );}};
    const controller=window.MiroxContrattoNoteUI.mount(host,{contrattoId,loadAuthor:async()=>({id:AUTHOR}),onBusy:v=>busy.push(v),request:async body=>{
      calls.push(JSON.parse(JSON.stringify(body)));
      if(body.action==='get_note_contratto'){if(state.failRead)throw Error('Lettura fallita');return state.more||{note:[],next_cursor:null};}
      if(state.save)return state.save(body);
      if(state.failSave)throw Error('Rete interrotta');
      return {nota:{id:body.request_id,contratto_id:body.contratto_id,testo:body.testo,autore_nome:'<Autore>',created_at:DATE}};
    }});
    return {host,fields,controller,field:selector=>host.querySelector(selector),async type(text){const e=host.querySelector('[data-note-text]');e.value=text;await e.emit('input');},save:()=>host.querySelector('[data-note-save]').emit('click')};
  }
  return {mount,state,memory,calls,busy};
}
test('note UI: storico vuoto, testo obbligatorio, salvataggio visibile ed escaped senza chiudere il contratto', async () => {
  const f=uiFixture(),m=f.mount();await m.controller.ready;assert.match(m.field('[data-note-list]').innerHTML,/Nessuna nota/);
  await m.type('  ');await m.save();assert.equal(f.calls.length,1);assert.match(m.field('[data-note-error]').textContent,/Inserisci/);
  await m.type('<script>prova</script>\nRiga 2');await m.save();
  assert.match(m.field('[data-note-list]').innerHTML,/&lt;script&gt;/);assert.doesNotMatch(m.field('[data-note-list]').innerHTML,/<script>/);
  assert.match(m.field('[data-note-list]').innerHTML,/&lt;Autore&gt;/);assert.equal(m.field('[data-note-text]').value,'');assert.equal(f.memory.size,0);
  assert.equal(m.field('[data-note-status]').textContent,'Nota salvata.');assert.deepEqual(f.busy,[true,false]);
});
test('note UI: bozze separate per contratto, errori e riapertura mantengono testo e UUID di retry', async () => {
  const f=uiFixture(),a=f.mount();await a.controller.ready;await a.type('Annotazione');a.controller.dispose();
  const other=f.mount(OTHER);await other.controller.ready;assert.equal(other.field('[data-note-text]').value,'');
  const b=f.mount();await b.controller.ready;assert.equal(b.field('[data-note-text]').value,'Annotazione');
  f.state.failSave=true;await b.save();const first=f.calls.at(-1);assert.equal(b.field('[data-note-text]').disabled,true);assert.match(b.field('[data-note-error]').textContent,/Rete/);b.controller.dispose();
  const c=f.mount();await c.controller.ready;f.state.failSave=false;await c.save();
  assert.equal(f.calls.at(-1).request_id,first.request_id);assert.equal(f.calls.at(-1).testo,'Annotazione');assert.equal(f.memory.size,0);
});
test('note UI: errore storico non equivale a vuoto, doppio clic bloccato e risposta malformata non confermata', async () => {
  const f=uiFixture();f.state.failRead=true;const m=f.mount();await m.controller.ready;await m.type('Non perdere');
  assert.equal(m.field('[data-note-save]').disabled,true);assert.match(m.field('[data-note-error]').textContent,/Lettura/);
  f.state.failRead=false;await m.field('[data-note-refresh]').emit('click');
  let resolve;f.state.save=()=>new Promise(r=>{resolve=r;});const pending=m.save();await new Promise(r=>setImmediate(r));
  assert.equal(m.controller.isSaving(),true);await m.save();assert.equal(f.calls.filter(c=>c.action==='add_nota_contratto').length,1);
  resolve({nota:{id:id(999)}});await pending;
  assert.match(m.field('[data-note-error]').textContent,/non valida/);assert.equal(m.field('[data-note-text]').value,'Non perdere');assert.equal(m.controller.isSaving(),false);
});
test('note UI: risposta tardiva dopo chiusura non sovrascrive un altro dettaglio', async () => {
  const f=uiFixture(),m=f.mount();await m.controller.ready;await m.type('Bozza uno');
  let resolve;f.state.save=body=>new Promise(r=>{resolve=()=>r({nota:{id:body.request_id,contratto_id:CONTRACT,testo:body.testo,autore_nome:'Autore',created_at:DATE}});});
  const pending=m.save();await new Promise(r=>setImmediate(r));m.controller.dispose();const other=f.mount(OTHER);await other.controller.ready;await other.type('Bozza due');
  resolve();await pending;assert.equal(other.field('[data-note-text]').value,'Bozza due');assert.match(m.field('[data-note-status]').textContent,/Salvataggio/);
});
test('dettaglio: note disponibili anche nei Verificati e indipendenti dal dirty dei dati PDA', () => {
  const page=fs.readFileSync(require.resolve('../moduli/verifica_contratti.html'),'utf8');
  assert.match(page,/bodyHtml = `\$\{statoHtml\}\$\{pdaHtml\}\s*<div class="det-section" data-contract-notes>/);
  const events={},context={m:{body:{addEventListener(k,f){events[k]=f;},querySelector(){return {addEventListener(){}};}}},c:{},window:{MiroxPdaUI:{bindReloadForever(){}}}};
  vm.createContext(context);const a=page.indexOf('  let pdaOtherFieldsDirty = false;'),b=page.indexOf('  // Trick:',a);
  vm.runInContext(page.slice(a,b),context);events.input({target:{closest:()=>({})}});assert.equal(vm.runInContext('pdaOtherFieldsDirty',context),false);
  events.input({target:{closest:()=>null}});assert.equal(vm.runInContext('pdaOtherFieldsDirty',context),true);
});
test('dettaglio: salvataggio nota blocca la chiusura e ripristina i controlli senza abilitare quelli riservati', () => {
  const page=fs.readFileSync(require.resolve('../moduli/verifica_contratti.html'),'utf8');
  let options, binding;
  const context={titolo:'Dettaglio',bodyHtml:'',footerHtml:'',window:{MiroxUI:{_build(value){options=value;return {};}}}};
  vm.createContext(context);const a=page.indexOf('  let noteController;'),b=page.indexOf('  let pdaOtherFieldsDirty',a);
  vm.runInContext(page.slice(a,b)+';this.bindController=value=>{noteController=value;};',context);
  let saving=true,disposed=false;context.bindController({isSaving:()=>saving,dispose(){disposed=true;}});
  assert.equal(options.canClose(),false);saving=false;assert.equal(options.canClose(),true);options.onClose();assert.equal(disposed,true);
  const restricted={disabled:true,closest:()=>null},editable={disabled:false,closest:()=>null},note={disabled:false,closest:()=>({})};
  const ctx={c:{id:CONTRACT},noteController:null,getProfiloCorrenteVC(){},gestisciVenditaContratto(){},
    m:{modal:{style:{},querySelectorAll:()=>[restricted,editable,note]},body:{style:{},querySelector:()=>({})}},
    window:{MiroxContrattoNoteUI:{mount(_,opts){binding=opts;return {};}}}};
  const start=page.indexOf('  // Trick:'),end=page.indexOf('  // Salva ref globale',start);
  vm.runInNewContext(page.slice(start,end),ctx);binding.onBusy(true);assert.equal(editable.disabled,true);assert.equal(note.disabled,false);
  binding.onBusy(false);assert.equal(editable.disabled,false);assert.equal(restricted.disabled,true);
});
