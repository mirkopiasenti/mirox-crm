'use strict';
const {requireAuth,getAdminClient}=require('./_lib/require-auth');
const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET, OPTIONS'};
const reply=(statusCode,payload)=>({statusCode,headers,body:JSON.stringify(payload)});
const PAGES=['prenota_interno','registra_chiamata','appuntamenti','call_center_lead_outbound','rilavorazione'];
function validDate(value){
  if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(value))return false;
  const parsed=new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
}
async function handle(event,deps={}){
  if(event.httpMethod==='OPTIONS')return reply(200,{});
  if(event.httpMethod!=='GET')return reply(405,{ok:false,error:'Metodo non consentito'});
  const auth=await(deps.requireAuth||requireAuth)(event);
  if(!auth.ok)return reply(auth.status,{ok:false,error:auth.error});
  const date=event.queryStringParameters?.data;
  if(!validDate(date))return reply(400,{ok:false,error:'Data non valida'});
  try{
    const db=(deps.getAdminClient||getAdminClient)();
    const {data:profile,error:profileError}=await db.from('profili').select('id,ruolo,attivo,pagine_accessibili').eq('id',auth.user.id).single();
    if(profileError)throw profileError;
    if(!profile||profile.attivo!==true||(profile.ruolo!=='admin'&&!PAGES.some(p=>profile.pagine_accessibili?.[p]===true)))
      return reply(403,{ok:false,error:'Accesso non consentito'});
    const {data,error}=await db.rpc('mirox_cc_slot_disponibili_v1',{p_data:date});
    if(error)throw error;
    return reply(200,{ok:true,slots:data||[]});
  }catch(_){return reply(503,{ok:false,error:'Impossibile caricare la disponibilità. Riprova.'});}
}
exports.handler=event=>handle(event);
exports._test={handle,validDate};
