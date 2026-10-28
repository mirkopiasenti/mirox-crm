'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Core = require('../js/verifica-contratti-core');
const { parseCsv } = require('../netlify/functions/_lib/verifica-csv');
const Worker = require('../netlify/functions/_lib/verifica-worker');
const Docs = require('../netlify/functions/_lib/verifica-documenti');
const { handler: api } = require('../netlify/functions/gestisci-verifica-automatica');
const ID = '11111111-1111-4111-8111-111111111111';
const evidence = value => ({ value, page: 1, quote: String(value) + ' trascritto dalla fonte' });
function fixture(category = 'Customer Base') {
  const make = (id, kind, fields, pages = 2) => ({ document: { id, tipo_documento: kind, pages }, reading: { id, fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, evidence(v)])) } });
  const pda = make('pda', 'contratto', { fiscale: 'RSSMRA80A01H501U', intestatario_nome: 'Mario Rossi', data_firma: '2026-10-26', codice_contratto: 'PDA001',
    portabilita: true, costo_offerta_mensile: '9.99', operatore_provenienza: 'Vodafone', iccid_uscente: '8939012345678901234', numero_telefono: '3491234567', numero_mnp: '3491234567', numero_provvisorio: '3331234567' });
  const identity = make('identity', 'documento_identita', { fiscale: 'RSSMRA80A01H501U', nome: 'Mario Rossi', nascita: '1980-01-01', scadenza: '2026-10-26' });
  const sim = make('sim', 'copia_sim_mnp', { iccid: '8939012345678901234' });
  const bill = make('bill', 'copia_bolletta', { fiscale: 'RSSMRA80A01H501U', intestatario_nome: 'Mario Rossi', pod_pdr: 'IT001E12345678', gestore: 'Gestore esempio', prima_pagina: true, seconda_pagina: true });
  const selected = category === 'Energia' ? [identity, bill] : category === 'Mobile' ? [pda, identity, sim] : [pda, identity];
  return { contract: { id: ID, categoria_snapshot: category, codice_contratto: category === 'Energia' ? null : 'PDA001', cluster_cliente: 'Consumer', pod_pdr: 'IT001E12345678',
    portabilita: true, numero_telefono: '3491234567', numero_mnp: '3491234567', numero_provvisorio: '3331234567', tipo_firma: 'elettronica' },
    customer: { cf_piva: 'RSSMRA80A01H501U', ragione_sociale: 'Mario Rossi' }, documents: selected.map(s => s.document), extracted: { documents: selected.map(s => s.reading) },
    signingDate: category === 'Energia' ? '2026-10-26' : null };
}
const get = (f, id) => f.extracted.documents.find(d => d.id === id).fields;

test('analisi automatica rispetta scope e gestione Cloud su Mobile e Fisso Business, incluso storico', async () => {
  for (const category of ['Mobile', 'Fisso']) {
    for (const choice of [
      { cluster: 'Business', flag: true, action: 'Mantieni attiva', valid: true },
      { cluster: 'Business', flag: true, action: 'Richiedi disattivazione', valid: true },
      { cluster: 'Business', flag: false, action: null, valid: true },
      { cluster: 'Business', flag: null, action: null, valid: true },
      { cluster: 'Business', flag: true, action: null, valid: false },
      { cluster: 'Consumer', flag: true, action: 'Mantieni attiva', valid: false }
    ]) {
      const f = fixture(category);
      Object.assign(f.contract, { stato_controllo: 'da_controllare', cluster_cliente: choice.cluster,
        professional_cloud: choice.flag, professional_cloud_gestione: choice.action });
      const rows = { vendita_contratti: f.contract, anagrafica: f.customer,
        vendita_pratiche: { stato_pratica: 'inviata' }, vendita_documenti: f.documents,
        vendita_documenti_regole: [], vendita_verifica_csv: null, vendita_verifiche: null };
      const db = { from(table) {
        assert.ok(Object.hasOwn(rows, table), table);
        const response = { data: rows[table] };
        const q = { select() { return q; }, eq() { return q; }, order() { return q; }, limit() { return q; },
          single: async () => response, maybeSingle: async () => response,
          then(resolve, reject) { return Promise.resolve(response).then(resolve, reject); } };
        return q;
      } };
      const { result } = await Worker.analyze(db, ID, { readDocuments: async () => ({ documents: f.documents, extracted: f.extracted, proofs: [] }) });
      assert.equal(result.errors.some(e => e.code === 'dati_pda'), !choice.valid, JSON.stringify({ category, ...choice }));
    }
  }
});

test('documento valido alla data firma, anche se scaduto prima del controllo; scadenza inclusiva', () => {
  const f = fixture();
  assert.equal(Core.evaluate(f).esito, 'controllato');
  get(f, 'identity').scadenza = evidence('2026-10-25');
  assert.equal(Core.evaluate(f).esito, 'da_verificare');
});
test('non usa data upload come data firma; rifiuta data impossibile e sola fiducia AI', () => {
  const f = fixture(); f.contract.data_contratto = '2026-10-26T12:00:00Z';
  get(f, 'pda').data_firma = null;
  assert.ok(Core.evaluate(f).errors.some(e => e.code === 'data_firma'));
  get(f, 'pda').data_firma = evidence('2026-02-30');
  assert.equal(Core.evaluate(f).esito, 'da_verificare');
  f.extracted.approved = true;
  assert.equal(Core.evaluate(f).esito, 'da_verificare');
});
test('intestatario fiscale errato, CF identita diverso o documento illeggibile bloccano', () => {
  for (const kind of ['tax', 'identityTax', 'page', 'quote', 'duplicate']) {
    const f = fixture();
    if (kind === 'tax') get(f, 'pda').fiscale = evidence('VRDLGI80A01H501Z');
    if (kind === 'identityTax') get(f, 'identity').fiscale = evidence('VRDLGI80A01H501Z');
    if (kind === 'page') get(f, 'identity').fiscale.page = 9;
    if (kind === 'quote') get(f, 'identity').scadenza.quote = '';
    if (kind === 'duplicate') f.extracted.documents.push(f.extracted.documents[0]);
    // A missing tax value may still be supported by full name + birth; remove fallback in this case.
    if (kind === 'page') get(f, 'identity').nascita = null;
    assert.equal(Core.evaluate(f).esito, 'da_verificare', kind);
  }
});
test('identita Consumer con CF esatto e scadenza valida non dipende dal nome OCR, anche nella verifica serale',()=>{
  const f=fixture();get(f,'identity').nome=evidence('Mario Rosi');
  assert.equal(Core.evaluate(f).esito,'controllato');
  get(f,'identity').nome=null;assert.equal(Core.evaluate(f).esito,'controllato');
  get(f,'identity').fiscale=null;assert.equal(Core.evaluate(f).esito,'da_verificare');
});
test('Business verifica CF personale del rappresentante PDA, distinto dalla società; nome OCR informativo', () => {
  const f = fixture(); f.contract.cluster_cliente = 'Business'; f.customer.cf_piva = '01234567890'; f.customer.ragione_sociale = 'Società esempio';
  f.customer.nome_referente = 'Mario Rossi';
  get(f, 'pda').fiscale = evidence('01234567890');
  get(f, 'pda').firmatario_nome = evidence('Mario Rossi'); get(f, 'pda').firmatario_fiscale = evidence('RSSMRA80A01H501U');
  assert.equal(Core.evaluate(f).esito, 'controllato');
  get(f, 'pda').firmatario_nome = evidence('Luigi Verdi');
  get(f,'identity').nome=evidence('Mario Rosi');
  assert.equal(Core.evaluate(f).esito,'controllato');
  get(f,'identity').fiscale=evidence('VRDLGI80A01H501Z');
  assert.equal(Core.evaluate(f).esito, 'da_verificare');
});
test('identità senza CF richiede verifica manuale, nome e nascita non sostituiscono il codice', () => {
  const f = fixture(); get(f, 'identity').fiscale = null;
  assert.equal(Core.evaluate(f).esito, 'da_verificare');
  get(f, 'identity').nascita = null;
  assert.equal(Core.evaluate(f).esito, 'da_verificare');
  assert.equal(Core.birthMatchesTax('1980-01-01', 'RSSMRA80A01H501U'), true);
  assert.equal(Core.birthMatchesTax('1980-01-02', 'RSSMRA80A01H501U'), false);
});
test('confronta ICCID uscente, non telefono o nuova SIM; rifiuta cifre discordanti', () => {
  const f = fixture('Mobile');
  assert.equal(Core.evaluate(f).esito, 'controllato');
  get(f, 'sim').iccid = evidence('8939012345678901235');
  assert.ok(Core.evaluate(f).errors.some(e => e.code === 'sim_diversa'));
  get(f, 'sim').iccid = evidence('3491234567');
  assert.equal(Core.evaluate(f).esito, 'da_verificare');
});
test('MNP senza SIM, portabilità discordante o numerazioni discordanti non passano', () => {
  for (const kind of ['missing', 'port', 'phone']) {
    const f = fixture('Mobile');
    if (kind === 'missing') { f.documents = f.documents.filter(d => d.id !== 'sim'); f.extracted.documents = f.extracted.documents.filter(d => d.id !== 'sim'); }
    if (kind === 'port') f.contract.portabilita = false;
    if (kind === 'phone') f.contract.numero_provvisorio = '3330000000';
    assert.equal(Core.evaluate(f).esito, 'da_verificare', kind);
  }
});
test('completa i dati Mobile mancanti da evidenze, senza sovrascrivere valori discordanti', () => {
  const f = fixture('Mobile');
  for (const key of ['codice_contratto', 'portabilita', 'costo_offerta_mensile', 'numero_telefono', 'numero_mnp', 'numero_provvisorio', 'operatore_provenienza']) f.contract[key] = null;
  const r = Core.evaluate(f);
  assert.equal(r.esito, 'controllato');
  assert.equal(r.patch.codice_contratto, 'PDA001'); assert.equal(r.patch.costo_offerta_mensile, 9.99);
  assert.equal(r.patch.portabilita, true); assert.equal(r.patch.numero_mnp, '3491234567');
  f.contract.costo_offerta_mensile = 29.99;
  const conflict = Core.evaluate(f);
  assert.equal(conflict.esito, 'da_verificare'); assert.equal(conflict.patch.costo_offerta_mensile, undefined);
});
test('firma cartacea richiede scansione dello stesso contratto e intestatario', () => {
  const f = fixture(); f.contract.tipo_firma = 'cartacea';
  assert.equal(Core.evaluate(f).esito, 'da_verificare');
  f.documents.push({ id: 'signed', tipo_documento: 'contratto_firmato', pages: 2 });
  f.extracted.documents.push({ id: 'signed', fields: { fiscale: evidence('RSSMRA80A01H501U'), codice_contratto: evidence('OTHER') } });
  assert.equal(Core.evaluate(f).esito, 'da_verificare');
  get(f, 'signed').codice_contratto = evidence('PDA001');
  assert.equal(Core.evaluate(f).esito, 'controllato');
});
test('Energia attende CSV assente e contratto non trovato, con motivi distinti', () => {
  const f = fixture('Energia');
  assert.equal(Core.evaluate(f).esito, 'in_attesa_csv');
  assert.equal(Core.evaluate(f).waiting[0].code, 'missing_file');
  f.csv = { rows: [] };
  assert.equal(Core.evaluate(f).esito, 'in_attesa_csv');
  assert.equal(Core.evaluate(f).waiting[0].code, 'missing');
});
test('CSV integra numero nuovo; gestore uscente proviene dalla bolletta', () => {
  const f = fixture('Energia'); f.csv = { rows: [{ punto: f.contract.pod_pdr, fiscale: f.customer.cf_piva, numero: 'PC001' }] };
  const result = Core.evaluate(f);
  assert.equal(result.esito, 'controllato');
  assert.deepEqual(result.patch, { numero_contratto_energia: 'PC001', ex_fornitore: 'Gestore esempio' });
  f.contract.numero_contratto_energia = 'OTHER';
  assert.equal(Core.evaluate(f).esito, 'da_verificare');
});
test('Energia attende il CSV per la data firma; poi esige una data effettivamente documentata', () => {
  const f = fixture('Energia'); f.signingDate = null;
  assert.equal(Core.evaluate(f).esito, 'in_attesa_csv');
  f.csv = { rows: [{ punto: f.contract.pod_pdr, fiscale: f.customer.cf_piva, numero: 'PC001' }] };
  assert.equal(Core.evaluate(f).esito, 'da_verificare');
  f.csv.rows[0].data_firma = '2026-10-26';
  assert.equal(Core.evaluate(f).esito, 'controllato');
});
test('due proposte sulla stessa fornitura o fiscale discordante sono problemi, non attesa CSV', () => {
  const f = fixture('Energia');
  f.csv = { rows: ['PC1', 'PC2'].map(numero => ({ punto: f.contract.pod_pdr, fiscale: f.customer.cf_piva, numero })) };
  assert.equal(Core.evaluate(f).esito, 'da_verificare');
  f.contract.numero_contratto_energia = 'PC2';
  assert.equal(Core.evaluate(f).esito, 'controllato');
  f.contract.numero_contratto_energia = null;
  f.csv.rows = [{ punto: f.contract.pod_pdr, fiscale: '01234567890', numero: 'PC1' }];
  assert.equal(Core.evaluate(f).esito, 'da_verificare');
});
test('Energia problemi documentali hanno precedenza su CSV assente; prime due pagine effettive', () => {
  const f = fixture('Energia'); get(f, 'bill').seconda_pagina = evidence(false);
  assert.equal(Core.evaluate(f).esito, 'da_verificare');
  assert.equal(Core.evaluate(f).waiting.length, 1);
  get(f, 'bill').seconda_pagina = evidence(true); f.documents.find(d => d.id === 'bill').pages = 1;
  assert.equal(Core.evaluate(f).esito, 'da_verificare');
});
test('Reload notifica solo CB con scelta Disattivazione cliente e flag coerente', () => {
  const f = fixture(); Object.assign(f.contract, { smartphone_reload: true, smartphone_reload_modalita: 'Disattivazione cliente' });
  assert.equal(Core.evaluate(f).notify_reload, true);
  f.contract.smartphone_reload_modalita = 'Mantenere attivo';
  assert.equal(Core.evaluate(f).notify_reload, false);
  f.contract.smartphone_reload_modalita = 'Disattivazione cliente'; f.contract.categoria_snapshot = 'Mobile';
  assert.equal(Core.evaluate(f).notify_reload, false);
});
test('primo turno alle21 italiane segue ora solare/legale, domeniche e confine', () => {
  assert.equal(Core.firstDue('2026-10-27T12:00:00Z'), '2026-10-27T20:00:00.000Z');
  assert.equal(Core.firstDue('2026-07-20T12:00:00Z'), '2026-07-20T19:00:00.000Z');
  assert.equal(Core.firstDue('2026-10-27T20:00:00Z'), '2026-10-28T20:00:00.000Z');
  assert.equal(Core.firstDue('2026-10-25T01:30:00Z'), '2026-10-25T20:00:00.000Z');
});
test('CSV conserva zeri, multilinea e virgolette senza formule o conversioni numeriche', () => {
  const text = '\uFEFFCodice Fiscale;Partita Iva;Proposta di Contratto;PDR;Note\r\n;1234567890;0000123;00123456789012;"test;\ncon ""virgolette"""';
  assert.deepEqual(parseCsv(text), [{ fiscale: '01234567890', numero: '0000123', punto: '00123456789012', riga: 2, data_firma: null }]);
});
test('CSV rifiuta file parziale, colonne duplicate e fonte senza POD/PDR', () => {
  for (const text of ['a;a\n1;2', 'Codice Fiscale;Partita Iva;Proposta di Contratto\na;;PC', 'a;b\n"non chiuso', 'a;b\n1;2;3', 'a;b\n"valore"x;2']) assert.throws(() => parseCsv(text));
});
test('CSV non sceglie silenziosamente tra più proposte e conserva due punti indipendenti', () => {
  const rows = parseCsv('Codice Fiscale;Partita Iva;Proposta di Contratto;POD;PDR\nRSSMRA80A01H501U;;PC001;IT001E12345678;00123456789012');
  assert.equal(rows.length, 2); assert.equal(Core.csvMatch(rows, 'RSSMRA80A01H501U', '00123456789012').numero, 'PC001');
});
test('CSV riconosce soltanto una colonna esplicita data firma, non una data commerciale', () => {
  const csv = 'Codice Fiscale;Partita Iva;Proposta di Contratto;PDR;Data sottoscrizione\nRSSMRA80A01H501U;;PC1;00123456789012;26/10/2026';
  assert.equal(parseCsv(csv)[0].data_firma, '2026-10-26');
  assert.equal(parseCsv(csv.replace('Data sottoscrizione', 'Data esportazione'))[0].data_firma, null);
});
test('dati categoria e punti incompleti non vengono approvati dal worker', () => {
  const c = { categoria_snapshot: 'Assicurazioni', modalita_pagamento_assicurazione: 'RID', ricorrenza_assicurazione: 'Annuale' };
  assert.ok(Worker.categoryErrors(c).some(e => e.message.includes('punteggi')));
  const invalid = { ...c, modalita_pagamento_assicurazione: null };
  assert.ok(Worker.categoryErrors(invalid).some(e => e.message.includes('pagamento')));
});
test('API richiede autenticazione e configurazione admin prima di mutare o accodare', async () => {
  const res = await api({ httpMethod: 'POST', body: '{}' }, { requireAuth: async () => ({ ok: false, status: 401, error: 'no' }) });
  assert.equal(res.statusCode, 401);
  const db = { from(table) { assert.equal(table, 'vendita_verifica_config'); const q = { select() { return q; }, eq() { return q; }, async single() { return { data: { modalita: 'collaudo' } }; } }; return q; } };
  const auth = async () => ({ ok: true, profilo: { id: ID, ruolo: 'operatore' } });
  for (const action of ['configure', 'upload_csv']) {
    const r = await api({ httpMethod: 'POST', body: JSON.stringify({ action, modalita: 'attiva' }) }, { db, requireAuth: auth });
    assert.equal(r.statusCode, 403);
  }
});
test('worker HMAC separato dagli altri agenti, scadenza e manipolazione protetti', () => {
  const previous = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-secret';
  try {
    const body = JSON.stringify({ ts: 1000000 }); const signature = Worker.sign(body);
    assert.equal(Worker.verify(body, signature, 1000001), true);
    assert.equal(Worker.verify(body, signature, 1060001), false);
    assert.equal(Worker.verify(body + ' ', signature, 1000001), false);
    assert.equal(Worker.verify(body, 'wrong', 1000001), false);
  } finally { if (previous === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previous; }
});
test('email distingue destinatari, escape contenuti e nessun invio WhatsApp', () => {
  const job = { tipo: 'problemi', destinatario: 'mirko.piasenti@mail.com', contratto_id: ID, payload: { cliente: '<script>', motivi: [{ message: '<img onerror=x>' }] } };
  const mail = Worker.email(job);
  assert.equal(mail.to, 'mirko.piasenti@mail.com'); assert.ok(mail.html.includes('&lt;script&gt;')); assert.ok(!mail.html.includes('<img'));
  assert.ok(mail.html.includes('contratto_id=' + ID));
  assert.ok(Worker.email({ ...job, tipo: 'reload', destinatario: 'info@konatech.it' }).html.includes('ricorda di scrivere'));
  assert.equal(Worker.email({ ...job, tipo: 'reload', destinatario: 'info@konatech.it' }).to, 'mirko.piasenti@gmail.com');
  const cloud = Worker.email({ ...job, tipo: 'professional_cloud', destinatario: 'mirko.piasenti@gmail.com' });
  assert.equal(cloud.to, 'mirko.piasenti@gmail.com');
  assert.equal(cloud.subject, 'Mirox CRM: promemoria WhatsApp Professional Cloud');
  assert.match(cloud.html, /Richiedi disattivazione per Professional Cloud/);
  assert.match(cloud.html, /ricorda di scrivere il promemoria al cliente su WhatsApp/);
  assert.match(cloud.html, /&lt;script&gt;/);
  assert.ok(!cloud.html.includes('<img') && !cloud.html.includes('Smartphone Reload'));
  assert.throws(() => Worker.email({ ...job, tipo: 'sconosciuto' }), /tipo_notifica/);
});

function notificationFixture({ mode = 'attiva', contract = {}, review = {}, state = 'in_coda', emailCollaudo = false, preview = false, type = 'professional_cloud' } = {}) {
  const job = { id: ID, contratto_id: ID, tipo: 'professional_cloud', destinatario: 'mirko.piasenti@gmail.com',
    stato: state, tentativi: 0, prossimo_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', payload: { cliente: 'Cliente esempio' } };
  Object.assign(job, { tipo: type, payload: preview ? { ...job.payload, modalita: 'collaudo', email_collaudo_at: '2026-10-28T10:00:00Z', revision: 2, motivi: [{ message: 'Documento scaduto' }] } : job.payload });
  const tables = { vendita_verifica_config: [{ id: true, modalita: mode, email_collaudo: emailCollaudo, email_collaudo_at: '2026-10-28T10:00:00Z' }], vendita_verifica_notifiche: [job],
    vendita_contratti: [{ id: ID, stato_controllo: 'controllato', categoria_snapshot: 'Mobile', cluster_cliente: 'Business',
      professional_cloud: true, professional_cloud_gestione: 'Richiedi disattivazione', ...contract }],
    vendita_verifiche: [{ contratto_id: ID, esito: 'controllato', stato_job: 'fermo', ...review }] };
  let queued = 0;
  const db = { async rpc(name) { assert.equal(name, 'vendita_verifica_accoda_email_collaudo'); queued++; return { data: null }; }, from(table) {
    assert.ok(Object.hasOwn(tables, table), table);
    const filters = []; let patch;
    const execute = () => {
      const rows = tables[table].filter(row => filters.every(f => f(row)));
      if (patch) for (const row of rows) Object.assign(row, patch);
      return { data: structuredClone(rows) };
    };
    const q = { select() { return q; }, update(value) { patch = value; return q; },
      eq(key, value) { filters.push(row => key === 'payload->>modalita' ? row.payload?.modalita === value : row[key] === value); return q; },
      lt(key, value) { filters.push(row => row[key] < value); return q; },
      lte(key, value) { filters.push(row => row[key] <= value); return q; },
      order() { return q; }, limit() { return q; },
      async single() { return { data: execute().data[0] }; }, async maybeSingle() { return { data: execute().data[0] || null }; },
      then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); } };
    return q;
  } };
  return { db, job, queued: () => queued };
}

test('email collaudo: abilitate solo esplicitamente, escludono la coda automatica e mantengono dedupe', async () => {
  for (const preview of [false, true]) {
    const { db, job, queued } = notificationFixture({ mode: 'collaudo', emailCollaudo: true, preview });
    let count = 0;
    await Worker.notifications(db, { sendEmail: async () => { count++; return { ok: true }; } });
    assert.equal(queued(), 1); assert.equal(count, preview ? 1 : 0);
    assert.equal(job.stato, preview ? 'inviata' : 'in_coda');
    await Worker.notifications(db, { sendEmail: async () => assert.fail('Duplicato') });
  }
});
test('problemi in collaudo: risultato attuale necessario, contratto e stato di verifica restano simulati', async () => {
  for (const revision of [2, 3]) {
    const { db, job } = notificationFixture({ mode: 'collaudo', emailCollaudo: true, preview: true, type: 'problemi',
      contract: { stato_controllo: 'da_controllare' }, review: { esito: 'da_controllare', stato_job: 'in_coda', revisione: revision,
        risultato: { esito: 'da_verificare', errors: [{ message: 'Documento scaduto' }] } } });
    let sent = 0; await Worker.notifications(db, { sendEmail: async () => { sent++; return { ok: true }; } });
    assert.equal(sent, revision === 2 ? 1 : 0); assert.equal(job.stato, revision === 2 ? 'inviata' : 'superata');
  }
});
test('Reload in collaudo: Gmail solo dopo conferma attuale Customer Base', async () => {
  for(const category of ['Customer Base','Mobile']){
    const {db,job}=notificationFixture({mode:'collaudo',emailCollaudo:true,preview:true,type:'reload',contract:{categoria_snapshot:category,smartphone_reload:true,smartphone_reload_modalita:'Disattivazione cliente'}});
    const sent=[];await Worker.notifications(db,{sendEmail:async mail=>{sent.push(mail);return {ok:true};}});
    assert.equal(sent.length,category==='Customer Base'?1:0);if(sent.length)assert.equal(sent[0].to,'mirko.piasenti@gmail.com');
    assert.equal(job.stato,category==='Customer Base'?'inviata':'superata');
  }
});

test('promemoria Cloud invia solo dopo verifica positiva e annulla le scelte superate', async () => {
  for (const scenario of [
    { contract: { categoria_snapshot: 'Mobile' }, send: true },
    { contract: { categoria_snapshot: 'Fisso' }, send: true },
    { contract: { professional_cloud_gestione: 'Mantieni attiva' } },
    { contract: { professional_cloud: false, professional_cloud_gestione: null } },
    { contract: { professional_cloud: null, professional_cloud_gestione: null } },
    { contract: { professional_cloud_gestione: null } },
    { contract: { cluster_cliente: 'Consumer' } },
    { contract: { categoria_snapshot: 'Customer Base' } },
    { contract: { stato_controllo: 'da_controllare' } },
    { review: { esito: 'da_verificare' } },
    { review: { stato_job: 'in_corso' } }
  ]) {
    const { db, job } = notificationFixture(scenario); const sent = [];
    await Worker.notifications(db, { sendEmail: async mail => { sent.push(mail); return { ok: true }; } });
    assert.equal(sent.length, scenario.send ? 1 : 0, JSON.stringify(scenario));
    assert.equal(job.stato, scenario.send ? 'inviata' : 'superata');
    await Worker.notifications(db, { sendEmail: async () => { assert.fail('invio duplicato'); } });
  }
});

test('promemoria Cloud: collaudo e spenta senza invii; SMTP ambiguo resta incerto, rifiuto temporaneo ritenta', async () => {
  for (const mode of ['collaudo', 'spenta']) {
    const { db, job } = notificationFixture({ mode });
    await Worker.notifications(db, { sendEmail: async () => { assert.fail('invio in modalita non attiva'); } });
    assert.equal(job.stato, 'in_coda'); assert.equal(job.tentativi, 0);
  }
  for (const [outcome, expected] of [[{ ok: false }, 'incerta'], [{ ok: false, rejected: true }, 'in_coda'],
    [{ ok: false, rejected: true, permanent: true }, 'fallita']]) {
    const { db, job } = notificationFixture();
    await Worker.notifications(db, { sendEmail: async () => outcome });
    assert.equal(job.stato, expected); assert.equal(job.tentativi, 1);
    await Worker.notifications(db, { sendEmail: async () => { assert.fail('retry prematuro o ambiguo'); } });
  }
  const { db, job } = notificationFixture({ state: 'in_corso' });
  await Worker.notifications(db, { sendEmail: async () => { assert.fail('invio incerto duplicato'); } });
  assert.equal(job.stato, 'incerta');
});
test('lettura AI incompleta o risposta fuori schema non produce un esito', async () => {
  const doc = { id: 'x', tipo_documento: 'copia_sim_mnp', pages: 1 };
  const client = stop_reason => ({ messages: { create: async () => ({ stop_reason, content: [{ type: 'tool_use', name: 'trascrivi_documento', input: { fields: { iccid: null } } }] }) } });
  await assert.rejects(Docs.extractDocument(doc, Buffer.from('pdf'), { client: client('max_tokens'), pdfText: async () => '' }), /incompleta/);
  await assert.rejects(Docs.extractDocument(doc, Buffer.from('pdf'), { client: client('end_turn'), pdfText: async () => '' }), /non_valida/);
  const result = await Docs.extractDocument(doc, Buffer.from('pdf'), { client: client('tool_use'), pdfText: async () => '' });
  assert.equal(result.id, 'x');
});
test('worker scarta un esito se il CSV cambia prima del commit', async () => {
  const snapshot = { contract: { id: ID, categoria_snapshot: 'Energia', anagrafica_id: ID, pratica_id: ID, stato_controllo: 'da_controllare', updated_at: '2026-10-27T12:00:00Z' },
    customer: { id: ID }, practice: { id: ID, stato_pratica: 'inviata' }, documents: [], documentRules: [] };
  let completed = false, requeued = false;
  const db = { async rpc(name) { if (name === 'vendita_verifica_claim') return { data: [{ contratto_id: ID, lock_token: ID, revisione: 1, tentativi: 1 }] }; completed = true; return { data: true }; },
    from(table) { const q = { select() { return q; }, eq() { return q; }, order() { return q; }, limit() { return q; },
      update(patch) { requeued = patch.stato_job === 'in_coda'; return q; },
      async single() { return q.maybeSingle(); }, async maybeSingle() { return { data: table === 'vendita_contratti' ? snapshot.contract : table === 'anagrafica' ? snapshot.customer : table === 'vendita_pratiche' ? snapshot.practice : table === 'vendita_verifica_csv' ? { id: 'new' } : null }; },
      then(resolve) { return Promise.resolve({ data: [] }).then(resolve); } }; return q; } };
  const result = await Worker.processOne(db, { id: ID, test: true }, { analyze: async () => ({ snapshot, result: { esito: 'controllato' }, proofs: [], fingerprint: Docs.fingerprint(snapshot), csvId: 'old' }) });
  assert.equal(result.stale, true); assert.equal(completed, false); assert.equal(requeued, true);
});
test('download documenti fallito è bloccante e non diventa fascicolo vuoto', async () => {
  const snapshot = { documents: [{ id: ID, tipo_documento: 'documento_identita', storage_bucket: 'contratti-vendita', storage_path: 'example/documento.pdf' }] };
  await assert.rejects(Docs.readDocuments({ storage: { from() { return { download: async () => ({ error: new Error('offline') }) }; } } }, snapshot), /verifica_database/);
});
test('ispezione PDF reale conta le pagine; limite e file non PDF sono bloccanti', async () => {
  const { PDFDocument } = require('pdf-lib');
  const pdf = await PDFDocument.create(); pdf.addPage(); pdf.addPage();
  assert.equal(await Docs.pdfInfo(Buffer.from(await pdf.save())), 2);
  await assert.rejects(Docs.pdfInfo(Buffer.from('test non PDF')), /non_valido/);
});
test('cache riusa solo stesso contenuto e versione; collaudo forza una nuova lettura', async () => {
  let reads = 0, writes = 0, cache = null;
  const bytes = Buffer.from('%PDF-fixture');
  const db = { storage: { from() { return { download: async () => ({ data: new Blob([bytes]) }) }; } }, from() {
    const q = { select() { return q; }, eq() { return q; }, async maybeSingle() { return { data: cache ? { lettura: cache } : null }; },
      async upsert(row) { writes++; cache = row.lettura; return { data: null }; } }; return q;
  } };
  const snapshot = { documents: [{ id: ID, tipo_documento: 'documento_identita', storage_bucket: 'contratti-vendita', storage_path: 'fixture.pdf' }] };
  const deps = { pdfInfo: async () => 1, extract: async () => { reads++; return { id: ID, fields: {} }; } };
  await Docs.readDocuments(db, snapshot, deps); await Docs.readDocuments(db, snapshot, deps);
  assert.equal(reads, 1); assert.equal(writes, 1);
  await Docs.readDocuments(db, snapshot, { ...deps, forceRead: true });
  assert.equal(reads, 2);
});
test('UI mostra dati AI e problemi come testo escaped e collaudo separato dalla conferma', () => {
  const source = fs.readFileSync(require.resolve('../js/verifica-contratti-automatica.js'), 'utf8');
  assert.doesNotThrow(() => new vm.Script(source));
  assert.ok(source.includes('e(m.message)')); assert.ok(source.includes('Collauda questo contratto'));
});
