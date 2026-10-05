'use strict';
const crypto=require('node:crypto');
const ORIGIN='https://mirox-crm.it';
function configured(env=process.env) {
  return env.TARGET_ENABLED==='true' && env.MIROX_DEPLOY_ENV!=='staging'
    && (!env.BRANCH||env.BRANCH==='main') && (!env.CONTEXT||env.CONTEXT==='production')
    && Boolean(env.TELEGRAM_TARGET_BOT_TOKEN?.trim()) && /^[1-9]\d*$/.test(env.TELEGRAM_TARGET_OWNER_CHAT_ID||'')
    && (env.TELEGRAM_TARGET_WEBHOOK_SECRET||'').length>=32 && (env.TARGET_WORKER_SECRET||'').length>=32;
}
function equal(a,b) {const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length>0&&x.length===y.length&&crypto.timingSafeEqual(x,y);}
function sign(body,secret=process.env.TARGET_WORKER_SECRET) {return crypto.createHmac('sha256',secret||'').update(body).digest('hex');}
function verify(body,signature,now=Date.now()) {
  if((process.env.TARGET_WORKER_SECRET||'').length<32||!equal(signature,sign(body))) return false;
  try {const data=JSON.parse(body);return Number.isSafeInteger(data.ts)&&Math.abs(now-data.ts)<=300000;} catch {return false;}
}
async function request(method,payload,fetcher=fetch) {
  const token=process.env.TELEGRAM_TARGET_BOT_TOKEN;
  let response,data;
  try {
    response=await fetcher(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:payload instanceof FormData?undefined:{'Content-Type':'application/json'},body:payload instanceof FormData?payload:JSON.stringify(payload),signal:AbortSignal.timeout(12000)});
    data=await response.json();
  } catch {const e=new Error('telegram_ambiguous');e.ambiguous=true;throw e;}
  if(!response.ok||!data.ok) {
    const e=new Error(`telegram_${data.error_code||response.status}`);
    e.retryAfter=data.parameters?.retry_after||null;
    e.retryable=(data.error_code||response.status)===429;
    e.ambiguous=response.status>=500;
    throw e;
  }
  return data.result;
}
async function send(text,fetcher=fetch) {
  const chat=process.env.TELEGRAM_TARGET_OWNER_CHAT_ID;
  if(!text) throw new Error('telegram_empty');
  if(text.length<=4000) return request('sendMessage',{chat_id:chat,text,disable_web_page_preview:true},fetcher);
  const form=new FormData();form.append('chat_id',chat);
  form.append('caption','MIROX AI - Target · Report completo in allegato (supera la lunghezza del messaggio Telegram).');
  form.append('document',new Blob([text],{type:'text/plain;charset=utf-8'}),'mirox-target-report.txt');
  return request('sendDocument',form,fetcher);
}
async function voice(fileId,fetcher=fetch) {
  const file=await request('getFile',{file_id:fileId},fetcher);
  if(!file.file_path||file.file_size>25*1024*1024||!/^voice\/[\w.-]+$/.test(file.file_path)) throw new Error('voice_invalid');
  const response=await fetcher(`https://api.telegram.org/file/bot${process.env.TELEGRAM_TARGET_BOT_TOKEN}/${file.file_path}`,{signal:AbortSignal.timeout(20000)});
  if(!response.ok) throw new Error('voice_unavailable');
  const bytes=await response.arrayBuffer();if(bytes.byteLength>25*1024*1024) throw new Error('voice_too_large');
  return {bytes,mimeType:'audio/ogg',filename:file.file_path.split('/').pop()};
}
async function nudge(fetcher=fetch) {
  const body=JSON.stringify({ts:Date.now()});
  const result=await fetcher(`${ORIGIN}/.netlify/functions/target-worker-background`,{method:'POST',headers:{'Content-Type':'application/json','X-Target-Signature':sign(body)},body,signal:AbortSignal.timeout(5000)});
  if(!result.ok) throw new Error('target_dispatch_failed');
}
module.exports={configured,equal,sign,verify,send,voice,nudge,request};
