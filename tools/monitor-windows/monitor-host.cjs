'use strict';
// Servizio loopback: nessun proxy generico, nessun segreto al browser.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync,execFile}=require('node:child_process');
const powershell=process.platform==='win32'?path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'):'powershell.exe';
const {WEB,createPageUpdates}=require('./monitor-updates.cjs');
const POLL_MS=3000;
const FILES={'/monitor':'monitor.html','/':'monitor.html','/monitor.html':'monitor.html','/css/monitor.css':'css/monitor.css','/js/mirox-safe.js':'js/mirox-safe.js','/js/mirox-api.js':'js/mirox-api.js','/js/monitor-core.js':'js/monitor-core.js','/js/monitor.js':'js/monitor.js','/assets/logo.png':'assets/logo.png','/assets/favicon.png':'assets/favicon.png','/assets/fonts/InterVariable.woff2':'assets/fonts/InterVariable.woff2'};
function validateOrigin(value,environment='production') {
  const u=new URL(value);
  if(u.protocol!=='https:' || u.username || u.password || u.port || u.pathname!=='/' || u.search || u.hash)throw Error('Origine remota non valida.');
  if(environment==='production' && u.hostname!=='mirox-crm.it')throw Error('Il pacchetto production accetta solo mirox-crm.it.');
  if(environment!=='production' && (!u.hostname.endsWith('.netlify.app') || u.hostname==='mirox-crm.netlify.app'))throw Error('Lo staging richiede un deploy Netlify separato.');
  return u.origin;
}
function vault(root) {
  function run(mode,input){try{return execFileSync(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'vault.ps1'),'-Mode',mode,'-Path',path.join(root,'state.bin')],{input:input || '',encoding:'utf8',windowsHide:true,timeout:15000,stdio:['pipe','pipe','pipe']}).trim();}catch{throw Error('Archivio credenziali Windows non disponibile.');}}
  return {read:()=>fs.existsSync(path.join(root,'state.bin'))?JSON.parse(run('read')):null,write:state=>run('write',JSON.stringify(state))};
}
function createHost({root,origin,environment='production',store=vault(root),remote=fetch,now=Date.now,restartBrowser=()=>{},port=8765,pageUpdates=null}) {
  origin=validateOrigin(origin,environment);
  const nonce=crypto.randomBytes(32).toString('hex');
  let credential=store.read(),snapshot=null,stato=credential?.associated?'caricamento':'non_associato',errore=null;
  let busy=false,remoteBusy=false,timer=null,heartbeat=0,lastRestart=0,closed=false,failures=0,credentialRejected=false;
  const startedAt=now();
  if(credential && !/^[a-f0-9]{64}$/.test(credential.secret || ''))throw Error('Archivio postazione non valido.');
  function persistCredential(next) {
    try{store.write(next);}catch{throw Object.assign(Error('Impossibile salvare l’associazione sul PC. Aggiorna il pacchetto Windows e riprova.'),{code:'MONITOR_VAULT_WRITE'});}
    credential=next;
  }
  async function call(method,body) {
    const res=await remote(origin+'/.netlify/functions/monitor-kpi',{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{...(method==='GET'?{Authorization:'MiroxMonitor '+credential.secret}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const data=await res.json();
    if(!res.ok)throw Object.assign(Error(data.error || 'Aggiornamento remoto non disponibile.'),{status:res.status});
    return data;
  }
  async function refresh(force=false) {
    if(remoteBusy || (busy && !force) || !credential || stato==='revocato')return;
    remoteBusy=true;
    try {
      const data=await call('GET');
      if(data.versione!==1 || typeof data.data!=='string' || !Array.isArray(data.day) || !Array.isArray(data.mensile) || !data.agenda)throw Error('Risposta KPI non valida.');
      if(!credential.associated)persistCredential({...credential,associated:true});
      snapshot=data;stato='attivo';errore=null;failures=0;credentialRejected=false;
    }catch(error){
      failures++;
      if(error.status===403){snapshot=null;stato=credential.associated?'revocato':'non_associato';credentialRejected=true;}
      errore=error.code==='MONITOR_VAULT_WRITE'?error.message:error.status===403?'Accesso non disponibile.':'Aggiornamento remoto interrotto. Nuovo tentativo automatico.';
    }finally{remoteBusy=false;}
  }
  async function cycle(){const began=now();await refresh();if(!closed)timer=setTimeout(cycle,failures?Math.min(30000,POLL_MS*2**Math.min(failures,4)):Math.max(250,POLL_MS-(now()-began)));}
  const localOrigin='http://127.0.0.1:'+port;
  const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
  const server=http.createServer(async(req,res)=>{
    if(req.headers.host!=='127.0.0.1:'+port || req.socket.remoteAddress!=='127.0.0.1')return json(res,403,{error:'Richiesta locale non valida.'});
    if(req.headers.origin && req.headers.origin!==localOrigin)return json(res,403,{error:'Origine non consentita.'});
    if(req.headers['sec-fetch-site']==='cross-site')return json(res,403,{error:'Richiesta esterna non consentita.'});
    let url;try{if(!req.url.startsWith('/')||req.url.startsWith('//'))throw Error();url=new URL(req.url,localOrigin);if(url.origin!==localOrigin)throw Error();}catch{return json(res,400,{error:'Indirizzo locale non valido.'});}
    if(url.search)return json(res,400,{error:'Parametri non consentiti.'});
    try {
      const versioned=/^\/__monitor_release\/([a-f0-9]{64})(\/.*)$/.exec(url.pathname);
      const route=versioned?versioned[2]:url.pathname;
      if(FILES[route] && req.method==='GET') {
        const relative=FILES[route],isHtml=relative==='monitor.html';
        if(versioned&&(!pageUpdates||isHtml))return json(res,404,{error:'Versione pagina non disponibile.'});
        const release=versioned?versioned[1]:pageUpdates?.version;
        let bytes=pageUpdates?pageUpdates.file(relative,release):fs.readFileSync(path.join(root,relative));
        if(!bytes)return json(res,404,{error:'Versione pagina non disponibile.'});
        if(isHtml){
          let html=bytes.toString('utf8').replace('<!--MIROX_MONITOR_SESSION-->',`<meta name="mirox-monitor-session" content="${nonce}">${release?`<meta name="mirox-monitor-release" content="${release}">`:''}`);
          if(release){html=html.replace(/\b(src|href)\s*=\s*["']([^"']+)["']/gi,(match,attr,value)=>{const name=path.posix.normalize(value.replace(/^\//,''));return WEB.includes(name)?`${attr}="/__monitor_release/${release}/${name}"`:match;});pageUpdates.served(release);}
          bytes=Buffer.from(html);
        }
        const mime=isHtml?'text/html; charset=utf-8':relative.endsWith('.js')?'text/javascript; charset=utf-8':relative.endsWith('.css')?'text/css; charset=utf-8':relative.endsWith('.woff2')?'font/woff2':relative.endsWith('logo.png')?'image/jpeg':'image/png';
        res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Permissions-Policy':'camera=(), microphone=(), geolocation=()',
          'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"});res.end(bytes);return;
      }
      if(req.headers['x-mirox-monitor-session']!==nonce)return json(res,403,{error:'Sessione locale scaduta. Ricarica la pagina.'});
      if(url.pathname==='/api/snapshot' && req.method==='GET')return json(res,200,{stato,errore,snapshot,...(pageUpdates?{pagina_versione:pageUpdates.version}:{})});
      if(!['/api/associa','/api/heartbeat'].includes(url.pathname)||req.method!=='POST')return json(res,405,{error:'Operazione non consentita.'});
      if(!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || ''))return json(res,415,{error:'Formato non consentito.'});
      let body='';for await(const chunk of req){body+=chunk;if(body.length>2048)return json(res,413,{error:'Richiesta troppo estesa.'});}
      let data;try{data=JSON.parse(body);}catch{return json(res,400,{error:'Richiesta non valida.'});}
      if(url.pathname==='/api/heartbeat'){if(!data||typeof data!=='object')return json(res,400,{error:'Richiesta non valida.'});const healthy=pageUpdates?pageUpdates.heartbeat(data.pagina_versione,data.rendering!==false,data.errore_render===true):true;if(healthy)heartbeat=now();return json(res,200,{ok:true});}
      if(busy || remoteBusy)return json(res,409,{error:'Aggiornamento in corso. Riprova fra pochi secondi.'});
      if(!data || typeof data.code!=='string' || !/^[a-f0-9\s-]{16,24}$/i.test(data.code))return json(res,400,{error:'Codice non valido.'});
      busy=true;
      try {
        // Anche lo stato legacy associated:false puo' contenere una chiave gia
        // registrata e revocata: un 403 confermato richiede una nuova chiave.
        if(!credential || credential.associated || credentialRejected){persistCredential({secret:crypto.randomBytes(32).toString('hex'),associated:false});credentialRejected=false;}
        await call('POST',{action:'associa',code:data.code,token_hash:crypto.createHash('sha256').update(credential.secret).digest('hex')});
        persistCredential({...credential,associated:true});stato='caricamento';snapshot=null;failures=0;
        await refresh(true);json(res,200,{ok:true});
      }catch(error){const status=[400,429].includes(error.status)?error.status:503;json(res,status,{error:error.code==='MONITOR_VAULT_WRITE'||status===400?error.message:status===429?'Troppi tentativi. Riprova fra 15 minuti.':'Associazione non completata. Riprova con lo stesso codice.'});}finally{busy=false;}
    }catch{json(res,503,{error:'Servizio locale temporaneamente non disponibile.'});}
  });
  server.requestTimeout=20000;server.headersTimeout=10000;server.maxHeadersCount=40;
  function checkWatchdog(){pageUpdates?.checkRollback();const age=now()-(heartbeat || startedAt);if(age>(heartbeat?120000:180000) && now()-lastRestart>120000){lastRestart=now();restartBrowser();}}
  const watch=setInterval(checkWatchdog,15000);
  watch.unref();
  return {server,refresh,checkWatchdog,start:()=>{server.listen(port,'127.0.0.1');cycle();pageUpdates?.start();},close:()=>{closed=true;clearTimeout(timer);clearInterval(watch);pageUpdates?.close();server.close();},state:()=>({stato,snapshot,errore})};
}
if(require.main===module) {
  try {
    if(process.platform!=='win32')throw Error('Il servizio richiede Windows 11.');
    const root=__dirname,config=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8').replace(/^\uFEFF/,''));
    const restartBrowser=()=>execFile(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'restart-browser.ps1')],{windowsHide:true,timeout:20000},()=>{});
    const pageUpdates=createPageUpdates({root,origin:validateOrigin(config.origin,config.environment),onRollback:restartBrowser});
    const host=createHost({root,...config,restartBrowser,pageUpdates});host.server.on('error',()=>process.exit(1));host.start();
  }catch{process.stderr.write('Servizio monitor non avviato. Verifica installazione e configurazione.\n');process.exitCode=1;}
}
module.exports={createHost,validateOrigin,FILES,POLL_MS};
