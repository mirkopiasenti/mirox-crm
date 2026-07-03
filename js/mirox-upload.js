/* ============================================================
   MIROX UPLOAD — Binding condiviso per drop-zone file upload
   Pattern HTML atteso:
     <div class="mx-drop-zone" data-target="myInput"
          data-accept=".pdf"           // opzionale, default .pdf
          data-multiple="false">        // opzionale, default false
       <div class="mx-drop-text">Trascina qui il file PDF o clicca per selezionare</div>
       <div class="mx-drop-hint">PDF - un solo file</div>
     </div>
     <input type="file" id="myInput" accept=".pdf" style="display:none">
     <div class="mx-files-list" data-list-for="myInput"></div>
   Espone window.MiroxUpload con:
     bindAll(rootEl?)  -> ri-attacca i listener (utile dopo render dinamici)
     clearFile(inputId) -> reset
     renderList(inputId) -> ridisegna la lista per quell'input
     previewPdfFile(file) / previewPdfFiles(files) -> anteprima PDF prima dell'upload
     confirmFilesForInput(input, files) -> anteprima + applicazione file su input
   Si auto-attiva su DOMContentLoaded.
   ============================================================ */
(function () {
    if (window.MiroxUpload) return;

    function esc(s) {
        const d = document.createElement('div');
        d.textContent = s == null ? '' : String(s);
        return d.innerHTML;
    }

    function formatSize(value) {
        const n = Number(value || 0);
        if (!Number.isFinite(n) || n <= 0) return '0 B';
        if (n < 1024) return `${n} B`;
        if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
        return `${(n / (1024 * 1024)).toFixed(2)} MB`;
    }

    function toFiles(files) {
        return Array.from(files || []).filter(file => file instanceof File);
    }

    function isPdfFile(file) {
        if (!file) return false;
        const name = (file.name || '').toLowerCase();
        const type = (file.type || '').toLowerCase();
        return type === 'application/pdf' || name.endsWith('.pdf');
    }

    function injectPreviewCss() {
        if (document.getElementById('mx-upload-preview-css')) return;
        const style = document.createElement('style');
        style.id = 'mx-upload-preview-css';
        style.textContent = `
.mx-upload-preview-meta{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;padding:10px 12px;background:#F6F9FC;border:1px solid #E3E8EE;border-radius:10px;color:#0A2540;font-size:13px;}
.mx-upload-preview-meta strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.mx-upload-preview-meta span{flex-shrink:0;color:#697386;}
.mx-upload-preview-frame{display:block;width:100%;height:min(72vh,720px);border:1px solid #E3E8EE;border-radius:10px;background:#F6F9FC;}
.mx-upload-preview-x{min-width:58px;padding-left:16px;padding-right:16px;}
.mx-upload-preview-ok{background:#16a34a;color:#fff;}
.mx-upload-preview-ok:hover{background:#15803d;}
@media (max-width:700px){.mx-upload-preview-frame{height:62vh;}.mx-upload-preview-meta{align-items:flex-start;flex-direction:column;}}
`;
        document.head.appendChild(style);
    }

    function renderList(inputId) {
        const inp = document.getElementById(inputId);
        if (!inp) return;
        const list = document.querySelector(`.mx-files-list[data-list-for="${inputId}"]`);
        const dz = document.querySelector(`.mx-drop-zone[data-target="${inputId}"]`);
        if (!list && !dz) return;
        if (list) list.innerHTML = '';
        if (inp.files && inp.files.length > 0) {
            if (dz) dz.classList.add('has-file');
            if (list) {
                Array.from(inp.files).forEach(f => {
                    const row = document.createElement('div');
                    row.className = 'mx-file-row';
                    row.innerHTML = `<span class="mx-file-name">${esc(f.name)}</span>` +
                        `<button type="button" class="mx-file-remove" title="Rimuovi" data-mx-clear="${esc(inputId)}">×</button>`;
                    list.appendChild(row);
                });
            }
        } else if (dz) {
            dz.classList.remove('has-file');
        }
    }

    function dispatchChange(input) {
        if (!input) return;
        input.__mxUploadPreviewSilent = true;
        try {
            input.dispatchEvent(new Event('change', { bubbles: true }));
        } finally {
            input.__mxUploadPreviewSilent = false;
        }
    }

    function setInputFiles(input, files, opts = {}) {
        if (!input) return [];
        const safeFiles = toFiles(files);
        input.value = '';
        if (safeFiles.length > 0) {
            try {
                const dt = new DataTransfer();
                safeFiles.forEach(file => dt.items.add(file));
                input.files = dt.files;
            } catch (error) {
                // Alcuni browser vecchi non permettono di scrivere input.files.
            }
        }
        if (input.id) renderList(input.id);
        if (opts.dispatchChange !== false) dispatchChange(input);
        return safeFiles;
    }

    function clearFile(inputId) {
        const inp = document.getElementById(inputId);
        if (inp) {
            setInputFiles(inp, [], { dispatchChange: false });
            renderList(inputId);
        }
    }

    function acceptPatternsFromInput(input) {
        const raw = input && input.getAttribute('accept');
        if (!raw) return [];
        return raw.toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    }

    function _acceptByPatterns(patterns, file) {
        if (!patterns || !patterns.length) return true;
        const name = (file.name || '').toLowerCase();
        const type = (file.type || '').toLowerCase();
        return patterns.some(pattern => {
            if (pattern.startsWith('.')) return name.endsWith(pattern);
            if (pattern.endsWith('/*')) return type.startsWith(pattern.slice(0, -1));
            return type === pattern;
        });
    }

    function _accept(dz, file, input) {
        const fromZone = (dz.dataset.accept || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
        const patterns = fromZone.length ? fromZone : acceptPatternsFromInput(input);
        return _acceptByPatterns(patterns.length ? patterns : ['.pdf'], file);
    }

    function previewPdfFile(file, opts = {}) {
        if (!isPdfFile(file)) return Promise.resolve(true);
        if (!window.MiroxUI || typeof window.MiroxUI._build !== 'function') return Promise.resolve(true);

        injectPreviewCss();
        const objectUrl = URL.createObjectURL(file);
        const title = opts.title || 'Anteprima PDF';
        const bodyHtml = `
<div class="mx-upload-preview-meta">
  <strong title="${esc(file.name)}">${esc(file.name)}</strong>
  <span>${formatSize(file.size)}</span>
</div>
<iframe class="mx-upload-preview-frame" src="${esc(objectUrl)}#toolbar=1&navpanes=0" title="Anteprima PDF"></iframe>`;
        const footerHtml = `
<button type="button" class="mx-btn mx-btn-danger mx-upload-preview-x" data-mx-cancel>X</button>
<button type="button" class="mx-btn mx-upload-preview-ok" data-mx-ok>Conferma</button>`;

        return new Promise(resolve => {
            let decided = false;
            const modal = window.MiroxUI._build({
                title,
                bodyHtml,
                footerHtml,
                large: true,
                onClose: () => {
                    URL.revokeObjectURL(objectUrl);
                    if (!decided) resolve(false);
                }
            });

            function closeWith(value) {
                if (decided) return;
                decided = true;
                modal.close();
                resolve(value);
            }

            modal.foot.querySelector('[data-mx-cancel]').addEventListener('click', () => closeWith(false));
            modal.foot.querySelector('[data-mx-ok]').addEventListener('click', () => closeWith(true));
        });
    }

    async function previewPdfFiles(files, opts = {}) {
        const list = toFiles(files);
        const accepted = [];
        const pdfTotal = list.filter(isPdfFile).length;
        let pdfIndex = 0;
        for (const file of list) {
            if (!isPdfFile(file)) {
                accepted.push(file);
                continue;
            }
            pdfIndex += 1;
            const title = pdfTotal > 1 ? `Anteprima PDF ${pdfIndex}/${pdfTotal}` : (opts.title || 'Anteprima PDF');
            const keep = await previewPdfFile(file, Object.assign({}, opts, { title }));
            if (keep) accepted.push(file);
        }
        return accepted;
    }

    async function confirmFilesForInput(input, files, opts = {}) {
        const incoming = toFiles(files);
        const multiple = !!(input && input.multiple);
        const selected = multiple ? incoming : incoming.slice(0, 1);
        const accepted = await previewPdfFiles(selected, opts);
        setInputFiles(input, accepted, { dispatchChange: opts.dispatchChange !== false });
        return accepted;
    }

    function shouldPreviewInput(input) {
        if (!input || input.type !== 'file') return false;
        if (input.dataset && input.dataset.mxPreview === 'off') return false;
        const files = toFiles(input.files);
        if (!files.length) return false;
        return files.some(isPdfFile);
    }

    document.addEventListener('change', (event) => {
        const input = event.target;
        if (!shouldPreviewInput(input)) return;
        if (input.__mxUploadPreviewSilent || input.__mxUploadPreviewBusy) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        const files = toFiles(input.files);
        input.__mxUploadPreviewBusy = true;
        previewPdfFiles(files)
            .then(accepted => setInputFiles(input, accepted, { dispatchChange: true }))
            .catch(() => setInputFiles(input, [], { dispatchChange: true }))
            .finally(() => { input.__mxUploadPreviewBusy = false; });
    }, true);

    function bindZone(dz) {
        if (dz.__mxBound) return;
        if (dz.dataset && dz.dataset.mxUpload === 'manual') return;
        dz.__mxBound = true;
        const targetId = dz.dataset.target;
        if (!targetId) return;
        const inp = document.getElementById(targetId);
        if (!inp) return;

        dz.addEventListener('click', () => inp.click());
        inp.addEventListener('change', () => renderList(targetId));
        dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
        dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
        dz.addEventListener('drop', async (e) => {
            e.preventDefault();
            dz.classList.remove('dragover');
            const list = e.dataTransfer && e.dataTransfer.files;
            if (!list || !list.length) return;
            const multiple = inp.multiple || dz.dataset.multiple === 'true';
            const files = Array.from(list).filter(f => _accept(dz, f, inp));
            if (!files.length) return;
            await confirmFilesForInput(inp, multiple ? files : [files[0]]);
        });
    }

    function bindFileDrop(drop) {
        if (drop.__mxLooseBound) return;
        drop.__mxLooseBound = true;
        const inp = drop.querySelector('input[type="file"]');
        if (!inp) return;

        drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('dragover'); });
        drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
        drop.addEventListener('drop', async (e) => {
            e.preventDefault();
            drop.classList.remove('dragover');
            const list = e.dataTransfer && e.dataTransfer.files;
            if (!list || !list.length) return;
            const patterns = acceptPatternsFromInput(inp);
            const files = Array.from(list).filter(file => _acceptByPatterns(patterns, file));
            if (!files.length) return;
            await confirmFilesForInput(inp, inp.multiple ? files : [files[0]]);
        });
    }

    function bindAll(root) {
        const scope = root || document;
        scope.querySelectorAll('.mx-drop-zone').forEach(bindZone);
        scope.querySelectorAll('.file-drop').forEach(bindFileDrop);
        scope.querySelectorAll('.mx-files-list[data-list-for]').forEach(list => {
            renderList(list.dataset.listFor);
        });
    }

    document.addEventListener('click', (e) => {
        const t = e.target;
        if (t && t.matches && t.matches('.mx-file-remove[data-mx-clear]')) {
            e.preventDefault();
            clearFile(t.dataset.mxClear);
        }
    });

    window.MiroxUpload = {
        bindAll,
        clearFile,
        renderList,
        setInputFiles,
        confirmFilesForInput,
        previewPdfFile,
        previewPdfFiles,
        isPdfFile
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => bindAll());
    } else {
        bindAll();
    }
})();
