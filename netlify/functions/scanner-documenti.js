'use strict';
const Busboy=require('busboy');
const Sessions=require('./_lib/scanner-sessioni');
const {requireAuth,getAdminClient}=require('./_lib/require-auth');
const {authorizePages}=require('./_lib/page-permissions');
const headers={'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
const reply=(statusCode,data)=>({statusCode,headers,body:JSON.stringify(data)});
function multipart(event){return new Promise((resolve,reject)=>{
  const parts=[];let invalid=false,count=0;
  const parser=Busboy({headers:{'content-type':event.headers?.['content-type']||event.headers?.['Content-Type']},limits:{files:1,fileSize:Sessions.Core.MAX_BYTES,fields:0}});
  parser.on('file',(_,stream,info)=>{count++;if(info.mimeType!=='application/pdf')invalid=true;stream.on('data',p=>parts.push(p));stream.on('limit',()=>{invalid=true;});});
  parser.on('filesLimit',()=>{invalid=true;});parser.on('fieldsLimit',()=>{invalid=true;});parser.on('error',reject);
  parser.on('finish',()=>invalid||count!==1?reject(Error('Invia un solo PDF di massimo 4 MB.')):resolve(Buffer.concat(parts)));
  parser.end(Buffer.from(event.body||'',event.isBase64Encoded?'base64':'binary'));
});}
async function handler(event,deps={}){
  if(event.httpMethod!=='POST')return reply(405,{success:false,error:'Metodo non consentito'});
  try{
    const h=event.headers||{},token=h['x-scanner-token']||h['X-Scanner-Token'];
    let auth=null;
    if(!token){auth=await (deps.requireAuth||requireAuth)(event,{endpoint:'scanner-documenti'});if(!auth.ok)return reply(auth.status,{success:false,error:auth.error});}
    const db=deps.db||getAdminClient();if(!db)throw Error('Servizio scanner non disponibile.');
    if(token){
      const id=h['x-scanner-id']||h['X-Scanner-Id'];
      const row=await Sessions.get(db,id,{token,secret:deps.secret});
      const owner=await (deps.authorizeOwner||authorizePages)(db,{ok:true,user:{id:row.operatore_id}},['upload_contratti']);
      if(!owner.ok)return reply(owner.status,{success:false,error:owner.error});
      if(/multipart\/form-data/i.test(h['content-type']||h['Content-Type']||''))return reply(200,{success:true,...await Sessions.upload(db,row,await (deps.multipart||multipart)(event),deps)});
      return reply(200,{success:true,stato:row.stato,pacchetto:row.pacchetto,cliente:row.cliente_snapshot.ragione_sociale,expires_at:row.expires_at});
    }
    const input=JSON.parse(event.body||'{}'),user=auth.user.id;
    if(input.action==='create')return reply(200,{success:true,...await Sessions.create(db,user,input.cliente,input.pacchetto,deps)});
    const row=await Sessions.get(db,input.id,{user});
    if(input.action==='status')return reply(200,{success:true,stato:row.stato,pacchetto:row.pacchetto,expires_at:row.expires_at});
    if(input.action==='cancel'){await Sessions.cancel(db,row);return reply(200,{success:true});}
    if(input.action==='download')return {statusCode:200,headers:{...headers,'Content-Type':'application/pdf'},isBase64Encoded:true,body:(await Sessions.download(db,row,input.cliente)).toString('base64')};
    return reply(400,{success:false,error:'Operazione non valida'});
  }catch(error){return reply(error.statusCode||400,{success:false,error:error.message||'Scansione non disponibile. Riprova.'});}
}
exports.handler=handler;exports._test={multipart};
