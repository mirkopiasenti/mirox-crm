'use strict';
const {createHash}=require('node:crypto');
const {SHA}=require('./guardian-release');
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function validateReview(review,head) {
  if(!review || review.reviewed_by!=='codex_local' || review.head_sha!==head || !SHA.test(head || '')
    || !/^[a-f0-9]{64}$/.test(review.hash || '') || typeof review.plan_json!=='string' || review.plan_json.length>40000
    || createHash('sha256').update(review.plan_json).digest('hex')!==review.hash)throw new Error('Piano catalogo non revisionato per questa versione');
  const plan=JSON.parse(review.plan_json);
  if(plan.version!==1 || !Array.isArray(plan.offers) || !Array.isArray(plan.daily_rows) || !Array.isArray(plan.daily_updates)
    || plan.offers.length+plan.daily_rows.length+plan.daily_updates.length<1
    || [plan.offers,plan.daily_rows,plan.daily_updates].some(items=>items.length>10))throw new Error('Piano catalogo non valido');
  if(Object.keys(plan).some(key=>!['version','offers','daily_rows','daily_updates'].includes(key)))throw new Error('Operazione catalogo non consentita');
  const record=value=>value && typeof value==='object' && !Array.isArray(value);
  const text=(value,max)=>typeof value==='string' && value.length>=3 && value.length<=max;
  for(const item of plan.offers) {
    if(!record(item) || Object.keys(item).some(key=>!['id','categoria_id','cluster_cliente','nome_offerta','descrizione','punteggio_gara','punteggio_extra_gara','abilita_dispositivo','abilita_switch_sim'].includes(key))
      || !UUID_RE.test(item.id || '') || !UUID_RE.test(item.categoria_id || '') || !['Consumer','Business','Turista'].includes(item.cluster_cliente)
      || !text(item.nome_offerta,180) || (item.descrizione!==undefined && (typeof item.descrizione!=='string' || item.descrizione.length>1000))
      || ['punteggio_gara','punteggio_extra_gara'].some(key=>typeof item[key]!=='number' || !Number.isFinite(item[key]) || item[key]<0 || item[key]>1000)
      || typeof item.abilita_dispositivo!=='boolean' || typeof item.abilita_switch_sim!=='boolean')throw new Error('Offerta nel piano non valida');
  }
  const rule=value=>record(value) && JSON.stringify(value).length<=4000;
  for(const item of plan.daily_rows) {
    if(!record(item) || Object.keys(item).some(key=>!['name','group','color','order','rule'].includes(key))
      || !text(item.name,180) || !text(item.group,100) || !/^#[a-f0-9]{6}$/i.test(item.color || '')
      || !Number.isInteger(item.order) || item.order<0 || item.order>100000 || !rule(item.rule))throw new Error('Riga nel piano non valida');
  }
  for(const item of plan.daily_updates) {
    if(!record(item) || Object.keys(item).some(key=>!['id','expected_name','expected_rule','rule'].includes(key))
      || !Number.isSafeInteger(item.id) || item.id<1 || !text(item.expected_name,180) || !rule(item.expected_rule) || !rule(item.rule))throw new Error('Aggiornamento nel piano non valido');
  }
  return plan;
}
async function reviewForTest(supabase,tested) {
  const patchId=tested.risultato?.development?.patch_execution_id;
  if(!patchId)return null;
  const {data:patch,error}=await supabase.from('kona_ai_esecuzioni').select('*').eq('id',patchId).maybeSingle();
  if(error)throw error;
  const {data:approval,error:approvalError}=await supabase.from('kona_ai_approvazioni').select('*').eq('id',patch?.approvazione_id).maybeSingle();
  if(approvalError)throw approvalError;
  const review=approval?.risultato?.catalog_review;
  if(!review) {if(patch?.risultato?.catalog_required)throw new Error('Manca la revisione del piano catalogo');return null;}
  validateReview(review,tested.result_commit_sha);
  if(patch.incidente_id!==tested.incidente_id || approval.incidente_id!==tested.incidente_id)throw new Error('Piano di un’altra richiesta');
  return {patch_execution_id:patch.id,patch_approval_id:approval.id,head_sha:review.head_sha,hash:review.hash,
    summary:String(review.summary || 'Configurazione catalogo revisionata').slice(0,1000)};
}
async function validateReference(supabase,reference,tested) {
  const actual=await reviewForTest(supabase,tested);
  if(actual===null && !reference)return null;
  const keys=['patch_execution_id','patch_approval_id','head_sha','hash','summary'];
  if(!actual || !reference || Object.keys(reference).length!==keys.length || keys.some(key=>actual[key]!==reference[key]))throw new Error('La revisione catalogo è cambiata');
  return actual;
}
module.exports={validateReview,reviewForTest,validateReference};
