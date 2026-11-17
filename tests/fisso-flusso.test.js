'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const F=require('../js/fisso-core');
const {fixedTechnologyFields,sectionFields,readPdfData}=require('../netlify/functions/_lib/pda-pdf-text');
const {PDFDocument,StandardFonts}=require('pdf-lib');
const {normalizeResult,mergePdfResult}=require('../netlify/functions/ocr-pda')._test;
const header='Linea telefonica su cui attivare il servizio Offerta (*)\n';
test('Consumer e Business hanno sette/sei tecnologie; Professional Box e solo Business, suffisso persistito',()=>{
  assert.equal(F.options('Consumer').length,7);assert.equal(F.options('Business').length,6);
  for(const technology of F.BASES){
    const d=F.validate({tecnologia_fisso:technology,professional_box:true,codice_cliente_fisso:'P0001'},'Fisso','Business',{required:true});
    assert.equal(d.tecnologia_fisso,technology+' - Professional Box');assert.equal(d.codice_pos_fisso,F.POS);
    assert.throws(()=>F.validate({...d,professional_box:null},'Fisso','Business',{required:true}),/Professional Box/);
    assert.throws(()=>F.validate(d,'Fisso','Consumer',{required:true}),/Professional Box/);
  }
  assert.throws(()=>F.validate({tecnologia_fisso:'FWA Voce',professional_box:false,codice_cliente_fisso:'P01'},'Fisso','Business',{required:true}),/tecnologia/);
});
test('riconoscimento nomi esatti, Area Bianca e 2,5 non distinguono piu le reti fisiche',()=>{
  for(const professional of ['', ' Professional']){
    assert.equal(F.recognize('Internet 100'+professional),'FTTC 100');
    assert.equal(F.recognize('Internet 200'+professional),'FTTC 200');
    assert.equal(F.recognize('Super Fibra'+professional),'FTTH OF-FWCOP');
    assert.equal(F.recognize('Super Fibra'+professional+' su Aree Bianche'),'FTTH Aree Bianche');
  }
  assert.equal(F.recognize('Super Fibra 2,5 Giga'),'FTTH OF-FWCOP');
  for(const name of ['Super Internet Casa 5G','Super Internet Professional 5G']){
    assert.equal(F.recognize(name,true),'FWA Indoor');assert.equal(F.recognize(name,false),'FWA Outdoor');assert.equal(F.recognize(name,null),null);
  }
  assert.equal(F.recognize('Super Fibra pubblicita sconosciuta'),null);
});
test('parser riquadro contrattuale: non deduce Indoor dalla parola modem o da un modulo vuoto',()=>{
  const text=header+'[X] Su una nuova linea telefonica Super Internet Casa 5G\nAntenna e modem in vendita abbinata\nOpzioni aggiuntive\nChiamate\nDettaglio ubicazione';
  assert.equal(fixedTechnologyFields(text,true).tecnologia_fisso,'FWA Outdoor');
  assert.equal(fixedTechnologyFields(text,false).tecnologia_fisso,null);
  const empty=text+'\nModulo di Cessione del credito\ncede importo di ___ euro\nSERIALE MODEM ______';
  assert.equal(fixedTechnologyFields(empty,true).tecnologia_fisso,'FWA Outdoor');
  assert.equal(fixedTechnologyFields(text+'\nModulo di Cessione del credito\nSERIALE MODEM 352941750563628',true).tecnologia_fisso,null);
  const full=text+'\nModulo di Cessione del credito\ncede importo di 297,52 euro\nSERIALE MODEM 352941750563628';
  assert.equal(fixedTechnologyFields(full,true).tecnologia_fisso,'FWA Indoor');
  assert.equal(fixedTechnologyFields('Pubblicita Super Fibra su Aree Bianche').tecnologia_fisso,undefined);
});
test('codice cliente/contratto rimangono separati anche con etichette senza due punti',()=>{
  const fields=sectionFields('CODICE CLIENTE P00001 Numero Contratto 00123\n'+header+'Internet 100 Professional');
  assert.equal(fields.codice_cliente,'P00001');assert.equal(fields.codice_contratto,'00123');
  assert.equal(fields.tecnologia_fisso,'FTTC 100');
});
test('OCR non inventa Professional Box e conserva incertezza FWA su assenza testuale non corroborata',()=>{
  const d=normalizeResult({offerta_fisso_pda:'Super Internet Professional 5G',cessione_credito_modem:true});
  assert.equal(d.tecnologia_fisso,'FWA Indoor');assert.equal(d.professional_box,undefined);
  if(mergePdfResult)assert.equal(mergePdfResult({offerta_fisso_pda:'Super Internet Casa 5G',cessione_credito_modem:true},{offerta_fisso_pda:'Super Internet Casa 5G',cessione_credito_modem:false}).tecnologia_fisso,null);
});
test('PDF vero: tecnologia iniziale e modulo modem in pagina successiva',async()=>{
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText(header+'[X] Su una nuova linea telefonica Super Internet Casa 5G\nOpzioni aggiuntive\nGIGA illimitati\nDettaglio ubicazione\nCodice Cliente: P000001 Numero Contratto: 000001',{x:30,y:700,font,size:10});
  pdf.addPage().drawText('Modulo di Cessione del credito\ncede importo di 297,52 euro\nSERIALE MODEM 352941750563628\nUlteriori dati del contratto e documentazione allegata alla proposta di attivazione.',{x:30,y:700,font,size:10});
  const data=await readPdfData(await pdf.save());assert.equal(data.fields.tecnologia_fisso,'FWA Indoor');
});
test('catalogo: nuovi dettagli mantengono le offerte e i punteggi di famiglia e Professional Box esistenti',()=>{
  const offers=['FTTC','FTTH','FTTH - Fritz Box','FWA - OUTDOOR','FWA - Fritz Box'].map((nome_offerta,i)=>({id:String(i),nome_offerta,cluster_cliente:'Business',punteggio_gara:/Fritz/.test(nome_offerta)?2.75:1.75}));
  for(const technology of F.BASES){
    assert.equal(F.findOffer(offers,technology,false,'Business').punteggio_gara,1.75);
    assert.equal(F.findOffer(offers,technology,true,'Business').punteggio_gara,2.75);
    assert.ok(F.legacyTechnology(technology));
  }
});
test('Controllo Fissi mantiene solo riepilogo/esiti; quattro dati readonly, nessuna seconda compilazione',()=>{
  const html=fs.readFileSync(require.resolve('../moduli/controllo_fissi.html'),'utf8');
  assert.doesNotMatch(html,/confermaCompilazione|Compilazione Completata|data-tab="da-completare"/);
  assert.match(html,/r\.contratto\?\.tecnologia_fisso/);
  const fields=html.slice(html.indexOf('function getValori()'),html.indexOf('async function salvaCampi'));
  assert.doesNotMatch(fields,/codice_cliente|tecnologia|cod_contratto|cod_pos/);
});
