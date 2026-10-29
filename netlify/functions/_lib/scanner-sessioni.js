'use strict';
const crypto=require('node:crypto');
const Core=require('../../../js/scanner-documenti-core');
const Identity=require('./identita-upload');
const QR=require('qrcode');
const TABLE='vendita_scanner_sessioni',BUCKET='contratti-vendita';
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const checked=r=>{if(r.error)throw Object.assign(Error('Servizio scansione non disponibile. Riprova.'),{code:r.error.code,statusCode:503});return r.data;};
const fail=(message,statusCode=400)=>{throw Object.assign(Error(message),{statusCode});};
const pathFor=id=>'temp-scanner/'+id+'/documento.pdf';
function signature(id,nonce,secret){return crypto.createHmac('sha256',secret).update('mirox-scanner-v1\n'+id+'\n'+nonce).digest('base64url');}
function validToken(id,token,secret){try{if(!/^[a-f0-9-]{36}$/i.test(id)||typeof token!=='string'||!secret)return false;const [nonce,sig,extra]=token.split('.');if(extra||!/^[A-Za-z0-9_-]{43}$/.test(nonce||''))return false;const a=Buffer.from(sig||''),b=Buffer.from(signature(id,nonce,secret));return a.length===b.length&&crypto.timingSafeEqual(a,b);}catch{return false;}}
async function create(db,user,customer,pacchetto,{secret=process.env.SUPABASE_SERVICE_ROLE_KEY,now=Date.now(),origin=process.env.URL||'https://mirox-crm.it',qr=QR.toDataURL}={}){
  if(!secret)fail('Scanner non configurato.',503);
  const normalized=Identity.Core.customer(customer);const m=Core.manifest(pacchetto);Core.sides(m);
  if(customer.cluster==='Turista'||!normalized.nome||!/^(?:[A-Z0-9]{16}|\d{11})$/.test(normalized.fiscale))fail('Completa l’anagrafica o usa il percorso PDF per il passaporto.');
  const current=checked(await db.from('anagrafica').select('cf_piva,cluster,ragione_sociale,nome_referente').ilike('cf_piva',normalized.fiscale).limit(2));
  if(current.length>1||current[0]&&!Identity.Core.sameCustomer({...customer,...Object.fromEntries(Object.entries(current[0]).filter(([,v])=>v!==null&&String(v).trim()))},customer))fail('L’anagrafica è cambiata. Ricarica i dati prima della scansione.');
  const active=checked(await db.from(TABLE).select('id').eq('operatore_id',user).gt('expires_at',new Date(now).toISOString()).in('stato',['aperta','in_caricamento','pronta']).limit(6));
  if(active.length>=5)fail('Sono già aperte diverse scansioni. Chiudile o attendi la scadenza del QR.',429);
  const id=crypto.randomUUID(),nonce=crypto.randomBytes(32).toString('base64url'),token=nonce+'.'+signature(id,nonce,secret);
  const snapshot=Object.fromEntries(['cf_piva','cluster','ragione_sociale','nome_referente'].map(k=>[k,String(customer[k]||'').trim()]));
  const row={id,operatore_id:user,cliente_snapshot:snapshot,pacchetto:m,token_hash:hash(token),expires_at:new Date(now+Core.TTL_MS).toISOString(),stato:'aperta'};
  checked(await db.from(TABLE).insert(row));
  const url=new URL('/moduli/scanner-documenti.html',origin);url.hash=new URLSearchParams({id,token}).toString();
  return {id,expires_at:row.expires_at,qr:await qr(url.href,{width:280,margin:2,errorCorrectionLevel:'M'})};
}
async function get(db,id,{user,token,secret=process.env.SUPABASE_SERVICE_ROLE_KEY,now=Date.now()}={}){
  if(!/^[a-f0-9-]{36}$/i.test(id||''))fail('Sessione non valida.',403);
  if(!user&&!validToken(id,token,secret))fail('QR non valido. Aprine uno nuovo dal CRM.',403);
  const row=checked(await db.from(TABLE).select('*').eq('id',id).maybeSingle());
  if(!row||user&&row.operatore_id!==user||!user&&row.token_hash!==hash(token))fail('Sessione non disponibile.',403);
  if(Date.parse(row.expires_at)<=now||row.stato==='annullata')fail('QR scaduto o annullato. Generane uno nuovo dal CRM.',410);
  return row;
}
async function upload(db,row,bytes,deps={}){
  if(bytes.length>Core.MAX_BYTES||!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))fail('Il documento deve essere un PDF di massimo 4 MB.');
  const pages=await (deps.pdfInfo||require('./verifica-documenti').pdfInfo)(bytes);
  if(pages!==Core.sides(row.pacchetto).length)fail('Mancano fronte/retro del documento o della tessera sanitaria.');
  const digest=hash(bytes);
  if(['pronta','consumata'].includes(row.stato)){if(row.sha256===digest)return {stato:row.stato};fail('Questa scansione è già stata inviata.',409);}
  if(row.stato!=='aperta')fail('Invio già in corso. Attendi il completamento.',409);
  const locked=checked(await db.from(TABLE).update({stato:'in_caricamento'}).eq('id',row.id).eq('stato','aperta').select('id').maybeSingle());
  if(!locked)fail('Scansione già inviata o annullata.',409);
  const path=pathFor(row.id);
  try{
    checked(await db.storage.from(BUCKET).upload(path,bytes,{contentType:'application/pdf',upsert:false}));
    const saved=checked(await db.from(TABLE).update({stato:'pronta',sha256:digest}).eq('id',row.id).eq('stato','in_caricamento').gt('expires_at',new Date().toISOString()).select('id').maybeSingle());
    if(!saved)throw Error('La sessione è scaduta durante l’invio.');
    return {stato:'pronta'};
  }catch(error){
    // Una risposta persa non dimostra un rollback: non rimuovere un file gia pronto.
    const current=await db.from(TABLE).select('*').eq('id',row.id).maybeSingle();
    if(current.error)throw error;
    if(['pronta','consumata'].includes(current.data?.stato)){
      if(current.data.sha256===digest)return {stato:current.data.stato};
      throw error;
    }
    const removed=await db.storage.from(BUCKET).remove([path]);
    if(!removed.error)await db.from(TABLE).update({stato:'aperta'}).eq('id',row.id).eq('stato','in_caricamento');
    throw error;
  }
}
async function download(db,row,customer){
  if(!Identity.Core.sameCustomer(row.cliente_snapshot,customer))fail('L’anagrafica è cambiata: ripeti la scansione.',409);
  if(!['pronta','consumata'].includes(row.stato))fail('Attendi l’invio dal telefono.',409);
  const blob=checked(await db.storage.from(BUCKET).download(pathFor(row.id))),bytes=Buffer.from(await blob.arrayBuffer());
  if(hash(bytes)!==row.sha256)fail('Il documento ricevuto non è integro. Ripeti la scansione.',409);
  const saved=checked(await db.from(TABLE).update({stato:'consumata'}).eq('id',row.id).in('stato',['pronta','consumata']).gt('expires_at',new Date().toISOString()).select('id').maybeSingle());
  if(!saved)fail('Scansione annullata o scaduta.',410);
  return bytes;
}
async function cancel(db,row){checked(await db.from(TABLE).update({stato:'annullata'}).eq('id',row.id));checked(await db.storage.from(BUCKET).remove([pathFor(row.id)]));}
async function cleanup(db,now=new Date().toISOString()){
  const rows=checked(await db.from(TABLE).select('id').lt('expires_at',now).limit(100));
  for(const row of rows){checked(await db.storage.from(BUCKET).remove([pathFor(row.id)]));checked(await db.from(TABLE).delete().eq('id',row.id).lt('expires_at',now));}
  return rows.length;
}
module.exports={create,get,upload,download,cancel,cleanup,validToken,pathFor,TABLE,Core};
