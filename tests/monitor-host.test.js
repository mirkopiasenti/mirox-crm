'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {once}=require('node:events');
const {createHost,validateOrigin}=require('../tools/monitor-windows/monitor-host.cjs');
const {unzipSync,strFromU8}=require('fflate');
test('origini remote vincolate: HTTPS, niente redirect/proxy generico o production nello staging',()=>{assert.equal(validateOrigin('https://mirox-crm.it'),'https://mirox-crm.it');for(const url of ['http://mirox-crm.it','https://evil.example','https://user@mirox-crm.it','https://mirox-crm.it/path','https://mirox-crm.it?token=x'])assert.throws(()=>validateOrigin(url));assert.throws(()=>validateOrigin('https://mirox-crm.netlify.app','staging'));assert.equal(validateOrigin('https://deploy-example.netlify.app','staging'),'https://deploy-example.netlify.app');});
test('host loopback: nonce, origin/Host, pairing, credenziale fuori browser e revoca',async t=>{
  const root=path.resolve(__dirname,'..');let stored=null,revoked=false,requests=[];
  const remote=async(url,options)=>{requests.push({url,options});return options.method==='POST'?{ok:true,status:200,json:async()=>({id:'device',stato:'attivo'})}:revoked?{ok:false,status:403,json:async()=>({error:'revocato'})}:{ok:true,status:200,json:async()=>({versione:1,data:'2026-11-05',day:[],mensile:[],agenda:{},aggiornato_il:'2026-11-05T14:18:00Z'})};};
  const host=createHost({root,origin:'https://mirox-crm.it',port:0,store:{read:()=>stored,write:s=>{stored=structuredClone(s);}},remote});
  t.after(()=>host.close());host.start();await once(host.server,'listening');
  const request=(method,url,headers={},body)=>new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:host.server.address().port,path:url,method,headers:{Host:'127.0.0.1:0',...headers}},res=>{let data='';res.setEncoding('utf8');res.on('data',x=>data+=x);res.on('end',()=>resolve({status:res.statusCode,body:data,headers:res.headers}));});req.on('error',reject);req.end(body);});
  const html=await request('GET','/monitor');assert.equal(html.status,200);const nonce=html.body.match(/name="mirox-monitor-session" content="([a-f0-9]+)"/)[1];const h={'X-Mirox-Monitor-Session':nonce,'Content-Type':'application/json'};
  assert.equal((await request('GET','/api/snapshot')).status,403);
  assert.equal((await request('GET','/monitor',{Host:'evil.example'})).status,403);
  assert.equal((await request('GET','/api/snapshot',{...h,Origin:'https://evil.example'})).status,403);
  assert.equal((await request('GET','/api/snapshot',{...h,'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal((await request('GET','/api/snapshot?token=x',h)).status,400);
  const paired=await request('POST','/api/associa',h,JSON.stringify({code:'AAAA-BBBB-CCCC-DDDD'}));assert.equal(paired.status,200);assert.equal(stored.associated,true);assert.match(stored.secret,/^[a-f0-9]{64}$/);
  const sent=JSON.parse(requests[0].options.body);assert.equal(sent.token_hash,crypto.createHash('sha256').update(stored.secret).digest('hex'));assert.ok(!requests[0].options.headers.Authorization);assert.equal(requests[1].options.headers.Authorization,'MiroxMonitor '+stored.secret);assert.equal(requests[1].options.redirect,'error');
  const active=await request('GET','/api/snapshot',h);assert.equal(JSON.parse(active.body).stato,'attivo');assert.ok(!active.body.includes(stored.secret));assert.ok(!html.body.includes(stored.secret));
  revoked=true;await host.refresh();const state=JSON.parse((await request('GET','/api/snapshot',h)).body);assert.equal(state.stato,'revocato');assert.equal(state.snapshot,null);
  assert.equal((await request('POST','/api/heartbeat',h,'{}')).status,200);
  assert.equal((await request('POST','/api/heartbeat',h,'null')).status,400);
  assert.equal((await request('GET','http://%')).status,400);
  assert.equal((await request('GET','//evil.example/monitor')).status,400);
  assert.equal((await request('GET','/monitor')).status,200,'richieste non valide non interrompono il servizio');
  assert.equal((await request('GET','/state.bin',h)).status,405);
});
test('pacchetto build: solo file in allowlist, credenziali assenti e hash verificabili',()=>{const root=path.resolve(__dirname,'..'),zip=fs.readFileSync(path.join(root,'dist/assets/mirox-monitor-windows.zip')),files=unzipSync(zip);assert.ok(files['monitor-host.cjs']&&files['monitor-updates.cjs']&&files['installa-monitor.cmd']&&files['install.ps1']&&files['monitor.html']);assert.ok(!Object.keys(files).some(n=>n.includes('netlify/')||n.includes('database/')||n.includes('state.bin')||n.includes('.env')));const version=JSON.parse(strFromU8(files['version.json']));for(const [name,hash] of Object.entries(version.sha256))assert.equal(crypto.createHash('sha256').update(files[name]).digest('hex'),hash);assert.deepEqual(JSON.parse(strFromU8(files['config.json'])),{environment:'production',origin:'https://mirox-crm.it'});});
test('watchdog: primo avvio bloccato e heartbeat scaduto richiedono recupero, senza loop di riavvii',()=>{let now=1000000,restarts=0;const host=createHost({root:path.resolve(__dirname,'..'),origin:'https://mirox-crm.it',now:()=>now,store:{read:()=>null,write:()=>{}},restartBrowser:()=>restarts++});host.checkWatchdog();assert.equal(restarts,0);now+=181000;host.checkWatchdog();assert.equal(restarts,1);host.checkWatchdog();assert.equal(restarts,1);now+=121000;host.checkWatchdog();assert.equal(restarts,2);host.close();});

async function pairingHost(t,store,remote) {
  const host=createHost({root:path.resolve(__dirname,'..'),origin:'https://mirox-crm.it',port:0,store,remote});
  t.after(()=>host.close());host.start();await once(host.server,'listening');
  const request=(method,url,headers={},body)=>new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port:host.server.address().port,path:url,method,headers:{Host:'127.0.0.1:0',...headers}},res=>{
      let text='';res.setEncoding('utf8');res.on('data',x=>text+=x);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(text)}));
    });req.on('error',reject);req.end(body);
  });
  const html=await new Promise((resolve,reject)=>http.get({hostname:'127.0.0.1',port:host.server.address().port,path:'/monitor',headers:{Host:'127.0.0.1:0'}},res=>{let text='';res.on('data',x=>text+=x);res.on('end',()=>resolve(text));}).on('error',reject));
  const headers={'X-Mirox-Monitor-Session':html.match(/name="mirox-monitor-session" content="([a-f0-9]+)"/)[1],'Content-Type':'application/json'};
  return {host,pair:()=>request('POST','/api/associa',headers,JSON.stringify({code:'AAAA-BBBB-CCCC-DDDD'}))};
}
const validSnapshot=()=>({ok:true,status:200,json:async()=>({versione:1,data:'2026-11-06',day:[],mensile:[],agenda:{}})});

test('errore archivio prima del pairing: nessuna richiesta remota e retry solo dopo persistenza riuscita',async t=>{
  let stored=null,blocked=true,calls=0;
  const {pair}=await pairingHost(t,{read:()=>stored,write:next=>{if(blocked)throw Error('dettaglio privato');stored=structuredClone(next);}},async()=>{calls++;return validSnapshot();});
  const failed=await pair();assert.equal(failed.status,503);assert.match(failed.data.error,/salvare l’associazione sul PC/);assert.ok(!failed.data.error.includes('dettaglio privato'));assert.equal(calls,0);assert.equal(stored,null);
  blocked=false;assert.equal((await pair()).status,200);assert.equal(stored.associated,true);assert.equal(calls,2);
});

test('conferma locale fallita dopo pairing remoto: stesso segreto nel retry e recupero da nuovo host',async t=>{
  let stored=null,failConfirm=true;const hashes=[];
  const store={read:()=>structuredClone(stored),write:next=>{if(next.associated&&failConfirm)throw Error('synthetic');stored=structuredClone(next);}};
  const remote=async(url,options)=>{if(options.method==='POST')hashes.push(JSON.parse(options.body).token_hash);return validSnapshot();};
  const {pair}=await pairingHost(t,store,remote);
  assert.equal((await pair()).status,503);assert.equal(stored.associated,false);
  const pendingSecret=stored.secret;failConfirm=false;
  assert.equal((await pair()).status,200);assert.equal(stored.secret,pendingSecret);assert.equal(stored.associated,true);assert.equal(hashes.length,2);assert.equal(hashes[0],hashes[1]);
  const resumed=createHost({root:path.resolve(__dirname,'..'),origin:'https://mirox-crm.it',store,remote});t.after(()=>resumed.close());await resumed.refresh();assert.equal(resumed.state().stato,'attivo');
});

test('postazione revocata: sostituzione segreto persistita e riassociazione, rate limit esplicito',async t=>{
  const oldSecret='a'.repeat(64);let stored={secret:oldSecret,associated:true},revoked=true,limited=false;
  const remote=async(url,options)=>options.method==='GET'&&revoked?{ok:false,status:403,json:async()=>({error:'revocato'})}:options.method==='POST'&&limited?{ok:false,status:429,json:async()=>({error:'synthetic private detail'})}:(revoked=false,validSnapshot());
  const {host,pair}=await pairingHost(t,{read:()=>structuredClone(stored),write:next=>{stored=structuredClone(next);}},remote);
  assert.equal(host.state().stato,'revocato');
  limited=true;const rejected=await pair();assert.equal(rejected.status,429);assert.equal(rejected.data.error,'Troppi tentativi. Riprova fra 15 minuti.');assert.notEqual(stored.secret,oldSecret);assert.equal(stored.associated,false);
  const pending=stored.secret;limited=false;assert.equal((await pair()).status,200);assert.equal(stored.secret,pending);assert.equal(stored.associated,true);assert.equal(host.state().stato,'attivo');
});

test('stato legacy pending con chiave gia revocata: il 403 forza una nuova chiave prima della riassociazione',async t=>{
  const revokedSecret='c'.repeat(64),revokedHash=crypto.createHash('sha256').update(revokedSecret).digest('hex');
  let stored={secret:revokedSecret,associated:false},activeHash=null,pairCalls=0;
  const remote=async(url,options)=>{
    if(options.method==='POST'){
      pairCalls++;const nextHash=JSON.parse(options.body).token_hash;
      // Come il vincolo UNIQUE reale: la revoca conserva l'hash gia registrato.
      if(nextHash===revokedHash)return {ok:false,status:503,json:async()=>({error:'Servizio monitor non disponibile.'})};
      assert.equal(crypto.createHash('sha256').update(stored.secret).digest('hex'),nextHash,'persistenza prima della richiesta remota');
      activeHash=nextHash;return {ok:true,status:200,json:async()=>({stato:'attivo'})};
    }
    const hash=crypto.createHash('sha256').update(options.headers.Authorization.slice('MiroxMonitor '.length)).digest('hex');
    return hash===activeHash?validSnapshot():{ok:false,status:403,json:async()=>({error:'Postazione non associata o revocata.'})};
  };
  const {host,pair}=await pairingHost(t,{read:()=>structuredClone(stored),write:next=>{stored=structuredClone(next);}},remote);
  assert.equal(host.state().stato,'non_associato');
  assert.equal((await pair()).status,200);assert.equal(pairCalls,1);assert.notEqual(stored.secret,revokedSecret);assert.equal(stored.associated,true);assert.equal(host.state().stato,'attivo');
});
