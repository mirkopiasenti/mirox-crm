/* Disponibilita CC: soltanto slot, nessun dato del personale nel client. */
(function(root){
  'use strict';
  async function slots(date){
    try{
      const response=await root.MiroxApi.fetch(`/.netlify/functions/gestisci-disponibilita-cc?data=${encodeURIComponent(date)}`,{cache:'no-store'});
      const payload=await response.json();
      if(!response.ok||payload.ok!==true||!Array.isArray(payload.slots))throw new Error(payload.error||'Disponibilità non disponibile');
      return {data:payload.slots,error:null};
    }catch(error){return {data:null,error};}
  }
  function errorMessage(error){
    return /slot_non_disponibile_planning/.test(error?.message||'')
      ? 'Il planning approvato non consente questo appuntamento. Ricarica gli orari e scegli un altro slot.'
      : 'Errore: '+(error?.message||'Salvataggio non riuscito');
  }
  root.MiroxCcDisponibilita={slots,errorMessage};
})(window);
