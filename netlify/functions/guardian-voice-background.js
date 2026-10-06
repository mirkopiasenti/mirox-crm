'use strict';
const {getAdminClient}=require('./_lib/require-auth');
const {validRequest,processQueue}=require('./_lib/guardian-voice');
async function handler(event,deps={}) {
 if(event.httpMethod!=='POST')return {statusCode:405};
 const body=event.body || '';
 const headers=Object.fromEntries(Object.entries(event.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));
 if(body.length>1000 || !validRequest(body,headers['x-guardian-voice-signature']))return {statusCode:403};
 const db=deps.db || getAdminClient();if(!db)return {statusCode:503};
 try {await processQueue(db,deps);return {statusCode:200};}
 catch {console.error('Guardian: coda vocali non completata');return {statusCode:500};}
}
module.exports={handler};
