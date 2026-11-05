'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {zipSync}=require('fflate');
const WEB=['monitor.html','css/monitor.css','js/mirox-safe.js','js/mirox-api.js','js/monitor-core.js','js/monitor.js','assets/logo.png','assets/favicon.png','assets/fonts/InterVariable.woff2','assets/fonts/Inter-OFL.txt'];
const TOOLS=['monitor-host.cjs','vault.ps1','restart-browser.ps1','supervisor.ps1','install.ps1','uninstall.ps1','avvia-monitor.cmd','LEGGIMI.txt'];
function buildPackage(root,output,environment='production',origin=null){
  const files={};
  for(const file of WEB)files[file]=new Uint8Array(fs.readFileSync(path.join(root,file)));
  for(const file of TOOLS)files[file]=new Uint8Array(fs.readFileSync(path.join(root,'tools/monitor-windows',file)));
  files['config.json']=Buffer.from(JSON.stringify({environment,origin:environment==='production'?'https://mirox-crm.it':origin}));
  const hashes=Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,crypto.createHash('sha256').update(bytes).digest('hex')]));
  files['version.json']=Buffer.from(JSON.stringify({versione:1,sha256:hashes},null,2));
  const zip=zipSync(files,{level:6});
  fs.mkdirSync(path.join(output,'assets'),{recursive:true});
  fs.writeFileSync(path.join(output,'assets/mirox-monitor-windows.zip'),zip);
  fs.writeFileSync(path.join(output,'assets/mirox-monitor-windows.sha256'),crypto.createHash('sha256').update(zip).digest('hex')+'  mirox-monitor-windows.zip\n');
  return {files:Object.keys(files),bytes:zip.length};
}
module.exports={buildPackage,WEB,TOOLS};
