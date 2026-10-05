'use strict';
const path=require('node:path');
const fs=require('node:fs');
const WIDTH=960;
const C={ink:'#142942',muted:'#61738a',bg:'#eef3f8',line:'#dbe4ee',blue:'#2364b0',green:'#137547',red:'#ae3439'};
const num=n=>Number(n).toLocaleString('it-IT',{maximumFractionDigits:2});
const clean=value=>String(value??'').replace(/[\x00-\x1f]/g,' ').slice(0,160);
const xml=value=>clean(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function lines(value,max=36) {
  const words=clean(value).split(/\s+/),out=[];let line='';
  for(const word of words) {
    const parts=word.match(new RegExp(`.{1,${max}}`,'gu'))||[''];
    for(const part of parts) {if(line&&(line+' '+part).length>max){out.push(line);line='';}line+=(line?' ':'')+part;}
  }
  if(line)out.push(line);return out.length?out:[''];
}
class Canvas {
  constructor(title,subtitle) {
    this.parts=[];this.y=220;
    this.box(0,0,WIDTH,190,'#142942',0);
    this.text(48,53,'MIROX AI - TARGET',23,'#a9c5e8',true);
    this.text(48,113,title,52,'#ffffff',true);
    this.text(48,157,subtitle,28,'#d3e1ef');
  }
  box(x,y,w,h,fill='#ffffff',radius=18){this.parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}"/>`);}
  text(x,y,value,size=32,color=C.ink,bold=false){this.parts.push(`<text x="${x}" y="${y}" font-family="Lato" font-size="${size}" font-weight="${bold?700:400}" fill="${color}">${xml(value)}</text>`);}
  wrap(x,y,value,size=32,max=36,color=C.ink,bold=false){const all=lines(value,max);all.forEach((line,i)=>this.text(x,y+i*(size+9),line,size,color,bold));return all.length*(size+9);}
  heading(value){this.y+=this.wrap(48,this.y+34,value,36,38,C.ink,true)+18;}
  finish(p) {
    this.y+=12;
    const date=new Date(p.letto_il),stamp=new Intl.DateTimeFormat('it-IT',{timeZone:'Europe/Rome',dateStyle:'short',timeStyle:'short'}).format(date);
    this.text(48,this.y+25,`Dati letti ${stamp} · Europe/Rome`,25,C.muted);
    this.y+=64;
    return {svg:`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${this.y}" viewBox="0 0 ${WIDTH} ${this.y}"><rect width="100%" height="100%" fill="${C.bg}"/>${this.parts.join('')}</svg>`,width:WIDTH,height:this.y};
  }
}
function metricRow(c,m,y) {
  ['fatte','risposte','non_risposte','fissati'].forEach((key,i)=>{
    const x=72+i*215;
    c.text(x,y,['Fatte','Risposte','Non risposte','Fissati'][i],26,C.muted);
    c.text(x,y+49,num(m[key]),45,key==='fissati'?C.blue:C.ink,true);
  });
}
function operator(c,op,total=false) {
  const name=total?'Totale canale':op.nome;
  const nameHeight=lines(name,34).length*46;
  const h=144+nameHeight+(op.spostamenti?38:0);
  c.box(48,c.y,864,h,total?'#e0ebf7':'#ffffff');
  c.wrap(72,c.y+43,name,37,34,C.ink,true);
  metricRow(c,op,c.y+nameHeight+49);
  if(op.spostamenti)c.text(72,c.y+h-18,`Spostamenti: ${num(op.spostamenti)}`,27,C.muted);
  c.y+=h+16;
}
function callsImage(p) {
  const c=new Canvas('Call Center',p.data.split('-').reverse().join('/')+' · Riepilogo della giornata');
  const total=p.chiamate.totale;
  ['fatte','risposte','non_risposte','fissati'].forEach((key,i)=>{
    const x=48+(i%2)*444,y=220+Math.floor(i/2)*154;
    c.box(x,y,420,138);
    c.text(x+24,y+39,['Chiamate fatte','Risposte','Non risposte','Appuntamenti fissati'][i],29,C.muted);
    c.text(x+24,y+111,num(total[key]),67,key==='fissati'?C.blue:C.ink,true);
  });
  c.y=536;
  if(total.spostamenti){c.text(48,c.y+23,`Spostamenti complessivi: ${num(total.spostamenti)}`,29,C.muted);c.y+=46;}
  c.heading('Totale per operatore');
  if(!p.chiamate.operatori.length){c.text(48,c.y+27,'Nessuna attività registrata.',31,C.muted);c.y+=64;}
  for(const op of p.chiamate.operatori)operator(c,op);
  for(const channel of p.chiamate.canali){c.heading(channel.canale);operator(c,channel.totale,true);for(const op of channel.operatori)operator(c,op);}
  c.text(48,c.y+25,'Fissati = nuovi appuntamenti; spostamenti separati.',27,C.muted);c.y+=48;
  return c.finish(p);
}
function monthImage(p) {
  const c=new Canvas('Andamento mensile',p.data.slice(5,7)+'/'+p.data.slice(0,4)+' · Legnago · Situazione aggiornata');
  const missing=p.mensile.filter(r=>!(r.obiettivo>0)).length;
  if(missing) {
    c.box(48,c.y,864,132,'#fff0cf');
    c.text(72,c.y+42,`${missing} ${missing===1?'categoria senza obiettivo':'categorie senza obiettivo'}`,33,C.ink,true);
    c.text(72,c.y+81,'Andamento ed eccedenza non calcolabili',30,C.ink);
    c.text(72,c.y+114,'per le categorie indicate sotto.',28,C.muted);
    c.y+=152;
  }
  if(!p.mensile.length){c.text(48,c.y+30,'Nessuna categoria configurata.',32,C.muted);c.y+=64;}
  for(const r of p.mensile) {
    const absent=!(r.obiettivo>0),color=absent?C.muted:r.andamento==='IN RITARDO'?C.red:C.green;
    const nameHeight=lines(r.nome,34).length*45,h=nameHeight+199;
    c.box(48,c.y,864,h);c.box(48,c.y,7,h,color,3);
    c.wrap(72,c.y+43,r.nome,36,34,C.ink,true);
    c.text(72,c.y+nameHeight+42,absent?'OBIETTIVO NON CONFIGURATO':r.andamento,26,color,true);
    const metrics=c.y+nameHeight+83;
    c.text(72,metrics,'Punteggio / Obiettivo',26,C.muted);
    c.text(72,metrics+54,`${num(r.punteggio)} / ${absent?'—':num(r.obiettivo)}`,46,C.ink,true);
    c.text(616,metrics,'Eccedenza',26,C.muted);
    c.text(616,metrics+54,r.eccedenza==null?'—':(r.eccedenza>0?'+':'')+num(r.eccedenza),50,color,true);
    c.y+=h+18;
  }
  c.y+=c.wrap(48,c.y+24,'Andamento ed eccedenza seguono i giorni lavorativi, come nella pagina del CRM.',27,62,C.muted);
  return c.finish(p);
}
function renderImage(message) {
  if(message.type!=='image'||typeof message.svg!=='string'||message.svg.length>2*1024*1024||message.width!==WIDTH||!Number.isSafeInteger(message.height)||message.height<1||message.height>50000||/<!|<[^>]+\b(?:href|style)\s*=|<(?:image|use|foreignObject|script)\b/i.test(message.svg))throw new Error('target_image_invalid');
  const {Resvg}=require('@resvg/resvg-js');
  const candidates=[path.join(__dirname,'_assets/target'),path.join(__dirname,'../_assets/target'),path.join(process.cwd(),'netlify/functions/_assets/target')];
  const fonts=candidates.find(dir=>['Lato-Regular.ttf','Lato-Bold.ttf'].every(file=>fs.existsSync(path.join(dir,file))));
  if(!fonts)throw new Error('target_image_fonts_missing');
  // Bound native allocation; long reports retain the full image as a PNG document.
  const renderer=new Resvg(message.svg,{font:{fontFiles:[path.join(fonts,'Lato-Regular.ttf'),path.join(fonts,'Lato-Bold.ttf')],loadSystemFonts:false,defaultFontFamily:'Lato'},fitTo:{mode:'height',value:Math.min(message.height,18000)}});
  const png=renderer.render();
  return {type:'photo',bytes:png.asPng(),width:png.width,height:png.height,filename:message.filename,caption:message.caption,text:message.text};
}
module.exports={callsImage,monthImage,renderImage};
