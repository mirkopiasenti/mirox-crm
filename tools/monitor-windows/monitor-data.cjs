'use strict';
// Solo trasporto e minimizzazione: il codice report scaricato viene eseguito nel browser.
const MAX_RESPONSE=4*1024*1024;
const CONTRACT_FIELDS='id,operatore_id,cluster_cliente,categoria_snapshot,nome_offerta_snapshot,nome_opzione_snapshot,nome_reload_snapshot,tipo_attivazione,apri_chiudi,intestatario,switch_sim,modalita_pagamento,dispositivo_associato,tipo_acquisto,fascia_prezzo,finanziaria,kolme,reload_exchange,data_contratto,stato_inserimento,reinserimento_fisso_finalizzato,codice_rivenditore,punteggio_gara_totale,punteggio_extra_gara_totale,punteggio_offerta,punteggio_opzione,punteggio_totale,punteggio_gara_offerta,punteggio_gara_opzione,punteggio_extra_gara_offerta,punteggio_extra_gara_opzione'.split(',');
function validateDataConfig(config){
  let url;try{url=new URL(config?.url);}catch{throw Error('Configurazione dati monitor non valida.');}
  if(url.protocol!=='https:'||!/^([a-z0-9]{20})\.supabase\.co$/.test(url.hostname)||url.port||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Origine dati monitor non valida.');
  const key=config.anonKey;
  if(typeof key!=='string'||key.length<20||key.startsWith('sb_secret_'))throw Error('Chiave pubblica monitor non valida.');
  if(!key.startsWith('sb_publishable_')){
    let claims;try{claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString('utf8'));}catch{throw Error('Chiave pubblica monitor non valida.');}
    if(claims.role!=='anon'||claims.ref!==url.hostname.split('.')[0])throw Error('Il monitor accetta solo la chiave pubblica del progetto configurato.');
  }
  return {url:url.origin,anonKey:key};
}
const pick=(row,fields)=>{
  if(!row||typeof row!=='object'||Array.isArray(row))throw Error('Dati monitor non validi.');
  return Object.fromEntries(fields.filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]]));
};
function minimize(input){
  const contracts=new Map();
  const contractId=id=>{
    if(typeof id!=='string'||!id)throw Error('Riferimenti monitor non validi.');
    if(!contracts.has(id))contracts.set(id,'c'+(contracts.size+1));
    return contracts.get(id);
  };
  const list=(value,fields)=>{
    if(!Array.isArray(value)||value.length>100000)throw Error('Dati monitor incompleti.');
    return value.map(row=>pick(row,fields));
  };
  const safe=pick(input,['versione','data','revisione','aggiornato_il','verificato_il','postazione','ultimo_csv']);
  for(const field of ['contratti','fttc'])safe[field]=list(input[field],CONTRACT_FIELDS).map(c=>({...c,id:contractId(c.id)}));
  safe.righe=list(input.righe,['id','nome','gruppo','colore_hex','ordine','regola']);
  safe.metriche=list(input.metriche,['id','nome','tabella','ordine','regola','punteggio_campo']);
  safe.obiettivi=list(input.obiettivi,['id','metrica_id','operatore_id','obiettivo']);
  safe.profili=list(input.profili,['id','nome','attivo','in_gara','alias_di']);
  safe.agenda=list(input.agenda,['id','data_ora','durata_minuti','presentato']).map(a=>({...a,id:String(a.id).slice(0,8)}));
  safe.post={};
  for(const field of ['fisso','energia','allarmi'])safe.post[field]=list(input.post?.[field],field==='fisso'?['contratto_id','stato','tecnologia']:['contratto_id','stato'])
    .filter(p=>contracts.has(p.contratto_id)).map(p=>({...p,contratto_id:contracts.get(p.contratto_id)}));
  return safe;
}
async function readJson(response){
  const length=response.headers?.get('content-length');
  if(length&&/^\d+$/.test(length)&&Number(length)>MAX_RESPONSE)throw Error('Risposta monitor troppo estesa.');
  let bytes=0;const chunks=[];
  if(!response.body)throw Error('Risposta monitor non valida.');
  for await(const chunk of response.body){bytes+=chunk.length;if(bytes>MAX_RESPONSE)throw Error('Risposta monitor troppo estesa.');chunks.push(Buffer.from(chunk));}
  return JSON.parse(Buffer.concat(chunks,bytes).toString('utf8'));
}
async function probeDataConfig(config,{remote=fetch}={}){
  const c=validateDataConfig(config);
  const response=await remote(c.url+'/rest/v1/rpc/mirox_monitor_leggi',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
    headers:{apikey:c.anonKey,...(c.anonKey.startsWith('sb_publishable_')?{}:{Authorization:'Bearer '+c.anonKey}),'Content-Type':'application/json'},
    body:JSON.stringify({p_token:'',p_revisione:null})});
  if(response.redirected||(response.url&&new URL(response.url).origin!==c.url))throw Error('Origine dati monitor non valida.');
  const data=await readJson(response);
  if(![401,403].includes(response.status)||data?.code!=='42501'||data.message!=='Postazione non associata o revocata.')throw Error('Servizio dati monitor non pronto.');
  return true;
}
function createDirectSource({config,remote=fetch}){
  const checked=validateDataConfig(config),endpoint=checked.url+'/rest/v1/rpc/mirox_monitor_leggi';
  let cache=null,currentSecret=null;
  return {
    reset(){cache=null;currentSecret=null;},
    async read(secret){
      if(!/^[a-f0-9]{64}$/.test(secret||''))throw Error('Credenziale monitor non valida.');
      if(currentSecret!==secret){cache=null;currentSecret=secret;}
      const response=await remote(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
        headers:{apikey:checked.anonKey,...(checked.anonKey.startsWith('sb_publishable_')?{}:{Authorization:'Bearer '+checked.anonKey}),'Content-Type':'application/json'},
        body:JSON.stringify({p_token:secret,p_revisione:cache?.revisione||null})});
      if(response.redirected||(response.url&&new URL(response.url).origin!==checked.url))throw Error('Origine dati monitor non valida.');
      if([401,403].includes(response.status)){
        cache=null;
        throw Object.assign(Error('Postazione non associata o revocata.'),{status:403});
      }
      const data=await readJson(response);
      if(!response.ok){
        const denied=data?.code==='42501'||[401,403].includes(response.status);
        if(denied)cache=null;
        throw Object.assign(Error(denied?'Postazione non associata o revocata.':'Aggiornamento dati non disponibile.'),{status:denied?403:503});
      }
      if(data?.versione!==2||!/^\d{4}-\d{2}-\d{2}:[a-f0-9]{32}:[a-f0-9]{32}$/.test(data.revisione||'')||
        data.data!==data.revisione.slice(0,10)||!Number.isFinite(Date.parse(data.verificato_il))||typeof data.postazione!=='string')throw Error('Risposta dati monitor non valida.');
      if(data.invariato===true){
        if(!cache||cache.data!==data.data||cache.revisione.split(':')[2]!==data.revisione.split(':')[2]){cache=null;throw Error('Copia locale monitor non disponibile.');}
        cache={...cache,revisione:data.revisione,verificato_il:data.verificato_il,postazione:data.postazione};
      }else{
        if(data.invariato!==false||!Number.isFinite(Date.parse(data.aggiornato_il)))throw Error('Dati monitor incompleti.');
        cache=minimize(data);
      }
      return cache;
    }
  };
}
module.exports={MAX_RESPONSE,CONTRACT_FIELDS,validateDataConfig,probeDataConfig,minimize,createDirectSource};
