'use strict';
const fs=require('node:fs');
const {execFileSync}=require('node:child_process');
function classifyPatch(files,summary) {
  const kind=String(summary).match(/^ESITO_PATCH:\s*(MODIFICA_PREPARATA|GIA_PRESENTE|RICHIEDE_INFORMAZIONI|BLOCCATA)\s*$/m)?.[1];
  if(!kind)throw new Error('Codex non ha dichiarato un esito valido');
  const result={has_changes:false,no_changes:false,needs_information:false,blocked:false,manual_review:false,catalog_required:false};
  if(!files.length) {
    if(kind==='MODIFICA_PREPARATA')throw new Error('Codex dichiara modifiche ma non ci sono file modificati');
    result.no_changes=kind==='GIA_PRESENTE';result.needs_information=kind==='RICHIEDE_INFORMAZIONI';result.blocked=kind==='BLOCCATA';return result;
  }
  if(kind!=='MODIFICA_PREPARATA')throw new Error('Modifiche incompatibili con esito dichiarato');
  if(files.some(p=>/(^|\/)(\.env(?:\.|$)|netlify\.toml$|package(?:-lock)?\.json$)/.test(p) || p.startsWith('.github/')))throw new Error('Modifica bloccata: segreti, deploy, workflow o dipendenze');
  result.has_changes=true;
  // SQL is preserved for review, never approved for execution or automatic release.
  result.catalog_required=files.some(p=>/^netlify\/functions\/_lib\/guardian-catalog-[a-z0-9_-]+\.json$/i.test(p));
  result.manual_review=result.catalog_required || files.some(p=>/^database\/.*\.sql$/i.test(p));
  result.blocked=result.manual_review;
  return result;
}
if(require.main===module) {
  const files=execFileSync('git',['diff','--name-only','--','.',' :(exclude)guardian-context.json'.trim(),':(exclude)guardian-changed-files.txt',':(exclude)codex-output.md'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
  const result=classifyPatch(files,fs.readFileSync('codex-output.md','utf8'));
  fs.writeFileSync('/tmp/guardian-changed-files.txt',files.join('\n'));
  fs.appendFileSync(process.env.GITHUB_OUTPUT,Object.entries(result).map(([k,v])=>`${k}=${v}\n`).join(''));
}
module.exports={classifyPatch};
