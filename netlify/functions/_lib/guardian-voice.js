'use strict';
const crypto = require('node:crypto');
const telegram = require('./telegram');
const URL = 'https://mirox-crm.it/.netlify/functions/guardian-voice-background';
const checked = result => { if (result.error) throw Object.assign(new Error('guardian_voice_database'), {code: result.error.code}); return result.data; };
const now = () => new Date().toISOString();
function signature(body) { return crypto.createHmac('sha256', process.env.GUARDIAN_WORKER_SECRET || '').update(body).digest('hex'); }
function validRequest(body, received) {
  if (!process.env.GUARDIAN_WORKER_SECRET) return false;
  try {
    const data = JSON.parse(body);
    const expected = Buffer.from(signature(body)), actual = Buffer.from(received || '');
    return Object.keys(data).length === 1 && Number.isSafeInteger(data.timestamp) && Math.abs(Date.now()-data.timestamp)<300000
      && expected.length===actual.length && crypto.timingSafeEqual(expected,actual);
  } catch (_) { return false; }
}
async function nudge(request=fetch) {
  const body = JSON.stringify({timestamp:Date.now()});
  const result = await request(URL,{method:'POST',headers:{'Content-Type':'application/json','X-Guardian-Voice-Signature':signature(body)},body,signal:AbortSignal.timeout(5000)});
  if (!result.ok) throw new Error('guardian_voice_nudge');
}
async function enqueue(db, update, chatId) {
  const message=update.message;
  if (!Number.isSafeInteger(update.update_id) || update.update_id<0 || !message?.voice?.file_id
    || message.voice.file_size>25*1024*1024 || String(message.voice.file_id).length>500) throw new Error('Vocale non valido o troppo grande.');
  const session=checked(await db.from('kona_ai_telegram_sessioni').select('incidente_attivo_id').eq('chat_id',chatId).maybeSingle());
  const result=await db.from('kona_ai_vocali_jobs').insert({update_id:update.update_id,chat_id:chatId,
    incidente_id:session?.incidente_attivo_id || null,file_id:message.voice.file_id}).select('id').single();
  if (result.error?.code==='23505') return null;
  return checked(result).id;
}
async function retry(db,chatId,id) {
  if(String(chatId)!==String(process.env.TELEGRAM_GUARDIAN_OWNER_CHAT_ID || '')) throw new Error('Vocale non autorizzato');
  return checked(await db.from('kona_ai_vocali_jobs').update({stato:'in_coda',tentativi:0,in_flight:false,
    lease_token:null,lease_until:null,next_attempt_at:now(),updated_at:now()}).eq('id',id).eq('chat_id',String(chatId))
    .in('stato',['fallito','incerto']).select('id').maybeSingle());
}
async function processQueue(db,deps={}) {
  const chat=String(process.env.TELEGRAM_GUARDIAN_OWNER_CHAT_ID || '');
  if (!chat) throw new Error('guardian_owner_missing');
  const started=Date.now();let completed=0;
  for (let n=0;n<4 && Date.now()-started<8*60*1000;n++) {
    const job=checked(await db.from('kona_ai_vocali_jobs').select('*').eq('chat_id',chat).in('stato',['in_coda','in_corso']).order('created_at').limit(1).maybeSingle());
    if (!job || Date.parse(job.next_attempt_at)>Date.now()) break;
    if (job.stato==='in_corso' && Date.parse(job.lease_until)>Date.now()) break;
    const token=crypto.randomUUID();
    const claim=await db.from('kona_ai_vocali_jobs').update({stato:'in_corso',lease_token:token,
      lease_until:new Date(Date.now()+12*60*1000).toISOString(),tentativi:job.tentativi+1,updated_at:now()})
      .eq('id',job.id).eq('stato',job.stato).eq('tentativi',job.tentativi).select('*').maybeSingle();
    if (claim.error?.code==='23505') break;
    const claimed=checked(claim);if(!claimed) break;
    const save=async values=>{const saved=checked(await db.from('kona_ai_vocali_jobs').update({...values,updated_at:now()}).eq('id',job.id).eq('lease_token',token).select('id').maybeSingle());if(!saved)throw new Error('guardian_voice_lease_lost');};
    const notify=async(code,text)=>checked(await db.from('kona_ai_notifiche').upsert({incidente_id:job.incidente_id,
      dedupe_key:`voice:${code}:${job.id}`,payload:{text, ...(['failed','uncertain'].includes(code) ? {reply_markup:{inline_keyboard:[[{text:'Riprova questo vocale',callback_data:`retry_voice:${job.id}`}]]}} : {})},stato:'in_coda',prossimo_tentativo_at:now()}, {onConflict:'dedupe_key',ignoreDuplicates:true}));
    let stage='transcription';
    try {
      if (job.in_flight) { await save({stato:'incerto',errore_codice:'telegram_delivery_uncertain',lease_token:null,lease_until:null});
        await notify('uncertain','La risposta al vocale è pronta, ma non posso confermare che Telegram l’abbia ricevuta. Ho conservato il vocale e la trascrizione per la verifica.');continue; }
      if (!job.transcript) {
        const file=await (deps.download||telegram.downloadTelegramFile)(job.file_id);
        job.transcript=await (deps.transcribe||telegram.transcribeVoice)(file,{timeoutMs:180000});
        await save({transcript:job.transcript});
      }
      stage='conversation';
      if (!job.risposta) {
        const session=checked(await db.from('kona_ai_telegram_sessioni').select('*').eq('chat_id',chat).maybeSingle()) || {};
        const conversation=deps.conversation || require('../guardian-telegram-webhook')._test.handleOwnerConversation;
        job.risposta=await conversation(db,chat,{...session,incidente_attivo_id:job.incidente_id},job.transcript,
          {input_type:'voice',telegram_file_id:job.file_id,voice_job_id:job.id},null,{jobId:job.id,deferDelivery:true});
        await save({risposta:job.risposta});
      }
      stage='delivery';
      await save({in_flight:true});job.in_flight=true;
      const sent=await (deps.send||telegram.sendTelegramMessage)(chat,job.risposta.text,{reply_markup:job.risposta.reply_markup});
      await save({stato:'inviato',in_flight:false,telegram_message_id:sent?.message_id || null,errore_codice:null,lease_token:null,lease_until:null});
      completed++;
    } catch(error) {
      const uncertain=job.in_flight && !error.telegramRejected;
      const exhausted=claimed.tentativi>=5 || (error.telegramRejected && error.status!==429 && error.status<500);
      const detail=/^[A-Za-z0-9_]{1,50}$/.test(String(error.code || '')) ? error.code : error.name==='TimeoutError'?'timeout':'processing_failed';
      const code=uncertain?'telegram_delivery_uncertain':stage+':'+detail;
      console.warn('Guardian vocale:',code);
      await save({stato:uncertain?'incerto':exhausted?'fallito':'in_coda',errore_codice:code,
        in_flight:uncertain,next_attempt_at:new Date(Date.now()+Math.max(error.retryAfter || 0,Math.min(900,60*2**claimed.tentativi))*1000).toISOString(),lease_token:null,lease_until:null});
      await notify(uncertain?'uncertain':exhausted?'failed':'retry',uncertain
        ? 'Ho conservato il vocale e la risposta, ma la consegna Telegram non è confermata. Serve una verifica prima di ripetere l’invio.'
        : exhausted ? 'Non sono riuscito a completare il vocale dopo più tentativi. Il file e l’eventuale trascrizione sono conservati; non occorre registrarlo nuovamente.'
        : 'Il vocale è salvato. L’elaborazione ha incontrato un errore temporaneo e verrà riprovata automaticamente; non occorre registrarlo nuovamente.');
      break;
    }
  }
  return {completed};
}
module.exports={enqueue,processQueue,retry,nudge,signature,validRequest};
