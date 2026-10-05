'use strict';
const crypto=require('node:crypto');
const {today,validateDate,buildReports,formatReportMessages}=require('./target-reports');
const dialogue=require('./target-dialogue');
const telegram=require('./target-telegram');
const LEASE_MS=20*60*1000;
const checked=result=> {if(result.error) throw new Error('target_database_error');return result.data;};
async function ensureSession(db,chat) {
  checked(await db.from('mirox_target_sessioni').upsert({chat_id:chat},{onConflict:'chat_id',ignoreDuplicates:true}));
}
async function enqueue(db,{key,chat,tipo,payload}) {
  await ensureSession(db,chat);
  const result=await db.from('mirox_target_jobs').insert({dedupe_key:key,chat_id:chat,tipo,payload}).select('id').single();
  if(result.error?.code==='23505') return null;
  const job=checked(result);return job.id;
}
function command(text,now=new Date()) {
  const trimmed=text.trim();
  const match=/^\/(report|vendite|chiamate|mese)(?:@\w+)?(?:\s+(\d{4}-\d{2}-\d{2}))?$/i.exec(trimmed);
  if(match) return {action:match[1].toLowerCase(),date:validateDate(match[2]||today(now),now)};
  if(/^(?:(?:mandami|inviami|mostrami|aggiorna|aggiornami)\s+(?:i |il |un )?)?report(?:\s+(?:aggiornato|di oggi|di ieri|del \d{4}-\d{2}-\d{2}))?[.!?]?$/i.test(trimmed)) {
    let date=today(now);
    if(/ieri/i.test(trimmed)) {const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-1);date=d.toISOString().slice(0,10);}
    const explicit=trimmed.match(/\d{4}-\d{2}-\d{2}/); if(explicit) date=explicit[0];
    return {action:'report',date:validateDate(date,now)};
  }
  const simple=/^\/(start|aiuto|salute|nuova)(?:@\w+)?$/i.exec(trimmed);
  return simple?{action:simple[1].toLowerCase()}:null;
}
const WELCOME='MIROX AI - Target\n\nParliamo liberamente di vendite, chiamate e obiettivi: puoi farmi domande, chiedere confronti e discutere i risultati.\n\nI tre report arrivano alle 19:45, dal lunedi al sabato escluse le festivita nazionali.\n/report aggiorna i tre report\n/report YYYY-MM-DD per un altro giorno\n/vendite, /chiamate, /mese per un solo report\n/salute mostra lo stato delle consegne\n/nuova ricomincia la conversazione.';
async function prepare(db,job,session,deps) {
  const now=deps.now||new Date(),read=deps.read||((date)=>buildReports(db,date,now));
  if(job.tipo==='report') return {messages:formatReportMessages(await read(job.payload.data)),user:null};
  let text=job.payload.testo||'';
  if(job.payload.voice_id) text=await (deps.transcribe||dialogue.transcribe)(await (deps.voice||telegram.voice)(job.payload.voice_id));
  if(!text.trim()) return {messages:['Il messaggio non contiene testo leggibile. Puoi scrivermi o inviare un vocale.'],user:null};
  let cmd;
  try {cmd=command(text,now);} catch {return {messages:['Data non valida. Usa /report YYYY-MM-DD, dal 2020 a oggi.'],user:text};}
  if(cmd && ['report','vendite','chiamate','mese'].includes(cmd.action)) {
    const all=formatReportMessages(await read(cmd.date));
    return {messages:cmd.action==='report'?all:[all[{vendite:0,chiamate:1,mese:2}[cmd.action]]],user:text};
  }
  if(cmd?.action==='start'||cmd?.action==='aiuto') return {messages:[WELCOME],user:text};
  if(cmd?.action==='nuova') {
    checked(await db.from('mirox_target_sessioni').update({conversazione:[]}).eq('chat_id',session.chat_id).eq('lock_token',session.lock_token));
    session.conversazione=[];
    return {messages:['Conversazione ricominciata. Dimmi pure da dove vuoi partire.'],user:null};
  }
  if(cmd?.action==='salute') {
    const recent=checked(await db.from('mirox_target_jobs').select('tipo,stato,inviati,created_at,errore_codice').eq('chat_id',session.chat_id).in('stato',['incerto','fallito']).order('created_at',{ascending:false}).limit(5));
    const latest=checked(await db.from('mirox_target_jobs').select('payload,updated_at').eq('chat_id',session.chat_id).eq('tipo','report').eq('stato','inviato').order('created_at',{ascending:false}).limit(1));
    return {messages:[`MIROX AI - Target\nInvio: 19:45 Europe/Rome, lun-sab escluse festivita nazionali.\nUltimo report serale completato: ${latest[0]?.payload?.data||'nessuno'}.\nConsegne recenti da verificare: ${recent.length}.${recent.length?'\nUn esito incerto non viene ritentato automaticamente. /report richiede una nuova copia.':''}`],user:text};
  }
  if(text.startsWith('/')) return {messages:[WELCOME],user:text};
  const history=Date.parse(session.updated_at)<now.getTime()-90*86400000?[]:session.conversazione;
  return {messages:[await (deps.reply||dialogue.reply)(db,text,history)],user:text};
}
async function processQueue(db,deps={}) {
  const now=deps.now||new Date(),chat=process.env.TELEGRAM_TARGET_OWNER_CHAT_ID;
  await ensureSession(db,chat);
  const token=crypto.randomUUID();
  const session=checked(await db.from('mirox_target_sessioni').update({lock_token:token,lease_until:new Date(now.getTime()+LEASE_MS).toISOString()})
    .eq('chat_id',chat).or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`).select('*').maybeSingle());
  if(!session) return {busy:true};
  let completed=0; const startedAt=Date.now();
  try {
    for(let n=0;n<5 && Date.now()-startedAt<8*60*1000;n++) {
      const job=checked(await db.from('mirox_target_jobs').select('*').eq('chat_id',chat).in('stato',['in_coda','in_corso'])
        .order('created_at').order('id').limit(1).maybeSingle());
      if(!job || Date.parse(job.next_attempt_at) > (deps.now || new Date()).getTime()) break;
      const update=async values=>checked(await db.from('mirox_target_jobs').update({...values,updated_at:new Date().toISOString()}).eq('id',job.id));
      if(job.in_flight) {await update({stato:'incerto',errore_codice:'delivery_checkpoint_missing'});continue;}
      if(job.tentativi>=8) {await update({stato:'fallito',errore_codice:'retry_limit'});continue;}
      await update({stato:'in_corso',tentativi:job.tentativi+1});
      let prepared;
      try {
        if(!job.messaggi.length) {
          prepared=await prepare(db,job,session,deps);
          job.messaggi=prepared.messages;
          await update({messaggi:job.messaggi,payload:{...job.payload,user:prepared.user}});
          job.payload.user=prepared.user;
        }
        for(let i=job.inviati;i<job.messaggi.length;i++) {
          const deliverable=await (deps.prepareMessage||telegram.prepareMessage)(job.messaggi[i]);
          await update({in_flight:true});job.in_flight=true;
          await (deps.send||telegram.send)(deliverable);
          // Persist progress before another Telegram request: a lost checkpoint is ambiguous.
          await update({inviati:i+1,in_flight:false});job.in_flight=false;
          await (deps.pause || (ms=>new Promise(resolve=>setTimeout(resolve,ms))))(1100);
        }
        const history=dialogue.trimHistory([...(session.conversazione||[]),...(job.payload.user?[{role:'user',content:job.payload.user}]:[]),...job.messaggi.map(message=>({role:'assistant',content:telegram.messageText(message)}))]);
        checked(await db.from('mirox_target_sessioni').update({conversazione:history,updated_at:new Date().toISOString()}).eq('chat_id',chat).eq('lock_token',token));
        session.conversazione=history;
        await update({stato:'inviato',errore_codice:null});completed++;
      } catch(error) {
        // Only explicit rejection (e.g. 429) proves that Telegram did not accept a message.
        const ambiguous=job.in_flight && (error.ambiguous||!error.message?.startsWith('telegram_'));
        const permanent=job.in_flight&&!ambiguous&&!error.retryable;
        const attempts=job.tentativi+1;
        await update({stato:ambiguous?'incerto':permanent||attempts>=8?'fallito':'in_coda',in_flight:ambiguous,
          next_attempt_at:new Date(Date.now()+Math.max(error.retryAfter||0,Math.min(3600,60*2**attempts))*1000).toISOString(),
          errore_codice:ambiguous?'telegram_ambiguous':permanent?'telegram_rejected':'preparation_or_rate_limit'});
        // Preserve FIFO conversation order while a retryable job is waiting.
        break;
      }
    }
  } finally {
    checked(await db.from('mirox_target_sessioni').update({lock_token:null,lease_until:null}).eq('chat_id',chat).eq('lock_token',token));
  }
  return {completed};
}
module.exports={enqueue,ensureSession,processQueue,prepare,command,WELCOME};
