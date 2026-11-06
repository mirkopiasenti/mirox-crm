'use strict';
// Scarica solo contenuti browser: mai eseguire questi byte nel processo Node.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const WEB=Object.freeze(['monitor.html','css/monitor.css','js/mirox-safe.js','js/mirox-api.js','js/monitor-core.js','js/monitor.js','assets/logo.png','assets/favicon.png','assets/fonts/InterVariable.woff2','assets/fonts/Inter-OFL.txt']);
const CHECK_MS=30000,ACK_MS=45000,MAX_FILE=2*1024*1024,MAX_TOTAL=4*1024*1024;
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function manifestFor(files) {
  const entries=Object.fromEntries(WEB.map(name=>[name,{bytes:files[name].length,sha256:digest(files[name])}]));
  return {formato:1,api:1,versione:digest(JSON.stringify({api:1,files:entries})),files:entries};
}
function validateManifest(value) {
  if(!value||value.formato!==1||value.api!==1||!value.files||Object.keys(value.files).length!==WEB.length)throw Error('Manifest pagina incompatibile.');
  let total=0;const entries={};
  for(const name of WEB){
    const item=value.files[name];
    if(!item||!Number.isInteger(item.bytes)||item.bytes<1||item.bytes>MAX_FILE||!/^[a-f0-9]{64}$/.test(item.sha256||''))throw Error('Manifest pagina non valido.');
    total+=item.bytes;entries[name]={bytes:item.bytes,sha256:item.sha256};
  }
  if(total>MAX_TOTAL||value.versione!==digest(JSON.stringify({api:1,files:entries})))throw Error('Impronta pagina non valida.');
  return {...value,files:entries};
}
function validatePageFiles(files) {
  validateManifest(manifestFor(files));
  const html=files['monitor.html'].toString('utf8');
  if(!html.includes('<!--MIROX_MONITOR_SESSION-->'))throw Error('Pagina senza sessione locale.');
  const check=name=>{if(!name.startsWith('#')&&!WEB.includes(path.posix.normalize(name.replace(/^\//,''))))throw Error('Risorsa pagina non supportata: '+name);};
  for(const tag of html.matchAll(/<(?:script|link|img)\b[^>]*>/gi)){
    const reference=tag[0].match(/\s(?:src|href)\s*=\s*["']([^"']+)["']/i);if(reference)check(reference[1]);
  }
  for(const match of files['css/monitor.css'].toString('utf8').matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/gi)){
    if(!match[1].startsWith('#'))check(match[1].startsWith('/')?match[1]:path.posix.join('css',match[1]));
  }
}
function createPageUpdates({root,origin,remote=fetch,now=Date.now,onRollback=()=>{}}) {
  const url=new URL(origin);
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash)throw Error('Origine aggiornamenti non valida.');
  origin=url.origin;
  const bundled=Object.fromEntries(WEB.map(name=>[name,fs.readFileSync(path.join(root,name))]));
  validatePageFiles(bundled);
  const factory=manifestFor(bundled).versione;
  const releases=new Map([[factory,bundled]]),blocked=new Set();
  let current=factory,previous=null,pending=null,work=null,timer=null,closed=false,controller=null,started=false;
  function prune(){for(const id of releases.keys())if(![factory,current,previous].includes(id))releases.delete(id);}
  async function download(relative,maxBytes,signal) {
    const res=await remote(origin+relative,{method:'GET',redirect:'error',cache:'no-store',headers:{'Cache-Control':'no-cache'},signal});
    if(!res.ok||res.redirected||(res.url&&new URL(res.url).origin!==origin))throw Error('Download pagina non disponibile.');
    const length=res.headers.get('content-length');
    const encoding=res.headers.get('content-encoding');
    if(length!==null&&(!/^\d+$/.test(length)||((!encoding||encoding==='identity')&&Number(length)>maxBytes)))throw Error('Pagina troppo grande.');
    if(!res.body)throw Error('Pagina vuota.');
    let total=0;const chunks=[];
    for await(const chunk of res.body){total+=chunk.length;if(total>maxBytes)throw Error('Pagina troppo grande.');chunks.push(Buffer.from(chunk));}
    return Buffer.concat(chunks,total);
  }
  async function check() {
    if(closed)return false;
    if(work)return work;
    controller=new AbortController();
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]);
    work=(async()=>{
      const manifest=validateManifest(JSON.parse((await download('/assets/monitor-release.json',16384,signal)).toString('utf8')));
      if(manifest.versione===current||blocked.has(manifest.versione)||pending)return false;
      const entries=await Promise.all(WEB.map(async name=>{
        const expected=manifest.files[name];
        const bytes=await download('/assets/monitor-releases/'+manifest.versione+'/'+name,expected.bytes,signal);
        if(bytes.length!==expected.bytes||digest(bytes)!==expected.sha256)throw Error('File pagina non integro.');
        return [name,bytes];
      }));
      const files=Object.fromEntries(entries);
      validatePageFiles(files);
      if(closed)return false;
      previous=current;current=manifest.versione;releases.set(current,files);pending={servedAt:null};prune();
      return true;
    })().catch(()=>{controller?.abort();return false;});
    try{return await work;}finally{work=null;controller=null;}
  }
  function checkRollback() {
    if(!pending||pending.servedAt===null||now()-pending.servedAt<=ACK_MS)return false;
    blocked.add(current);if(blocked.size>32)blocked.delete(blocked.values().next().value);
    current=previous;previous=null;pending=null;prune();
    try{onRollback();}catch{/* La pagina precedente resta disponibile. */}
    return true;
  }
  async function cycle(){await check();if(!closed)timer=setTimeout(cycle,CHECK_MS);}
  return {
    get version(){return current;},
    file:(name,id=current)=>WEB.includes(name)?releases.get(id)?.[name]:undefined,
    served:id=>{if(id===current&&pending&&pending.servedAt===null)pending.servedAt=now();},
    // Un viewer ancora sulla vecchia pagina avvia anche il timeout di passaggio.
    heartbeat:(id,ready=true,failed=false)=>{if(id===current){if(failed&&!pending&&previous&&previous!==current)pending={servedAt:now()};if(pending&&ready&&!failed)pending=null;return !failed;}if(pending&&id===previous&&pending.servedAt===null)pending.servedAt=now();return false;},
    check,checkRollback,
    start:()=>{if(!started&&!closed){started=true;cycle();}},
    close:()=>{closed=true;clearTimeout(timer);controller?.abort();}
  };
}
module.exports={WEB,CHECK_MS,ACK_MS,manifestFor,validateManifest,validatePageFiles,createPageUpdates};
