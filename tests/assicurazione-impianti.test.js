'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Pda = require('../js/vendita-pda-core');
const Energia = require('../js/energia-core');
const pdr = '00123456789012';
const { normalizeContractInput, validateAssicurazioneImpianti } = require('../netlify/functions/crea-vendita-pratica-carrello')._test;
const source = fs.readFileSync(path.join(__dirname, '../moduli/upload-contratti-vendita.html'), 'utf8');
const isCategory = (a, b) => String(a).toLowerCase() === b.toLowerCase();
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a);
  return source.slice(a, b);
}

test('API distingue Sì e No e rifiuta risposta assente, ambigua o su altre categorie', () => {
  for (const value of [true, false]) {
    const normalized = normalizeContractInput({ categoria_id: 'cat', offerta_id: 'offer', assicurazione_impianti: value }, 0);
    assert.equal(validateAssicurazioneImpianti(normalized, 'Energia'), value);
  }
  for (const value of [undefined, null, '', 'false', 'true', 0, 1, {}, []]) {
    assert.throws(() => validateAssicurazioneImpianti({ assicurazione_impianti: value }, 'Energia'), /Sì oppure No/);
  }
  for (const category of ['Mobile', 'Fisso', 'Assicurazioni', 'Allarmi', 'Customer Base']) {
    assert.equal(validateAssicurazioneImpianti({}, category), null);
    for (const value of [true, false]) assert.throws(() => validateAssicurazioneImpianti({ assicurazione_impianti: value }, category), /solo per Luce e Gas/);
  }
});

function popupFixture() {
  let modal;
  const ctx = { window: { MiroxUI: { _build(options) {
    const callbacks = {};
    modal = { options, foot: { querySelector: selector => ({ addEventListener(type, fn) { callbacks[selector] = fn; } }) },
      close() { options.onClose(); }, choose(selector) { callbacks[selector](); } };
    return modal;
  } } } };
  vm.runInNewContext(section(' function chiediAssicurazioneImpianti()', ' // Popup custom per contratti Fisso'), ctx);
  return { ask: ctx.chiediAssicurazioneImpianti, modal: () => modal };
}
test('popup: Sì=true, No=false, chiusura senza risposta=null', async () => {
  for (const [button, expected] of [['[data-impianti-si]', true], ['[data-impianti-no]', false], [null, null]]) {
    const f = popupFixture(), result = f.ask();
    assert.match(f.modal().options.bodyHtml, /È stata attivata/);
    if (button) f.modal().choose(button); else f.modal().close();
    assert.equal(await result, expected);
  }
});

function nextFixture(category = 'Energia') {
  const refs = { btnContrattoNext: { disabled: false, addEventListener(type, fn) { this.click = fn; } }, numeroContrattoEnergia: { dataset: {} }, podPdr: { value: pdr } };
  let resolve, asks = 0, saves = 0;
  const steps = [], ctx = { refs, window: { MiroxEnergia: Energia }, runtimeState: { pdaRevision: 1, assicurazioneImpianti: null },
    getCategoriaName: () => category, isCategory, isCurrentCategoriaPda: () => false,
    collectContractDraft: () => ({ pod_pdr: pdr }), chiediConfermaPuntoEnergia: () => pdr,
    checkEnergyPoint: async () => {},
    chiediAssicurazioneImpianti() { asks++; return new Promise(r => { resolve = r; }); },
    queueDraftSave() { saves++; }, goToStep: n => steps.push(n), showUserError: msg => assert.fail(msg) };
  vm.runInNewContext(section(" refs.btnContrattoNext.addEventListener('click', async () => {", ' function chiediConfermaPuntoEnergia'), ctx);
  return { ctx, refs, steps, answer: v => resolve(v), asks: () => asks, saves: () => saves };
}
test('Avanti attende una scelta, blocca doppi click e conserva anche No', async () => {
  for (const answer of [true, false, null]) {
    const f = nextFixture(), pending = f.refs.btnContrattoNext.click();
    await f.refs.btnContrattoNext.click();
    await new Promise(setImmediate);
    assert.equal(f.asks(), 1); assert.deepEqual(f.steps, []);
    f.answer(answer); await pending;
    assert.equal(f.ctx.runtimeState.assicurazioneImpianti, answer);
    assert.deepEqual(f.steps, answer === null ? [] : [4]);
    assert.equal(f.saves(), answer === null ? 0 : 1);
    assert.equal(f.refs.btnContrattoNext.disabled, false);
  }
});
test('risposta tardiva non modifica un nuovo contratto e le altre categorie non aprono il popup', async () => {
  const f = nextFixture(), pending = f.refs.btnContrattoNext.click();
  await new Promise(setImmediate);
  f.ctx.runtimeState.pdaRevision++; f.answer(true); await pending;
  assert.equal(f.ctx.runtimeState.assicurazioneImpianti, null); assert.deepEqual(f.steps, []);
  const other = nextFixture('Allarmi'); await other.refs.btnContrattoNext.click();
  assert.equal(other.asks(), 0); assert.deepEqual(other.steps, [4]);
});

test('Avanti non apre gli allegati se il riscontro del POD/PDR viene annullato', async () => {
  const f = nextFixture();
  f.ctx.chiediConfermaPuntoEnergia = () => null;
  await f.refs.btnContrattoNext.click();
  assert.equal(f.ctx.runtimeState.puntoEnergiaConfermato, null);
  assert.equal(f.asks(), 0);
  assert.deepEqual(f.steps, []);
});

test('Avanti blocca una fornitura già caricata prima di chiedere l’assicurazione o i PDF', async () => {
  const f = nextFixture();
  const messages = [];
  f.ctx.checkEnergyPoint = async point => {
    assert.equal(point, pdr);
    throw new Error('È già stata caricata una pratica oggi');
  };
  f.ctx.showUserError = message => messages.push(message);
  await f.refs.btnContrattoNext.click();
  assert.match(messages[0], /già stata caricata/);
  assert.equal(f.ctx.runtimeState.puntoEnergiaConfermato, null);
  assert.equal(f.asks(), 0);
  assert.deepEqual(f.steps, []);
});

test('popup POD/PDR mostra il valore, respinge una differenza e accetta una nuova digitazione', async () => {
  const buttons = new Map();
  const input = { value: '', events: {}, addEventListener(type, cb) { this.events[type] = cb; }, focus() {},
    setAttribute(key, value) { this[key] = value; }, removeAttribute(key) { delete this[key]; } };
  const error = { textContent: '' };
  const ctx = { escapeHtml: x => x, window: { MiroxEnergia: Energia, MiroxUI: { _build(options) {
    assert.match(options.title, /PDR/);
    assert.match(options.bodyHtml, new RegExp(pdr));
    assert.match(options.bodyHtml, /Confrontalo con la bolletta/);
    return { body: { querySelector: selector => selector === '#confermaPuntoEnergia' ? input : error },
      foot: { querySelector: selector => ({ addEventListener: (_type, callback) => buttons.set(selector, callback) }) },
      close() { options.onClose(); } };
  } } } };
  vm.runInNewContext(section(' function chiediConfermaPuntoEnergia', ' // Chiudere il popup'), ctx);
  const pending = ctx.chiediConfermaPuntoEnergia(pdr);
  input.value = '00123456789013';
  buttons.get('[data-punto-conferma]')();
  assert.match(error.textContent, /non coincidono/);
  assert.equal(input['aria-invalid'], 'true');
  input.value = '00 123456789012';
  input.events.input();
  input.events.keydown({ key: 'Enter', preventDefault() {} });
  assert.equal(await pending, pdr);
});

function payload(items, cluster, identityFiles = [{}]) {
  const ctx = { window: { MiroxEnergia: Energia, MiroxFisso:require('../js/fisso-core'),MiroxFissoUI:{form:()=>'',bind(){},read:()=>({})},MiroxPda: Pda, MiroxIdentitaCore: require('../js/identita-upload-core'),
    MiroxIdentitaUpload: { get: () => ({ token: 'fixture', result: {} }) } },
    state: { cart: { contratti: items } }, getClienteFormData: () => ({ cluster }), validateClienteData() {},
    praticaFiles: { documento_identita: identityFiles }, runtimeState: {},
    refs: { originePratica: { value: 'spontaneo' }, operatoreId: { value: 'operator' } }, CODICE_RIVENDITORE_DEFAULT: '9001415852' };
  vm.runInNewContext(section(' function isEnergyCartItem(', ' async function inviaPratica()'), ctx);
  return ctx.buildInvioPayload();
}
const item = value => ({ temp_id: 'temp', categoria_nome: 'Energia', categoria_id: 'cat', offerta_id: 'offer',
  assicurazione_impianti: value, pod_pdr: pdr, pod_pdr_conferma: pdr, flags: {}, files: { bolletta: [{}] } });
const pod = 'IT001E12345678';
test('carrello misto e payload Consumer/Business preservano risposte opposte per singolo contratto', () => {
  for (const cluster of ['Consumer', 'Business']) {
    const dto = payload([item(true), { ...item(false), pod_pdr: pod, pod_pdr_conferma: pod }, { ...item(undefined), categoria_nome: 'Assicurazioni' }], cluster);
    assert.deepEqual(Array.from(dto.contratti, c => c.assicurazione_impianti), [true, false, null]);
    for (const raw of dto.contratti) {
      const normalized = normalizeContractInput(raw, 0);
      assert.equal(normalized.assicurazione_impianti, raw.assicurazione_impianti);
    }
    assert.throws(() => payload([item(undefined)], cluster), /Modifica il contratto/);
    assert.equal(dto.contratti[0].pod_pdr_conferma, pdr);
    assert.throws(() => payload([{ ...item(false), pod_pdr_conferma: null }], cluster), /conferma il POD\/PDR/);
  }
});

test('carrello Energia invia soltanto la bolletta e richiede un punto distinto per contratto', () => {
  assert.equal(payload([item(false)], 'Consumer', []).pratica.identita_token, null);
  assert.throws(() => payload([{ ...item(false), files: {} }], 'Business', []), /bolletta mancante/);
  assert.throws(() => payload([item(true), item(false)], 'Consumer', []), /già stata caricata/);
  assert.throws(() => payload([item(false), { ...item(undefined), categoria_nome: 'Assicurazioni' }], 'Consumer', []), /Documento di riconoscimento mancante/);
});

test('bozza, riapertura carrello e nuovo contratto conservano No senza ereditarlo', () => {
  const field = () => ({ value: '', dataset: {}, classList: { add() {} } });
  const refs = new Proxy({}, { get(target, key) { return target[key] ||= field(); } });
  const ctx = { refs, window: { MiroxEnergia: Energia }, runtimeState: { assicurazioneImpianti: false }, readPdaFields: () => ({}),
    renderPdaFields() {}, renderOfferte() {}, renderOpzioni() {}, renderReload() {}, renderDynamicSections() {},
    renderCategorieCards() {}, renderCategoriaActions() {}, clearInputFile() {}, updateUploadVisibility() {},
    CODICE_RIVENDITORE_DEFAULT: '9001415852' };
  vm.runInNewContext(section(' function getContractFormDraft()', ' function serializeDraftState()') +
    section(' function restoreContractFormDraft(', ' function restoreDraftState(') +
    section(' function resetContractFields()', ' function resetFullPracticeForm()'), ctx);
  const draft = JSON.parse(JSON.stringify(ctx.getContractFormDraft()));
  ctx.runtimeState.assicurazioneImpianti = true; ctx.restoreContractFormDraft(draft);
  assert.equal(ctx.runtimeState.assicurazioneImpianti, false);
  ctx.resetContractFields(); assert.equal(ctx.runtimeState.assicurazioneImpianti, null);
  ctx.restoreContractFormDraft({}); assert.equal(ctx.runtimeState.assicurazioneImpianti, null);
  Object.assign(ctx, { state: { categorie: [] }, praticaFiles: {}, TIPI_FIRMA: [], setInputFiles() {}, setInputFile() {},
    renderFirmaSelection() {}, updateStep3ActionsLabels() {} });
  vm.runInNewContext(section(' function loadCartContractInForm(item)', ' window.editCartContract ='), ctx);
  ctx.loadCartContractInForm(item(false)); assert.equal(ctx.runtimeState.assicurazioneImpianti, false);
  assert.equal(ctx.getContractFormDraft().pod_pdr_conferma, pdr);
  ctx.resetContractFields(); assert.equal(ctx.runtimeState.assicurazioneImpianti, null);
  assert.equal(ctx.runtimeState.puntoEnergiaConfermato, null);
});

test('handler respinge Energia senza risposta prima di scrivere pratica, anagrafica o file', async () => {
  const filename = path.join(__dirname, '../netlify/functions/crea-vendita-pratica-carrello.js');
  const module = { exports: {} }, nativeRequire = require('node:module').createRequire(filename);
  let duplicateChecks = 0;
  const db = {
    from(table) { assert.equal(table, 'vendita_categorie'); return { select() { return this; }, async in() { return { data: [{ id: 'cat', nome: 'Energia' }] }; } }; },
    async rpc(name, args) {
      assert.equal(name, 'vendita_energia_punto_caricato_oggi');
      assert.deepEqual(Array.from(args.p_punti), [pdr]);
      duplicateChecks++;
      return { data: true };
    }
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, Buffer, Date, Intl,
    console: { log() {}, warn() {}, error() {} }, process: { env: { SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test' } },
    require(name) {
      if (name === '@supabase/supabase-js') return { createClient: () => db };
      if (name === './_lib/require-auth') return { requireAuth: async () => ({ ok: true, profilo: { id: '11111111-1111-4111-8111-111111111111', ruolo: 'operatore' } }) };
      return nativeRequire(name);
    } });
  const submit = contract => module.exports.handler({ httpMethod: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    cliente: { cf_piva: 'RSSMRA80A01H501U', ragione_sociale: 'Test', cluster: 'Consumer', cellulare: '3331234567', email: 'test@example.invalid' },
    contratti: [{ categoria_id: 'cat', offerta_id: 'offer', ...contract }] }) });
  const result = await submit({});
  assert.equal(result.statusCode, 400); assert.match(JSON.parse(result.body).error, /assicurazione impianti/);
  const mismatch = await submit({ assicurazione_impianti: false, pod_pdr: pdr, pod_pdr_conferma: '00123456789013' });
  assert.equal(mismatch.statusCode, 400); assert.match(JSON.parse(mismatch.body).error, /Conferma il POD\/PDR/);
  assert.equal(duplicateChecks, 0);
  const duplicate = await submit({ assicurazione_impianti: false, pod_pdr: pdr, pod_pdr_conferma: pdr });
  assert.equal(duplicate.statusCode, 409, duplicate.body);
  assert.equal(JSON.parse(duplicate.body).error_code, 'punto_energia_duplicato');
  assert.equal(duplicateChecks, 1);
});
