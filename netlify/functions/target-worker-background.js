'use strict';
const {getAdminClient}=require('./_lib/require-auth');
const telegram=require('./_lib/target-telegram');
const {processQueue}=require('./_lib/target-queue');
async function handler(event,deps={}) {
  if(event.httpMethod!=='POST') return {statusCode:405};
  if(!telegram.configured()) return {statusCode:503};
  const headers=Object.fromEntries(Object.entries(event.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));
  const body=event.isBase64Encoded?Buffer.from(event.body||'','base64').toString('utf8'):event.body||'';
  if(body.length>1000||!telegram.verify(body,headers['x-target-signature'])) return {statusCode:403};
  const db=deps.db||getAdminClient();if(!db) return {statusCode:503};
  try {await processQueue(db,deps);return {statusCode:200};}
  catch {console.error('Target: worker fallito, coda persistente da verificare');return {statusCode:500};}
}
module.exports={handler};
