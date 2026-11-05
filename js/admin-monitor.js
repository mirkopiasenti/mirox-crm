(async function(){
  'use strict';
  const profile=await Auth.richiediAuth();
  if(!profile || profile.ruolo!=='admin'){if(profile)location.href='dashboard.html';return;}
  const $=id=>document.getElementById(id),endpoint='/.netlify/functions/admin-monitor';
  let busy=false;
  const stamp=s=>s?new Date(s).toLocaleString('it-IT',{timeZone:'Europe/Rome'}):'mai';
  async function request(body){const res=await MiroxApi.fetch(endpoint,{cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const data=await res.json();if(!res.ok)throw Error(data.error || 'Operazione non riuscita');return data;}
  function status(text){$('monitorAdminStatus').textContent=text;}
  function lock(value){busy=value;$('monitorCreateButton').disabled=value;$('monitorReload').disabled=value;}
  async function reload(){try{const data=await request();$('monitorDevices').replaceChildren();for(const d of data.dispositivi){const row=document.createElement('article');row.className='permission-audit-entry';const title=document.createElement('h3');title.textContent=d.nome;const info=document.createElement('p');const expired=d.stato==='in_attesa'&&Date.parse(d.pairing_expires_at)<Date.now();info.textContent=`${expired?'Codice scaduto':d.stato==='attivo'?'Associato':d.stato==='revocato'?'Revocato':'In attesa di associazione'} · Ultimo contatto: ${stamp(d.last_seen_at)}`;row.append(title,info);if(d.stato!=='revocato'){const button=document.createElement('button');button.type='button';button.className='permission-button';button.textContent='Revoca';button.addEventListener('click',async()=>{if(busy)return;const yes=await MiroxUI.confirm(`Revocare la postazione ${d.nome}? Il televisore perderà l’accesso ai KPI.`);if(!yes)return;lock(true);try{await request({action:'revoca',id:d.id});await reload();}catch(error){status(error.message);}finally{lock(false);}});row.append(button);}$('monitorDevices').append(row);}if(!data.dispositivi.length)$('monitorDevices').textContent='Nessuna postazione configurata.';status('Postazioni aggiornate.');}catch(error){status(error.message);}}
  $('monitorDownload').href='assets/mirox-monitor-windows.zip';
  $('monitorReload').addEventListener('click',()=>{if(!busy)reload();});
  $('monitorCreate').addEventListener('submit',async event=>{event.preventDefault();if(busy)return;lock(true);try{const result=await request({action:'crea',nome:$('monitorName').value});$('monitorCode').textContent=result.codice;$('monitorCodeExpiry').textContent='Valido fino a '+stamp(result.dispositivo.pairing_expires_at);$('monitorCodeBox').hidden=false;await reload();}catch(error){status(error.message);}finally{lock(false);}});
  await reload();
})();
