/* Motore puro condiviso Dashboard Pezzi / MIROX AI - Target. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MiroxDashboardReport = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';
const LEGNAGO = '9001415852';
const CEREA = '9000822241';
const DAY_OPERATORS = ['MATTEO', 'MIRKO', 'FRANCESCA', 'CEREA'];
function inMonthlyScope(c, includeCereaFissi=false) {
  return c.stato_inserimento!=='reinserimento' && (c.codice_rivenditore===LEGNAGO
    || (includeCereaFissi && c.codice_rivenditore===CEREA && c.categoria_snapshot==='Fisso'));
}
function matchRegola(contratto, regola) {
  if (!regola || typeof regola !== 'object') return true;
  // OR: se presente, ognuna delle sotto-regole viene valutata; basta che una matchi
  if (Array.isArray(regola.or) && regola.or.length) {
    return regola.or.some(sub => matchRegola(contratto, sub));
  }
  const c = contratto;
  const strEq = (got, want) => String(got || '').trim().toLowerCase() === String(want || '').trim().toLowerCase();
  const strInArr = (got, arr) => Array.isArray(arr) && arr.some(v => strEq(got, v));
  const reMatch = (got, pattern) => {
    if (!pattern) return true;
    try { return new RegExp(pattern, 'i').test(String(got || '')); } catch (e) { return false; }
  };
  if (regola.categoria && !strEq(c.categoria_snapshot, regola.categoria)) return false;
  if (regola.categoria_in && !strInArr(c.categoria_snapshot, regola.categoria_in)) return false;
  if (regola.cluster && !strEq(c.cluster_cliente, regola.cluster)) return false;
  if (regola.cluster_in && !strInArr(c.cluster_cliente, regola.cluster_in)) return false;
  if (regola.tipo_attivazione && !strEq(c.tipo_attivazione, regola.tipo_attivazione)) return false;
  if (regola.apri_chiudi && !strEq(c.apri_chiudi, regola.apri_chiudi)) return false;
  if (regola.intestatario && !strEq(c.intestatario, regola.intestatario)) return false;
  if (regola.switch_sim && !strEq(c.switch_sim, regola.switch_sim)) return false;
  if (regola.modalita_pagamento && !strEq(c.modalita_pagamento, regola.modalita_pagamento)) return false;
  if (regola.tipo_acquisto && !strEq(c.tipo_acquisto, regola.tipo_acquisto)) return false;
  if (regola.fascia_prezzo && !strEq(c.fascia_prezzo, regola.fascia_prezzo)) return false;
  if (regola.fascia_prezzo_in && !strInArr(c.fascia_prezzo, regola.fascia_prezzo_in)) return false;
  if (regola.finanziaria && !strEq(c.finanziaria, regola.finanziaria)) return false;
  if (regola.dispositivo_associato !== undefined && Boolean(c.dispositivo_associato) !== Boolean(regola.dispositivo_associato)) return false;
  if (regola.kolme !== undefined && Boolean(c.kolme) !== Boolean(regola.kolme)) return false;
  if (regola.reload_exchange !== undefined && Boolean(c.reload_exchange) !== Boolean(regola.reload_exchange)) return false;
  if (regola.offerta_match && !reMatch(c.nome_offerta_snapshot, regola.offerta_match)) return false;
  if (regola.offerta_not_match && reMatch(c.nome_offerta_snapshot, regola.offerta_not_match)) return false;
  if (regola.opzione_match && !reMatch(c.nome_opzione_snapshot, regola.opzione_match)) return false;
  if (regola.reload_match && !reMatch(c.nome_reload_snapshot, regola.reload_match)) return false;
  return true;
}
function pesoContratto(contratto, regola) {
  if (!matchRegola(contratto, regola)) return 0;
  let peso = 1;
  const bonus = (regola && Array.isArray(regola.bonus_conteggio)) ? regola.bonus_conteggio : [];
  bonus.forEach(b => {
    const sub = Object.assign({}, b);
    delete sub.peso;
    if (matchRegola(contratto, sub)) peso += Number(b.peso || 0);
  });
  return peso;
}
function calcolaCompenso(attuale, regola, contratti) {
  if (!regola || typeof regola !== 'object') return { euro: 0, label: '' };
  const n = Math.max(0, Number(attuale) || 0);
  const label = regola.label || '';
  const sogliaDec = Number(regola.decurtazione_soglia) || 0;
  if (sogliaDec > 0 && n < sogliaDec) return { euro: 0, label: 'DECURTAZIONE' };
  if (regola.tipo === 'obiettivi_combinati') {
    const condizioni = Array.isArray(regola.condizioni) ? regola.condizioni : [];
    const valide = condizioni.length >= 2 && condizioni.every(c =>
      c && typeof c.nome === 'string' && c.nome.trim()
      && typeof c.soglia === 'number' && Number.isFinite(c.soglia) && c.soglia > 0
      && c.regola && typeof c.regola === 'object' && !Array.isArray(c.regola)
      && Object.keys(c.regola).length > 0);
    const componenti = valide ? condizioni.map(c => ({
      nome: c.nome, obiettivo: c.soglia,
      attuale: (contratti || []).reduce((sum, contratto) => sum + pesoContratto(contratto, c.regola), 0)
    })) : [];
    const importoValido = typeof regola.importo === 'number' && Number.isFinite(regola.importo) && regola.importo >= 0;
    return {
      euro: valide && importoValido && componenti.every(c => c.attuale >= c.obiettivo) ? regola.importo : 0,
      label, componenti
    };
  }
  if (regola.tipo === 'nessuno') return { euro: 0, label };
  if (regola.tipo === 'per_pezzo') return { euro: n * (Number(regola.per_pezzo) || 0), label };
  if (regola.tipo === 'per_pezzo_variabile') {
    if (!Array.isArray(contratti) || !regola.campo) return { euro: 0, label: '' };
    const casi = Array.isArray(regola.casi) ? regola.casi : [];
    const euro = contratti.reduce((totale, c) => {
      const caso = casi.find(k => String(k.valore || '').trim().toLowerCase() === String(c[regola.campo] || '').trim().toLowerCase());
      return totale + Number(caso?.importo || 0);
    }, 0);
    return { euro, label };
  }
  if (regola.tipo !== 'scaglioni') return { euro: 0, label };
  let totale = 0, flatMaxImporto = 0, flatMaxDa = -1;
  (Array.isArray(regola.scaglioni) ? regola.scaglioni : []).forEach(s => {
    const modo = s.tipo_calcolo || 'per_pezzo';
    const importo = Number(s.importo ?? s.per_pezzo ?? 0);
    const da = Number(s.da || 0);
    if (modo === 'flat') {
      if (n >= da) totale += importo;
    } else if (modo === 'flat_max') {
      if (n >= da && da > flatMaxDa) { flatMaxDa = da; flatMaxImporto = importo; }
    } else {
      const a = (s.a === null || s.a === undefined || s.a === '') ? Infinity : Number(s.a);
      if (n > da) totale += Math.max(0, Math.min(n, a) - da) * importo;
    }
  });
  totale += flatMaxImporto;
  (Array.isArray(regola.bonus_soglie) ? regola.bonus_soglie : []).forEach(b => {
    if (n >= Number(b.soglia || 0)) totale += Number(b.bonus || 0);
  });
  return { euro: totale, label };
}
function valutaGara(metrica, obiettivo, contratti, operatoreId, resolveOperatore = id => id) {
  const regolaCompenso = obiettivo?.compenso_regola;
  const gara = regolaCompenso?.gara || {};
  const conteggioSquadra = (gara.tipo_conteggio || metrica.tipo_conteggio) === 'squadra';
  const produzione = (contratti || []).filter(c =>
    c.stato_inserimento !== 'reinserimento'
    && (!gara.codice_rivenditore || c.codice_rivenditore === gara.codice_rivenditore)
    && (!Array.isArray(gara.operatori) || gara.operatori.includes(resolveOperatore(c.operatore_id)))
    && (conteggioSquadra || resolveOperatore(c.operatore_id) === operatoreId));
  const matched = produzione.filter(c => matchRegola(c, metrica.regola));
  // Il campo punti si applica solo agli override mensili, preservando il vecchio conteggio.
  const attuale = matched.reduce((sum, c) => sum + (gara.punteggio_campo
    ? Number(c[gara.punteggio_campo] || 0) : pesoContratto(c, metrica.regola)), 0);
  const compenso = calcolaCompenso(attuale, regolaCompenso,
    regolaCompenso?.tipo === 'obiettivi_combinati' ? produzione : matched);
  return {
    ...compenso, attuale, obiettivo: obiettivo?.obiettivo ?? 0, conteggioSquadra,
    descrizione: gara.descrizione ?? metrica.descrizione ?? ''
  };
}
function easter(year) {
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4;
  const f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30;
  const i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  return new Date(Date.UTC(year,Math.floor((h+l-7*m+114)/31)-1,(h+l-7*m+114)%31+1));
}
function isWorkday(dateKey) {
  const d=new Date(dateKey+'T12:00:00Z');
  if (!Number.isFinite(d.getTime()) || d.getUTCDay()===0) return false;
  const fixed=['01-01','01-06','04-25','05-01','06-02','08-15','11-01','12-08','12-25','12-26'];
  if (fixed.includes(dateKey.slice(5))) return false;
  const monday=easter(d.getUTCFullYear()); monday.setUTCDate(monday.getUTCDate()+1);
  return dateKey!==monday.toISOString().slice(0,10);
}
function workingDays(year,month,asOf=null) {
  const end=new Date(Date.UTC(year,month,0)).getUTCDate(); let total=0,elapsed=0;
  for(let day=1;day<=end;day++) {
    const key=String(year)+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');
    if(isWorkday(key)) {total++; if(asOf===null || key<=asOf) elapsed++;}
  }
  return {total,elapsed};
}
function progress(score,goal,year,month,asOf) {
  if(!(goal>0)) return {andamento:'OBIETTIVO NON CONFIGURATO',eccedenza:null,andCls:'',eccCls:''};
  const {total,elapsed}=workingDays(year,month,asOf);
  const delta=score-(goal/total)*elapsed;
  if(score>=goal) return {andamento:'RAGGIUNTO',eccedenza:null,andCls:'raggiunto',eccCls:''};
  const excess=Math.ceil(Math.abs(delta))*(delta<0?-1:1);
  return {andamento:delta>=0?'IN LINEA':'IN RITARDO',eccedenza:excess,andCls:delta>=0?'in-linea':'in-ritardo',eccCls:excess>0?'pos':excess<0?'neg':''};
}
function monthlyRows(state,asOf) {
  const year=state.anno,month=state.mese;
  const validPiva=c=> {
    const status=state.statoPostVendita;
    if(c.categoria_snapshot==='Fisso') return ['In Attivazione','Attivo'].includes(status.fisso.get(c.id));
    if(c.categoria_snapshot==='Energia') return status.energia.get(c.id)!=='Rifiutato';
    if(c.categoria_snapshot==='Allarmi') return status.allarmi.get(c.id)==='OK';
    return true;
  };
  return state.metricheGara.filter(m=>m.tabella.startsWith('avanzamento_')).map(m=> {
    const piva=m.tabella!=='avanzamento_standard';
    const standardFissi=!piva && m.regola?.categoria==='Fisso';
    let lists=state.operatoriAttiviMese.map(op=>state.contrattiMese.filter(c=>
      inMonthlyScope(c,standardFissi)
      && state.resolveOperatore(c.operatore_id)===op.id && matchRegola(c,m.regola)));
    if(piva) lists=lists.map(list=>list.filter(validPiva));
    else if(m.regola?.categoria==='Energia') lists=lists.map(list=>list.filter(c=>state.statoPostVendita.energia.get(c.id)!=='Rifiutato'));
    else if(m.regola?.categoria==='Allarmi') lists=lists.map(list=>list.filter(c=>['In Attivazione','OK'].includes(state.statoPostVendita.allarmi.get(c.id))));
    else if(standardFissi) lists=lists.map((list,index)=>[
      ...list.filter(c=>state.tecnologiaFisso.get(c.id)!=='FTTC' && ['Da completare','Attivo','In Attivazione'].includes(state.statoPostVendita.fisso.get(c.id))),
      ...(state.fissoFTTCAttivatiMese||[]).filter(c=>inMonthlyScope(c,true) && state.resolveOperatore(c.operatore_id)===state.operatoriAttiviMese[index].id && matchRegola(c,m.regola))
    ]);
    const conteggi=lists.map(list=>list.reduce((sum,c)=>sum+pesoContratto(c,m.regola),0));
    const attuale=conteggi.reduce((a,b)=>a+b,0);
    const field=piva?'punteggio_extra_gara_totale':({Assicurazioni:'punteggio_gara_totale',Fisso:'punteggio_gara_totale'}[m.regola?.categoria]||m.punteggio_campo);
    const punteggio=field?lists.reduce((sum,list)=>sum+list.reduce((a,c)=>a+Number(c[field]||0),0),0):attuale;
    const o=state.obiettivi.find(o=>o.metrica_id===m.id && !o.operatore_id);
    const obiettivo=o?.obiettivo??0;
    return {id:m.id,nome:m.nome,tabella:m.tabella,conteggi,attuale,punteggio,obiettivo,...progress(punteggio,obiettivo,year,month,asOf)};
  });
}
function dailyRows(contracts,rows,profiles) {
  const map=new Map(profiles.map(p=>[p.id,p]));
  return rows.map(r=> {
    const operators=Object.fromEntries(DAY_OPERATORS.map(n=>[n,0]));
    contracts.forEach(c=> {
      const name=String(map.get(c.operatore_id)?.nome||'').trim().toUpperCase();
      if(c.codice_rivenditore===LEGNAGO && c.stato_inserimento!=='reinserimento' && DAY_OPERATORS.includes(name) && matchRegola(c,r.regola)) operators[name]++;
    });
    return {nome:r.nome,gruppo:r.gruppo,operatori:operators,totale:Object.values(operators).reduce((a,b)=>a+b,0)};
  }).filter(r=>r.totale>0);
}
return {LEGNAGO,CEREA,DAY_OPERATORS,inMonthlyScope,matchRegola,pesoContratto,calcolaCompenso,valutaGara,easter,isWorkday,workingDays,progress,monthlyRows,dailyRows};
}));
