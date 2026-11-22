'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require.resolve('../moduli/upload-contratti-vendita.html'), 'utf8');
const start = html.indexOf(' let smartphoneReloadChoiceSequence = 0;');
const end = html.indexOf('\n function hasUnsavedContractFields()', start);
assert.ok(start >= 0 && end > start);

function fixture() {
  const handlers = {};
  const element = value => ({ value, addEventListener: (name, fn) => { handlers[name] = fn; } });
  const refs = {
    smartphoneReload: element('false'), smartphoneReloadModalita: element(''),
    smartphoneReloadChoose: { addEventListener: (_, fn) => { handlers.choose = fn; } },
    dispositivoAssociato: element('true'), offerta: element('offer')
  };
  const runtimeState = { pdaRevision: 1, editingTempId: null };
  const modals = [];
  let saves = 0, indoor = false;
  const context = {
    refs, runtimeState, isFwaIndoor: () => indoor,
    renderDynamicSections: () => { if (refs.smartphoneReload.value !== 'true') refs.smartphoneReloadModalita.value = ''; },
    queueDraftSave: () => { saves++; },
    window: { MiroxUI: { _build(options) {
      const buttons = {};
      const modal = { options, foot: { querySelector: selector => ({ addEventListener: (_, fn) => { buttons[selector] = fn; } }) },
        close: () => options.onClose(), buttons };
      modals.push(modal); return modal;
    } } }
  };
  vm.runInNewContext(html.slice(start, end) + '\nthis.openChoice = chooseSmartphoneReload;', context);
  return { refs, runtimeState, handlers, modals, context, get saves() { return saves; }, setIndoor(value) { indoor = value; } };
}

test('Upload Smartphone Reload: popup, scelta e modifica compilano la modalità', async () => {
  const f = fixture();
  f.refs.smartphoneReload.value = 'true'; f.handlers.change();
  assert.equal(f.modals.length, 1);
  assert.match(f.modals[0].options.bodyHtml, /Smartphone Reload attiva/);
  f.modals[0].buttons['[data-smartphone-stop]']();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.refs.smartphoneReloadModalita.value, 'Disattivazione cliente');
  assert.equal(f.saves, 1);
  const changing = f.handlers.choose();
  f.modals[1].buttons['[data-smartphone-keep]'](); await changing;
  assert.equal(f.refs.smartphoneReloadModalita.value, 'Mantenere attivo');
});

test('Chiusura non sceglie un valore e le risposte tardive non modificano un altro contratto', async () => {
  const f = fixture(); f.refs.smartphoneReload.value = 'true';
  let pending = f.context.openChoice(); f.modals[0].close(); await pending;
  assert.equal(f.refs.smartphoneReloadModalita.value, '');
  pending = f.context.openChoice(); f.runtimeState.pdaRevision++;
  f.modals[1].buttons['[data-smartphone-keep]'](); await pending;
  assert.equal(f.refs.smartphoneReloadModalita.value, '');
  assert.equal(f.saves, 0);
  f.setIndoor(true); await f.context.openChoice(); assert.equal(f.modals.length, 2);
});

test('OCR applica Smartphone Reload e richiede la decisione quando il dispositivo è visibile', () => {
  const ocrStart = html.indexOf(' function maybeApplyOcrDevice() {');
  const ocrEnd = html.indexOf('\n // ===== EVENT HANDLERS =====', ocrStart);
  const field = () => ({ value: '', disabled: false, classList: { contains: () => false, remove() {}, toggle() {} } });
  const refs = Object.fromEntries(['deviceSection','dispositivoAssociato','imei','tipoAcquisto','fasciaPrezzo',
    'fieldImei','fieldFasciaPrezzo','fieldTipoAcquisto','fieldFinanziaria','fieldKolme',
    'smartphoneReload','smartphoneReloadModalita','fieldSmartphoneReload','fieldSmartphoneReloadModalita'].map(key => [key, field()]));
  const runtimeState = { lastOcrData: { dispositivo_presente: true, smartphone_reload: true }, ocrDeviceApplied: false };
  let opens = 0;
  const context = { refs, runtimeState, document: { getElementById: () => ({ dataset: {} }) },
    isFwaIndoor: () => false, chooseSmartphoneReload: () => { opens++; }, window: {}, queueDraftSave() {}, updateScorePreview() {} };
  vm.runInNewContext(html.slice(ocrStart, ocrEnd) + '\nmaybeApplyOcrDevice();', context);
  assert.equal(refs.smartphoneReload.value, 'true');
  assert.equal(opens, 1);
  assert.equal(runtimeState.ocrDeviceApplied, true);
  assert.match(html, /Smartphone Reload = Si: seleziona la modalita/);
  assert.match(html, /id="smartphone_reload_modalita" hidden/);
});
