'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {zipSync}=require('fflate');
const {WEB,manifestFor,validatePageFiles}=require('../tools/monitor-windows/monitor-updates.cjs');
const TOOLS=['monitor-host.cjs','monitor-updates.cjs','vault.ps1','restart-browser.ps1','supervisor.ps1','install.ps1','installa-monitor.cmd','uninstall.ps1','avvia-monitor.cmd','LEGGIMI.txt'];
function buildRelease(root,output){
  const files=Object.fromEntries(WEB.map(file=>[file,fs.readFileSync(path.join(root,file))]));
  validatePageFiles(files);
  const manifest=manifestFor(files),directory=path.join(output,'assets','monitor-releases',manifest.versione);
  for(const [name,bytes] of Object.entries(files)){const target=path.join(directory,name+'.bin');fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);}
  fs.writeFileSync(path.join(output,'assets','monitor-release.json'),JSON.stringify(manifest));
  return manifest;
}
function buildPackage(root,output,environment='production',origin=null){
  buildRelease(root,output);
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
module.exports={buildPackage,buildRelease,WEB,TOOLS};
