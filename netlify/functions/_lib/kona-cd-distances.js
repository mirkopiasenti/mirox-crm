'use strict';

// Distanze tra centri comunali per la pianificazione appuntamenti.
// Le coordinate NON sono hardcodate: provengono da kona_call_director_comuni
// (dataset ISTAT autoritativo, import configurato manualmente).
// Regole:
//  * stesso comune => 0 km (anche se il dataset coordinate non e' importato);
//  * cache per nome+provincia (mai per solo nome: evita omonimie);
//  * se il dato autorevole manca => null (comportamento "unknown").
// Mai inventare coordinate.

const EARTH_RADIUS_KM = 6371;
const _cache = new Map(); // chiave "nome|provincia" -> {lat, lon, provincia}

function normName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function cacheKey(nome, provincia) {
  return `${normName(nome)}|${normName(provincia)}`;
}

function toRad(deg) {
  return (Number(deg) * Math.PI) / 180;
}

function haversineKm(latA, lonA, latB, lonB) {
  const dLat = toRad(latB - latA);
  const dLon = toRad(lonB - lonA);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

// Carica (con cache per invocation) tutti i comuni della tabella.
async function loadComuni(supabase) {
  if (!supabase || _cache.size > 0) return _cache;
  const { data, error } = await supabase.from('kona_call_director_comuni').select('nome, provincia_sigla, lat, lon');
  if (error || !Array.isArray(data)) return _cache;
  for (const row of data) {
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      _cache.set(cacheKey(row.nome, row.provincia_sigla), { lat, lon, provincia: row.provincia_sigla });
    }
  }
  return _cache;
}

function clearCache() {
  _cache.clear();
}

// Posizione {lat, lon} di un comune, o null se non nel dataset.
async function comuniPosition(supabase, nomeComune, provincia) {
  const nome = normName(nomeComune);
  if (!nome) return null;
  const cache = await loadComuni(supabase);
  // 1) con provincia nota, 2) fallback senza provincia (se unica).
  if (provincia) {
    const con = cache.get(cacheKey(nome, provincia));
    if (con) return con;
  }
  const senza = cache.get(cacheKey(nome, ''));
  if (senza) return senza;
  // Fallback: primo risultato per il solo nome (comune non ambiguo).
  const matches = [];
  for (const [k, v] of cache.entries()) {
    if (k.startsWith(`${nome}|`)) matches.push(v);
  }
  return matches.length === 1 ? matches[0] : null;
}

// Distanza km tra due comuni. 0 se stesso comune. null se non disponibile.
async function distanzaKm(supabase, comuneA, comuneB, provinciaA, provinciaB) {
  const nomeA = normName(comuneA);
  const nomeB = normName(comuneB);
  if (!nomeA || !nomeB) return null;
  if (nomeA === nomeB) return 0; // stesso comune, anche senza coordinate
  const a = await comuniPosition(supabase, comuneA, provinciaA);
  const b = await comuniPosition(supabase, comuneB, provinciaB);
  if (!a || !b) return null;
  return Math.round(haversineKm(a.lat, a.lon, b.lat, b.lon) * 10) / 10;
}

module.exports = {
  cacheKey,
  clearCache,
  comuniPosition,
  distanzaKm,
  haversineKm,
  normName,
  _test: { cacheKey, haversineKm, normName }
};
