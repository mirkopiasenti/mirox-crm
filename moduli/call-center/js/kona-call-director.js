/* KONA Call Director — pagina operatore (Call Center).
 *
 * Macchina a stati esplicita: una sola schermata visibile alla volta.
 *   welcome -> briefing -> contact -> outcome -> (followup | calendar) -> transition -> ...
 * Lo stato server (task, sessione, piano, esiti) e' la fonte di verita':
 * il frontend non simula completamenti. Idempotente su Avvia / Avvia chiamate /
 * Prossimo / esito.
 */
(function (root) {
  'use strict';

  var API_BASE = '/.netlify/functions/';
  var TASK = API_BASE + 'kona-call-director-task';
  var STATUS = API_BASE + 'kona-call-director-status';
  var DIALOG = API_BASE + 'kona-call-director-dialog';
  var OPERATOR = API_BASE + 'kona-call-director-operator';

  var _profilo = null;
  var _stato = null;
  var _task = null;
  var _prevFamiglia = null;
  var _esiti = [];
  var _pendingEsito = null;
  var _followupMode = null;
  var _slots = [];
  var _days = [];
  var _selectedDay = null;
  var _selectedSlot = null;
  var _riprogrammaAppId = null;
  var _ricontattoAssegnato = null;
  var _negozioSlot = [];
  var _negozioDay = null;
  var _negozioSelected = null;
  var _salvataggioInCorso = false;
  var _consumer = null;
  var _pausa = false;
  var _ricercaMode = 'inbound';

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

  var TITOLI_TIPO = {
    conferma_appuntamento_business: 'Conferma appuntamento Business',
    ricontatto_programmato: 'Ricontatto programmato',
    auto_non_risposto: 'Cliente non risposto da riprovare',
    passa_a_cerea: 'Controllo Passa a Cerea',
    passa_in_negozio: 'Controllo Passa in negozio',
    campagna_urgente: 'Campagna urgente',
    sessione_business: 'Nuovo lead Business',
    enrichment_review: 'Verifica arricchimento'
  };

  var ESITI_CONSUMER = [
    { esito: 'non_risposto', label: 'Non risposto' },
    { esito: 'non_interessato', label: 'Non interessato' },
    { esito: 'passa_in_negozio', label: 'Passa in negozio' },
    { esito: 'ricontattare', label: 'Ricontattare' },
    { esito: 'passa_a_cerea', label: 'Passa a Cerea' },
    { esito: 'appuntamento', label: 'Appuntamento' },
  ];

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

  function toast(message, kind) {
    if (root.MiroxUI && typeof root.MiroxUI.toast === 'function') root.MiroxUI.toast(message, kind || 'info');
  }

  async function apiFetch(endpoint, opts) {
    var response = await root.MiroxApi.fetch(endpoint, opts);
    var result = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      var error = new Error(result.error || ('Errore ' + response.status));
      error.code = result.error_code || result.reason || null;
      error.payload = result;
      throw error;
    }
    return result;
  }

  // -- Macchina a stati -------------------------------------------------------

  function go(screen) {
    document.querySelectorAll('.kona-screen').forEach(function (s) {
      s.classList.toggle('active', s.getAttribute('data-screen') === screen);
    });
    aggiornaAvanzamento(screen);
    window.scrollTo(0, 0);
  }

  function aggiornaAvanzamento(screen) {
    var index = ['welcome', 'briefing'].indexOf(screen) !== -1 ? 1
      : ['contact', 'consumer'].indexOf(screen) !== -1 ? 2
        : ['outcome', 'followup', 'calendar', 'negozio'].indexOf(screen) !== -1 ? 3
          : ['transition', 'completed'].indexOf(screen) !== -1 ? 4 : 1;
    for (var i = 1; i <= 4; i += 1) {
      var el = document.getElementById('konaProgress' + i);
      if (el) el.className = i < index ? 'done' : i === index ? 'current' : '';
    }
    var labels = {
      welcome: ['KONA e\' pronto', 'Avvia la giornata quando sei pronta.'],
      briefing: ['Briefing della giornata', 'Controlla il piano preparato per oggi.'],
      contact: ['Prossimo contatto', 'Ti mostro una sola lavorazione alla volta.'],
      consumer: ['Acquisizione Consumer', 'Cerchiamo o censiamo il cliente senza uscire da KONA.'],
      outcome: ['Registrazione esito', 'Salvo il risultato nel Call Center condiviso.'],
      calendar: ['Calendario Business', 'Mostro soltanto le disponibilita\' reali del calendario collegato.'],
      negozio: ['Calendario negozio', 'Scegli uno slot Consumer disponibile.'],
      completed: ['Giornata completata', 'Le attivita\' registrate sono gia\' visibili nel sistema manuale.']
    };
    var copy = labels[screen] || ['KONA Call Director', 'Sto gestendo il flusso operativo.'];
    setText('konaAgentStatus', copy[0]);
    setText('konaAgentHint', copy[1]);
  }

  function mostraErrore(message) {
    setText('konaErrorTesto', message);
    go('error');
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
    var badge = document.getElementById('konaStatoBadge');
    if (badge) {
      badge.textContent = _stato.modalita_osservazione ? 'Osservazione' : 'Attivo';
      badge.className = 'badge ' + (_stato.modalita_osservazione ? 'badge-warning' : 'badge-success');
    }
    if (!res.abilitato) {
      setText('konaMotivo', motivazione(res.motivo));
      go('non_abilitato');
      return;
    }
    setText('konaBudgetWelcome', _stato.budget ? 'Budget ' + _stato.budget.mese + ': ' + num(_stato.budget.speso).toFixed(2) + ' / ' + num(_stato.budget.budget).toFixed(2) + ' euro' : '');
    // Se esiste gia' un task lavorabile il pulsante diventa "Riprendi".
    var attivo = await apiFetch(TASK, jsonBody({ action: 'attivo' }));
    _task = attivo.task || null;
    document.getElementById('btnAvvia').textContent = _task ? 'Riprendi' : 'Avvia';
    go('welcome');
    renderWelcome();
  }

  function motivazione(reason) {
    if (reason === 'enabled_env_off' || reason === 'global_off') return 'KONA Call Director e\' disattivato.';
    if (reason === 'profilo_inattivo') return 'Il tuo profilo non e\' attivo.';
    return 'Il tuo profilo non e\' abilitato a KONA Call Director.';
  }

  function renderWelcome() {
    var saluto = _stato.saluto || 'Buongiorno';
    var nome = _stato.nome || '';
    setText('konaSaluto', saluto + (nome ? ', ' + nome : ''));
    setText('konaIntro', 'KONA prepara la giornata e ti accompagna un contatto alla volta, senza far scegliere a te cosa lavorare.');
  }

  // -- Welcome / briefing -----------------------------------------------------

  async function avvia() {
    // Idempotente: non crea sessioni ne' task duplicati.
    try {
      // Se esiste gia' un task attivo, "Riprendi" recupera quello stato.
      var attivo = await apiFetch(TASK, jsonBody({ action: 'attivo' }));
      if (attivo.task) {
        _task = attivo.task;
        go('contact');
        renderContact();
        return;
      }
      var res = await apiFetch(STATUS, { method: 'GET' });
      _stato = res;
      renderBriefing();
      go('briefing');
    } catch (e) {
      mostraErrore(e.message);
    }
  }

  function renderBriefing() {
    var b = _stato.briefing || {};
    setText('konaBriefingTitolo', 'Programma della giornata');
    setText('konaBriefingSottotitolo', 'KONA sceglie da solo cosa lavorare: qui vedi il piano dell\'intera giornata.');

    var aggiungiRiga = function (list, etichetta, conteggio, extraLabel) {
      var li = document.createElement('li');
      var span = document.createElement('span');
      span.textContent = etichetta;
      var badge = document.createElement('span');
      badge.className = 'kona-badge';
      badge.textContent = extraLabel || conteggio;
      li.appendChild(span);
      li.appendChild(badge);
      list.appendChild(li);
    };

    var list = document.getElementById('konaBriefingList');
    list.textContent = '';

    // Sezione MATTINA
    var mattinaHead = document.createElement('li');
    mattinaHead.textContent = 'MATTINA';
    mattinaHead.style.fontWeight = '700';
    mattinaHead.style.borderBottom = 'none';
    mattinaHead.style.paddingBottom = '0';
    list.appendChild(mattinaHead);
    var nMattina = 0;
    (b.mattina || []).forEach(function (a) { aggiungiRiga(list, a.etichetta, a.conteggio); nMattina += a.conteggio; });
    if (b.business && b.business.conteggio > 0) { aggiungiRiga(list, b.business.etichetta, b.business.conteggio); nMattina += b.business.conteggio; }
    if (b.consumer) { aggiungiRiga(list, b.consumer.etichetta, 'manuale'); }
    if (nMattina === 0 && !b.consumer && !(b.business && b.business.conteggio > 0)) {
      var liMattinaVuota = document.createElement('li');
      liMattinaVuota.textContent = 'Nessuna attivita' + ' prevista.';
      liMattinaVuota.style.color = 'var(--text-secondary)';
      list.appendChild(liMattinaVuota);
    }

    // Sezione POMERIGGIO
    var pomHead = document.createElement('li');
    pomHead.textContent = 'POMERIGGIO';
    pomHead.style.fontWeight = '700';
    pomHead.style.borderBottom = 'none';
    pomHead.style.paddingBottom = '0';
    pomHead.style.marginTop = '8px';
    list.appendChild(pomHead);
    var nPom = 0;
    (b.pomeriggio || []).forEach(function (a) { aggiungiRiga(list, a.etichetta, a.conteggio); nPom += a.conteggio; });
    if (b.business && b.business.conteggio > 0) { aggiungiRiga(list, b.business.etichetta, b.business.conteggio); nPom += b.business.conteggio; }
    if (b.consumer) { aggiungiRiga(list, b.consumer.etichetta, 'manuale'); }
    if (nPom === 0 && !b.consumer && !(b.business && b.business.conteggio > 0)) {
      var liPomVuota = document.createElement('li');
      liPomVuota.textContent = 'Nessuna attivita' + ' prevista.';
      liPomVuota.style.color = 'var(--text-secondary)';
      list.appendChild(liPomVuota);
    }
  }

  async function avviaChiamate() {
    // Idempotente: `prossimo` restituisce il task attivo se gia' presente.
    try {
      var res = await apiFetch(TASK, jsonBody({ action: 'prossimo' }));
      _task = res.task || null;
      if (_task) {
        go('contact');
        renderContact();
      } else {
        vaiAllaFaseSuccessiva(res.motivo);
      }
    } catch (e) {
      mostraErrore(e.message);
    }
  }

  // Decide la fase successiva quando non ci sono piu' task materializzabili.
  function vaiAllaFaseSuccessiva(motivo) {
    var consumer = _stato && _stato.briefing && _stato.briefing.consumer;
    if (consumer) {
      _pendingTransition = { prossima: 'consumer' };
      renderTransition();
      go('transition');
      return;
    }
    setText('konaCompletedTesto', 'Hai terminato le attivita' + ' previste. KONA e' + ' disponibile per eventuali nuove lavorazioni.');
    go('completed');
  }

  // -- Contact ----------------------------------------------------------------

  function renderContact() {
    var t = _task && _task.task ? _task.task : {};
    var c = _task && _task.contatto ? _task.contatto : {};
    setText('konaTaskTipo', TITOLI_TIPO[t.tipo] || t.descrizione || 'Contatto');
    setText('konaTaskNome', c.nome || 'Contatto');
    var dettagli = [];
    if (c.cellulare) dettagli.push('Telefono: ' + c.cellulare);
    if (c.telefoni && c.telefoni.length > 1) dettagli.push('Altri numeri: ' + c.telefoni.slice(1).join(', '));
    if (c.localita) dettagli.push('Comune: ' + c.localita);
    if (c.provincia) dettagli.push('Provincia: ' + c.provincia);
    if (c.categoria) dettagli.push('Categoria: ' + c.categoria);
    if (c.cf_piva) dettagli.push('CF/P.IVA: ' + c.cf_piva);
    if (c.appuntamento && c.appuntamento.data_ora) {
      dettagli.push('Appuntamento: ' + new Date(c.appuntamento.data_ora).toLocaleString('it-IT'));
    }
    setText('konaTaskDettagli', dettagli.join(' | '));
    setText('konaTaskTentativi', 'Tentativi effettuati: ' + (t.tentativi || 0));

    var storico = [];
    if (c.motivo) storico.push('Motivo: ' + c.motivo);
    if (c.esito_precedente) storico.push('Esito precedente: ' + c.esito_precedente);
    if (c.note) storico.push('Ultima nota: ' + c.note);
    if (c.storico) {
      if (c.storico.esito) storico.push('Stato: ' + c.storico.esito);
      if (c.storico.ultimo_contatto_at) storico.push('Ultimo contatto: ' + new Date(c.storico.ultimo_contatto_at).toLocaleString('it-IT'));
      if (c.storico.data_ora) storico.push('Data ultima: ' + new Date(c.storico.data_ora).toLocaleString('it-IT'));
    }
    if (storico.length) {
      setText('konaTaskStorico', storico.join('\n'));
      show('konaTaskStoricoBox');
    } else {
      hide('konaTaskStoricoBox');
    }
  }

  function iniziaChiamata() {
    _esiti = (_task && _task.task && ESITI_PER_TIPO[_task.task.tipo]) || [];
    setText('konaOutcomeNome', _task && _task.contatto ? _task.contatto.nome : '');
    renderEsiti();
    go('outcome');
  }

  function renderEsiti() {
    var box = document.getElementById('konaEsiti');
    box.textContent = '';
    _esiti.forEach(function (e) {
      var b = document.createElement('button');
      b.className = 'btn btn-primary';
      b.textContent = e.label;
      b.onclick = function () { selezionaEsito(e.esito); };
      box.appendChild(b);
    });
  }

  // -- Outcome ----------------------------------------------------------------

  function eContatto() {
    return (_task && _task.contatto) || {};
  }

  function eBusiness() {
    var s = eContatto().sorgente;
    return s === 'lead' || s === 'lead_outbound_chiamata';
  }

  function selezionaEsito(esito) {
    var tipo = _task && _task.task && _task.task.tipo;
    // Conferma appuntamento: azioni specifiche (conferma/annulla/riprogramma).
    if (tipo === 'conferma_appuntamento_business') {
      var appId = _task.task.payload && _task.task.payload.appuntamento_business_id;
      if (esito === 'da_riprogrammare') { apriCalendar(appId); return; }
      if (esito === 'confermato') { azioneAppuntamento('conferma', appId); return; }
      if (esito === 'annullato') { azioneAppuntamento('annulla', appId); return; }
      // non_risposto prosegue come esito normale
      salvaEsito(esito);
      return;
    }
    if (esito === 'appuntamento' && eBusiness()) {
      // Business -> calendario Google personale (solo su esito Appuntamento).
      apriCalendar(null);
      return;
    }
    if (esito === 'ricontattare') {
      apriFollowup('ricontattare');
      return;
    }
    if (esito === 'altro') {
      apriFollowup('altro');
      return;
    }
    salvaEsito(esito);
  }

  // -- Followup (ricontattare / altro) ---------------------------------------

  function apriFollowup(mode) {
    _followupMode = mode;
    hide('konaFollowupRicontatto');
    hide('konaFollowupAltro');
    if (mode === 'ricontattare') {
      _pendingEsito = 'ricontattare';
      setText('konaFollowupTitolo', 'Ricontattare');
      setText('konaFollowupSottotitolo', 'Il prossimo ricontatto viene pianificato da KONA.');
      show('konaFollowupRicontatto');
    } else {
      _pendingEsito = 'altro';
      setText('konaFollowupTitolo', 'Esito "Altro"');
      setText('konaFollowupSottotitolo', 'Spiega il motivo: KONA puo' + ' chiedere un chiarimento una sola volta, ma la decisione resta tua.');
      document.getElementById('konaFollowupSpiegazione').value = '';
      show('konaFollowupAltro');
    }
    go('followup');
  }

  function annullaFollowup() {
    _followupMode = null;
    _pendingEsito = null;
    go('outcome');
  }

  async function confermaFollowup() {
    if (_followupMode === 'ricontattare') {
      await salvaEsito('ricontattare');
    } else {
      var spiegazione = document.getElementById('konaFollowupSpiegazione').value || '';
      if (!spiegazione.trim()) { toast('La spiegazione e\' obbligatoria per "Altro".'); return; }
      var motivo = '';
      try {
        var valutazione = await apiFetch(DIALOG, jsonBody({ action: 'valuta_altro', spiegazione: spiegazione, tipo_contatto: eBusiness() ? 'business' : 'standard' }));
        if (valutazione.ai_unavailable) {
          await attivaFailoverAi(valutazione.error_code, valutazione.motivo);
          return;
        }
        if (valutazione.valutazione) {
          motivo = valutazione.valutazione.motivo || '';
          var suggerimento = valutazione.valutazione.esito === 'procedi' ? 'Procedi con l\'esclusione.' : valutazione.valutazione.esito === 'richiedi_dettaglio' ? 'Chiedi ulteriori dettagli.' : 'Verifica manuale necessaria.';
          if (root.MiroxUI && typeof root.MiroxUI.confirm === 'function') {
            var ok = await root.MiroxUI.confirm('Valutazione KONA: ' + suggerimento + ' Vuoi procedere?');
            if (!ok) return;
          }
        }
      } catch (e) {
        toast('Valutazione non disponibile: ' + e.message);
      }
      await salvaEsito('altro', { motivo: motivo });
    }
  }

  async function attivaFailoverAi(codice, dettaglio) {
    try {
      var res = await apiFetch(OPERATOR, jsonBody({ action: 'attiva_failover', codice: codice, dettaglio: dettaglio }));
      toast('KONA non e\' disponibile. Passaggio temporaneo al Call Center manuale.', 'warning');
      root.location.href = res.redirect || 'registra-chiamata.html';
    } catch (e) {
      mostraErrore('KONA non e\' disponibile e il passaggio al sistema manuale non e\' riuscito: ' + e.message);
    }
  }

  // -- Esito / salvataggio ----------------------------------------------------

  async function salvaEsito(esito, dettagli) {
    if (_salvataggioInCorso) return;
    _salvataggioInCorso = true;
    try {
      var body = { action: 'esito', esito: esito };
      if (dettagli) {
        if (dettagli.motivo) body.motivo = dettagli.motivo;
        if (dettagli.spiegazione) body.spiegazione = dettagli.spiegazione;
        if (dettagli.skip_reason) body.skip_reason = dettagli.skip_reason;
        if (dettagli.appuntamento_tipo) body.appuntamento_tipo = dettagli.appuntamento_tipo;
        if (dettagli.data_ricontatto) body.dettagli = { data_ricontatto: dettagli.data_ricontatto, fascia_ricontatto: dettagli.fascia_ricontatto };
      }
      var res = await apiFetch(TASK, jsonBody(body));
      if (res.esito && res.esito.esaurito) toast('Tentativi esauriti per questo contatto.');
      _prevFamiglia = _task && _task.task ? famiglia(_task.task.tipo) : _prevFamiglia;
      _ricontattoAssegnato = res.esito && res.esito.ricontatto ? res.esito.ricontatto : null;
      _task = null;
      _pendingEsito = null;
      _followupMode = null;
      await dopoEsito();
    } catch (e) {
      toast(e.message);
    } finally {
      _salvataggioInCorso = false;
    }
  }

  async function dopoEsito() {
    // Mostra la conferma del ricontatto assegnato dal backend.
    if (_ricontattoAssegnato) {
      var d = new Date(_ricontattoAssegnato.data + 'T00:00:00');
      toast('Ricontatto pianificato: ' + d.toLocaleDateString('it-IT', { weekday: 'long', day: '2-digit', month: '2-digit' }) + ', fascia ' + _ricontattoAssegnato.fascia.toLowerCase() + '.');
      _ricontattoAssegnato = null;
    }
    try {
      var res = await apiFetch(TASK, jsonBody({ action: 'prossimo' }));
      _task = res.task || null;
      if (_task) {
        var nuovaFamiglia = famiglia(_task.task.tipo);
        if (_prevFamiglia && nuovaFamiglia !== _prevFamiglia) {
          _pendingTransition = { prev: _prevFamiglia, nuovo: nuovaFamiglia, prossima: null };
          renderTransition();
          go('transition');
        } else {
          _prevFamiglia = nuovaFamiglia;
          go('contact');
          renderContact();
        }
      } else {
        vaiAllaFaseSuccessiva(res.motivo);
      }
    } catch (e) {
      mostraErrore(e.message);
    }
  }

  var _pendingTransition = null;

  // Famiglie di attivita': le transizioni avvengono SOLO fra famiglie diverse,
  // mai fra task della stessa famiglia.
  function famiglia(tipo) {
    if (tipo === 'conferma_appuntamento_business') return 'conferme';
    if (tipo === 'campagna_urgente') return 'campagne';
    if (tipo === 'sessione_business') return 'business';
    if (['ricontatto_programmato', 'auto_non_risposto', 'passa_a_cerea', 'passa_in_negozio'].indexOf(tipo) !== -1) return 'rilavorazioni';
    return tipo || 'altro';
  }

  function messaggioTransizione(prev, nuovo) {
    if (prev === 'rilavorazioni' && nuovo === 'business') {
      return 'Le rilavorazioni previste sono terminate. Passiamo ai nuovi lead Business.';
    }
    if (prev === 'business' && nuovo === 'campagne') {
      return 'I lead Business standard sono terminati. Passiamo alle campagne urgenti approvate.';
    }
    if (prev === 'campagne' && nuovo === 'business') {
      return 'Le campagne urgenti sono terminate. Riprendiamo i lead Business.';
    }
    if (nuovo === 'conferme') {
      return 'Sono disponibili conferme di appuntamenti Business. Passiamo alle conferme.';
    }
    return 'Passiamo alla lavorazione successiva.';
  }

  function renderTransition() {
    var msg = messaggioTransizione(_pendingTransition.prev, _pendingTransition.nuovo);
    setText('konaTransitionTitolo', 'Transizione');
    setText('konaTransitionTesto', msg);
  }

  function continuaDopoTransizione() {
    if (_pendingTransition && _pendingTransition.prossima === 'consumer') {
      // Ingresso nella fase Consumer: KONA avvia la sessione dal piano.
      _pendingTransition = null;
      avviaConsumer();
      return;
    }
    _prevFamiglia = _pendingTransition ? _pendingTransition.nuovo : _prevFamiglia;
    _pendingTransition = null;
    go('contact');
    renderContact();
  }

  async function avviaConsumer() {
    try {
      var res = await apiFetch(TASK, jsonBody({ action: 'avvia_consumer' }));
      if (res.consumer && res.consumer.modalita) {
        _stato.consumer_modalita = res.consumer.modalita;
        if (!_stato.briefing) _stato.briefing = {};
        _stato.briefing.consumer = { modalita: res.consumer.modalita };
      }
      renderConsumer();
      go('consumer');
    } catch (e) {
      mostraErrore(e.message);
    }
  }

  // -- Blacklist --------------------------------------------------------------

  async function segnalaBlacklist() {
    if (_salvataggioInCorso) return;
    if (!root.MiroxUI || typeof root.MiroxUI.confirm !== 'function') {
      await salvaEsito('blacklist');
      return;
    }
    var ok = await root.MiroxUI.confirm('Segnalare questo contatto nella blacklist reale? Non sara' + ' piu\' proposto.');
    if (!ok) return;
    await salvaEsito('blacklist');
  }

  // -- Skip -------------------------------------------------------------------

  function apriSkip() {
    var sel = document.getElementById('skipReason');
    sel.textContent = '';
    SKIP_REASONS.forEach(function (r) {
      var opt = document.createElement('option');
      opt.value = r.value;
      opt.textContent = r.label;
      sel.appendChild(opt);
    });
    sel.value = '';
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

  async function confermaSkip() {
    var sel = document.getElementById('skipReason');
    var spiegazione = document.getElementById('skipSpiegazioneInput').value || '';
    if (!sel.value) { toast('Seleziona un motivo.'); return; }
    if (sel.value === 'altro' && !spiegazione.trim()) {
      toast('La spiegazione e\' obbligatoria per "Altro".');
      return;
    }
    var motivo = '';
    if (sel.value === 'altro') {
      try {
        var valutazione = await apiFetch(DIALOG, jsonBody({ action: 'valuta_altro', spiegazione: spiegazione, tipo_contatto: eBusiness() ? 'business' : 'standard' }));
        if (valutazione.ai_unavailable) {
          hide('modalSkip');
          await attivaFailoverAi(valutazione.error_code, valutazione.motivo);
          return;
        }
        if (valutazione.valutazione) motivo = valutazione.valutazione.motivo || '';
      } catch (e) {
        toast('Valutazione non disponibile: ' + e.message);
      }
    }
    hide('modalSkip');
    await salvaEsito('skip', { skip_reason: sel.value, spiegazione: spiegazione, motivo: motivo });
  }

  // -- Calendar (Business) ----------------------------------------------------

  async function apriCalendar(riprogrammaAppId) {
    _riprogrammaAppId = riprogrammaAppId || null;
    _slots = [];
    _days = [];
    _selectedDay = null;
    _selectedSlot = null;
    setText('konaCalTitolo', _riprogrammaAppId ? 'Riprogramma appuntamento Business' : 'Calendario appuntamento Business');
    setText('konaCalDurata', _stato.config ? (_stato.config.durata_appuntamento_minuti || 45) : 45);
    document.getElementById('konaCalGiorni').textContent = '';
    document.getElementById('konaCalSlot').textContent = '';
    hide('konaCalSlotWrap');
    hide('konaCalRiepilogo');
    document.getElementById('konaCalConferma').disabled = true;
    go('calendar');
    try {
      var leadId = (_task && _task.task && _task.task.payload && _task.task.payload.lead_id) || (eContatto().sorgente === 'lead' ? _task.task.sorgente_id : null);
      if (!leadId) { toast('Nessun lead Business collegato.'); return; }
      var res = await apiFetch(DIALOG, jsonBody({ action: 'cerca_slot', lead_id: leadId }));
      _slots = res.slots || [];
      if (!_slots.length) { setText('konaCalGiorni', ''); document.getElementById('konaCalGiorni').textContent = 'Nessuna fascia libera disponibile.'; return; }
      var byDay = {};
      _slots.forEach(function (s) { (byDay[s.giorno] = byDay[s.giorno] || []).push(s); });
      _days = Object.keys(byDay).sort();
      var giorniBox = document.getElementById('konaCalGiorni');
      giorniBox.textContent = '';
      _days.forEach(function (giorno) {
        var b = document.createElement('button');
        b.className = 'btn btn-secondary btn-sm';
        b.textContent = new Date(giorno + 'T00:00:00').toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit', month: '2-digit' });
        b.onclick = function () { selezionaGiorno(giorno); };
        giorniBox.appendChild(b);
      });
    } catch (e) {
      setText('konaCalGiorni', '');
      document.getElementById('konaCalGiorni').textContent = e.message;
    }
  }

  function selezionaGiorno(giorno) {
    _selectedDay = giorno;
    _selectedSlot = null;
    hide('konaCalRiepilogo');
    document.getElementById('konaCalConferma').disabled = true;
    var slotBox = document.getElementById('konaCalSlot');
    slotBox.textContent = '';
    show('konaCalSlotWrap');
    _slots.filter(function (s) { return s.giorno === giorno; }).forEach(function (slot) {
      var b = document.createElement('button');
      b.className = 'btn btn-secondary btn-sm';
      b.textContent = new Date(slot.start).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
      b.onclick = function () { selezionaSlot(slot); };
      slotBox.appendChild(b);
    });
  }

  function selezionaSlot(slot) {
    _selectedSlot = slot;
    var riepilogo = document.getElementById('konaCalRiepilogo');
    riepilogo.textContent = 'Appuntamento: ' + new Date(slot.start).toLocaleString('it-IT', { weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' - durata ' + (_stato.config ? (_stato.config.durata_appuntamento_minuti || 45) : 45) + ' minuti.';
    show('konaCalRiepilogo');
    document.getElementById('konaCalConferma').disabled = false;
  }

  function indietroCalendar() {
    _riprogrammaAppId = null;
    go('outcome');
  }

  async function confermaSlot() {
    if (!_selectedSlot || _salvataggioInCorso) return;
    _salvataggioInCorso = true;
    try {
      if (_riprogrammaAppId) {
        // Riprogrammazione: UNA SOLA operazione di calendario, nessun evento nuovo.
        await apiFetch(DIALOG, jsonBody({ action: 'riprogramma_appuntamento', appuntamento_business_id: _riprogrammaAppId, start: _selectedSlot.start }));
        _riprogrammaAppId = null;
        toast('Appuntamento riprogrammato e sincronizzato.');
        await salvaEsito('da_riprogrammare');
      } else {
        var leadId = (_task && _task.task && _task.task.payload && _task.task.payload.lead_id) || null;
        await apiFetch(DIALOG, jsonBody({
          action: 'proponi_appuntamento',
          lead_id: leadId,
          start: _selectedSlot.start,
          durata_minuti: _stato.config ? (_stato.config.durata_appuntamento_minuti || 45) : 45,
          anagrafica_id: eContatto().anagrafica_id || null
        }));
        toast('Appuntamento creato e sincronizzato con il calendario.');
        await salvaEsito('appuntamento', { appuntamento_tipo: 'esterno' });
      }
    } catch (e) {
      toast(e.message);
      _salvataggioInCorso = false;
    }
  }

  async function azioneAppuntamento(action, appId) {
    if (!appId) { toast('Appuntamento non identificato.'); return; }
    if (action === 'riprogramma') {
      apriCalendar(appId);
      return;
    }
    if (_salvataggioInCorso) return;
    if (action === 'annulla' && root.MiroxUI && typeof root.MiroxUI.confirm === 'function') {
      var ok = await root.MiroxUI.confirm('Annullare l\'appuntamento (evento Google incluso)?');
      if (!ok) return;
    }
    _salvataggioInCorso = true;
    try {
      await apiFetch(DIALOG, jsonBody({ action: action + '_appuntamento', appuntamento_business_id: appId }));
      toast('Operazione completata.');
      await salvaEsito(action === 'conferma' ? 'confermato' : 'annullato');
    } catch (e) {
      toast(e.message);
      _salvataggioInCorso = false;
    }
  }

  // -- Consumer completamente integrato --------------------------------------

  function renderConsumer() {
    var consumer = _stato && _stato.briefing && _stato.briefing.consumer;
    setText('konaConsumerTitolo', consumer ? consumer.etichetta : 'Contatti Consumer');
    setText('konaConsumerSottotitolo', consumer ? 'Modalita' + ' attiva per questa sessione.' : 'Nessuna modalita' + ' Consumer attiva.');
    var box = document.getElementById('konaConsumerEsiti');
    box.textContent = '';
    ESITI_CONSUMER.forEach(function (e) {
      var b = document.createElement('button');
      b.className = 'btn btn-secondary btn-sm';
      b.textContent = e.label;
      b.onclick = function () {
        if (!_consumer) { toast('Cerca prima il cliente.'); return; }
        if (e.esito === 'appuntamento') apriNegozio();
        else registraConsumer(e.esito);
      };
      box.appendChild(b);
    });
  }

  function campo(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  }

  function datiConsumer() {
    return {
      cf_piva: campo('konaConsumerCf').toUpperCase(),
      cluster: 'Consumer',
      ragione_sociale: campo('konaConsumerRagione'),
      nome_referente: campo('konaConsumerReferente'),
      cellulare: campo('konaConsumerTelefono'),
      email: campo('konaConsumerEmail'),
      provincia: campo('konaConsumerProvincia'),
      comune: campo('konaConsumerComune'),
      via: campo('konaConsumerVia'),
      civico: campo('konaConsumerCivico')
    };
  }

  function validaConsumer() {
    var dati = datiConsumer();
    var required = ['cf_piva', 'ragione_sociale', 'nome_referente', 'cellulare', 'provincia', 'comune', 'via', 'civico'];
    var missing = required.find(function (key) { return !dati[key]; });
    if (missing) return 'Completa tutti i dati obbligatori dell\'anagrafica.';
    if (!campo('konaConsumerCopertura') || !campo('konaConsumerMotivo')) return 'Seleziona copertura e motivo della chiamata.';
    return null;
  }

  function riempiConsumer(cliente) {
    var c = cliente || {};
    var map = {
      konaConsumerRagione: c.ragione_sociale,
      konaConsumerReferente: c.nome_referente,
      konaConsumerTelefono: c.cellulare,
      konaConsumerEmail: c.email,
      konaConsumerProvincia: c.provincia,
      konaConsumerComune: c.comune,
      konaConsumerVia: c.via,
      konaConsumerCivico: c.civico
    };
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = map[id] || '';
    });
  }

  async function cercaConsumer() {
    var cf = campo('konaConsumerCf').toUpperCase();
    if (!cf) { toast('Inserisci il codice fiscale o la P.IVA.'); return; }
    try {
      var res = await apiFetch(OPERATOR, jsonBody({ action: 'cerca_consumer', cf_piva: cf }));
      if (res.blacklist) {
        _consumer = null;
        hide('konaConsumerForm');
        toast('Il contatto e\' in Black List e non puo\' essere lavorato.', 'danger');
        return;
      }
      _consumer = { anagrafica_id: res.cliente ? res.cliente.id : null };
      riempiConsumer(res.cliente);
      setText('konaConsumerLookupStatus', res.cliente
        ? 'Cliente trovato. Verifica i dati e prosegui con la chiamata.'
        : 'Cliente non presente. KONA lo creera\' dopo la compilazione completa.');
      show('konaConsumerForm');
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  async function registraConsumer(esito) {
    var categoria = _stato && _stato.consumer_modalita;
    if (!categoria) { toast('Attiva prima una modalita' + ' Consumer.'); return; }
    var errore = validaConsumer();
    if (errore) { toast(errore, 'warning'); return; }
    if (esito === 'ricontattare') {
      toast('KONA assegnera\' automaticamente data e fascia del prossimo ricontatto.');
    }
    if (_salvataggioInCorso) return;
    _salvataggioInCorso = true;
    try {
      var res = await apiFetch(OPERATOR, jsonBody({
        action: 'salva_consumer',
        categoria: categoria,
        cliente: datiConsumer(),
        copertura: campo('konaConsumerCopertura'),
        motivo: campo('konaConsumerMotivo'),
        esito: esito,
        note: campo('konaConsumerNota')
      }));
      setText('konaConsumerStatus', 'Chiamate tracciate nella sessione: ' + (res.totale_sessione || 0));
      resetConsumer();
      toast('Chiamata salvata nel Call Center condiviso. Prosegui con il prossimo contatto.', 'success');
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      _salvataggioInCorso = false;
    }
  }

  function resetConsumer() {
    _consumer = null;
    ['konaConsumerCf','konaConsumerRagione','konaConsumerReferente','konaConsumerTelefono','konaConsumerEmail','konaConsumerProvincia','konaConsumerComune','konaConsumerVia','konaConsumerCivico','konaConsumerCopertura','konaConsumerMotivo','konaConsumerNota'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });
    hide('konaConsumerForm');
  }

  // -- Calendario negozio (Consumer) ------------------------------------------

  async function apriNegozio() {
    var errore = validaConsumer();
    if (errore) { toast(errore, 'warning'); return; }
    _negozioSlot = [];
    _negozioDay = null;
    _negozioSelected = null;
    document.getElementById('konaNegozioGiorni').textContent = '';
    document.getElementById('konaNegozioSlot').textContent = '';
    hide('konaNegozioSlotWrap');
    hide('konaNegozioRiepilogo');
    document.getElementById('konaNegozioConferma').disabled = true;
    var cliente = datiConsumer();
    setText('konaNegozioCliente', (cliente.nome_referente || cliente.ragione_sociale) + ' - ' + cliente.cellulare + ' - ' + cliente.cf_piva);
    go('negozio');
    try {
      var domani = new Date();
      domani.setDate(domani.getDate() + 1);
      var data = domani.toISOString().slice(0, 10);
      await caricaSlotNegozio(data);
    } catch (e) {
      document.getElementById('konaNegozioGiorni').textContent = e.message;
    }
  }

  async function caricaSlotNegozio(data) {
    var res = await apiFetch(DIALOG, jsonBody({ action: 'negozio_slot', data: data }));
    _negozioDay = data;
    _negozioSlot = res.slots || [];
    _negozioSelected = null;
    hide('konaNegozioRiepilogo');
    document.getElementById('konaNegozioConferma').disabled = true;
    document.getElementById('konaNegozioGiorni').textContent = 'Slot per ' + new Date(data + 'T00:00:00').toLocaleDateString('it-IT', { weekday: 'long', day: '2-digit', month: '2-digit' }) + ':';
    var box = document.getElementById('konaNegozioSlot');
    box.textContent = '';
    if (!_negozioSlot.length) {
      box.textContent = 'Nessuno slot disponibile in questa data.';
      hide('konaNegozioSlotWrap');
      return;
    }
    show('konaNegozioSlotWrap');
    _negozioSlot.forEach(function (slot) {
      var b = document.createElement('button');
      b.className = 'btn btn-secondary btn-sm';
      b.textContent = new Date(slot.start).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
      b.onclick = function () { selezionaSlotNegozio(slot); };
      box.appendChild(b);
    });
  }

  function selezionaSlotNegozio(slot) {
    _negozioSelected = slot;
    var riepilogo = document.getElementById('konaNegozioRiepilogo');
    riepilogo.textContent = 'Appuntamento negozio: ' + new Date(slot.start).toLocaleString('it-IT', { weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + '.';
    show('konaNegozioRiepilogo');
    document.getElementById('konaNegozioConferma').disabled = false;
  }

  function indietroNegozio() {
    go('consumer');
  }

  async function confermaNegozio() {
    if (!_negozioSelected || _salvataggioInCorso) return;
    var cliente = datiConsumer();
    var nome = cliente.nome_referente || cliente.ragione_sociale;
    var telefono = cliente.cellulare;
    var categoria = _stato && _stato.consumer_modalita;
    if (!categoria) { toast('Nessuna modalita' + ' Consumer attiva.'); return; }
    _salvataggioInCorso = true;
    try {
      await apiFetch(DIALOG, jsonBody({
        action: 'negozio_prenota',
        nome: nome,
        cf_piva: cliente.cf_piva,
        telefono: telefono,
        motivo: campo('konaConsumerMotivo'),
        copertura: campo('konaConsumerCopertura'),
        note: campo('konaConsumerNota'),
        data_ora: _negozioSelected.start,
        categoria: categoria,
        anagrafica_id: _consumer && _consumer.anagrafica_id,
        cliente: cliente
      }));
      toast('Appuntamento negozio prenotato ed esito registrato.');
      resetConsumer();
      go('consumer');
    } catch (e) {
      toast(e.message);
    } finally {
      _salvataggioInCorso = false;
    }
  }

  function terminaGiornata() {
    go('completed');
  }

  // -- Ricerca inbound, storico e correzione esiti --------------------------

  function apriRicercaInbound() {
    _ricercaMode = 'inbound';
    setText('konaRicercaTitolo', 'Ricerca numero in entrata');
    var input = document.getElementById('konaRicercaInput');
    input.value = '';
    input.placeholder = 'Inserisci il numero che ha richiamato';
    document.getElementById('konaRicercaRisultati').textContent = '';
    show('modalKonaRicerca');
    setTimeout(function () { input.focus(); }, 0);
  }

  async function apriStorico() {
    _ricercaMode = 'storico';
    setText('konaRicercaTitolo', 'Chiamate di oggi');
    var input = document.getElementById('konaRicercaInput');
    input.value = '';
    input.placeholder = 'Filtra per numero, nome o CF';
    show('modalKonaRicerca');
    await caricaStorico('');
  }

  function chiudiRicerca() {
    hide('modalKonaRicerca');
  }

  async function eseguiRicercaInbound() {
    var query = campo('konaRicercaInput');
    if (_ricercaMode === 'storico') { await caricaStorico(query); return; }
    if (!query) { toast('Inserisci un numero di telefono.'); return; }
    try {
      var res = await apiFetch(OPERATOR, jsonBody({ action: 'cerca_inbound', telefono: query }));
      renderRicerca(res.chiamate || [], res.anagrafiche || [], res.lead_business || []);
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  async function caricaStorico(query) {
    try {
      var res = await apiFetch(OPERATOR, jsonBody({ action: 'storico', query: query || '' }));
      renderRicerca(res.chiamate || [], [], []);
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  function aggiungiTesto(parent, tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = text || '';
    parent.appendChild(el);
    return el;
  }

  function etichettaEsito(esito) {
    return String(esito || '').replace(/_/g, ' ');
  }

  function renderRicerca(chiamate, anagrafiche, lead) {
    var box = document.getElementById('konaRicercaRisultati');
    box.textContent = '';
    if (!chiamate.length && !anagrafiche.length && !lead.length) {
      aggiungiTesto(box, 'div', 'kona-empty', 'Nessun contatto trovato.');
      return;
    }
    anagrafiche.forEach(function (a) {
      var row = document.createElement('div'); row.className = 'kona-result';
      aggiungiTesto(row, 'strong', '', a.nome_referente || a.ragione_sociale || 'Cliente');
      aggiungiTesto(row, 'div', 'kona-result-meta', [a.cellulare, a.cf_piva, a.comune].filter(Boolean).join(' - '));
      box.appendChild(row);
    });
    chiamate.forEach(function (c) {
      var row = document.createElement('div'); row.className = 'kona-result';
      var head = document.createElement('div'); head.className = 'kona-result-head';
      aggiungiTesto(head, 'strong', '', c.nome_cliente || 'Cliente');
      aggiungiTesto(head, 'span', 'kona-badge', etichettaEsito(c.esito));
      row.appendChild(head);
      aggiungiTesto(row, 'div', 'kona-result-meta', new Date(c.data_ora).toLocaleString('it-IT') + ' - ' + (c.motivo_chiamata || 'Motivo non indicato') + (c.note ? ' - ' + c.note : ''));
      if (c.modificabile) {
        var actions = document.createElement('div'); actions.className = 'kona-actions';
        var button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-secondary btn-sm'; button.textContent = 'Correggi esito';
        button.onclick = function () { apriCorrezione(c.id); };
        actions.appendChild(button); row.appendChild(actions);
      }
      box.appendChild(row);
    });
    lead.forEach(function (l) {
      var row = document.createElement('div'); row.className = 'kona-result';
      aggiungiTesto(row, 'strong', '', l.ragione_sociale || 'Lead Business');
      aggiungiTesto(row, 'div', 'kona-result-meta', [l.categoria, l.localita, l.stato_lead, l.note_ultima].filter(Boolean).join(' - '));
      box.appendChild(row);
    });
  }

  function apriCorrezione(id) {
    document.getElementById('konaCorrezioneId').value = id;
    document.getElementById('konaCorrezioneEsito').value = '';
    document.getElementById('konaCorrezioneMotivo').value = '';
    document.getElementById('konaCorrezioneData').value = '';
    document.getElementById('konaCorrezioneFascia').value = '';
    hide('konaCorrezioneRicontatto');
    show('modalKonaCorrezione');
  }

  function chiudiCorrezione() { hide('modalKonaCorrezione'); }

  function toggleCorrezioneRicontatto() {
    if (campo('konaCorrezioneEsito') === 'ricontattare') show('konaCorrezioneRicontatto');
    else hide('konaCorrezioneRicontatto');
  }

  async function confermaCorrezione() {
    var id = campo('konaCorrezioneId');
    var esito = campo('konaCorrezioneEsito');
    var motivo = campo('konaCorrezioneMotivo');
    if (!id || !esito || motivo.length < 3) { toast('Seleziona il nuovo esito e indica la motivazione.'); return; }
    if (esito === 'ricontattare' && (!campo('konaCorrezioneData') || !campo('konaCorrezioneFascia'))) {
      toast('Inserisci data e fascia del ricontatto.'); return;
    }
    try {
      await apiFetch(OPERATOR, jsonBody({
        action: 'correggi_esito', chiamata_id: id, esito: esito, motivo: motivo,
        data_ricontatto: campo('konaCorrezioneData') || null,
        fascia_ricontatto: campo('konaCorrezioneFascia') || null,
        canale: _ricercaMode === 'storico' ? 'kona_storico' : 'kona_inbound'
      }));
      chiudiCorrezione();
      toast('Esito corretto e audit registrato.', 'success');
      await eseguiRicercaInbound();
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  async function togglePausa() {
    if (_salvataggioInCorso) return;
    var target = !_pausa;
    try {
      if (_task) await apiFetch(TASK, jsonBody({ action: target ? 'sospendi' : 'riprendi' }));
      await apiFetch(OPERATOR, jsonBody({ action: 'audit_pausa', stato: target ? 'pausa' : 'ripresa' }));
      _pausa = target;
      var btn = document.getElementById('konaPauseBtn');
      if (btn) btn.textContent = _pausa ? 'Riprendi' : 'Pausa';
      setText('konaAgentStatus', _pausa ? 'Giornata in pausa' : 'KONA ha ripreso la lavorazione');
      toast(_pausa ? 'Attivita\' sospesa.' : 'Attivita\' ripresa.', 'success');
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  // -- Completed / error ------------------------------------------------------

  async function ricontrolla() {
    try {
      await caricaStato();
    } catch (e) {
      mostraErrore(e.message);
    }
  }

  async function riprova() {
    try {
      await caricaStato();
    } catch (e) {
      mostraErrore(e.message);
    }
  }

  // -- Init -------------------------------------------------------------------

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  root.KonaCD = {
    annullaFollowup: annullaFollowup,
    apriNegozio: apriNegozio,
    apriRicercaInbound: apriRicercaInbound,
    apriSkip: apriSkip,
    apriStorico: apriStorico,
    avvia: avvia,
    avviaChiamate: avviaChiamate,
    boot: boot,
    chiudiSkip: chiudiSkip,
    chiudiCorrezione: chiudiCorrezione,
    chiudiRicerca: chiudiRicerca,
    cercaConsumer: cercaConsumer,
    confermaCorrezione: confermaCorrezione,
    confermaFollowup: confermaFollowup,
    confermaNegozio: confermaNegozio,
    confermaSkip: confermaSkip,
    confermaSlot: confermaSlot,
    continuaDopoTransizione: continuaDopoTransizione,
    eseguiRicercaInbound: eseguiRicercaInbound,
    indietroCalendar: indietroCalendar,
    indietroNegozio: indietroNegozio,
    iniziaChiamata: iniziaChiamata,
    registraConsumer: registraConsumer,
    ricontrolla: ricontrolla,
    riprova: riprova,
    segnalaBlacklist: segnalaBlacklist,
    terminaGiornata: terminaGiornata,
    toggleCorrezioneRicontatto: toggleCorrezioneRicontatto,
    togglePausa: togglePausa,
    toggleSpiegazioneSkip: toggleSpiegazioneSkip,
    _test: { messaggioTransizione: messaggioTransizione, famiglia: famiglia, TITOLI_TIPO: TITOLI_TIPO }
  };
})(window);
