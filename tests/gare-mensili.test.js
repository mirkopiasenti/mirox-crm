'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../js/dashboard-report-core');
const root = path.resolve(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'database/configura_gare_2026_10.sql'), 'utf8');
const telefonoConfig = fs.readFileSync(path.join(root, 'database/configura_cambi_piano_telefono.sql'), 'utf8');
const config = tag => JSON.parse(sql.split('$' + tag + '$')[1]);
const cb = config('cb'), tied = config('tied'), insurance = config('assicurazioni');
insurance.gara.operatori = ['francesca', 'matteo', 'mirko'];
const metrica = { id: 3, nome: 'TELEFONI CB', tipo_conteggio: 'individuale', tipo_compenso: 'individuale',
  regola: cb.condizioni[0].regola, descrizione: '100 EUR a 50 pezzi' };
const row = rule => ({ obiettivo: rule === insurance ? 10 : 35, compenso_regola: rule });
const contract = patch => ({ operatore_id: 'matteo', codice_rivenditore: core.LEGNAGO,
  categoria_snapshot: 'Customer Base', cluster_cliente: 'Consumer', nome_offerta_snapshot: 'Telefono Incluso',
  dispositivo_associato: true, tipo_acquisto: 'VAR', stato_inserimento: 'nuovo', ...patch });
const phone = patch => contract(patch);
const change = patch => contract({ nome_offerta_snapshot: 'Cambio Piano - TIED', dispositivo_associato: false, ...patch });
const production = (phones, changes) => [
  ...Array.from({ length: phones }, (_, i) => phone({ tipo_acquisto: i % 2 ? 'VAR' : 'Finanziamento' })),
  ...Array.from({ length: changes }, (_, i) => change(i % 2 ? { cluster_cliente: 'Business', nome_offerta_snapshot: 'Cambio Piano - MOBILE' } : {}))
];
const evaluate = contracts => core.valutaGara(metrica, row(cb), contracts, 'matteo');
const assicurazione = patch => contract({ categoria_snapshot: 'Assicurazioni', punteggio_gara_totale: 1, ...patch });
const insuranceMetric = { tipo_conteggio: 'individuale', regola: { categoria: 'Assicurazioni' } };
const cambiPianoConTelefono = JSON.parse(telefonoConfig.split('$regola$')[1]);

test('Avanzamento separa CAMBI PIANO tra telefoni e fissi, con pezzi Legnago e senza cambiare le altre righe', () => {
  const definition = fs.readFileSync(path.join(root, 'database/configura_avanzamento_cambi_piano.sql'), 'utf8');
  const cambi = { id: 100, ordine: 35, ...JSON.parse(definition.split('$metrica$')[1]) };
  assert.deepEqual(cambi.regola, cb.condizioni[1].regola);
  const telefoni = { ...metrica, tabella: 'avanzamento_standard', ordine: 30 };
  const fissi = { id: 12, nome: 'FISSI', tabella: 'avanzamento_standard', ordine: 40, regola: { categoria: 'Fisso' } };
  const state = { anno: 2026, mese: 10, metricheGara: [telefoni, fissi], obiettivi: [],
    operatoriAttiviMese: [{ id: 'matteo' }, { id: 'francesca' }], resolveOperatore: id => id === 'alias' ? 'francesca' : id,
    statoPostVendita: { fisso: new Map(), energia: new Map(), allarmi: new Map() }, tecnologiaFisso: new Map(),
    contrattiMese: [phone(), change(), change({ cluster_cliente: 'Business', nome_offerta_snapshot: 'Cambio Piano - MOBILE', punteggio_gara_totale: 0 }),
      change({ operatore_id: 'alias' }), change({ nome_offerta_snapshot: 'Cambio Piano - UNTIED' }),
      change({ codice_rivenditore: '9000822241' }), change({ stato_inserimento: 'reinserimento' })] };
  const before = core.monthlyRows(state, '2026-10-06');
  state.metricheGara = [telefoni, cambi, fissi];
  const after = core.monthlyRows(state, '2026-10-06');
  assert.deepEqual(after.map(r => r.nome), ['TELEFONI CB', 'CAMBI PIANO', 'FISSI']);
  assert.deepEqual(after.filter(r => r.id !== cambi.id), before);
  const row = after[1];
  assert.deepEqual(row.conteggi, [2, 1]);
  assert.equal(row.attuale, 3);
  assert.equal(row.punteggio, 3);
  assert.equal(row.obiettivo, 0);
});

test('CB richiede entrambe le soglie, senza compensazioni tra telefoni e cambi piano', () => {
  for (const [phones, changes, euro] of [[35, 15, 100], [34, 100, 0], [100, 14, 0], [0, 50, 0], [70, 30, 100]]) {
    const result = evaluate(production(phones, changes));
    assert.equal(result.euro, euro);
    assert.deepEqual(result.componenti.map(c => [c.attuale, c.obiettivo]), [[phones, 35], [changes, 15]]);
  }
});
test('CB include solo telefoni Consumer con dispositivo VAR/Finanziamento e cambi TIED Consumer/MOBILE Business', () => {
  const invalidi = [phone({ dispositivo_associato: false }), phone({ tipo_acquisto: 'Contanti' }),
    phone({ cluster_cliente: 'Business' }), change({ nome_offerta_snapshot: 'Cambio Piano - UNTIED' }),
    change({ nome_offerta_snapshot: 'CB Caring - MOBILE' }), change({ nome_offerta_snapshot: 'Cambio Piano Fisso' }),
    change({ cluster_cliente: 'Business', nome_offerta_snapshot: 'Cambio Piano - FISSO' }),
    change({ cluster_cliente: 'Turista' })];
  assert.deepEqual(evaluate(invalidi).componenti.map(c => c.attuale), [0, 0]);
  assert.equal(evaluate(production(35, 15)).euro, 100);
});
test('i cambi piano con telefono entrano in Avanzamento e nel bonus CB, ma solo con tipo e dispositivo coerenti', () => {
  assert.match(telefonoConfig, /nome='CAMBI PIANO'/);
  const validi = [
    change({ nome_offerta_snapshot: 'Cambio Piano + Telefono Finanziato', tipo_acquisto: 'Finanziamento', dispositivo_associato: true }),
    change({ nome_offerta_snapshot: 'Cambio Piano + Telefono VAR', tipo_acquisto: 'VAR', dispositivo_associato: true })
  ];
  const bonusAggiornato = { ...cb, condizioni: [cb.condizioni[0], { ...cb.condizioni[1], regola: cambiPianoConTelefono }] };
  assert.equal(core.calcolaCompenso(0, bonusAggiornato, validi).componenti[1].attuale, 2);
  assert.equal(validi.filter(c => core.matchRegola(c, cambiPianoConTelefono)).length, 2);
  assert.equal(core.matchRegola(validi[0], { ...cambiPianoConTelefono.or[1], tipo_acquisto: 'VAR' }), false);
  assert.equal(core.matchRegola({ ...validi[1], dispositivo_associato: false }, cambiPianoConTelefono), false);
});
test('CB è individuale ed esclude reinserimenti; le gare personali continuano a includere entrambi i negozi', () => {
  const result = evaluate([...production(35, 15).map(c => ({ ...c, codice_rivenditore: '9000822241' })),
    ...production(10, 10).map(c => ({ ...c, operatore_id: 'francesca' })),
    ...production(10, 10).map(c => ({ ...c, stato_inserimento: 'reinserimento' }))]);
  assert.deepEqual(result.componenti.map(c => c.attuale), [35, 15]);
  assert.equal(result.euro, 100);
});
test('TIED scatta a 35, resta unico e non cambia la definizione dei contratti', () => {
  const m = { regola: { categoria: 'Mobile', offerta_match: 'fwa\\s*indoor|tied', offerta_not_match: 'untied' } };
  const valid = Array.from({ length: 35 }, () => contract({ categoria_snapshot: 'Mobile', nome_offerta_snapshot: 'TIED' }));
  assert.equal(core.valutaGara(m, row(tied), valid.slice(0, 34), 'matteo').euro, 0);
  assert.equal(core.valutaGara(m, row(tied), valid, 'matteo').euro, 100);
  assert.equal(core.valutaGara(m, row(tied), [...valid, ...valid], 'matteo').euro, 100);
  assert.equal(core.valutaGara(m, row(tied), [contract({ categoria_snapshot: 'Mobile', nome_offerta_snapshot: 'UNTIED' })], 'matteo').attuale, 0);
});
test('Assicurazioni usa 10 punti reali di squadra Legnago e dà 50 EUR a ciascuno', () => {
  const list = [assicurazione({ operatore_id: 'francesca', punteggio_gara_totale: 2.5 }),
    assicurazione({ operatore_id: 'matteo', punteggio_gara_totale: 3 }),
    assicurazione({ operatore_id: 'mirko', punteggio_gara_totale: 4.5 }),
    assicurazione({ operatore_id: 'mirko', codice_rivenditore: '9000822241', punteggio_gara_totale: 100 }),
    assicurazione({ operatore_id: 'cerea', punteggio_gara_totale: 100 }),
    assicurazione({ operatore_id: 'mirko', stato_inserimento: 'reinserimento', punteggio_gara_totale: 100 })];
  for (const id of insurance.gara.operatori) {
    const result = core.valutaGara(insuranceMetric, row(insurance), list, id);
    assert.equal(result.attuale, 10);
    assert.equal(result.euro, 50);
    assert.equal(result.conteggioSquadra, true);
  }
  assert.equal(core.valutaGara(insuranceMetric, row(insurance), list.slice(0, 2), 'matteo').euro, 0);
});
test('gli alias personali e di squadra confluiscono nel canonico', () => {
  const resolve = id => id === 'alias-mirko' ? 'mirko' : id;
  assert.equal(core.valutaGara(insuranceMetric, row(insurance), [assicurazione({ operatore_id: 'alias-mirko', punteggio_gara_totale: 10 })], 'mirko', resolve).euro, 50);
  assert.equal(core.valutaGara(metrica, row(cb), production(35, 15).map(c => ({ ...c, operatore_id: 'alias-mirko' })), 'mirko', resolve).euro, 100);
});
test('settembre conserva soglia 50 telefoni, descrizione e assicurazioni individuali a pezzi', () => {
  const legacy = { obiettivo: 50, compenso_regola: { tipo: 'scaglioni', scaglioni: [{ da: 50, importo: 100, tipo_calcolo: 'flat' }] } };
  const september = core.valutaGara(metrica, legacy, production(35, 15), 'matteo');
  assert.equal(september.attuale, 35);
  assert.equal(september.euro, 0);
  assert.equal(september.descrizione, metrica.descrizione);
  assert.equal(september.componenti, undefined);
  assert.equal(core.valutaGara(metrica, legacy, production(50, 0), 'matteo').euro, 100);
  const insuranceLegacy = core.valutaGara(insuranceMetric, { obiettivo: 15 }, [assicurazione({ punteggio_gara_totale: 10 }), assicurazione({ operatore_id: 'mirko' })], 'matteo');
  assert.equal(insuranceLegacy.attuale, 1);
  assert.equal(insuranceLegacy.conteggioSquadra, false);
});
test('DSL compensi preesistente: scaglioni, flat, massimo, bonus, per pezzo, variabili e decurtazione', () => {
  assert.equal(core.calcolaCompenso(35, { tipo: 'scaglioni', scaglioni: [{ da: 0, a: 20, per_pezzo: 2 }, { da: 20, per_pezzo: 3 }], bonus_soglie: [{ soglia: 35, bonus: 10 }] }).euro, 95);
  assert.equal(core.calcolaCompenso(50, { tipo: 'scaglioni', scaglioni: [{ da: 20, importo: 50, tipo_calcolo: 'flat_max' }, { da: 40, importo: 100, tipo_calcolo: 'flat_max' }] }).euro, 100);
  assert.equal(core.calcolaCompenso(10, { tipo: 'per_pezzo', per_pezzo: 5 }).euro, 50);
  assert.equal(core.calcolaCompenso(10, { tipo: 'per_pezzo_variabile', campo: 'tipo_acquisto', casi: [{ valore: 'VAR', importo: 3 }] }, production(5, 0)).euro, 6);
  assert.deepEqual(core.calcolaCompenso(10, { tipo: 'per_pezzo', per_pezzo: 5, decurtazione_soglia: 20 }), { euro: 0, label: 'DECURTAZIONE' });
});
test('configurazioni combinate malformate non assegnano bonus', () => {
  for (const patch of [{ condizioni: [] }, { condizioni: [{}] }, { importo: '100' }, { importo: -1 },
    { condizioni: [{ nome: 'vuota', soglia: 35, regola: {} }, cb.condizioni[1]] }]) {
    assert.equal(core.calcolaCompenso(100, { ...cb, ...patch }, production(100, 100)).euro, 0);
  }
});

function sourceFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  return source.slice(start, source.indexOf('\n}\n', start) + 2);
}
test('Dashboard renderizza entrambi i progressi CB e la descrizione mensile', () => {
  const source = fs.readFileSync(path.join(root, 'moduli/dashboard_pezzi.html'), 'utf8');
  const wrap = { innerHTML: '', querySelectorAll: () => [] };
  const context = { MiroxDashboardReport: core, escapeHtml: value => String(value), fmtEur: value => String(value),
    MESI: Array(12).fill('Ottobre'), DPState: { anno: 2026, mese: 10, metricheGara: [{ ...metrica, tabella: 'gara_individuale' }],
      operatoriInGara: [{ id: 'matteo', nome: 'Matteo' }], contrattiMese: production(35, 14), resolveOperatore: id => id },
    getObiettivoMese: () => row(cb), document: { getElementById: () => wrap } };
  vm.runInNewContext(sourceFunction(source, 'renderGare') + '\nrenderGare();', context);
  assert.match(wrap.innerHTML, /35 <small>Telefoni CB/);
  assert.match(wrap.innerHTML, /14 <small>Cambi piano TIED/);
  assert.match(wrap.innerHTML, /15 <small>Cambi piano TIED/);
  assert.match(wrap.innerHTML, /data-descrizione="Bonus individuale unico/);
  assert.match(wrap.innerHTML, /compenso-tot">0</);
});
test('editor Admin conserva entrambe le soglie e scope mensile al salvataggio', async () => {
  const source = fs.readFileSync(path.join(root, 'admin-gare.html'), 'utf8');
  for (const rule of [cb, insurance]) {
    let save, patch;
    const context = { State: { metriche: [metrica] }, getObiettivo: () => row(rule), escapeHtml: value => String(value),
      fmtEur: value => String(value), renderGaraIndividuale: () => {}, calcolaCompenso: core.calcolaCompenso,
      document: { getElementById: () => null, querySelectorAll: () => [] },
      upsertObiettivo: async (_id, _op, value) => { patch = value; },
      MiroxUI: { _build: () => ({ close: () => {}, foot: { querySelector: selector => ({ addEventListener: (_name, callback) => { if (selector === '[data-mx-ok]') save = callback; } }) } }), toast: () => {}, alert: message => { throw new Error(message); } } };
    vm.runInNewContext(sourceFunction(source, 'apriEditorScaglioni') + '\napriEditorScaglioni(3,"matteo");', context);
    await save();
    assert.deepEqual(JSON.parse(JSON.stringify(patch.compenso_regola.gara)), rule.gara);
    if (rule === cb) {
      assert.equal(patch.obiettivo, 35);
      assert.deepEqual(JSON.parse(JSON.stringify(patch.compenso_regola.condizioni)), cb.condizioni);
      assert.equal(evaluate(production(35, 14)).euro, 0);
    }
  }
});
