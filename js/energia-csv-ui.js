/* global MiroxApi, MiroxUI */
(function (root) {
  'use strict';

  const LIMIT = 4 * 1024 * 1024;
  const messages = Object.freeze({
    bolletta_assente: 'Allega la bolletta per riscontrare il punto di fornitura.',
    bolletta_illeggibile: 'La bolletta non è leggibile. Aprila e riscontra i dati a mano oppure sostituiscila.',
    bolletta_ambigua: 'Le bollette contengono più punti di fornitura o venditori. Individua i dati della pratica.',
    intestatario_diverso: 'L’intestatario letto sulla bolletta è diverso dal cliente della pratica.',
    fornitore_incerto: 'Il gestore uscente non è stato riconosciuto. Controlla la bolletta.',
    punto_incerto: 'Il POD/PDR non è stato letto con certezza. Controlla la bolletta.',
    cliente_incompleto: 'Controlla il codice fiscale o la partita IVA in anagrafica.',
    csv_assente: 'Carica il CSV WindTre per riscontrare il numero di contratto.',
    csv_non_trovato: 'La fornitura non è presente nell’ultimo CSV caricato.',
    csv_fiscale_diverso: 'Il codice fiscale o la partita IVA per questa fornitura non coincide con i dati del CSV.',
    csv_ambiguo: 'Il CSV contiene più proposte compatibili. Verifica l’export WindTre.',
    errore_lettura: 'La lettura della bolletta ha avuto un errore. Puoi riscontrare i dati a mano.'
  });
  const labels = Object.freeze({
    bolletta_assente: 'Bolletta mancante',
    bolletta_illeggibile: 'Bolletta illeggibile',
    bolletta_ambigua: 'Bolletta da riscontrare',
    intestatario_diverso: 'Intestatario discordante',
    fornitore_incerto: 'Gestore da riscontrare',
    punto_incerto: 'POD/PDR da riscontrare',
    cliente_incompleto: 'Dato fiscale incompleto',
    csv_assente: 'CSV da caricare',
    csv_non_trovato: 'Fornitura assente dal CSV',
    csv_fiscale_diverso: 'Dato fiscale discordante nel CSV',
    csv_ambiguo: 'Proposta da disambiguare',
    errore_lettura: 'Errore di lettura della bolletta'
  });

  async function upload(file) {
    if (file.size > LIMIT) throw new Error('Il CSV WindTre può contenere al massimo 4 MB.');
    const res = await MiroxApi.fetch('/.netlify/functions/gestisci-controllo-lg', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'import_shared_csv', csv: await file.text() })
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || result.success !== true) throw new Error(result.error || 'Caricamento CSV non riuscito. Riprova.');
    return result;
  }

  async function run(file, refresh) {
    const loader = MiroxUI.loading.show('Importazione del CSV WindTre', file.name);
    let result;
    try {
      result = await upload(file);
    } catch (e) {
      loader.error('CSV non importato');
      await MiroxUI.alert(e.message, { type: 'error' });
      return false;
    }
    loader.success('CSV disponibile');
    const message = result.duplicato
      ? 'Questo CSV è già disponibile nei due moduli. Le pratiche Energia in attesa vengono elaborate in coda.'
      : `Controllo Luce e Gas. Esiti aggiornati: ${result.aggiornati}. Esiti manuali protetti: ${result.protetti}. Le pratiche in Verifica Contratti vengono elaborate in coda.`;
    await MiroxUI.alert(message, { title: 'CSV WindTre', type: 'success' });
    await refresh();
    return true;
  }

  root.MiroxEnergiaCsv = { run, messages, labels };
})(typeof globalThis !== 'undefined' ? globalThis : window);
