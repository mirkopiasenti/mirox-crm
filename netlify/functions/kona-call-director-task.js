/**
 * KONA Call Director — task operatore (POST action-based, auth).
 *
 * Azioni:
 *   prossimo   -> materializza il prossimo contatto e ritorna il dettaglio
 *   attivo     -> ri-verifica blacklist/esclusioni del task corrente PRIMA di
 *                 mostrarlo (fail-closed); se bloccato lo annulla e materializza
 *                 il successivo
 *   esito      -> registra esito valido / skip motivato / blacklist (persistita)
 *   sospendi   -> sospende il task attivo (un solo task lavorabile per operatrice)
 *   riprendi   -> riattiva il task sospeso (deterministico: ne esiste uno solo)
 *
 * Il dettaglio contatto (nome, telefono, ecc.) e' restituito SOLO all'operatore
 * in questa function: mai in Telegram, mai nei log. Gli esiti passano dal
 * motore deterministico (kona-cd-engine) che valida, conta i tentativi
 * PERSISTENTI e applica le esclusioni.
 */

const { authAndEnabled } = require('./_lib/kona-cd-config');
const { materializeNextTask, verificaTaskAttivo, getTaskDettaglio, registerEsito } = require('./_lib/kona-cd-engine');
const { enqueueNotifica } = require('./_lib/kona-cd-notifiche');
const { notificaEsauriti } = require('./_lib/kona-cd-conferme');
const { todayRomeStr } = require('./_lib/kona-cd-time');
const { jsonError, jsonOk, readJsonBody } = require('./_lib/kona-cd-util');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }, body: '' };
  }
  if (event.httpMethod !== 'POST') return jsonError(405, 'Metodo non consentito');

  const body = await readJsonBody(event);
  const action = String(body.action || '');

  const { createClient } = require('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return jsonError(500, 'Configurazione Supabase mancante');
  const client = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const guard = await authAndEnabled(event, { supabase: client, response: jsonError });
  if (guard.response) return guard.response;
  const { cfg, profiloId } = guard;

  try {
    switch (action) {
      case 'prossimo': {
        const esito = await materializeNextTask({ supabase: client, cfg, profiloId, oggi: null });
        if (!esito.ok) {
          return jsonOk({ task: null, motivo: esito.reason || 'nessun_candidato' });
        }
        const dettaglio = await getTaskDettaglio(client, esito.task);
        return jsonOk({ task: dettaglio });
      }

      case 'attivo': {
        // Ri-verifica blacklist/esclusioni PRIMA di mostrare (fail-closed).
        const verificato = await verificaTaskAttivo({ supabase: client, profiloId });
        if (verificato.blocked) {
          // Se il task era bloccato e annullato, materializza il successivo.
          const esito = await materializeNextTask({ supabase: client, cfg, profiloId, oggi: null });
          if (!esito.ok) return jsonOk({ task: null, motivo: esito.reason || 'nessun_candidato' });
          const dettaglio = await getTaskDettaglio(client, esito.task);
          return jsonOk({ task: dettaglio });
        }
        if (!verificato.task) return jsonOk({ task: null });
        return jsonOk({ task: verificato.dettaglio });
      }

      case 'esito': {
        const task = (await verificaTaskAttivo({ supabase: client, profiloId })).task;
        if (!task) return jsonError(409, 'Nessun task attivo');
        const esito = await registerEsito({
          supabase: client,
          cfg,
          task,
          profiloId,
          esito: String(body.esito || ''),
          dettagli: {
            skip_reason: body.skip_reason,
            spiegazione: body.spiegazione,
            motivo: body.motivo,
            appuntamento_tipo: body.appuntamento_tipo,
            dettagli: body.dettagli || {}
          }
        });
        if (!esito.ok) return jsonError(400, esito.error);
        // Conferme esaurite (4 non risposti): notifica Telegram senza PII.
        if (esito.notifica === 'conferma_non_risposti_esauriti') {
          const payload = task.payload || {};
          const dettaglio = notificaEsauriti({
            appuntamento_business_id: payload.appuntamento_business_id,
            zona: payload.zona,
            data_appuntamento: (payload.data_ora || '').slice(0, 10)
          });
          await enqueueNotifica(client, {
            dedupeKey: `conferma_esauriti_${payload.appuntamento_business_id}_${todayRomeStr()}`,
            testo: dettaglio.messaggio,
            extra: dettaglio
          });
        }
        return jsonOk({ esito: esitoRecordPublic(esito) });
      }

      case 'sessione': {
        // Apre/chiude una sessione operativa (Consumer manuale o Business).
        const tipo = body.tipo === 'pomeriggio' ? 'pomeriggio' : 'mattina';
        const statoSessione = body.stato === 'chiudi' ? 'chiudi' : 'apri';
        const data = todayRomeStr();
        if (statoSessione === 'apri') {
          const categoria = ['telefoni_omaggio', 'fibra_fwa', 'business'].includes(String(body.categoria || '')) ? body.categoria : null;
          await client.from('kona_call_director_sessioni').upsert(
            { data, operatore_id: profiloId, tipo, stato: 'attiva', categoria, aperta_at: new Date().toISOString() },
            { onConflict: 'data,operatore_id,tipo' }
          );
          return jsonOk({ sessione: true, tipo, categoria });
        }
        const { data: chiusa, error } = await client
          .from('kona_call_director_sessioni')
          .update({ stato: 'chiusa', chiusa_at: new Date().toISOString() })
          .eq('data', data).eq('operatore_id', profiloId).eq('tipo', tipo).eq('stato', 'attiva')
          .select('id')
          .single();
        if (error) return jsonError(500, error.message);
        return jsonOk({ sessione_chiusa: true, tipo, id: chiusa?.id || null });
      }

      case 'sospendi': {
        const { data: sospeso, error } = await client
          .from('kona_call_director_task')
          .update({ stato: 'sospeso', lease_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() })
          .eq('operatore_id', profiloId)
          .eq('stato', 'attivo')
          .select('id')
          .single();
        if (error) return jsonError(500, error.message);
        return jsonOk({ sospeso: true, task_id: sospeso?.id || null });
      }

      case 'riprendi': {
        const { data: ripreso, error } = await client
          .from('kona_call_director_task')
          .update({ stato: 'attivo', lease_until: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString() })
          .eq('operatore_id', profiloId)
          .eq('stato', 'sospeso')
          .select('id')
          .single();
        if (error) return jsonError(500, error.message);
        return jsonOk({ ripreso: true, task_id: ripreso?.id || null });
      }

      default:
        return jsonError(400, 'Action non valida');
    }
  } catch (e) {
    return jsonError(500, String(e?.message || 'errore'));
  }
};

// Risposta pubblica: mai dettagli personali, solo esito + conteggio tentativi.
function esitoRecordPublic(esito) {
  return { esito: esito.esito, esaurito: Boolean(esito.esaurito), tentativo: esito.tentativo || 1 };
}
