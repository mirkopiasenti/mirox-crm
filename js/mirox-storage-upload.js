/**
 * Upload PDF server-side per i moduli operativi Mirox.
 *
 * Il browser non scrive direttamente nei bucket Supabase: il file passa dalla
 * Netlify Function autenticata, che verifica firma PDF, dimensione, bucket e
 * percorso prima di usare la service role.
 */
(function () {
  async function upload({ file, bucket, path }) {
    if (!file) throw new Error('File mancante');
    if (!bucket) throw new Error('Bucket mancante');
    if (!path) throw new Error('Percorso mancante');
    if (!window.MiroxApi || typeof window.MiroxApi.fetch !== 'function') {
      throw new Error('MiroxApi non disponibile');
    }

    const formData = new FormData();
    formData.append('file', file, file.name || 'documento.pdf');
    formData.append('bucket', bucket);
    formData.append('path', path);

    const response = await window.MiroxApi.fetch('/.netlify/functions/upload-documento-modulo', {
      method: 'POST',
      body: formData
    });

    let result;
    try {
      result = await response.json();
    } catch (_error) {
      throw new Error(`Risposta non valida dalla funzione upload-documento-modulo (${response.status})`);
    }

    if (!response.ok || result.success === false) {
      throw new Error(result.error || `Upload non riuscito (${response.status})`);
    }

    return result;
  }

  window.MiroxStorageUpload = { upload };
})();
