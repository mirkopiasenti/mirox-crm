/* global MiroxApi, MiroxUI */
(function (root) {
  'use strict';

  const LIMIT = 4 * 1024 * 1024;
  async function upload(file) {
    if (file.size > LIMIT) throw new Error('Il CSV WindTre può contenere al massimo 4 MB.');
    const res = await MiroxApi.fetch('/.netlify/functions/gestisci-controllo-lg', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'import_shared_csv', csv: await file.text() })
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || result.success !== true) throw new Error(result.error || 'Caricamento CSV non riuscito. Riprova.');
    const counts = [result.in_attesa_verifica, result.errore_csv, result.aggiornati, result.protetti];
    if (!counts.every(value => Number.isSafeInteger(value) && value >= 0)) {
      throw new Error('Il server non ha confermato l’esito completo dell’import. Aggiorna la pagina e riprova.');
    }
    return result;
  }

  async function run(file, refresh) {
    const loader = MiroxUI.loading.show('Importazione del CSV WindTre in corso…', file.name);
    let result;
    try {
      result = await upload(file);
    } catch (e) {
      loader.hide();
      await MiroxUI.alert(e.message, { title: 'Importazione CSV', type: 'error' });
      return false;
    }
    loader.setText('Aggiornamento della lista…');
    let refreshed = false;
    try {
      refreshed = await refresh() !== false;
    } catch {
      refreshed = false;
    } finally {
      loader.hide();
    }
    const message = `Verifica Contratti. Numero e tipo pratica compilati: ${result.in_attesa_verifica}. Errori CSV: ${result.errore_csv}.\n`
      + `Controllo Luce e Gas. Esiti aggiornati: ${result.aggiornati}. Esiti manuali protetti: ${result.protetti}.`
      + (refreshed ? '' : '\nPer vedere i dati salvati, ricarica l’elenco con Aggiorna.');
    await MiroxUI.alert(message, { title: 'Importazione CSV completata',
      type: refreshed && result.errore_csv === 0 ? 'success' : 'warning' });
    return true;
  }

  root.MiroxEnergiaCsv = { run };
})(typeof globalThis !== 'undefined' ? globalThis : window);
