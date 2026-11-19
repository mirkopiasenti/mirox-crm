(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./dashboard-report-core'));
  else root.MiroxMonitorReport=factory(root.MiroxDashboardReport);
})(typeof window!=='undefined'?window:globalThis,function(core){
  'use strict';
  function build(input){
    if(!core||!input||input.versione!==2||!/^\d{4}-\d{2}-\d{2}$/.test(input.data||'')||
      !Number.isFinite(Date.parse(input.aggiornato_il)))throw Error('Dati monitor non validi.');
    for(const field of ['contratti','fttc','righe','metriche','obiettivi','profili','agenda']){
      if(!Array.isArray(input[field]))throw Error('Dati monitor incompleti.');
    }
    for(const field of ['fisso','energia','allarmi'])if(!Array.isArray(input.post?.[field]))throw Error('Controlli monitor incompleti.');
    const date=input.data,year=Number(date.slice(0,4)),month=Number(date.slice(5,7));
    const rows=input.righe.slice().sort((a,b)=>a.ordine-b.ordine||a.id-b.id);
    const priority={avanzamento_standard:0,avanzamento_piva:1,avanzamento_extra_piva:2};
    const metrics=input.metriche.slice().sort((a,b)=>priority[a.tabella]-priority[b.tabella]||a.ordine-b.ordine||a.id-b.id);
    const daily=core.dailyRows(input.contratti.filter(c=>String(c.data_contratto).slice(0,10)===date),rows,input.profili,date);
    const key=r=>r.gruppo+'\0'+r.nome;
    const counts=new Map(daily.map(r=>[key(r),r.operatori]));
    const operators=core.dayOperators(date);
    const day=rows.map(r=>({nome:r.nome,gruppo:r.gruppo,colore:r.colore_hex,
      operatori:operators.map(op=>counts.get(key(r))?.[op]||0)}));
    const state=core.monthlyState(input.contratti,metrics,input.obiettivi,input.profili,input.post,input.fttc,year,month);
    const monthly=core.monthlyRows(state,date).map(r=>({nome:r.nome,tabella:r.tabella,punti:r.punteggio,
      obiettivo:r.obiettivo,andamento:r.andamento,eccedenza:r.eccedenza,
      ...(r.conteggioNetto===undefined?{}:{netto:r.conteggioNetto,ultimo_csv:input.ultimo_csv||null})}));
    const appointments=input.agenda.slice().sort((a,b)=>a.data_ora.localeCompare(b.data_ora)||String(a.id).localeCompare(String(b.id)));
    const pending=appointments.filter(a=>!a.presentato).map(a=>({codice:'A-'+String(a.id).slice(0,8).toUpperCase(),ora:a.data_ora,durata:a.durata_minuti}));
    return {versione:1,data:date,aggiornato_il:input.aggiornato_il,
      ...(input.verificato_il?{verificato_il:input.verificato_il}:{}),
      ...(input.revisione?{revisione:input.revisione}:{}),
      ...(input.postazione?{postazione:input.postazione}:{}),
      negozio:'Legnago',operatori:operators,day,
      totale_day:day.reduce((sum,r)=>sum+r.operatori.reduce((a,b)=>a+b,0),0),mensile:monthly,
      agenda:{totale:appointments.length,presentati:appointments.filter(a=>a.presentato==='si').length,
        non_presentati:appointments.filter(a=>a.presentato==='no').length,in_attesa:pending.length,appuntamenti:pending}};
  }
  return {build};
});
