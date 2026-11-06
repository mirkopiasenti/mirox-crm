'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events');
const {WEB,ACK_MS,manifestFor,validateManifest,createPageUpdates}=require('../tools/monitor-windows/monitor-updates.cjs');
const {createHost}=require('../tools/monitor-windows/monitor-host.cjs');
const root=path.resolve(__dirname,'..');
function files(label=''){
  const result=Object.fromEntries(WEB.map(name=>[name,fs.readFileSync(path.join(root,name))]));
  result['css/monitor.css']=Buffer.concat([result['css/monitor.css'],Buffer.from('\n/* '+label+' */')]);
  return result;
}
function publisher(content){
  const state={content,manifest:manifestFor(content),calls:[],change:null};
  state.remote=async(url,options)=>{
    state.calls.push({url,options});
    const name=new URL(url).pathname;
    if(state.change){const changed=await state.change(name);if(changed)return changed;}
    if(name==='/assets/monitor-release.json')return new Response(JSON.stringify(state.manifest));
    const prefix='/assets/monitor-releases/'+state.manifest.versione+'/';
    const relative=name.startsWith(prefix)&&name.endsWith('.bin')?name.slice(prefix.length,-4):null;
    if(!name.startsWith(prefix)||!state.content[relative])return new Response('',{status:404});
    return new Response(state.content[relative]);
  };
  return state;
}
function updater(t,pub,options={}){const pages=createPageUpdates({root,origin:'https://mirox-crm.it',remote:pub.remote,...options});t.after(()=>pages.close());return pages;}

test('pubblicazione pagina: hash/API, download senza credenziali e asset precedenti disponibili per versione',async t=>{
  const pub=publisher(files('release nuova')),pages=updater(t,pub),old=pages.version;
  assert.equal(await pages.check(),true);assert.equal(pages.version,pub.manifest.versione);assert.notEqual(pages.version,old);
  assert.deepEqual(pages.file('css/monitor.css'),pub.content['css/monitor.css']);
  assert.deepEqual(pages.file('css/monitor.css',old),fs.readFileSync(path.join(root,'css/monitor.css')));
  assert.equal(pages.file('state.bin'),undefined);assert.equal(pages.file('monitor-host.cjs'),undefined);
  for(const call of pub.calls){assert.equal(call.options.redirect,'error');assert.equal(call.options.headers.Authorization,undefined);assert.equal(new URL(call.url).origin,'https://mirox-crm.it');}
  const count=pub.calls.length;assert.equal(await pages.check(),false);assert.equal(pub.calls.length,count+1);
});

test('download incompleto: versione attiva atomica e richieste simultanee condivise',async t=>{
  const pub=publisher(files('atomic')),pages=updater(t,pub),old=pages.version;
  let unlock,entered;const began=new Promise(resolve=>{entered=resolve;});const gate=new Promise(resolve=>{unlock=resolve;});t.after(()=>unlock());
  pub.change=async name=>{if(name.endsWith('/css/monitor.css.bin')){entered();await gate;}return null;};
  const one=pages.check(),two=pages.check();await began;
  assert.equal(pages.version,old);assert.deepEqual(pages.file('css/monitor.css'),fs.readFileSync(path.join(root,'css/monitor.css')));
  unlock();assert.deepEqual(await Promise.all([one,two]),[true,true]);
  assert.equal(pub.calls.filter(call=>call.url.endsWith('/monitor-release.json')).length,1);
});

test('rollback: nessun timeout prima dell’apertura; pagina senza conferma ripristinata e versione guasta esclusa',async t=>{
  let now=1000,restarts=0;const pub=publisher(files('guasta')),pages=updater(t,pub,{now:()=>now,onRollback:()=>restarts++}),old=pages.version;
  await pages.check();const bad=pages.version;now+=ACK_MS+1000;assert.equal(pages.checkRollback(),false);
  pages.served(bad);assert.equal(pages.heartbeat(old),false);now+=ACK_MS+1;
  assert.equal(pages.checkRollback(),true);assert.equal(pages.version,old);assert.equal(restarts,1);
  const before=pub.calls.length;assert.equal(await pages.check(),false);assert.equal(pub.calls.length,before+1);
});

test('conferma heartbeat: conserva nuova versione; rollback del codice tramite nuovo manifest supportato',async t=>{
  let now=1000;const pub=publisher(files('buona')),pages=updater(t,pub,{now:()=>now}),old=pages.version;
  await pages.check();pages.served(pages.version);assert.equal(pages.heartbeat(pages.version),true);
  now+=ACK_MS+1;assert.equal(pages.checkRollback(),false);
  pub.content=Object.fromEntries(WEB.map(name=>[name,fs.readFileSync(path.join(root,name))]));pub.manifest=manifestFor(pub.content);
  assert.equal(await pages.check(),true);assert.equal(pages.version,old);
});

test('manifest ostili/incompatibili: nessuna attivazione o download helper, percorsi e dimensioni vincolati',async t=>{
  const base=manifestFor(files('invalid'));
  for(const mutate of [m=>{m.api=2;},m=>{m.files['../state.bin']=m.files['monitor.html'];delete m.files['monitor.html'];},m=>{m.files['monitor-host.cjs']=m.files['monitor.html'];},m=>{m.files['monitor.html'].bytes=2*1024*1024+1;},m=>{m.files['monitor.html'].sha256='0'.repeat(64);}]){
    const pub=publisher(files('invalid'));pub.manifest=structuredClone(base);mutate(pub.manifest);
    assert.throws(()=>validateManifest(pub.manifest));const pages=updater(t,pub),old=pages.version;
    assert.equal(await pages.check(),false);assert.equal(pages.version,old);assert.equal(pub.calls.length,1);
  }
});

test('file alterato, stream troppo lungo, redirect e assenza rete mantengono la pagina precedente',async t=>{
  for(const mode of ['hash','large','redirect','offline']){
    const pub=publisher(files(mode)),pages=updater(t,pub),old=pages.version;
    pub.change=async name=>{
      if(mode==='offline')throw Error('synthetic network failure');
      if(name.endsWith('/css/monitor.css.bin')){
        if(mode==='redirect')return new Response('',{status:302,headers:{Location:'https://evil.example/x'}});
        if(mode==='large')return new Response(Buffer.alloc(pub.manifest.files['css/monitor.css'].bytes+1));
        const bytes=Buffer.from(pub.content['css/monitor.css']);bytes[0]^=1;return new Response(bytes);
      }
      return null;
    };
    assert.equal(await pages.check(),false);assert.equal(pages.version,old);
    assert.deepEqual(pages.file('css/monitor.css'),fs.readFileSync(path.join(root,'css/monitor.css')));
    pub.change=null;assert.equal(await pages.check(),true,'recupero dopo errore senza reinstallare il servizio');
  }
});

test('host reale: HTML e CSS versionati, versione notificata, associazione conservata durante aggiornamento',async t=>{
  const content=files('host');content['monitor.html']=Buffer.from(content['monitor.html'].toString().replace('href="css/monitor.css"','HREF = "./css/monitor.css"'));
  const pub=publisher(content),pages=updater(t,pub),old=pages.version;await pages.check();
  const secret='d'.repeat(64);let writes=0;
  const host=createHost({root,origin:'https://mirox-crm.it',port:0,pageUpdates:pages,store:{read:()=>({secret,associated:true}),write:()=>writes++},remote:async()=>({ok:true,status:200,json:async()=>({versione:1,data:'2026-11-06',day:[],mensile:[],agenda:{}})})});
  t.after(()=>host.close());host.start();await once(host.server,'listening');
  const request=(url,{method='GET',headers={},body}={})=>new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port:host.server.address().port,path:url,method,headers:{Host:'127.0.0.1:0',...headers}},res=>{let text='';res.on('data',x=>text+=x);res.on('end',()=>resolve({status:res.statusCode,text}));});req.on('error',reject);req.end(body);
  });
  const html=await request('/monitor');assert.equal(html.status,200);assert.ok(html.text.toLowerCase().includes(`href="/__monitor_release/${pages.version}/css/monitor.css"`));assert.ok(!html.text.includes(secret));
  const nonce=html.text.match(/name="mirox-monitor-session" content="([a-f0-9]+)"/)[1];
  const state=JSON.parse((await request('/api/snapshot',{headers:{'X-Mirox-Monitor-Session':nonce}})).text);
  assert.equal(state.pagina_versione,pages.version);assert.equal(state.stato,'attivo');assert.equal(writes,0);
  assert.equal((await request(`/__monitor_release/${old}/css/monitor.css`)).text,fs.readFileSync(path.join(root,'css/monitor.css'),'utf8'));
  assert.equal((await request(`/__monitor_release/${pages.version}/css/monitor.css`)).text,pub.content['css/monitor.css'].toString());
  assert.equal((await request(`/__monitor_release/${'0'.repeat(64)}/css/monitor.css`)).status,404);
  assert.equal((await request('/api/heartbeat',{method:'POST',headers:{'X-Mirox-Monitor-Session':nonce,'Content-Type':'application/json'},body:JSON.stringify({pagina_versione:pages.version})})).status,200);
});

test('build: manifest pubblicato coerente con tutti gli asset immutabili',()=>{
  const manifest=validateManifest(JSON.parse(fs.readFileSync(path.join(root,'dist/assets/monitor-release.json'),'utf8')));
  const payload=Object.fromEntries(WEB.map(name=>[name,fs.readFileSync(path.join(root,'dist/assets/monitor-releases',manifest.versione,name+'.bin'))]));
  assert.deepEqual(manifestFor(payload),manifest);
  assert.ok(!Object.keys(manifest.files).some(name=>name.includes('state.bin')||name.endsWith('.cjs')||name.endsWith('.ps1')));
});

test('pagina rimasta alla vecchia versione: timeout di passaggio e recupero anche senza nuova richiesta HTML',async t=>{
  let now=1000;const pub=publisher(files('handoff')),pages=updater(t,pub,{now:()=>now}),old=pages.version;
  await pages.check();assert.equal(pages.heartbeat(old),false);now+=ACK_MS+1;
  assert.equal(pages.checkRollback(),true);assert.equal(pages.version,old);
});

test('errore rendering dopo prima conferma: rollback; attesa dati non e un errore di rendering',async t=>{
  let now=1000;const pub=publisher(files('late failure')),pages=updater(t,pub,{now:()=>now}),old=pages.version;
  await pages.check();pages.served(pages.version);
  assert.equal(pages.heartbeat(pages.version,false,false),true);now+=ACK_MS-1;assert.equal(pages.checkRollback(),false);
  assert.equal(pages.heartbeat(pages.version,true,false),true);now+=ACK_MS+1;assert.equal(pages.checkRollback(),false);
  assert.equal(pages.heartbeat(pages.version,false,true),false);now+=ACK_MS+1;assert.equal(pages.checkRollback(),true);assert.equal(pages.version,old);
});

test('risposta compressa: Content-Length riguarda il trasporto, limiti/hash verificano i byte decodificati',async t=>{
  const pub=publisher(files('compressed')),pages=updater(t,pub);
  pub.change=async name=>name.endsWith('/css/monitor.css.bin')?new Response(pub.content['css/monitor.css'],{headers:{'content-encoding':'gzip','content-length':String(pub.content['css/monitor.css'].length+25)}}):null;
  assert.equal(await pages.check(),true);assert.deepEqual(pages.file('css/monitor.css'),pub.content['css/monitor.css']);
});

test('risorse HTML/CSS mancanti: rilascio rifiutato anche con hash validi, prima di mostrare una pagina incompleta',async t=>{
  for(const mode of ['html','css']){
    const content=files(mode);
    if(mode==='html')content['monitor.html']=Buffer.from(content['monitor.html'].toString().replace('js/monitor.js','js/non-presente.js'));
    else content['css/monitor.css']=Buffer.concat([content['css/monitor.css'],Buffer.from('\n.a{background:url(../assets/non-presente.png)}')]);
    const pub=publisher(content),pages=updater(t,pub),old=pages.version;
    assert.equal(await pages.check(),false);assert.equal(pages.version,old);
  }
});

test('chiusura durante download: il rilascio incompleto non viene attivato dopo lo stop',async t=>{
  const pub=publisher(files('closing')),pages=updater(t,pub),old=pages.version;
  let entered,unlock;const began=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{unlock=resolve;});t.after(()=>unlock());
  pub.change=async name=>{if(name.endsWith('/css/monitor.css.bin')){entered();await gate;}return null;};
  const checking=pages.check();await began;pages.close();unlock();assert.equal(await checking,false);assert.equal(pages.version,old);
});
