/* Vincoli delle combinazioni Customer Base, condivisi da wizard e server. */
(function(root,factory){if(typeof module==='object' && module.exports)module.exports=factory();else root.MiroxCustomerBaseDevice=factory();}(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
function requiredPurchaseType(offerName,categoryName) {
  if(String(categoryName || '').trim().toLowerCase()!=='customer base')return null;
  const name=String(offerName || '').trim().replace(/\s+/g,' ').toLowerCase();
  if(name==='cambio piano + telefono finanziato')return 'Finanziamento';
  if(name==='cambio piano + telefono var')return 'VAR';
  return null;
}
function validateCombination(contract,offerName,categoryName) {
  const required=requiredPurchaseType(offerName,categoryName);
  if(!required)return;
  if(contract.dispositivo_associato!==true)throw new Error('Questa combinazione richiede un telefono associato.');
  if(contract.tipo_acquisto!==required)throw new Error('Questa combinazione richiede tipo acquisto '+required+'.');
}
return {requiredPurchaseType,validateCombination};
}));
