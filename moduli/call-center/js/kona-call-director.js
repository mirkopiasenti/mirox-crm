/* KONA Call Director — pagina operatrice (Call Center). */
(function (root) {
  'use strict';

  var API_BASE = '/.netlify/functions/';
  var TASK = API_BASE + 'kona-call-director-task';
  var STATUS = API_BASE + 'kona-call-director-status';
  var DIALOG = API_BASE + 'kona-call-director-dialog';
  var PLAN = API_BASE + 'kona-call-director-plan';

  var _profilo = null;
  var _stato = null;
  var _task = null;
  var _slots = [];

  var ESITI_PER_TIPO = {
    conferma_appuntamento_business: [
      { esito: 'confermato', label: 'Confermato' },
      { esito: 'non_risposto', label: 'Non risposto' },
      { esito: 'annullato', label: 'Annullato' },
      { esito: 'da_riprogrammare', label: 'Da riprogrammare' }
    ],
    ricontatto_programmato: ESITI_CHIAMATA(),
    auto_non_risposto: ESITI_CHIAMATA(),
    passa_a_cerea: ESITI_CHIAMATA(),
    passa_in_negozio: ESITI_CHIAMATA(),
    campagna_urgente: ESITI_LEAD(),
    sessione_business: ESITI_LEAD(),
    enrichment_review: [
      { esito: 'verificato', label: 'Verificato' },
      { esito: 'non_trovato', label: 'Non trovato' },
      { esito: 'altro', label: 'Altro' }
    ]
  };

  function ESITI_CHIAMATA() {
    return [
      { esito: 'non_risposto', label: 'Non risposto' },
      { esito: 'non_interessato', label: 'Non interessato' },
      { esito: 'ricontattare', label: 'Ricontattare' },
      { esito: 'appuntamento', label: 'Appuntamento' },
      { esito: 'passa_in_negozio', label: 'Passa in negozio' },
      { esito: 'passa_a_cerea', label: 'Passa a Cerea' }
    ];
  }

  function ESITI_LEAD() {
    return [
      { esito: 'non_risposto', label: 'Non risposto' },
      { esito: 'non_interessato', label: 'Non interessato' },
      { esito: 'appuntamento', label: 'Appuntamento' },
      { esito: 'passa_in_negozio', label: 'Passa in negozio' },
      { esito: 'ricontattare', label: 'Ricontattare' },
      { esito: 'chiuso', label: 'Chiudi' },
      { esito: 'altro', label: 'Altro' }
    ];
  }

  var SKIP_REASONS = [
    { value: 'dato_errato', label: 'Dato errato' },
    { value: 'numero_non_utilizzabile', label: 'Numero non utilizzabile' },
    { value: 'cliente_momentaneamente_indisponibile', label: 'Cliente momentaneamente indisponibile' },
    { value: 'duplicato', label: 'Duplicato' },
    { value: 'possibile_cliente_gia_acquisito', label: 'Possibile cliente gia' + ' acquisito' },
    { value: 'trattative_gia_in_corso', label: 'Trattative gia' + ' in corso' },
    { value: 'problema_tecnico', label: 'Problema tecnico' },
    { value: 'altro', label: 'Altro' }
  ];

  function esc(str) {
    return root.MiroxSafe ? root.MiroxSafe.escapeHtml(String(str === undefined || str === null ? '' : str)) : String(str || '');
  }

  function num(n) {
    var v = Number(n);
    return Number.isFinite(v) ? v : 0;
  }

  function jsonBody(opts) {
    return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts) };
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = String(text === undefined || text === null ? '' : text);
  }

  function show(elId) {
    var el = document.getElementById(elId);
    if (el) el.classList.remove('hidden');
  }

  function hide(elId) {
    var el = document.getElementById(elId);
    if (el) el.classList.add('hidden');
  }

  function toast(message) {
    if (root.MiroxUI && typeof root.MiroxUI.toast === 'function') root.MiroxUI.toast(message, 'info');
  }

  async function apiFetch(endpoint, opts) {
    var response = await root.MiroxApi.fetch(endpoint, opts);
    var result = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(result.error || ('Errore ' + response.status));
    return result;
  }

  // -- Boot -------------------------------------------------------------------

  async function boot() {
    var profilo = await Auth.richiediAuth();
    if (!profilo) return;
    _profilo = profilo;
    if (root.CcHeader) root.CcHeader.render('kona_call_director', profilo);
    try {
      await caricaStato();
    } catch (e) {
      mostraErrore(e.message);
    }
  }

  async function caricaStato() {
    var res = await apiFetch(STATUS, { method: 'GET' });
    _stato = res;
    if (!res.abilitato) {
      hide('konaArea');
      setText('konaMotivo', motivazione(res.motivo));
      show('konaNonAbilitato');
      return;
    }
    show('konaArea');
    var badge = document.getElementById('konaStatoBadge');
    if (badge) {
      badge.textContent = _stato.modalita_osservazione ? 'Osservazione' : 'Attivo';
      badge.className = 'badge ' + (_stato.modalita_osservazione ? 'badge-warning' : 'badge-success');
    }
    setText('konaBudget', _stato.budget ? 'Budget ' + _stato.budget.mese + ': ' + num(_stato.budget.speso).toFixed(2) + ' / ' + num(_stato.budget.budget).toFixed(2) + ' euro' : '');
    setText('konaOggi', 'Task oggi: ' + (_stato.oggi ? _stato.oggi.task_totali : 0) + ' | Conferme: ' + (_stato.oggi ? _stato.oggi.conferme_totali : 0));
    await caricaAttivo();
  }

  function motivazione(reason) {
    if (reason === 'enabled_env_off' || reason === 'global_off') return 'KONA Call Director e\' disattivato.';
    if (reason === 'profilo_inattivo') return 'Il tuo profilo non e\' attivo.';
    return 'Il tuo profilo non e\' abilitato a KONA Call Director.';
  }

  // -- Task -------------------------------------------------------------------

  async function caricaAttivo() {
    try {
      var res = await apiFetch(TASK, jsonBody({ action: 'attivo' }));
      _task = res.task || null;
      renderTask();
    } catch (e) {
      toast(e.message);
    }
  }

  async function prossimo() {
    var btn = document.getElementById('btnProssimo');
    if (btn) btn.disabled = true;
    try {
      var res = await apiFetch(TASK, jsonBody({ action: 'prossimo' }));
      _task = res.task || null;
      renderTask();
      if (!_task) toast('Nessun contatto disponibile al momento.');
    } catch (e) {
      toast(e.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function renderTask() {
    var card = document.getElementById('konaTaskCard');
    if (!_task) {
      card.classList.add('hidden');
      return;
    }
    card.classList.remove('hidden');

    var t = _task.task || {};
    var c = _task.contatto || {};
    setText('konaTaskTipo', labelTipo(t.tipo));
    setText('konaTaskDesc', t.descrizione || '');
    setText('konaTaskTentativi', 'Tentativi persistenti: ' + (t.tentativi || 0));

    var nome = c.nome || 'Contatto';
    var dettagli = [];
    if (c.cellulare) dettagli.push('Tel: ' + esc(c.cellulare));
    if (c.telefoni && c.telefoni.length > 1) dettagli.push('Altri numeri: ' + esc(c.telefoni.slice(1).join(', ')));
    if (c.email) dettagli.push('Email: ' + esc(c.email));
    if (c.localita) dettagli.push('Localita: ' + esc(c.localita));
    if (c.provincia) dettagli.push('Provincia: ' + esc(c.provincia));
    if (c.categoria) dettagli.push('Categoria: ' + esc(c.categoria));
    if (c.zona) dettagli.push('Zona: ' + esc(c.zona));
    if (c.cf_piva) dettagli.push('CF/P.IVA: ' + esc(c.cf_piva));
    document.getElementById('konaTaskNome').textContent = esc(nome);
    document.getElementById('konaTaskDettagli').textContent = dettagli.join(' | ');

    // Storico / ultima nota / motivo (senza script telefonici).
    var storico = [];
    if (c.motivo) storico.push('Motivo: ' + c.motivo);
    if (c.esito_precedente) storico.push('Esito precedente: ' + c.esito_precedente);
    if (c.note) storico.push('Ultima nota: ' + c.note);
    if (c.storico) {
      if (c.storico.esito) storico.push('Stato lead: ' + c.storico.esito);
      if (c.storico.ultimo_contatto_at) storico.push('Ultimo contatto: ' + new Date(c.storico.ultimo_contatto_at).toLocaleString('it-IT'));
      if (c.storico.data_ora) storico.push('Data ultima: ' + new Date(c.storico.data_ora).toLocaleString('it-IT'));
    }
    if (c.appuntamento && c.appuntamento.data_ora) {
      storico.push('Appuntamento: ' + new Date(c.appuntamento.data_ora).toLocaleString('it-IT') + ' (' + (c.appuntamento.durata_minuti || 45) + ' min, stato ' + (c.appuntamento.stato || '?') + ')');
    }
    setText('konaTaskStorico', storico.join('\n'));
    show('konaTaskStoricoBox');

    window._konaDialogoLeadId = (c.sorgente === 'lead' || c.sorgente === 'lead_outbound_chiamata') ? (t.payload && t.payload.lead_id) || null : null;
    setText('konaKonaLead', window._konaDialogoLeadId ? 'Lead Business: ' + esc(nome) : 'Suggerimento KONA (nessun lead collegato)');

    // Esiti
    var esiti = ESITI_PER_TIPO[t.tipo] || [];
    var box = document.getElementById('konaEsiti');
    box.textContent = '';
    esiti.forEach(function (e) {
      var b = document.createElement('button');
      b.className = 'btn btn-primary btn-sm';
      b.textContent = e.label;
      b.style.marginRight = '6px';
      b.onclick = function () { inviaEsito(e.esito); };
      box.appendChild(b);
    });

    // Azioni Calendar per i task conferma (solo dati propri).
    var cal = document.getElementById('konaCalActions');
    if (t.tipo === 'conferma_appuntamento_business' && c.appuntamento) {
      cal.style.display = 'flex';
      cal.setAttribute('data-app-id', t.payload && t.payload.appuntamento_business_id || '');
    } else {
      cal.style.display = 'none';
    }

    var skip = document.getElementById('btnSkip');
    if (skip) skip.style.display = 'inline-flex';
    var black = document.getElementById('btnBlacklist');
    if (black) black.style.display = 'inline-flex';
  }

  function labelTipo(tipo) {
    var labels = {
      conferma_appuntamento_business: 'Conferma appuntamento Business',
      ricontatto_programmato: 'Ricontatto programmato',
      auto_non_risposto: 'Non risposto automatico',
      passa_a_cerea: 'Passa a Cerea',
      passa_in_negozio: 'Passa in negozio',
      campagna_urgente: 'Campagna urgente',
      sessione_business: 'Sessione Business',
      enrichment_review: 'Verifica arricchimento'
    };
    return labels[tipo] || tipo;
  }

  // -- Esiti ------------------------------------------------------------------

  async function inviaEsito(esito) {
    if (esito === 'altro') {
      apriSkip(true);
      return;
    }
    await confermaEsito({ action: 'esito', esito: esito });
  }

  async function confermaEsito(body) {
    try {
      var res = await apiFetch(TASK, jsonBody(body));
      if (res.esito && res.esito.tentativi_esauriti) toast('Tentativi esauriti per questo contatto.');
      _task = null;
      renderTask();
      await prossimo();
    } catch (e) {
      toast(e.message);
    }
  }

  function apriSkip(preSelezionaAltro) {
    var sel = document.getElementById('skipReason');
    sel.textContent = '';
    SKIP_REASONS.forEach(function (r) {
      var opt = document.createElement('option');
      opt.value = r.value;
      opt.textContent = r.label;
      sel.appendChild(opt);
    });
    if (preSelezionaAltro) sel.value = 'altro';
    document.getElementById('skipSpiegazioneInput').value = '';
    show('modalSkip');
    toggleSpiegazioneSkip();
  }

  function chiudiSkip() {
    hide('modalSkip');
  }

  function toggleSpiegazioneSkip() {
    var sel = document.getElementById('skipReason');
    var box = document.getElementById('skipSpiegazioneBox');
    if (box) box.style.display = sel.value === 'altro' ? 'block' : 'none';
  }

  // Per "Altro", l'IA puo' contestare/chiedere chiarimenti UNA volta; la
  // decisione finale resta all'operatrice.
  async function confermaSkip() {
    var sel = document.getElementById('skipReason');
    var spiegazione = document.getElementById('skipSpiegazioneInput').value || '';
    if (sel.value === 'altro' && !spiegazione.trim()) {
      toast('La spiegazione e\' obbligatoria per "Altro".');
      return;
    }
    var motivo = '';
    if (sel.value === 'altro') {
      try {
        var valutazione = await apiFetch(DIALOG, jsonBody({ action: 'valuta_altro', spiegazione: spiegazione, tipo_contatto: taskTipoContatto() }));
        if (valutazione.valutazione) {
          motivo = valutazione.valutazione.motivo || '';
          var suggerimento = valutazione.valutazione.esito === 'procedi' ? 'Procedi con l\'esclusione.' : valutazione.valutazione.esito === 'richiedi_dettaglio' ? 'Chiedi ulteriori dettagli all\'operatrice.' : 'Verifica manuale necessaria.';
          if (root.MiroxUI && typeof root.MiroxUI.confirm === 'function') {
            var ok = await root.MiroxUI.confirm('Valutazione KONA: ' + suggerimento + ' Vuoi procedere con l\'esclusione?');
            if (!ok) return;
          }
        }
      } catch (e) {
        toast('Valutazione non disponibile: ' + e.message);
      }
    }
    hide('modalSkip');
    await confermaEsito({ action: 'esito', esito: 'skip', skip_reason: sel.value, spiegazione: spiegazione, motivo: motivo });
  }

  function taskTipoContatto() {
    var c = (_task && _task.contatto) || {};
    return (c.sorgente === 'lead' || c.sorgente === 'lead_outbound_chiamata') ? 'business' : 'standard';
  }

  async function segnalaBlacklist() {
    if (!root.MiroxUI || typeof root.MiroxUI.confirm !== 'function') {
      await confermaEsito({ action: 'esito', esito: 'blacklist' });
      return;
    }
    var ok = await root.MiroxUI.confirm('Segnalare questo contatto nella blacklist reale? Non sara' + ' piu\' proposto.');
    if (!ok) return;
    await confermaEsito({ action: 'esito', esito: 'blacklist' });
  }

  // -- KONA (suggerimento) ----------------------------------------------------

  async function suggerisci() {
    var input = document.getElementById('konaKonaInput');
    var testo = (input.value || '').trim();
    var leadId = window._konaDialogoLeadId || null;
    var box = document.getElementById('konaKonaOut');
    box.textContent = '...';
    try {
      var res = await apiFetch(DIALOG, jsonBody({ action: 'messaggio', lead_id: leadId, messaggio_operatore: testo }));
      box.textContent = res.suggerimento ? res.suggerimento : 'Suggerimento non disponibile.';
    } catch (e) {
      box.textContent = e.message;
    }
  }

  // -- Azioni Calendar --------------------------------------------------------

  async function caricaSlot() {
    var leadId = window._konaDialogoLeadId;
    if (!leadId) { toast('Nessun lead collegato.'); return; }
    var box = document.getElementById('konaSlotOut');
    box.textContent = 'Ricerca slot...';
    try {
      var res = await apiFetch(DIALOG, jsonBody({ action: 'cerca_slot', lead_id: leadId }));
      _slots = res.slots || [];
      if (!_slots.length) { box.textContent = 'Nessuna fascia libera (Calendar obbligatorio).'; return; }
      box.textContent = '';
      _slots.slice(0, 12).forEach(function (slot) {
        var b = document.createElement('button');
        b.className = 'btn btn-secondary btn-sm';
        b.style.margin = '4px';
        b.textContent = new Date(slot.start).toLocaleString('it-IT', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        b.onclick = function () { proponiSlot(slot); };
        box.appendChild(b);
      });
    } catch (e) {
      box.textContent = e.message;
    }
  }

  async function proponiSlot(slot) {
    var leadId = window._konaDialogoLeadId;
    try {
      var res = await apiFetch(DIALOG, jsonBody({ action: 'proponi_appuntamento', lead_id: leadId, start: slot.start, durata_minuti: 45 }));
      toast('Appuntamento proposto e sincronizzato con il calendario.');
      await caricaAttivo();
    } catch (e) {
      toast(e.message);
    }
  }

  async function azioneAppuntamento(action, appId) {
    if (!appId) { toast('Appuntamento non identificato.'); return; }
    try {
      if (action === 'annulla' && root.MiroxUI && typeof root.MiroxUI.confirm === 'function') {
        var ok = await root.MiroxUI.confirm('Annullare l\'appuntamento (evento Google incluso)?');
        if (!ok) return;
      }
      await apiFetch(DIALOG, jsonBody({ action: action + '_appuntamento', appuntamento_business_id: appId }));
      toast('Operazione completata.');
      await caricaAttivo();
    } catch (e) {
      toast(e.message);
    }
  }

  // -- Consumer manuale (#15) --------------------------------------------------

  async function selezionaModalitaConsumer(mode) {
    var current = _stato && _stato.consumer_modalita;
    if (current === mode) { toast('Modalita' + ' gia' + ' attiva.'); return; }
    try {
      await apiFetch(TASK, jsonBody({ action: 'sessione', tipo: 'mattina', categoria: mode }));
      toast('Modalita' + ' Consumer: ' + (mode === 'telefoni_omaggio' ? 'Telefoni omaggio' : 'Fibra/FWA'));
      await caricaStato();
    } catch (e) {
      toast(e.message);
    }
  }

  // -- Piano ------------------------------------------------------------------

  async function mostraPiano() {
    var box = document.getElementById('konaPianoOut');
    box.textContent = '...';
    try {
      var res = await apiFetch(PLAN, jsonBody({ action: 'piano' }));
      var p = res.piano && res.piano.contenuto;
      if (!p) {
        box.textContent = 'Nessun piano persistito. Avvia "/piano" su Telegram o usa la pianificazione del dispatcher.';
        return;
      }
      var righe = (p.perZona || []).map(function (z) {
        return z.zona + ': ' + z.n + ' appuntamenti (' + z.finestra.da + '-' + z.finestra.a + ')';
      });
      box.textContent = 'Piano ' + res.data + '\n' + righe.join('\n') + (p.suggerimento ? '\n\n' + p.suggerimento : '');
    } catch (e) {
      box.textContent = e.message;
    }
  }

  function mostraErrore(message) {
    setText('konaMotivo', message);
    show('konaNonAbilitato');
  }

  // -- Init -------------------------------------------------------------------

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  root.KonaCD = {
    apriSkip: apriSkip,
    azioneAppuntamento: azioneAppuntamento,
    boot: boot,
    caricaAttivo: caricaAttivo,
    caricaSlot: caricaSlot,
    chiudiSkip: chiudiSkip,
    confermaSkip: confermaSkip,
    inviaEsito: inviaEsito,
    mostraPiano: mostraPiano,
    prossimo: prossimo,
    segnalaBlacklist: segnalaBlacklist,
    selezionaModalitaConsumer: selezionaModalitaConsumer,
    suggerisci: suggerisci,
    toggleSpiegazioneSkip: toggleSpiegazioneSkip
  };
})(window);
