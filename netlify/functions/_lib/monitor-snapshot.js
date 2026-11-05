'use strict';
const core = require('../../../js/dashboard-report-core');
const {paged,monthlyState,today,nextDay,romeMidnight,CONTRACT_FIELDS} = require('./target-reports');
const {checked} = require('./monitor-device');
async function byIds(db,table,fields,ids) {
  const rows=[];
  for(let i=0;i<ids.length;i+=200) rows.push(...await paged(db,table,fields,q=>q.in('contratto_id',ids.slice(i,i+200))));
  return rows;
}
async function buildSnapshot(db,now=new Date()) {
  const date=today(now),year=Number(date.slice(0,4)),month=Number(date.slice(5,7));
  const start=date.slice(0,7)+'-01',end=new Date(Date.UTC(year,month,1)).toISOString().slice(0,10);
  const [contracts,rows,metrics,objectives,profiles,activations,appointments,csv] = await Promise.all([
    paged(db,'vendita_contratti',CONTRACT_FIELDS,q=>q.gte('data_contratto',start+'T00:00:00Z').lt('data_contratto',end+'T00:00:00Z').in('codice_rivenditore',[core.LEGNAGO,core.CEREA])),
    paged(db,'dashboard_righe_giornaliera','id,nome,gruppo,colore_hex,ordine,regola',q=>q.eq('attiva',true)),
    paged(db,'gara_metriche','id,nome,tabella,ordine,regola,punteggio_campo',q=>q.eq('attiva',true).in('tabella',['avanzamento_standard','avanzamento_piva','avanzamento_extra_piva'])),
    paged(db,'gara_obiettivi_mensili','id,metrica_id,operatore_id,obiettivo',q=>q.eq('anno',year).eq('mese',month)),
    paged(db,'profili','id,nome,attivo,in_gara,alias_di'),
    paged(db,'post_vendita_controllo_fissi','id,contratto_id',q=>q.eq('tecnologia','FTTC').eq('stato','Attivo').gte('data_attivazione',start).lt('data_attivazione',end)),
    paged(db,'appuntamenti','id,data_ora,durata_minuti,presentato',q=>q.eq('stato','confermato').gte('data_ora',romeMidnight(date)).lt('data_ora',romeMidnight(nextDay(date)))),
    db.from('post_vendita_controllo_lg').select('ultimo_csv_upload_at').not('ultimo_csv_upload_at','is',null).order('ultimo_csv_upload_at',{ascending:false}).limit(1)
  ]);
  const lastCsv=checked(csv)?.[0]?.ultimo_csv_upload_at || null;
  const fttc=[];
  for(let i=0;i<activations.length;i+=200) fttc.push(...await paged(db,'vendita_contratti',CONTRACT_FIELDS,q=>q.in('id',activations.slice(i,i+200).map(r=>r.contratto_id))));
  const ids=[...new Set([...contracts,...fttc].filter(c=>['Fisso','Energia','Allarmi'].includes(c.categoria_snapshot)).map(c=>c.id))];
  const [fisso,energia,allarmi]=await Promise.all([
    byIds(db,'post_vendita_controllo_fissi','id,contratto_id,stato,tecnologia',ids),
    byIds(db,'post_vendita_controllo_lg','id,contratto_id,stato',ids),
    byIds(db,'post_vendita_controllo_allarmi','id,contratto_id,stato',ids)
  ]);
  rows.sort((a,b)=>a.ordine-b.ordine || a.id-b.id);
  const priority={avanzamento_standard:0,avanzamento_piva:1,avanzamento_extra_piva:2};
  metrics.sort((a,b)=>priority[a.tabella]-priority[b.tabella] || a.ordine-b.ordine || a.id-b.id);
  const daily=core.dailyRows(contracts.filter(c=>String(c.data_contratto).slice(0,10)===date),rows,profiles,date);
  const key=r=>r.gruppo+'\0'+r.nome;
  const counts=new Map(daily.map(r=>[key(r),r.operatori]));
  const operators=core.dayOperators(date);
  const day=rows.map(r=>({nome:r.nome,gruppo:r.gruppo,colore:r.colore_hex,operatori:operators.map(op=>counts.get(key(r))?.[op] || 0)}));
  const state=monthlyState(contracts,metrics,objectives,profiles,{fisso,energia,allarmi},fttc,year,month);
  const monthly=core.monthlyRows(state,date).map(r=>({nome:r.nome,tabella:r.tabella,punti:r.punteggio,obiettivo:r.obiettivo,andamento:r.andamento,eccedenza:r.eccedenza,
    ...(r.conteggioNetto === undefined ? {} : {netto:r.conteggioNetto,ultimo_csv:lastCsv})}));
  appointments.sort((a,b)=>a.data_ora.localeCompare(b.data_ora) || a.id.localeCompare(b.id));
  const pending=appointments.filter(a=>!a.presentato).map(a=>({codice:'A-'+a.id.slice(0,8).toUpperCase(),ora:a.data_ora,durata:a.durata_minuti}));
  return {versione:1,data:date,aggiornato_il:now.toISOString(),negozio:'Legnago',operatori:operators,day,
    totale_day:day.reduce((sum,r)=>sum+r.operatori.reduce((a,b)=>a+b,0),0),mensile:monthly,
    agenda:{totale:appointments.length,presentati:appointments.filter(a=>a.presentato==='si').length,
      non_presentati:appointments.filter(a=>a.presentato==='no').length,in_attesa:pending.length,appuntamenti:pending}};
}
function snapshotCache(build=buildSnapshot) {
  let cache=null,inflight=null;
  return async(db,now=new Date())=>{
    const date=today(now);
    if(cache?.data===date && now.getTime()-Date.parse(cache.aggiornato_il)<20000) return cache;
    if(inflight?.date===date) return inflight.promise;
    const work={date,promise:build(db,now).then(value=>{cache=value;return value;})};inflight=work;
    try{return await work.promise;}finally{if(inflight===work)inflight=null;}
  };
}
module.exports={buildSnapshot,snapshotCache};
