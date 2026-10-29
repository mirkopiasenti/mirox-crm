(function(){
  'use strict';
  const core=window.MiroxScannerCore,$=id=>document.getElementById(id);
  const params=new URLSearchParams(location.hash.slice(1)),id=params.get('id'),token=params.get('token');
  history.replaceState(null,'',location.pathname);
  let stream=null,sides=[],photos=[],urls=[],sending=false,taking=false,starting=false,cameraRevision=0,expires=0,sideIndex=0,pendingPdf=null;
  const status=text=>{$('scanStatus').textContent=text;};
  async function request(body){
    const response=await window.MiroxApi.fetch('/.netlify/functions/scanner-documenti',{method:'POST',headers:{'X-Scanner-Token':token,'X-Scanner-Id':id,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:'{}'});
    const data=await response.json();if(!response.ok||!data.success)throw Error(data.error||'Invio non riuscito.');return data;
  }
  function stop(){cameraRevision++;if(stream)stream.getTracks().forEach(track=>track.stop());stream=null;$('scanVideo').srcObject=null;$('scanTake').disabled=true;}
  function clear(){pendingPdf=null;stop();urls.forEach(url=>URL.revokeObjectURL(url));urls=[];photos=[];$('scanThumbnails').replaceChildren();}
  function update(){
    $('scanSide').textContent=sideIndex<sides.length?sides[sideIndex]:'Controlla tutte le anteprime';
    $('scanTake').disabled=!stream||sideIndex>=sides.length||sending||taking;
    $('scanSend').hidden=photos.filter(Boolean).length!==sides.length;
    $('scanSend').disabled=sending;
    const container=$('scanThumbnails');container.replaceChildren();
    photos.forEach((photo,index)=>{if(!photo)return;const fig=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption'),redo=document.createElement('button');img.src=urls[index];img.alt=sides[index];caption.textContent=sides[index];redo.type='button';redo.textContent='Ripeti scatto';redo.disabled=sending;redo.addEventListener('click',()=>{sideIndex=index;update();status('Ripeti '+sides[index].toLowerCase()+'.');});fig.append(img,caption,redo);container.append(fig);});
  }
  async function start(){if(starting||sending)return;starting=true;try{
    if(Date.now()>=expires)throw Error('QR scaduto. Generane uno nuovo dal CRM.');
    stop();const stamp=cameraRevision;const acquired=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:2560},height:{ideal:1600}}});
    if(stamp!==cameraRevision||document.hidden){acquired.getTracks().forEach(track=>track.stop());return;}stream=acquired;
    $('scanVideo').srcObject=stream;await $('scanVideo').play();update();status('Fotocamera pronta. Inquadra il documento e acquisisci.');
  }catch(error){stop();status('Fotocamera non disponibile: '+error.message+' Puoi tornare al CRM e scegliere il caricamento PDF.');}finally{starting=false;}}
  async function take(){try{
    if(!stream||sending||taking||sideIndex>=sides.length)return;
    taking=true;update();const stamp=cameraRevision;
    const video=$('scanVideo');if(!video.videoWidth)throw Error('Attendi la fotocamera.');
    const area=core.crop(video.videoWidth,video.videoHeight),canvas=document.createElement('canvas');
    // Il riquadro guida lascia un margine: si conserva l’intera area visibile per non tagliare dati.
    const scale=Math.min(1,2400/area.width);canvas.width=Math.round(area.width*scale);canvas.height=Math.round(area.height*scale);
    canvas.getContext('2d').drawImage(video,area.x,area.y,area.width,area.height,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.94));canvas.width=canvas.height=0;
    if(stamp!==cameraRevision)return;
    if(!blob)throw Error('Scatto non disponibile. Riprova.');
    pendingPdf=null;
    if(urls[sideIndex])URL.revokeObjectURL(urls[sideIndex]);photos[sideIndex]=blob;urls[sideIndex]=URL.createObjectURL(blob);
    sideIndex=photos.findIndex(photo=>!photo);if(sideIndex<0)sideIndex=photos.length<sides.length?photos.length:sides.length;
    update();status(sideIndex>=sides.length?'Controlla fronte e retro, poi invia al CRM.':'Acquisisci '+sides[sideIndex].toLowerCase()+'.');
  }catch(error){status(error.message);}finally{taking=false;update();}}
  async function send(){
    if(sending||taking||photos.filter(Boolean).length!==sides.length)return;
    sending=true;update();
    try{
      if(Date.now()>=expires)throw Error('QR scaduto. Generane uno nuovo dal CRM.');
      status('Preparazione e invio al CRM...');
      if(!pendingPdf){const pdf=await PDFLib.PDFDocument.create();
      for(const blob of photos){const image=await pdf.embedJpg(await blob.arrayBuffer());const page=pdf.addPage([image.width,image.height]);page.drawImage(image,{x:0,y:0,width:image.width,height:image.height});}
      pendingPdf=await pdf.save();}
      const bytes=pendingPdf;if(bytes.length>core.MAX_BYTES)throw Error('Le immagini superano 4 MB. Ripeti gli scatti evitando sfondi molto dettagliati.');
      const form=new FormData();form.append('file',new Blob([bytes],{type:'application/pdf'}),'documento.pdf');await request(form);
      clear();$('scanCapture').hidden=true;status('Documento inviato al CRM. Puoi chiudere questa pagina e continuare dal computer.');
    }catch(error){status(error.message+' Gli scatti restano disponibili in questa pagina per riprovare.');}
    finally{sending=false;update();}
  }
  $('scanStart').addEventListener('click',start);$('scanTake').addEventListener('click',take);$('scanSend').addEventListener('click',send);
  window.addEventListener('pagehide',clear);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  (async()=>{try{if(!id||!token)throw Error('Apri lo scanner usando il QR mostrato nel CRM.');const data=await request();if(data.stato!=='aperta')throw Error('Questo QR è già stato utilizzato. Torna al CRM.');sides=core.sides(data.pacchetto);expires=Date.parse(data.expires_at);$('scanCliente').textContent=data.cliente||'Cliente della pratica';$('scanCapture').hidden=false;update();status('Collegato al CRM. Apri la fotocamera per iniziare.');}catch(error){clear();status(error.message);}})();
})();
