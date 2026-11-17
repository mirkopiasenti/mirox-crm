(function() {
  'use strict';
  const F = window.MiroxFisso;
  const esc = v => window.MiroxSafe.escapeHtml(String(v ?? ''));
  function form(data, cluster, { wizard = false, disabled = false } = {}) {
    const d = F.normalize(data);
    const input = (key,title,value,readonly=false) => '<label style="display:block;margin:10px 0;">'+title+'<input class="mx-input" data-fixed-field="'+key+'" value="'+esc(value)+'" '+(readonly?'readonly ':'')+(disabled?'disabled':'')+'></label>';
    return '<div data-fixed-form data-fixed-cluster="'+esc(cluster)+'">'
      + '<label style="display:block;margin:10px 0;">Tecnologia *'
      + (wizard ? '<input class="mx-input" data-fixed-base value="'+esc(F.base(d.tecnologia_fisso))+'" placeholder="Tecnologia non rilevata dalla PDA" readonly>'
        : '<select class="mx-input" data-fixed-base '+(disabled?'disabled':'')+'><option value="">Da verificare</option>'
          + F.options(cluster).map(v=>'<option value="'+esc(v)+'"'+(F.base(d.tecnologia_fisso)===v?' selected':'')+'>'+esc(v)+'</option>').join('')+'</select>')+'</label>'
      + '<input type="hidden" data-fixed-field="professional_box" value="'+(d.professional_box===null?'':d.professional_box)+'">'
      + (F.business(cluster) ? '<p>Professional Box (FRITZ!Box): <strong data-fixed-box-label>'+ (d.professional_box===null?'Da confermare':d.professional_box?'Si':'No')+'</strong> <button class="mx-btn mx-btn-secondary" type="button" data-fixed-box '+(disabled?'disabled':'')+'>Scegli Professional Box</button></p>' : '')
      + input('codice_cliente_fisso','Codice cliente *',d.codice_cliente_fisso,wizard)
      + input('codice_pos_fisso','Codice POS',F.POS,true)
      + '<p data-fixed-label>'+esc(d.tecnologia_fisso || 'Tecnologia da verificare')+'</p></div>';
  }
  function read(root) {
    const form = root.querySelector('[data-fixed-form]');
    if (!form) return {};
    const out = {};
    form.querySelectorAll('[data-fixed-field]').forEach(el => {out[el.dataset.fixedField]=el.value;});
    if (!F.business(form.dataset.fixedCluster)) out.professional_box=false;
    out.tecnologia_fisso=F.label(form.querySelector('[data-fixed-base]').value,F.bool(out.professional_box));
    return F.normalize(out);
  }
  function chooseBox() {
    return new Promise(resolve => {
      let done=false;
      const modal=window.MiroxUI._build({title:'Professional Box (FRITZ!Box)',bodyHtml:'<p>Hai attivato anche il Professional Box (FRITZ!Box)?</p>',
        footerHtml:'<button type="button" class="mx-btn mx-btn-primary" data-fixed-yes>Si</button><button type="button" class="mx-btn mx-btn-secondary" data-fixed-no>No</button>',onClose:()=>{if(!done)resolve(null);}});
      const finish=value=>{done=true;modal.close();resolve(value);};
      modal.foot.querySelector('[data-fixed-yes]').addEventListener('click',()=>finish(true));
      modal.foot.querySelector('[data-fixed-no]').addEventListener('click',()=>finish(false));
    });
  }
  async function askBox(root, context = () => '') {
    const form=root.querySelector('[data-fixed-form]');
    if(!form || !F.business(form.dataset.fixedCluster)) return true;
    if(form.dataset.pending) return false;
    form.dataset.pending='true'; const stamp=context();
    try {
      const answer=await chooseBox();
      if(answer===null || !form.isConnected || context()!==stamp || root.querySelector('[data-fixed-form]')!==form) return false;
      form.querySelector('[data-fixed-field="professional_box"]').value=String(answer);
      form.querySelector('[data-fixed-box-label]').textContent=answer?'Si':'No';
      form.dispatchEvent(new Event('change',{bubbles:true}));
      return true;
    } finally {delete form.dataset.pending;}
  }
  function bind(root, options={}) {
    const form=root.querySelector('[data-fixed-form]'); if(!form || form.dataset.bound) return;
    form.dataset.bound='true';
    form.addEventListener('change',()=>{
      form.querySelector('[data-fixed-label]').textContent=read(root).tecnologia_fisso || 'Tecnologia da verificare';
      options.onFixedChange?.(read(root));
    });
    form.querySelector('[data-fixed-box]')?.addEventListener('click',()=>askBox(root,options.context));
  }
  window.MiroxFissoUI={form,read,bind,chooseBox,askBox};
})();
