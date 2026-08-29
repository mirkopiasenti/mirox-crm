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
const { categoriaConsumerPiano, materializeNextTask, verificaTaskAttivo, getTaskDettaglio, registerEsito } = require('./_lib/kona-cd-engine');
const { enqueueNotifica } = require('./_lib/kona-cd-notifiche');
const { notificaEsauriti } = require('./_lib/kona-cd-conferme');
const { nowRomeParts, todayRomeStr } = require('./_lib/kona-cd-time');
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
          if (esito.reason === 'task_attivo') {
            const corrente = await verificaTaskAttivo({ supabase: client, profiloId });
            if (corrente.task && corrente.dettaglio) {
              return jsonOk({ task: corrente.dettaglio, motivo: 'task_attivo' });
            }
          }
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
        const tipo = body.tipo === 'pomeriggio' || body.tipo === 'mattina'
          ? body.tipo
          : (nowRomeParts().hh >= 15 ? 'pomeriggio' : 'mattina');
        const statoSessione = body.stato === 'chiudi' ? 'chiudi' : 'apri';
        const data = todayRomeStr();
        if (statoSessione === 'apri') {
          const categoria = ['telefoni_omaggio', 'fibra_fwa', 'business'].includes(String(body.categoria || '')) ? body.categoria : null;
          const { error: sessioneOpenError } = await client.from('kona_call_director_sessioni').upsert(
            { data, operatore_id: profiloId, tipo, stato: 'attiva', categoria, aperta_at: new Date().toISOString(), chiusa_at: null, note: { obiettivo_minuti: categoria === 'business' ? (cfg.durata_sessione_business_minuti || 90) : null } },
            { onConflict: 'data,operatore_id,tipo' }
          );
          if (sessioneOpenError) return jsonError(500, sessioneOpenError.message);
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

      case 'avvia_consumer': {
        // KONA determina e apre automaticamente la sessione Consumer prevista
        // dal piano: l'operatore non sceglie la modalita' e non serve una
        // sessione aperta a mano in precedenza.
        const data = todayRomeStr();
        const tipo = nowRomeParts().hh >= 15 ? 'pomeriggio' : 'mattina';
        const [pianoRes, sessioneRes] = await Promise.all([
          client.from('kona_call_director_piani')
            .select('contenuto, stato')
            .eq('data', data).eq('operatore_id', profiloId)
            .in('stato', ['approvato', 'applicato']).limit(1).maybeSingle(),
          client.from('kona_call_director_sessioni')
            .select('categoria').eq('data', data).eq('operatore_id', profiloId)
            .eq('stato', 'attiva').limit(1).maybeSingle()
        ]);
        const { data: piano, error: pianoError } = pianoRes;
        if (pianoError) return jsonError(500, pianoError.message);
        const categoria = categoriaConsumerPiano(piano?.contenuto, sessioneRes.data?.categoria);
        if (!categoria) {
          // Fallback: se il piano non dichiara Consumer, nessuna sessione.
          return jsonOk({ consumer: null, motivo: 'nessuna_modalita_consumer_nel_piano' });
        }
        const { error: sessioneOpenError } = await client.from('kona_call_director_sessioni').upsert(
          { data, operatore_id: profiloId, tipo, stato: 'attiva', categoria, aperta_at: new Date().toISOString(), chiusa_at: null, note: { obiettivo_minuti: null } },
          { onConflict: 'data,operatore_id,tipo' }
        );
        if (sessioneOpenError) return jsonError(500, sessioneOpenError.message);
        return jsonOk({ consumer: { modalita: categoria }, sessione: true, tipo });
      }

      case 'registra_attivita_consumer': {
        const categoria = String(body.categoria || '');
        const esito = String(body.esito || '');
        if (!['telefoni_omaggio', 'fibra_fwa'].includes(categoria)) return jsonError(400, 'Categoria Consumer non valida');
        if (!['chiamata', 'non_risposto', 'non_interessato', 'passa_in_negozio', 'interessato', 'altro', 'appuntamento'].includes(esito)) return jsonError(400, 'Esito Consumer non valido');
        const { data: sessione, error: sessioneError } = await client.from('kona_call_director_sessioni')
          .select('id, categoria').eq('data', todayRomeStr()).eq('operatore_id', profiloId)
          .eq('stato', 'attiva').eq('categoria', categoria).limit(1).maybeSingle();
        if (sessioneError || !sessione) return jsonError(409, 'Nessuna sessione Consumer attiva per questa categoria');
        const { data: attivita, error } = await client.from('kona_call_director_sessione_attivita').insert({
          sessione_id: sessione.id,
          operatore_id: profiloId,
          categoria,
          esito,
          note: String(body.note || '').slice(0, 500) || null
        }).select('id, created_at').single();
        if (error || !attivita) return jsonError(500, error?.message || 'Registrazione attività fallita');
        const { count } = await client.from('kona_call_director_sessione_attivita')
          .select('id', { count: 'exact', head: true }).eq('sessione_id', sessione.id);
        return jsonOk({ registrata: true, attivita, totale_sessione: Number(count) || 0 });
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

// Risposta pubblica: mai dettagli personali, solo esito + conteggio tentativi
// + eventuale ricontatto assegnato dal backend.
function esitoRecordPublic(esito) {
  return {
    esito: esito.esito,
    esaurito: Boolean(esito.esaurito),
    tentativo: esito.tentativo || 1,
    ricontatto: esito.ricontatto || null
  };
}
