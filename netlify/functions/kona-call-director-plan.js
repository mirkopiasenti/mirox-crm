/**
 * KONA Call Director — piano giornaliero Business (POST, auth).
 *
 * Azioni:
 *   proposta       -> piano del giorno (default domani): determinismo per zona +
 *                     proposta OpenAI (solo aggregati) -> persistita 'proposta'
 *   approva        -> admin: piano -> 'approvato' (approvata_at/da)
 *   applica_default-> applica il piano default (solo se non approvato da Mirko)
 *   piano          -> legge il piano persistito per operatore/giorno
 *
 * Privacy: a OpenAI passano solo conteggi/zona/finestre, mai nomi o dati
 * personali. Il piano su Telegram idem.
 */

const { createClient } = require('@supabase/supabase-js');

const { authAndEnabled, getConfig } = require('./_lib/kona-cd-config');
const { requireAuth } = require('./_lib/require-auth');
const { openaiStructured } = require('./_lib/kona-cd-openai');
const { applicaPianoDefault, pianoDi, propostaPianoGiorno, salvaPiano } = require('./_lib/kona-cd-report');
const { addDaysStr, todayRomeStr } = require('./_lib/kona-cd-time');
const { cleanLog, isUuid, jsonError, jsonOk, readJsonBody } = require('./_lib/kona-cd-util');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }, body: '' };
  }
  if (event.httpMethod !== 'POST') return jsonError(405, 'Metodo non consentito');

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return jsonError(500, 'Configurazione Supabase mancante');
  const client = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const body = await readJsonBody(event);
  const action = String(body.action || '');
  let cfg;
  let profiloId;
  if (action === 'approva') {
    const adminAuth = await requireAuth(event, { adminOnly: true });
    if (!adminAuth.ok) return jsonError(adminAuth.status, adminAuth.error);
    cfg = await getConfig(client);
    profiloId = String(adminAuth.profilo.alias_di || adminAuth.profilo.id || adminAuth.user.id || '').toLowerCase();
  } else {
    const guard = await authAndEnabled(event, { supabase: client, response: jsonError });
    if (guard.response) return guard.response;
    cfg = guard.cfg;
    profiloId = guard.profiloId;
  }

  try {
    switch (action) {
      case 'proposta': {
        const data = String(body.data || addDaysStr(todayRomeStr(), 1));
        const deterministica = await propostaPianoGiorno(client, cfg, { data });
        const input = cleanLog({
          data,
          totale: deterministica.totale,
          perZona: (deterministica.perZona || []).map((z) => ({ zona: z.zona, n: z.n, finestra: z.finestra, distanza_km: z.distanza_km })),
          suggerimento: deterministica.suggerimento
        });
        const schema = {
          type: 'object',
          properties: {
            piano: { type: 'string' },
            priorita: { type: 'array', items: { type: 'string' } }
          },
          required: ['piano', 'priorita'],
          additionalProperties: false
        };
        const instructions = [
          'Sei il pianificatore del Call Center Business. Ricevi il piano del giorno',
          '(conteggi e zone, nessun dato personale). Produci un piano operativo',
          'breve e concreto in italiano (max 4 frasi) e una lista priorita\'.'
        ].join(' ');
        const ai = await openaiStructured({
          supabase: client, cfg, activity: 'piano', name: 'kona_piano_giorno',
          instructions, input, schema, maxOutputTokens: 400, webSearch: false,
          details: { data }
        });
        const contenuto = {
          deterministica: { totale: deterministica.totale, perZona: deterministica.perZona, suggerimento: deterministica.suggerimento },
          ...(ai.ok ? { analisi: { piano: ai.value.piano, priorita: ai.value.priorita } } : { analisi: null })
        };
        const salvataggio = await salvaPiano(client, {
          data, operatoreId: profiloId, contenuto, sorgente: 'openai', stato: 'proposta'
        });
        return jsonOk({ data, totale: deterministica.totale, perZona: deterministica.perZona, analisi: contenuto.analisi, salvato: salvataggio.ok });
      }

      case 'approva': {
        const auth = await requireAuth(event, { adminOnly: true });
        if (!auth.ok) return jsonError(auth.status, auth.error);
        const data = String(body.data || addDaysStr(todayRomeStr(), 1));
        const operatoreId = String(body.operatore_id || profiloId).toLowerCase();
        if (!isUuid(operatoreId)) return jsonError(400, 'operatore_id non valido');
        const esistente = await pianoDi(client, { data, operatoreId });
        if (!esistente) return jsonError(404, 'Nessun piano da approvare');
        const { error } = await client.from('kona_call_director_piani')
          .update({ stato: 'approvato', approvata_at: new Date().toISOString(), approvata_da: auth.profilo.id })
          .eq('data', data).eq('operatore_id', operatoreId);
        if (error) return jsonError(500, error.message);
        return jsonOk({ approvato: true });
      }

      case 'applica_default': {
        const data = String(body.data || todayRomeStr());
        const esito = await applicaPianoDefault(client, cfg, { data, operatoreId: profiloId });
        return jsonOk({ data, totale: esito.totale, salvato: esito.salvato });
      }

      case 'piano': {
        const data = String(body.data || todayRomeStr());
        const piano = await pianoDi(client, { data, operatoreId: profiloId });
        return jsonOk({ data, piano: piano ? { stato: piano.stato, sorgente: piano.sorgente, contenuto: piano.contenuto, approvata_at: piano.approvata_at } : null });
      }

      default:
        return jsonError(400, 'Action non valida');
    }
  } catch (e) {
    return jsonError(500, String(e?.message || 'errore'));
  }
};
