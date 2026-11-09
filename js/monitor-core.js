(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MiroxMonitorCore=api;})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const rome=(date,options)=>new Intl.DateTimeFormat('it-IT',{timeZone:'Europe/Rome',...options}).format(date);
  function dateKey(now=new Date()){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(p=>[p.type,p.value]));return `${p.year}-${p.month}-${p.day}`;}
  function freshness(snapshot,now=new Date()) {
    if(!snapshot || snapshot.data!==dateKey(now))return {hide:true,stale:true,text:'In attesa dei dati di oggi...'};
    const age=now-Date.parse(snapshot.aggiornato_il);
    if(!Number.isFinite(age)||age< -60000)return {hide:true,stale:true,text:'Data aggiornamento non valida. Controlla l’orologio del PC.'};
    const stamp=rome(new Date(snapshot.aggiornato_il),{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    return {hide:false,stale:age>15000,error:age>60000,text:age>60000?`Dati obsoleti · ultimo aggiornamento ${stamp}`:age>15000?`Aggiornamento interrotto · dati delle ${stamp}`:`Connesso · dati delle ${stamp}`};
  }
  function countdown(iso,now=new Date()){const mins=Math.ceil((Date.parse(iso)-now)/60000);return mins>0?`Tra ${mins} min`:mins===0?'Adesso':`In attesa da ${Math.abs(mins)} min`;}
  function agendaPage(appointments,tick){const [next,...others]=appointments;const pages=Math.max(1,Math.ceil(others.length/3));const page=Math.floor(tick/15)%pages;return {next,rows:others.slice(page*3,page*3+3),page:page+1,pages};}
  function fit(width,height,contentHeight){
    const top=height*0.03;
    const bottom=height*0.025;
    const scale=Math.min(width/1080,(height-top-bottom)/Math.max(1920,contentHeight));
    return {scale,left:Math.max(0,(width-1080*scale)/2),top};
  }
  return {rome,dateKey,freshness,countdown,agendaPage,fit};
});
