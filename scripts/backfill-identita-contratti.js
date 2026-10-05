'use strict';
// Retroattivo autorizzato dal proprietario dal 01/07/2026 Europe/Rome.
// Default dry-run; copie indipendenti, nessun UPDATE dei documenti originali.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const CUTOFF = '2026-06-30T22:00:00.000Z';
const BUCKET = 'contratti-vendita';

function planBackfill(contracts, documents, { allowSameClient = false } = {}) {
  const missing = contracts.filter(c => !documents.some(d =>
    d.contratto_id === c.id && d.tipo_documento === 'documento_identita'));
  const recoverable = [], unresolved = [];
  for (const contract of missing) {
    let sources = documents.filter(d => d.pratica_id === contract.pratica_id &&
      d.anagrafica_id === contract.anagrafica_id && d.tipo_documento === 'documento_identita' &&
      d.storage_bucket === BUCKET && d.storage_path && d.mime_type === 'application/pdf')
      .sort((a,b) => String(a.uploaded_at).localeCompare(String(b.uploaded_at)) || a.id.localeCompare(b.id));
    let sameClient = false;
    if (!sources.length && allowSameClient) {
      // Eccezione autorizzata dal proprietario: identita piu recente dello
      // stesso anagrafica_id, mai per nome/CF approssimato.
      sources = documents.filter(d => d.anagrafica_id === contract.anagrafica_id &&
        d.tipo_documento === 'documento_identita' && d.storage_bucket === BUCKET &&
        d.storage_path && d.mime_type === 'application/pdf')
        .sort((a,b) => String(b.uploaded_at).localeCompare(String(a.uploaded_at)) || a.id.localeCompare(b.id));
      sameClient = sources.length > 0;
    }
    if (!sources.length) { unresolved.push(contract); continue; }
    // Mantiene l'insieme di PDF identita dello stesso contratto sorgente (fronte/retro).
    const donorId = sources[0].contratto_id;
    const donorDocuments = sameClient ? [sources[0]] :
      sources.filter(d => d.contratto_id === donorId && d.pratica_id === sources[0].pratica_id);
    if (sameClient && !contract.storage_base_path) throw new Error('Percorso della pratica destinataria mancante');
    recoverable.push({ contract, sameClient, documents: donorDocuments.map(source => {
      const fileName = `documento_identita_backfill_${source.id}_${contract.id}.pdf`;
      return { source, file_name: fileName,
        storage_path: (sameClient ? contract.storage_base_path.replace(/\/+$/, '') + '/' :
          source.storage_path.slice(0, source.storage_path.lastIndexOf('/') + 1)) + fileName };
    }) });
  }
  return { contracts: contracts.length, missing: missing.length, recoverable, unresolved };
}

async function allRows(query) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await query().range(offset, offset + 999);
    if (error) throw new Error('Lettura inventario DB non riuscita');
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

async function readPdf(storage, key) {
  const { data, error } = await storage.download(key);
  if (error) throw new Error('Download documento non riuscito');
  const bytes = Buffer.from(await data.arrayBuffer());
  if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('Firma PDF non valida');
  return { size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

async function copyContractIdentity(db, item) {
  const { contract, documents } = item;
  const { data: current, error: currentError } = await db.from('vendita_contratti')
    .select('id, pratica_id, anagrafica_id, data_contratto, pratica:vendita_pratiche(storage_base_path)').eq('id', contract.id).single();
  if (currentError || current.pratica_id !== contract.pratica_id || current.anagrafica_id !== contract.anagrafica_id ||
      new Date(current.data_contratto) < new Date(CUTOFF) ||
      (item.sameClient && current.pratica?.storage_base_path !== contract.storage_base_path)) throw new Error('Contratto modificato dopo il piano');
  const { data: present, error: presentError } = await db.from('vendita_documenti').select('id')
    .eq('contratto_id', contract.id).eq('tipo_documento', 'documento_identita');
  if (presentError) throw new Error('Verifica identita corrente non riuscita');
  if (present.length) return { skipped: true };
  const storage = db.storage.from(BUCKET), created = [], rows = [], checks = [];
  try {
    for (const doc of documents) {
      const source = doc.source;
      const { data: sourceNow, error: sourceError } = await db.from('vendita_documenti').select('*').eq('id', source.id).single();
      if (sourceError || sourceNow.pratica_id !== source.pratica_id ||
          (!item.sameClient && sourceNow.pratica_id !== contract.pratica_id) || sourceNow.anagrafica_id !== contract.anagrafica_id ||
          sourceNow.tipo_documento !== 'documento_identita' || sourceNow.storage_bucket !== BUCKET ||
          sourceNow.storage_path !== source.storage_path) throw new Error('Sorgente modificata dopo il piano');
      const original = await readPdf(storage, source.storage_path);
      if (source.file_size != null && Number(source.file_size) !== original.size) throw new Error('Dimensione sorgente incoerente');
      const { error: copyError } = await storage.copy(source.storage_path, doc.storage_path);
      if (copyError) throw new Error('Copia Storage non riuscita');
      created.push(doc.storage_path);
      const copied = await readPdf(storage, doc.storage_path);
      if (original.sha256 !== copied.sha256 || original.size !== copied.size) throw new Error('Copia non identica alla sorgente');
      rows.push({ pratica_id: contract.pratica_id, contratto_id: contract.id, anagrafica_id: contract.anagrafica_id,
        tipo_documento: 'documento_identita', storage_bucket: BUCKET, storage_path: doc.storage_path,
        file_name: doc.file_name, mime_type: 'application/pdf', file_size: copied.size,
        uploaded_by: source.uploaded_by, uploaded_at: source.uploaded_at });
      checks.push({ source_id: source.id, contract_id: contract.id, path: doc.storage_path, ...copied });
    }
    // Un solo INSERT per contratto: fronte/retro non restano associati parzialmente.
    const { data, error } = await db.from('vendita_documenti').insert(rows).select('id, contratto_id, storage_path');
    if (error) throw new Error('Inserimento documenti non riuscito');
    return { inserted: data, checks };
  } catch (error) {
    if (created.length) {
      const { error: cleanupError } = await storage.remove(created);
      if (cleanupError) throw new Error('Bonifica fallita e pulizia copie non riuscita');
    }
    throw error;
  }
}

async function main() {
  const configPath = path.resolve('.backup-private/private.json');
  const stat = fs.lstatSync(configPath);
  if (!stat.isFile() || (stat.mode & 0o077) || stat.uid !== process.getuid()) throw new Error('Config privata non protetta');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const db = createClient('https://lbgwamhjkjjfwgusafbi.supabase.co', config.storage_key,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const dir = path.resolve('.backup-private/identity-backfill');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const write = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2), { mode: 0o600 });
  const contractRows = await allRows(() => db.from('vendita_contratti')
    .select('id, pratica_id, anagrafica_id, data_contratto, pratica:vendita_pratiche(storage_base_path)')
    .gte('data_contratto', CUTOFF).order('id'));
  const contracts = contractRows.map(c => ({ ...c, storage_base_path: c.pratica?.storage_base_path }));
  const documents = await allRows(() => db.from('vendita_documenti').select('*')
    .eq('tipo_documento', 'documento_identita').order('id'));
  const plan = planBackfill(contracts, documents, { allowSameClient: process.argv.includes('--same-client') });
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  write(`plan-${runId}.json`, plan);
  console.log(JSON.stringify({ contracts: plan.contracts, missing: plan.missing,
    recoverable: plan.recoverable.length, unresolved: plan.unresolved.length, apply: process.argv.includes('--apply') }));
  if (!process.argv.includes('--apply')) return;
  const results = [];
  for (const item of plan.recoverable) {
    try { results.push({ contract_id: item.contract.id, ...await copyContractIdentity(db, item) }); }
    catch (error) { results.push({ contract_id: item.contract.id, error: error.message }); }
    write(`result-${runId}.json`, results);
    if (results.length % 25 === 0) console.log(`Contratti elaborati: ${results.length}/${plan.recoverable.length}`);
  }
  console.log(JSON.stringify({ fixed: results.filter(r => r.inserted).length,
    files: results.reduce((n,r) => n + (r.inserted?.length || 0), 0),
    skipped: results.filter(r => r.skipped).length, errors: results.filter(r => r.error).length }));
  if (results.some(r => r.error)) process.exitCode = 1;
}

if (require.main === module) main().catch(() => { console.error('Operazione interrotta; consultare il report privato.'); process.exitCode = 1; });
module.exports = { planBackfill, copyContractIdentity, CUTOFF };
