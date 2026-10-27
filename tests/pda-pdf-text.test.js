'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { layoutText, sectionFields, readPdfFields } = require('../netlify/functions/_lib/pda-pdf-text');
const { normalizeResult } = require('../netlify/functions/ocr-pda')._test;

async function fixturePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const first = pdf.addPage();
  first.drawText('DATI FIRMA ELETTRONICA', { x: 30, y: 700, size: 10, font });
  first.drawText('Numero di telefono: +393351234567', { x: 30, y: 680, size: 10, font });
  first.drawText('Documento dimostrativo per test automatico, nessun dato personale reale.', { x: 30, y: 650, size: 10, font });
  pdf.addPage().drawText('Condizioni generali dimostrative. '.repeat(5), { x: 30, y: 700, size: 10, font });
  const sim = pdf.addPage();
  // Come nel guasto reale: il numero e' scritto prima nel content stream, ma sotto al titolo.
  sim.drawText('Numero di telefono: +393331234567 Seriale SIM (ICCID): 8939000000000000000', { x: 30, y: 680, size: 10, font });
  sim.drawText('DATI DELLA SIM WINDTRE', { x: 30, y: 700, size: 10, font });
  sim.drawText('Piano Telefonico: Professional Full Plus XL', { x: 30, y: 660, size: 10, font });
  sim.drawText('Data: 27/10/2026 Firma:', { x: 30, y: 640, size: 10, font });
  return pdf.save();
}

test('ricostruisce titolo e numero per coordinate anche con content stream fuori ordine', () => {
  const text = layoutText([[{str:'Numero di telefono:',x:20,y:680},{str:'+393331234567',x:130,y:680},
    {str:'DATI DELLA SIM WINDTRE',x:20,y:700},{str:'',x:0,y:0}]]);
  assert.equal(text, 'DATI DELLA SIM WINDTRE\nNumero di telefono: +393331234567');
  assert.deepEqual(sectionFields(text), {portabilita:false,numero_sim:'3331234567'});
});

test('separa SIM, firma elettronica e MNP e ignora gli importi di accessori', () => {
  const text = 'DATI FIRMA ELETTRONICA\nNumero di telefono: +393351234567\nDATI DELLA SIM WINDTRE\n'
    + 'Numero di telefono: +393931234567 Seriale SIM (ICCID): 8939000000000000000\nCosto mensile: 0,99 euro\n'
    + 'DATI PER LA RICHIESTA DEL SERVIZIO PASSA A WINDTRE\nNumero di telefono da portare: +393491234567\n'
    + 'Operatore attuale: Vodafone\nData preferita: 28/10/2026';
  const fields = sectionFields(text);
  assert.deepEqual(fields, {portabilita:true,numero_sim:'3931234567',numero_mnp:'3491234567',operatore_provenienza:'Vodafone'});
  const out = normalizeResult({...fields,cellulare:'3351234567'});
  assert.equal(out.cellulare,'3351234567');assert.equal(out.numero_telefono,'3491234567');
  assert.equal(out.numero_provvisorio,'3931234567');assert.equal(out.costo_offerta_mensile,null);
});

test('numeri discordanti non vengono scelti arbitrariamente e non usano la firma come fallback', () => {
  const header='DATI DELLA SIM WINDTRE\nNumero di telefono: ';
  assert.equal(sectionFields(header+'3331234567\n'+header+'3491234567').numero_sim,null);
  assert.equal(sectionFields(header+'12345').numero_sim,null);
  assert.deepEqual(sectionFields('DATI FIRMA ELETTRONICA\nNumero di telefono: 3351234567'),{});
  assert.deepEqual(sectionFields('Il testo cita DATI DELLA SIM WINDTRE senza una sezione.\nNumero di telefono: 3351234567'),{});
});

test('PDF ibrido: senza MNP testuale non conclude automaticamente nuova attivazione', () => {
  const fields=sectionFields('DATI DELLA SIM WINDTRE\nNumero di telefono: 3331234567',false);
  assert.deepEqual(fields,{numero_sim:'3331234567'});
  const out=normalizeResult({portabilita:true,numero_mnp:'3491234567',...fields});
  assert.equal(out.portabilita,true);assert.equal(out.numero_telefono,'3491234567');assert.equal(out.numero_provvisorio,'3331234567');
});

test('PDF vero sintetico: recupera numero nella terza pagina mantenendo separato il contatto firma',async()=>{
  const fields=await readPdfFields(await fixturePdf());
  assert.deepEqual(fields,{portabilita:false,numero_sim:'3331234567'});
  assert.equal(normalizeResult(fields).cellulare,null);
  await assert.rejects(readPdfFields(Buffer.from('PDF non valido')));
});

test('Function multipart recupera il numero omesso dall AI prima di restituire i dati al wizard',async()=>{
  const filename=path.join(__dirname,'../netlify/functions/ocr-pda.js'),nativeRequire=createRequire(filename),module={exports:{}};
  const raw={codice_contratto:'TEST-001',numero_sim:null,portabilita:false,cellulare:'3351234567'};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,Buffer,
    console:{error(){}},process:{env:{ANTHROPIC_API_KEY:'test-only'}},require(name){
      if(name==='./_lib/require-auth')return {requireAuth:async()=>({ok:true})};
      if(name==='@anthropic-ai/sdk')return {default:class{constructor(){this.messages={create:async()=>({content:[{type:'text',text:JSON.stringify(raw)}]})};}}};
      return nativeRequire(name);
    }},{filename});
  const boundary='pda-test-boundary',pdf=await fixturePdf();
  const body=Buffer.concat([Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="test.pdf"\r\nContent-Type: application/pdf\r\n\r\n'),Buffer.from(pdf),Buffer.from('\r\n--'+boundary+'--\r\n')]);
  const response=await module.exports.handler({httpMethod:'POST',headers:{'content-type':'multipart/form-data; boundary='+boundary},body:body.toString('base64'),isBase64Encoded:true});
  assert.equal(response.statusCode,200);const data=JSON.parse(response.body).data;
  assert.equal(data.numero_telefono,'3331234567');assert.equal(data.cellulare,'3351234567');assert.equal(data.codice_contratto,'TEST-001');
  assert.equal(data.portabilita,false);assert.equal(data.costo_offerta_mensile,null);
});
