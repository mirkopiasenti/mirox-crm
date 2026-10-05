'use strict';

const core = require('../../../js/dashboard-report-core');
const { buildProfileResolver, emptyMetrics, addCall, addAppointmentSet } = require('../admin-kpi-call-center').reportHelpers;
const PAGE_SIZE = 1000;
const CONTRACT_FIELDS = 'id,operatore_id,cluster_cliente,categoria_snapshot,nome_offerta_snapshot,nome_opzione_snapshot,nome_reload_snapshot,tipo_attivazione,apri_chiudi,intestatario,switch_sim,modalita_pagamento,dispositivo_associato,tipo_acquisto,fascia_prezzo,finanziaria,kolme,reload_exchange,data_contratto,stato_inserimento,codice_rivenditore,punteggio_gara_totale,punteggio_extra_gara_totale,punteggio_offerta,punteggio_opzione,punteggio_totale,punteggio_gara_offerta,punteggio_gara_opzione,punteggio_extra_gara_offerta,punteggio_extra_gara_opzione';

function romeParts(now = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type,p.value]));
}
function today(now = new Date()) { const p=romeParts(now); return `${p.year}-${p.month}-${p.day}`; }
function validateDate(key, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key || '') || key < '2020-01-01' || key > today(now)) throw new Error('Data non valida: usa YYYY-MM-DD, dal 2020 a oggi.');
  const d=new Date(key+'T00:00:00Z');
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0,10)!==key) throw new Error('Data non valida.');
  return key;
}
function nextDay(key) { const d=new Date(key+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()+1); return d.toISOString().slice(0,10); }
function romeMidnight(key) {
  const d=new Date(key+'T00:00:00Z');
  const hour=Number(romeParts(d).hour);
  return new Date(d.getTime()-hour*3600000).toISOString();
}
function due(now = new Date()) {
  const p=romeParts(now),key=today(now);
  return core.isWorkday(key) && `${p.hour}:${p.minute}` >= '19:45';
}
async function paged(db, table, fields, filter = q=>q) {
  const rows=[];
  for(let from=0;from<100000;from+=PAGE_SIZE) {
    const {data,error}=await filter(db.from(table).select(fields)).order('id').range(from,from+PAGE_SIZE-1);
    if(error) throw new Error(`Lettura ${table} non riuscita`);
    const batch=data||[]; rows.push(...batch);
    if(batch.length<PAGE_SIZE) return rows;
  }
  throw new Error('Report troppo esteso: restringi il periodo.');
}
async function byIds(db,table,fields,ids) {
  const result=[];
  for(let i=0;i<ids.length;i+=200) result.push(...await paged(db,table,fields,q=>q.in('contratto_id',ids.slice(i,i+200))));
  return result;
}
function monthlyState(contracts,metrics,objectives,profiles,post,fttc,year,month) {
  const active=profiles.filter(p=>p.attivo);
  const map=new Map(active.map(p=>[p.id,p]));
  const resolve=id=> { let cur=id; for(let i=0;i<3;i++) { const p=map.get(cur); if(!p?.alias_di) return cur; cur=p.alias_di; } return cur; };
  const ids=new Set(active.filter(p=>p.in_gara&&!p.alias_di).map(p=>p.id));
  [...contracts,...fttc].filter(c=>c.codice_rivenditore===core.LEGNAGO && c.stato_inserimento!=='reinserimento').forEach(c=>ids.add(resolve(c.operatore_id)));
  return {anno:year,mese:month,contrattiMese:contracts.filter(c=>c.stato_inserimento!=='reinserimento'),metricheGara:metrics,obiettivi:objectives,
    operatoriAttiviMese:[...ids].map(id=>map.get(id)).filter(p=>p&&!p.alias_di),resolveOperatore:resolve,
    statoPostVendita:{fisso:new Map(post.fisso.map(r=>[r.contratto_id,r.stato])),energia:new Map(post.energia.map(r=>[r.contratto_id,r.stato])),allarmi:new Map(post.allarmi.map(r=>[r.contratto_id,r.stato]))},
    tecnologiaFisso:new Map(post.fisso.map(r=>[r.contratto_id,r.tecnologia])),fissoFTTCAttivatiMese:fttc};
}
function callSummary(consumer,business,appointments,profiles,date) {
  const resolver=buildProfileResolver(profiles);
  function channel(calls,sets,label) {
    const totals=new Map(),operators=new Map();
    calls.forEach(c=>addCall(totals,operators,resolver,c,label==='Business outbound'?'business_outbound':'consumer'));
    sets.forEach(a=>addAppointmentSet(totals,operators,resolver,a));
    const compact=m=>({fatte:m.calls,risposte:m.answered_calls,non_risposte:m.calls-m.answered_calls,fissati:m.appointments_set,spostamenti:m.appointments_rescheduled});
    return {canale:label,totale:compact(totals.get(date)||emptyMetrics()),operatori:[...operators].map(([id,days])=>({id,nome:resolver.label(id),...compact(days.get(date)||emptyMetrics())})).sort((a,b)=>a.nome.localeCompare(b.nome,'it'))};
  }
  const channels=[channel(consumer,appointments.filter(a=>!a.chiamata_outbound_id),'Consumer'),channel(business,appointments.filter(a=>a.chiamata_outbound_id),'Business outbound')];
  const total=Object.fromEntries(Object.keys(channels[0].totale).map(k=>[k,channels.reduce((sum,c)=>sum+c.totale[k],0)]));
  const combined=new Map();
  channels.forEach(c=>c.operatori.forEach(op=> {
    if(!combined.has(op.id)) combined.set(op.id,{nome:op.nome,...Object.fromEntries(Object.keys(total).map(k=>[k,0]))});
    Object.keys(total).forEach(k=>combined.get(op.id)[k]+=op[k]);
  }));
  return {canali:channels.map(c=>({...c,operatori:c.operatori.map(({id,...op})=>op)})),totale:total,operatori:[...combined.values()].sort((a,b)=>a.nome.localeCompare(b.nome,'it'))};
}
async function buildReports(db,date = today(),now = new Date()) {
  validateDate(date,now);
  const year=Number(date.slice(0,4)),month=Number(date.slice(5,7));
  const start=date.slice(0,7)+'-01',end=new Date(Date.UTC(year,month,1)).toISOString().slice(0,10);
  const callStart=romeMidnight(date),callEnd=romeMidnight(nextDay(date));
  const timeFilter=col=>q=>q.gte(col,callStart).lt(col,callEnd).lte(col,now.toISOString());
  const [contracts,rows,metrics,objectives,profiles,consumer,business,appointments,activations]=await Promise.all([
    paged(db,'vendita_contratti',CONTRACT_FIELDS,q=>q.gte('data_contratto',start+'T00:00:00Z').lt('data_contratto',end+'T00:00:00Z').eq('codice_rivenditore',core.LEGNAGO)),
    paged(db,'dashboard_righe_giornaliera','id,nome,gruppo,ordine,regola',q=>q.eq('attiva',true)),
    paged(db,'gara_metriche','id,nome,tabella,ordine,regola,punteggio_campo',q=>q.eq('attiva',true).in('tabella',['avanzamento_standard','avanzamento_extra_piva'])),
    paged(db,'gara_obiettivi_mensili','id,metrica_id,operatore_id,obiettivo',q=>q.eq('anno',year).eq('mese',month)),
    paged(db,'profili','id,nome,attivo,in_gara,alias_di'),
    paged(db,'chiamate','id,operatore_id,data_ora,esito',timeFilter('data_ora')),
    paged(db,'call_center_lead_outbound_chiamate','id,operatore_id,data_ora,esito',timeFilter('data_ora')),
    paged(db,'appuntamenti','id,fissato_da_operatore_id,created_at,originato_da_id,chiamata_outbound_id',timeFilter('created_at')),
    paged(db,'post_vendita_controllo_fissi','id,contratto_id',q=>q.eq('tecnologia','FTTC').eq('stato','Attivo').gte('data_attivazione',start).lt('data_attivazione',end))
  ]);
  const ids=contracts.filter(c=>['Fisso','Energia','Allarmi'].includes(c.categoria_snapshot)).map(c=>c.id);
  const [fisso,energia,allarmi,fttc]=await Promise.all([
    byIds(db,'post_vendita_controllo_fissi','id,contratto_id,stato,tecnologia',ids),
    byIds(db,'post_vendita_controllo_lg','id,contratto_id,stato',ids),
    byIds(db,'post_vendita_controllo_allarmi','id,contratto_id,stato',ids),
    (async()=>{const results=[];for(let i=0;i<activations.length;i+=200) results.push(...await paged(db,'vendita_contratti',CONTRACT_FIELDS,q=>q.in('id',activations.slice(i,i+200).map(r=>r.contratto_id))));return results;})()
  ]);
  rows.sort((a,b)=>a.ordine-b.ordine);
  metrics.sort((a,b)=>(a.tabella==='avanzamento_standard'?0:1)-(b.tabella==='avanzamento_standard'?0:1)||a.ordine-b.ordine);
  const daily=core.dailyRows(contracts.filter(c=>new Date(c.data_contratto).toISOString().slice(0,10)===date),rows,profiles);
  const monthly=core.monthlyRows(monthlyState(contracts,metrics,objectives,profiles,{fisso,energia,allarmi},fttc,year,month),today(now))
    .map(({nome,tabella,attuale,punteggio,obiettivo,andamento,eccedenza})=>({nome,tabella,pezzi:attuale,punteggio,obiettivo,andamento,eccedenza}));
  return {data:date,letto_il:now.toISOString(),vendite:{categorie:daily,totale:daily.reduce((sum,r)=>sum+r.totale,0)},chiamate:callSummary(consumer,business,appointments,profiles,date),mensile:monthly,
    criteri:'Vendite: Legnago, data contratto UTC come Day by Day, reinserimenti esclusi; totale delle righe, possibili sovrapposizioni. CC: eventi Europe/Rome, ogni tentativo registrato, appuntamenti per creazione, spostamenti separati. Mensile: stati attuali dei record, non fotografia storica; Standard e Extra Gara P.IVA, lun-sab senza festivita\u0027 nazionali, eccedenza arrotondata verso l\u0027esterno; obiettivo raggiunto: eccedenza nascosta come pagina.'};
}
const number=n=>Number(n).toLocaleString('it-IT',{maximumFractionDigits:2});
const label=s=>String(s||'').replace(/[\r\n\x00-\x1f]/g,' ').slice(0,120);
function callLine(m) { return `${m.fatte} fatte · ${m.risposte} risposte · ${m.non_risposte} non risposte · ${m.fissati} fissati${m.spostamenti?` · ${m.spostamenti} spostamenti`:''}`; }
function formatReports(p) {
  const date=p.data.split('-').reverse().join('/');
  const time=romeParts(new Date(p.letto_il));
  const footer=`\nDati letti ${today(new Date(p.letto_il)).split('-').reverse().join('/')} alle ${time.hour}:${time.minute}.`;
  const categories=p.vendite.categorie.filter(r=>r.totale>0);
  const sales=[`MIROX AI - Target · Vendite ${date}`,'Legnago · data contratto','',`TOTALE GIORNATA: ${number(p.vendite.totale)} ${p.vendite.totale===1?'pezzo':'pezzi'}`,'',categories.length?categories.map(r=>`${label(r.nome)}
Totale: ${number(r.totale)} ${r.totale===1?'pezzo':'pezzi'}
${Object.entries(r.operatori).filter(([,n])=>n>0).map(([name,n])=>`  ${label(name)}: ${number(n)}`).join('\n')}`).join('\n\n'):'Nessun pezzo nel Day by Day.',footer].join('\n');
  const calls=[`MIROX AI - Target · Call Center ${date}`,'',...p.chiamate.canali.flatMap(c=>[c.canale,...c.operatori.map(op=>`${label(op.nome)}: ${callLine(op)}`),`Totale: ${callLine(c.totale)}`,'']), 'Totale generale',...p.chiamate.operatori.map(op=>`${label(op.nome)}: ${callLine(op)}`),callLine(p.chiamate.totale),footer].join('\n');
  const month=[`MIROX AI - Target · Avanzamento ${p.data.slice(5,7)}/${p.data.slice(0,4)}`,'Legnago · situazione aggiornata','',...p.mensile.map(r=>`${label(r.nome)}: ${r.andamento}\nEccedenza: ${r.eccedenza===null?'—':r.eccedenza>0?'+'+r.eccedenza:String(r.eccedenza)} · Punteggio ${number(r.punteggio)} / ${r.obiettivo>0?number(r.obiettivo):'obiettivo assente'}`),...(p.mensile.length?[]:['Nessuna categoria configurata.']),footer].join('\n');
  return [sales,calls,month];
}
function formatReportMessages(p) {
  const text=formatReports(p),images=require('./target-report-images');
  return [text[0],...[[images.callsImage(p),'Call Center','call-center',text[1]],[images.monthImage(p),'Andamento mensile','andamento-mensile',text[2]]].map(([layout,title,file,alternate])=>({type:'image',...layout,filename:`mirox-target-${file}-${p.data}.png`,caption:`MIROX AI - Target · ${title} · ${p.data.split('-').reverse().join('/')}`,text:alternate}))];
}

module.exports={buildReports,formatReports,formatReportMessages,paged,monthlyState,callSummary,romeParts,romeMidnight,today,validateDate,nextDay,due};
