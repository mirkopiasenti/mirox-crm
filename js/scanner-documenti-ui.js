(function(){
  'use strict';
  let opening=null,currentModal=null,revision=0;
  const e=v=>window.MiroxSafe.escapeHtml(String(v||''));
  async function api(input,pdf=false){const response=await window.MiroxApi.fetch('/.netlify/functions/scanner-documenti',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});if(pdf&&response.ok)return response.blob();const data=await response.json();if(!response.ok||!data.success)throw Error(data.error||'Scanner non disponibile.');return data;}
  async function open({customer,pacchetto,current=()=>true,onPdf,onFallback,onPackageChange=()=>{}}){
    const stamp=revision;let session=null,timer=null,closed=false,busy=false,refreshing=false;
    const active=()=>!closed&&stamp===revision&&current(pacchetto);
    const m=window.MiroxUI._build({title:'Acquisisci il documento da smartphone',large:true,bodyHtml:'<p>Cliente: <strong>'+e(customer.ragione_sociale)+'</strong></p><label>Documento da acquisire <select data-scan-type><option value="cie">Carta d’identità elettronica</option><option value="cartacea">Carta d’identità cartacea + tessera sanitaria</option><option value="patente">Patente + tessera sanitaria</option><option value="passaporto">Passaporto: PDF e controllo manuale</option></select></label><label style="display:block;margin:12px 0"><input type="checkbox" data-scan-health> Includi tessera sanitaria fronte e retro</label><div data-scan-qr role="status">Preparazione QR...</div><p>Scansiona il QR con il telefono e acquisisci fronte e retro. Le foto saranno inviate solo a questa sessione del CRM.</p>',footerHtml:'<button type="button" class="mx-btn" data-scan-pdf>Non è possibile acquisire la scansione da smartphone: carica PDF</button><button type="button" class="mx-btn" data-scan-renew>Rigenera QR</button>',onClose:()=>{if(closed)return;closed=true;if(currentModal===m)currentModal=null;clearTimeout(timer);if(session)api({action:'cancel',id:session.id}).catch(()=>{});}});
    currentModal=m;
    const box=m.body.querySelector('[data-scan-qr]');
    const type=m.body.querySelector('[data-scan-type]'),health=m.body.querySelector('[data-scan-health]');
    function syncPackage(){type.value=pacchetto.tipo;health.checked=Boolean(pacchetto.tessera_sanitaria);health.disabled=['cartacea','patente'].includes(pacchetto.tipo);}
    syncPackage();
    function changePackage(){
      if(busy||refreshing){syncPackage();return;}
      pacchetto=window.MiroxScannerCore.manifest({tipo:type.value,tessera_sanitaria:health.checked});syncPackage();onPackageChange(pacchetto);
      if(pacchetto.tipo==='passaporto'){onFallback();m.close();return;}refresh();
    }
    type.addEventListener('change',changePackage);health.addEventListener('change',changePackage);
    async function refresh(){
      if(refreshing||busy)return;refreshing=true;clearTimeout(timer);
      try{if(session)await api({action:'cancel',id:session.id}).catch(()=>{});session=null;if(!active()){m.close();return;}
        const data=await api({action:'create',cliente:customer,pacchetto});
        if(!active()){await api({action:'cancel',id:data.id});m.close();return;}
        session=data;box.innerHTML='<img alt="QR per acquisire il documento" src="'+e(data.qr)+'" width="280" height="280"><p>Il QR scade fra 10 minuti.</p>';timer=setTimeout(poll,2000);
      }catch(error){box.textContent=error.message+' Puoi usare il caricamento PDF.';}finally{refreshing=false;}
    }
    async function poll(){
      if(!active()){m.close();return;}if(!session||busy)return;busy=true;
      try{
        const state=await api({action:'status',id:session.id});
        if(!active()){m.close();return;}
        if(state.stato==='pronta'||state.stato==='consumata'){
          const blob=await api({action:'download',id:session.id,cliente:customer},true);
          if(!active()){m.close();return;}
          onPdf(new File([blob],'documento-smartphone.pdf',{type:'application/pdf'}));m.close();return;
        }
        timer=setTimeout(poll,2000);
      }catch(error){box.textContent=error.message+' Rigenera il QR oppure carica il PDF.';}finally{busy=false;}
    }
    m.foot.querySelector('[data-scan-pdf]').addEventListener('click',()=>{if(active())onFallback();m.close();});
    m.foot.querySelector('[data-scan-renew]').addEventListener('click',()=>{clearTimeout(timer);if(!busy)refresh();});
    await refresh();return m;
  }
  window.MiroxScannerUI={open(options){if(currentModal)return Promise.resolve(currentModal);if(opening)return opening;opening=open(options).finally(()=>{opening=null;});return opening;},invalidate(){revision++;if(currentModal)currentModal.close();}};
})();
