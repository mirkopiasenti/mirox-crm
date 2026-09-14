'use strict';

const { logUsage, openaiStructured } = require('./kona-cd-openai');
const { deepseekStructured } = require('./kona-cd-deepseek');

// Dispatcher dei provider IA di KONA Call Director.
//
// Perche' esiste: il progetto usa DUE provider con capacita' diverse.
//   OpenAI  -> ricerca web (dati aziendali) e valutazioni "di merito";
//   DeepSeek -> dialogo in linguaggio naturale su Telegram (V4.1 Flash).
// Il chiamante dichiara l'ATTIVITA', non il provider: quale provider serva lo
// decide `kona_call_director_config.provider_per_attivita`, quindi cambiare
// provider e' una riga di configurazione, non una modifica di codice.
//
// Regola di sicurezza: una capacita' che il provider scelto non ha NON viene
// mai degradata in silenzio. Se qualcuno chiedesse la ricerca web su DeepSeek
// (che non la offre) la chiamata FALLISCE: un arricchimento senza fonti reali
// sarebbe peggio di un arricchimento mancato.

const PROVIDERS = ['openai', 'deepseek'];

function providerPer(cfg, activity) {
  const mappa = cfg && typeof cfg.provider_per_attivita === 'object' && cfg.provider_per_attivita
    ? cfg.provider_per_attivita
    : null;
  const scelto = mappa ? String(mappa[activity] || '').trim().toLowerCase() : '';
  return PROVIDERS.includes(scelto) ? scelto : 'openai';
}

// DeepSeek non ha ricerca web. La funzione e' esportata per essere verificabile.
function providerSupportaWeb(provider) {
  return provider === 'openai';
}

// Stessa firma di `openaiStructured`, piu' il parametro opzionale `provider`
// (che scavalca la configurazione: usato solo dai test e dalle verifiche).
async function aiStructured(opts = {}) {
  const provider = PROVIDERS.includes(String(opts.provider || '').toLowerCase())
    ? String(opts.provider).toLowerCase()
    : providerPer(opts.cfg, opts.activity);

  if (opts.webSearch && !providerSupportaWeb(provider)) {
    await logUsage({
      supabase: opts.supabase,
      cfg: opts.cfg,
      activity: opts.activity || 'altro',
      model: null,
      details: { ...(opts.details || {}), esito: 'provider_non_supporta_web_search', provider }
    });
    return {
      ok: false,
      error_code: 'provider_non_supporta_web_search',
      error: `Il provider ${provider} non offre la ricerca web`
    };
  }

  return provider === 'deepseek'
    ? deepseekStructured(opts)
    : openaiStructured(opts);
}

module.exports = {
  PROVIDERS,
  aiStructured,
  providerPer,
  providerSupportaWeb,
  _test: { providerPer, providerSupportaWeb }
};
