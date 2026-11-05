'use strict';
const {getAdminClient} = require('./_lib/require-auth');
const D=require('./_lib/monitor-device');
const getSnapshot=require('./_lib/monitor-snapshot').snapshotCache();
const reply=(statusCode,data)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},body:JSON.stringify(data)});
async function handle(event,deps={}) {
  if(!['GET','POST'].includes(event.httpMethod))return reply(405,{error:'Metodo non consentito'});
  const db=(deps.getAdminClient || getAdminClient)();
  if(!db)return reply(503,{error:'Servizio monitor non disponibile.'});
  try {
    if(event.httpMethod==='POST') {
      if((event.body || '').length>2048)D.fail('Richiesta troppo estesa.');
      let body;try{body=JSON.parse(event.body || '{}');}catch{D.fail('Richiesta non valida.');}
      if(!body || body.action!=='associa')D.fail('Azione non consentita.');
      return reply(200,await D.associate(db,event,body,deps.secret || process.env.SUPABASE_SERVICE_ROLE_KEY));
    }
    const device=await D.authenticate(db,event);
    const snapshot=await (deps.getSnapshot || getSnapshot)(db);
    // Anche una revoca avvenuta durante il calcolo impedisce la consegna.
    await D.authenticate(db,event);
    const now=(deps.now || (()=>new Date()))();
    if(!device.last_seen_at || now-Date.parse(device.last_seen_at)>300000) {
      D.checked(await db.from(D.TABLE).update({last_seen_at:now.toISOString()}).eq('id',device.id).eq('stato','attivo'));
    }
    return reply(200,{...snapshot,postazione:device.nome});
  }catch(error){return reply(error.status || 503,{error:error.status?error.message:'Impossibile aggiornare i KPI. Nuovo tentativo automatico.'});}
}
exports.handler=event=>handle(event);
exports._test={handle};
