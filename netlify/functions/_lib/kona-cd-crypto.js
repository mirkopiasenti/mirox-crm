'use strict';

const crypto = require('crypto');

// Cifratura AES-256-GCM per il refresh token Google.
// La chiave arriva SOLO da env (KONA_CALL_DIRECTOR_GOOGLE_TOKEN_KEY),
// separata dalle altre credenziali. Mai nel codice, mai nel frontend.
// Formato accettato: 64 caratteri hex (32 byte).

function getKey() {
  return String(process.env.KONA_CALL_DIRECTOR_GOOGLE_TOKEN_KEY || '').trim();
}

function isConfigured() {
  return /^[0-9a-fA-F]{64}$/.test(getKey());
}

function keyBytes() {
  return Buffer.from(getKey(), 'hex');
}

// Ritorna { cipher, iv, tag } base64 oppure null se la chiave non e' configurata.
function encryptSecret(plaintext) {
  if (!isConfigured()) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return {
    cipher: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64')
  };
}

// Ritorna il plaintext oppure null (chiave assente / dati corrotti).
function decryptSecret(record) {
  if (!record || !record.cipher || !record.iv || !record.tag) return null;
  if (!isConfigured()) return null;
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      keyBytes(),
      Buffer.from(record.iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(record.cipher, 'base64')),
      decipher.final()
    ]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

module.exports = { decryptSecret, encryptSecret, isConfigured };
