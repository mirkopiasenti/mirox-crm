'use strict';
const fs=require('node:fs');
const {getDocumentProxy,renderPageAsImage}=require('unpdf');
const ZX=require('zxing-wasm/reader');
let ready=false,queue=Promise.resolve();
function validTax(value){
  const text=String(value||'').trim().toUpperCase();
  if(!/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(text))return null;
  const odd={0:1,1:0,2:5,3:7,4:9,5:13,6:15,7:17,8:19,9:21,A:1,B:0,C:5,D:7,E:9,F:13,G:15,H:17,I:19,J:21,K:2,L:4,M:18,N:20,O:11,P:3,Q:6,R:8,S:12,T:14,U:16,V:10,W:22,X:25,Y:24,Z:23};
  let sum=0;for(let i=0;i<15;i++)sum+=i%2?(isNaN(Number(text[i]))?text.charCodeAt(i)-65:Number(text[i])):odd[text[i]];
  return String.fromCharCode(65+sum%26)===text[15]?text:null;
}
async function zoomTiles(pdf, number, deadline, decode) {
  const { createCanvas } = await import('@napi-rs/canvas');
  const page = await pdf.getPage(number);
  const size = page.getViewport({ scale: 1 });
  const scale = Math.min(7, 4200 / size.width, 4600 / size.height);
  const viewport = page.getViewport({ scale });
  // Ingrandisce direttamente dal PDF, con margine fra riquadri per non tagliare il barcode.
  const width = Math.ceil(viewport.width * 0.62);
  const height = Math.ceil(viewport.height * 0.62);
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  for (const y of [0, height - viewport.height]) {
    for (const x of [0, width - viewport.width]) {
      if (Date.now() >= deadline) return false;
      await page.render({ canvas, canvasContext: context, viewport, transform: [1, 0, 0, 1, x, y] }).promise;
      const image = await canvas.encode('png');
      if (!await decode(image)) await decode(image, 'BoolCast');
    }
  }
  return Date.now() < deadline;
}
async function decodePdf(bytes,deps={}){
  const values=[];let complete=true,error=null;
  let pdf;
  try{
    if(!ready){ZX.prepareZXingModule({overrides:{wasmBinary:fs.readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm'))}});ready=true;}
    pdf=await getDocumentProxy(new Uint8Array(bytes));
    const count=pdf.numPages, sizes=[];
    for(let n=1;n<=Math.min(count,8);n++){const page=await pdf.getPage(n),v=page.getViewport({scale:1});if(!Number.isFinite(v.width*v.height)||v.width<=0||v.height<=0)throw Error('Dimensioni PDF non valide');sizes.push(v);}
    const deadline=deps.deadline||Date.now()+12000;
    for(let page=1;page<=Math.min(count,8);page++){
      if(Date.now()>deadline){complete=false;break;}
      const decode = async (image, binarizer) => {
        const codes=await (deps.decode||ZX.readBarcodes)(new Uint8Array(image),{formats:['Code39','Code128','DataMatrix','PDF417'],tryHarder:true,tryRotate:true,tryInvert:true,maxNumberOfSymbols:10,
          ...(binarizer ? { binarizer } : {})});
        let found = false;
        for (const item of codes) {
          const value = validTax(item.text);
          if (!value) continue;
          found = true;
          if (!values.some(v => v.value === value && v.page === page)) values.push({ value, page, format: item.format });
        }
        return found;
      };
      for(const scale of [2,3.5]){
        if(Date.now()>deadline){complete=false;break;}
        const image=await (deps.render||renderPageAsImage)(new Uint8Array(bytes),page,{canvasImport:()=>import('@napi-rs/canvas'),width:Math.min(sizes[page-1].width*scale,scale===2?1800:2600,Math.sqrt(8e6*sizes[page-1].width/sizes[page-1].height))});
        await decode(image);
      }
      if (complete && deps.zoom && !values.some(value => value.page === page)) {
        complete = await zoomTiles(pdf, page, deadline, decode);
      }
      if (!complete) break;
    }
    complete=complete&&count<=8&&Date.now()<deadline;
  }catch(_){complete=false;error='Decodifica barcode non disponibile: verifica manualmente il documento.';}
  finally { if (pdf) await pdf.loadingTask.destroy(); }
  const distinct=[...new Set(values.map(v=>v.value))];
  return {attempted:true,complete,conflict:distinct.length>1,values,error};
}
function apply(reading,barcode){
  const codes=[...new Set(barcode.values.map(v=>v.value))];
  const evidence=codes.length===1&&barcode.complete?barcode.values[0]:null;
  return {...reading,barcode,fiscale_ocr:reading.fields?.fiscale||null,
    fields:{...reading.fields,...(evidence?{fiscale:{value:evidence.value,page:evidence.page,quote:'CF decodificato dal codice a barre '+evidence.format,source:'barcode'}}:{})}};
}
function readPdf(bytes,deps={}){const deadline=deps.deadline||Date.now()+12000;const result=queue.then(()=>Date.now()>=deadline?{attempted:true,complete:false,conflict:false,values:[],error:'Tempo decodifica esaurito: verifica manualmente.'}:decodePdf(bytes,{...deps,deadline}));queue=result.catch(()=>{});return result;}
module.exports={validTax,readPdf,apply};
