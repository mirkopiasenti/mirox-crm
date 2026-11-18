'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas } = require('@napi-rs/canvas');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const Csv = require('../netlify/functions/_lib/energia-csv');
const Bill = require('../netlify/functions/_lib/energia-bolletta');
const Review = require('../netlify/functions/_lib/energia-verifica');
const { endpointPages } = require('../js/mirox-permissions-core');

const fiscale = 'RSSMRA80A01H501U';
const context = { fiscale, business: false };
const pdr = '00123456789012';
const pod = 'IT001E12345678';
const billLines = ['Fornitore: Enel Energia', `PDR: ${pdr}`, `Codice fiscale cliente: ${fiscale}`];
const header = 'A;B;C;D;Codice Fiscale;Partita Iva;G;Proposta di Contratto;POD;PDR;Stato;Causale stato pratica;Messaggio esito da SAP;Causa Annullamento\n';

test('export WindTre: proposta in H come testo, PIVA normalizzata, punti separati e gerarchia esiti per la stessa fornitura', () => {
  const rows = Csv.parse('\uFEFF' + header
    + `;;;;${fiscale};;x;"0007";;${pdr};Attivato;;;\n`
    + `;;;;${fiscale};;x;0007;;${pdr};Rifiutato;"causa; dettaglio";"riga 1\nriga 2";annullata\n`
    + `;;;;;123456789;x;0007;${pod};;Nuovo;testo;testo;testo\n`);
  assert.deepEqual(rows, [
    { numero: '0007', punto: pdr, cf: fiscale, piva: '', stato: 'Rifiutato', causale: 'causa; dettaglio', messaggio: 'riga 1\nriga 2', annullamento: 'annullata' },
    { numero: '0007', punto: pod, cf: '', piva: '00123456789', stato: 'Nuovo', causale: null, messaggio: null, annullamento: null }
  ]);
  assert.throws(() => Csv.parse(header + 'riga;non;valida'), /colonne/i);
  assert.throws(() => Csv.parse('Proposta di Contratto;Codice Fiscale;Partita Iva;Stato\n07;' + fiscale + ';;Nuovo'), /POD\/PDR/);
});

test('la bolletta individua un solo punto e distingue venditore, distributore e fiscale cliente', () => {
  assert.deepEqual(Bill.parseText('Distributore: E-Distribuzione\n' + billLines.join('\n'), context), { punto: pdr, gestore: 'Enel Energia', ocr: false });
  assert.equal(Bill.parseText([...billLines, `POD: ${pod}`].join('\n'), context).motivo, 'bolletta_ambigua');
  assert.equal(Bill.parseText(billLines.join('\n'), { ...context, fiscale: 'BNCANN80A01H501U' }).motivo, 'intestatario_diverso');
  assert.equal(Bill.parseText(`Distributore: E-Distribuzione\nPOD: ${pod} Altro campo`, context).motivo, 'fornitore_incerto');
  assert.equal(Bill.parseText('Fornitore: Enel Energia\nPDR: O0123456789012', context, { ocr: true }).motivo, 'punto_incerto');
});

test('PDF con testo e PDF scansionato sono letti localmente', { timeout: 25_000 }, async () => {
  const direct = await PDFDocument.create();
  const page = direct.addPage([700, 400]), font = await direct.embedFont(StandardFonts.Helvetica);
  billLines.forEach((line, i) => page.drawText(line, { x: 45, y: 330 - i * 50, font, size: 20 }));
  assert.deepEqual(await Bill.fromBytes(Buffer.from(await direct.save()), context), { punto: pdr, gestore: 'Enel Energia', ocr: false });

  const canvas = createCanvas(1500, 430);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1500, 430);
  ctx.fillStyle = 'black'; ctx.font = '44px sans-serif';
  billLines.forEach((line, i) => ctx.fillText(line, 55, 80 + i * 70));
  const scan = await PDFDocument.create(), image = await scan.embedPng(canvas.toBuffer('image/png'));
  scan.addPage([750, 215]).drawImage(image, { x: 0, y: 0, width: 750, height: 215 });
  assert.deepEqual(await Bill.fromBytes(Buffer.from(await scan.save()), context), { punto: pdr, gestore: 'Enel Energia', ocr: true });
});

test('import condiviso da Verifica Contratti e riscontro manuale richiedono la sua ACL', () => {
  const event = action => ({ body: JSON.stringify({ action }) });
  assert.deepEqual(endpointPages('gestisci-controllo-lg', event('import_shared_csv')), ['verifica_contratti']);
  assert.deepEqual(endpointPages('gestisci-controllo-lg', event('set_manual_outcome')), ['controllo_lg']);
  assert.deepEqual(endpointPages('gestisci-vendita-contratto', event('riscontro_energia')), ['verifica_contratti']);
});

test('la coda usa prove server-side, non approva contratti e registra un tentativo fallito', async () => {
  const calls = [];
  const db = { async rpc(name, args) {
    calls.push([name, args]);
    if (name === 'vendita_energia_prossimo') {
      return { data: calls.length < 3 ? { contratto_id: 'fixture', lease: 'job', contesto: context, csv_id: 'file', updated_at: '2026-11-18T14:00:00Z' } : null };
    }
    return { data: { stato: 'in_attesa_csv', motivo: 'errore_lettura' } };
  }};
  await Review.drain(db, async () => { throw new Error('lettura fixture'); });
  assert.deepEqual(calls.map(([name]) => name), ['vendita_energia_prossimo', 'vendita_energia_riscontra', 'vendita_energia_prossimo']);
  assert.equal(calls[1][1].p_punto, null);
  assert.equal(calls[1][1].p_motivo, 'errore_lettura');
  assert.equal(calls[1][1].p_lease, 'job');
});

test('riscontro manuale richiede attestazione e revisione, passa al DB solo POD/PDR e gestore', async () => {
  const calls = [];
  const db = { async rpc(name, payload) {
    calls.push([name, payload]);
    return { data: name === 'vendita_energia_contesto_manuale' ? context : { stato: 'in_attesa_verifica', motivo: null } };
  }};
  const input = { contratto_id: 'fixture', expected_updated_at: '2026-11-18T14:00:00Z', pod_pdr: pdr, ex_fornitore: 'Enel Energia', numero_contratto_energia: 'valore non autorizzato' };
  await assert.rejects(Review.manual(db, input, 'operatore'), { statusCode: 400 });
  assert.equal(calls.length, 0);
  assert.equal((await Review.manual(db, { ...input, attestazione: true }, 'operatore')).stato, 'in_attesa_verifica');
  assert.equal(calls[1][1].p_punto, pdr);
  assert.equal(calls[1][1].p_autore, 'operatore');
  assert.equal(calls[1][1].p_numero, undefined);
});
