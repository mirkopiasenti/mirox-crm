'use strict';
const {getAdminClient}=require('./_lib/require-auth');
const telegram=require('./_lib/target-telegram');
const {enqueue}=require('./_lib/target-queue');
const response=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
async function handler(event,deps={}) {
  if(event.httpMethod!=='POST') return response(405,{ok:false});
  if(!telegram.configured()) return response(503,{ok:false});
  const headers=Object.fromEntries(Object.entries(event.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));
  if(!telegram.equal(headers['x-telegram-bot-api-secret-token'],process.env.TELEGRAM_TARGET_WEBHOOK_SECRET)) return response(403,{ok:false});
  if((event.body||'').length>64000) return response(413,{ok:false});
  let update;
  try {update=JSON.parse(event.isBase64Encoded?Buffer.from(event.body,'base64').toString('utf8'):event.body);} catch {return response(400,{ok:false});}
  const message=update.message,owner=process.env.TELEGRAM_TARGET_OWNER_CHAT_ID;
  if(!message||message.chat?.type!=='private'||String(message.chat.id)!==owner||String(message.from?.id)!==owner||message.from?.is_bot) return response(200,{ok:true,ignored:true});
  if(!Number.isSafeInteger(update.update_id)||update.update_id<0) return response(400,{ok:false});
  if(!message.text&&!message.voice?.file_id) return response(200,{ok:true,ignored:true});
  try {
    const db=deps.db||getAdminClient();if(!db) throw new Error('database_unavailable');
    const id=await enqueue(db,{key:`telegram:${update.update_id}`,chat:owner,tipo:'dialogo',payload:{testo:String(message.text||'').slice(0,6000),...(message.voice?{voice_id:message.voice.file_id}:{})}});
    if(id) {try {await (deps.nudge||telegram.nudge)();} catch {console.warn('Target: consegna accodata, worker ripreso dal cron');}}
    return response(200,{ok:true});
  } catch {console.error('Target: accodamento webhook fallito');return response(503,{ok:false});}
}
module.exports={handler};
