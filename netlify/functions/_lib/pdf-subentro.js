'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { validatePayload, ValidationError } = require('../../../js/subentri-core');
const MAP = require('./pdf-subentro-coordinates.json');
const TEMPLATE_VERSION = 'windtre-cessione-mobile-2024-06-v1';
function resolveTemplatePath() {
  for (const directory of [path.join(__dirname, '_templates', 'subentri'), path.join(__dirname, '..', '_templates', 'subentri'), path.join(process.cwd(), 'netlify', 'functions', '_templates', 'subentri')]) {
    const candidate = path.join(directory, 'cessione-mobile-2024-06.pdf');
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Modello PDF subentri non disponibile');
}
function formatDate(value) { return value ? value.split('-').reverse().join('/') : ''; }
async function generateSubentroPdf(raw, { createdAt = new Date().toISOString() } = {}) {
  const data = validatePayload(raw);
  const source = await PDFDocument.load(fs.readFileSync(resolveTemplatePath()));
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const ink = rgb(.05,.05,.05);
  function draw(page, x, baseline, value, width = 550 - x, size = 6) {
    if (!value) return;
    const text = String(value);
    try { font.encodeText(text); } catch (_) { throw new ValidationError('Un campo contiene caratteri non stampabili nel modulo'); }
    const fitted = Math.min(size, width / Math.max(1, font.widthOfTextAtSize(text, 1)));
    if (fitted < 4.5) throw new ValidationError('Un campo è troppo lungo per lo spazio del modulo: abbrevialo');
    page.drawText(text, { x, y: page.getHeight()-baseline, size:fitted, font, color:ink });
  }
  function chars(page, positions, baseline, value, size = 5.6) {
    if (value.length > positions.length) throw new ValidationError('Un dato supera le caselle disponibili nel modulo');
    [...value].forEach((ch,i) => draw(page,positions[i]-font.widthOfTextAtSize(ch,size)/2,baseline,ch,10,size));
  }
  function grid(page, key, value, size) { const m=MAP[key]; chars(page,m.cells,m.baseline,value,size); }
  function phone(page,key,value) {
    const m=MAP[key]; const prefix=value.startsWith('0') ? Math.min(4,value.length-1) : 3;
    chars(page,m.prefix,m.baseline,value.slice(0,prefix)); chars(page,m.suffix,m.baseline,value.slice(prefix));
  }
  function dateGrid(page,key,value) {
    const m=MAP[key]; const [year,month,day]=value.split('-');
    [day,month,year.slice(-2)].forEach((part,i)=>chars(page,m.parts[i],m.baseline,part));
  }
  function check(page,x,top,size) {
    const m=.65; const height=page.getHeight();
    page.drawLine({ start:{x:x+m,y:height-top-m},end:{x:x+size-m,y:height-top-size+m},thickness:.65,color:ink });
    page.drawLine({ start:{x:x+m,y:height-top-size+m},end:{x:x+size-m,y:height-top-m},thickness:.65,color:ink });
  }
  const pageCount = Math.ceil(data.numeri.length/4);
  for (let i=0;i<pageCount;i++) {
    const [page] = await doc.copyPages(source,[0]); doc.addPage(page);
    grid(page,'codice_cliente',data.codice_cliente,7);
    draw(page,204,121.7,data.cedente_nome,155,6.2); draw(page,397,121.7,data.cedente_cognome,151,6.2);
    grid(page,'cedente_cf',data.cedente_codice_fiscale); phone(page,'cedente_telefono',data.cedente_telefono);
    if (data.cedente_tipo==='impresa') {
      draw(page,178,149.1,data.cedente_ragione_sociale,370,6.2);
      grid(page,'cedente_piva_impresa',data.cedente_partita_iva); phone(page,'impresa_telefono',data.cedente_telefono_impresa);
    } else grid(page,'cedente_piva_prof',data.cedente_partita_iva);
    draw(page,204,178.5,data.subentrante_nome,155,6.2); draw(page,397,178.5,data.subentrante_cognome,151,6.2);
    grid(page,'subentrante_cf',data.subentrante_codice_fiscale);
    check(page,data.subentrante_sesso==='M'?68.94:84.5,192.62,4.11);
    draw(page,146,196.9,data.subentrante_comune_nascita,370,6.1); grid(page,'nascita_prov',data.subentrante_provincia_nascita);
    dateGrid(page,'nascita',data.subentrante_data_nascita); phone(page,'subentrante_telefono',data.subentrante_telefono);
    draw(page,100,215.1,data.subentrante_documento_tipo,94,5.9); dateGrid(page,'rilascio',data.subentrante_documento_rilascio);
    grid(page,'documento',data.subentrante_documento_numero); draw(page,428,215.1,data.subentrante_nazionalita,121);
    draw(page,100,224.2,data.subentrante_via,402,6.1); draw(page,521,224.2,data.subentrante_civico,29);
    draw(page,68,233.4,data.subentrante_localita,165); grid(page,'cap',data.subentrante_cap);
    draw(page,322,233.4,data.subentrante_comune,194); grid(page,'provincia',data.subentrante_provincia);
    data.numeri.slice(i*4,i*4+4).forEach((number,index)=>phone(page,`numero${index}`,number));
    if (data.pagamento==='iban') {
      check(page,42.9,393.42,5.31); draw(page,96,414.8,data.banca,450);
      if (/^IT.{25}$/.test(data.iban)) {
        chars(page,MAP.iban.cells.slice(2),MAP.iban.baseline,data.iban.slice(2),5.8);
      } else {
        // IBAN estero: conserva la riga, sostituisce solo IT e caselle prestampate.
        page.drawRectangle({x:56,y:page.getHeight()-447.5,width:247,height:7,color:rgb(1,1,1)});
        draw(page,59,446.8,data.iban,241,6.2);
      }
      draw(page,89,462.6,`${data.sottoscrittore_nome} ${data.sottoscrittore_cognome}`,198,5.8);
      draw(page,69,470.6,data.sottoscrittore_via,173,5.8); draw(page,259,470.6,data.sottoscrittore_civico,29,5.8);
      grid(page,'sottoscrittore_cap',data.sottoscrittore_cap); draw(page,128,478.6,data.sottoscrittore_comune,114,5.8);
      grid(page,'sottoscrittore_provincia',data.sottoscrittore_provincia); grid(page,'sottoscrittore_cf',data.sottoscrittore_codice_fiscale);
      draw(page,96,494.6,data.sottoscrittore_telefono,192,5.8);
      draw(page,306,470.6,data.conto_intestatario,244,5.8); draw(page,331,478.6,data.conto_via,173,5.8); draw(page,522,478.6,data.conto_civico,28,5.8);
      grid(page,'conto_cap',data.conto_cap); draw(page,390,486.6,data.conto_comune,114,5.8); grid(page,'conto_provincia',data.conto_provincia);
      grid(page,'conto_cf',data.conto_cf_piva); draw(page,80,538.9,[data.luogo,formatDate(data.data)].filter(Boolean).join(', '),205,5.8);
    } else check(page,43.02,542.15,6.09);
    const consentChecks={windtre:[161.66,562.18],terze_parti:[234.69,572.98],profilazione:[498.3,578.38],geolocalizzazione:[451.02,583.78],arricchimento:[530.35,589.18],trasferimento:[510.17,594.58]};
    for (const [key,[x,y]] of Object.entries(consentChecks)) if(data.consensi[key]) check(page,x,y,3.75);
    draw(page,132,618.9,formatDate(data.data),155,5.8);
    draw(page,474,706.1,formatDate(data.data),74,5.8); draw(page,474,737.4,formatDate(data.data),74,5.8);
    if(pageCount>1) draw(page,42.5,17,`PAGINA ${i+1}/${pageCount} - NUMERI ${i*4+1}-${Math.min(i*4+4,data.numeri.length)} DI ${data.numeri.length}`,510,7);
  }
  doc.setTitle('Subentro Mobile da Microbusiness a Privato'); doc.setCreator('Mirox CRM'); doc.setProducer('Mirox CRM - pdf-lib');
  doc.setCreationDate(new Date(createdAt)); doc.setModificationDate(new Date(createdAt));
  return {buffer:Buffer.from(await doc.save({useObjectStreams:false})),data,pageCount,templateVersion:TEMPLATE_VERSION};
}
module.exports={generateSubentroPdf,resolveTemplatePath,TEMPLATE_VERSION};
