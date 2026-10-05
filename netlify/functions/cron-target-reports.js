'use strict';
const {getAdminClient}=require('./_lib/require-auth');
const telegram=require('./_lib/target-telegram');
const {enqueue}=require('./_lib/target-queue');
const {due,today}=require('./_lib/target-reports');
const schedule='*/5 * * * *';
async function handler(event={},deps={}) {
  // Netlify blocks URL invocation of scheduled functions; legacy events may include httpMethod.
  if(!telegram.configured()) return {statusCode:200,body:JSON.stringify({skipped:true})};
  const db=deps.db||getAdminClient(),now=deps.now||new Date();
  try {
    if(!db) throw new Error('database_unavailable');
    const chat=process.env.TELEGRAM_TARGET_OWNER_CHAT_ID;
    if(due(now)) await enqueue(db,{key:`evening:${today(now)}`,chat,tipo:'report',payload:{data:today(now)}});
    const {data,error}=await db.from('mirox_target_jobs').select('id').eq('chat_id',chat).in('stato',['in_coda','in_corso']).lte('next_attempt_at',now.toISOString()).limit(1);
    if(error) throw new Error('database_unavailable');
    if(data?.length) await (deps.nudge||telegram.nudge)();
    // Drop only Target's own terminal jobs; CRM records and documents are read-only.
    const cleanup=await db.from('mirox_target_jobs').delete().in('stato',['inviato','fallito','incerto']).lt('updated_at',new Date(now.getTime()-90*86400000).toISOString());
    if(cleanup.error) throw new Error('cleanup_failed');
    return {statusCode:200,body:JSON.stringify({ok:true})};
  } catch {console.error('Target: pianificazione o dispatch fallito');return {statusCode:500,body:JSON.stringify({ok:false})};}
}
module.exports={handler,schedule};
