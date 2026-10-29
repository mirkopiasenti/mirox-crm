(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.MiroxScannerCore=factory();})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  function manifest(value={}){
    if(!['cie','cartacea','patente','passaporto'].includes(value.tipo))throw Error('Seleziona il tipo di documento.');
    const tessera=value.tipo==='cartacea'||value.tipo==='patente'?true:value.tessera_sanitaria===true;
    return {tipo:value.tipo,tessera_sanitaria:tessera};
  }
  function sides(value){const m=manifest(value);if(m.tipo==='passaporto')throw Error('Per il passaporto usa il caricamento PDF e il controllo manuale.');
    return ['Fronte documento','Retro documento',...(m.tessera_sanitaria?['Fronte tessera sanitaria','Retro tessera sanitaria']:[])];}
  function crop(width,height){const ratio=85.6/53.98;let w=width,h=w/ratio;if(h>height){h=height;w=h*ratio;}return {x:(width-w)/2,y:(height-h)/2,width:w,height:h};}
  return {manifest,sides,crop,MAX_BYTES:4*1024*1024,TTL_MS:10*60*1000};
});
