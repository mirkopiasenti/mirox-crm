'use strict';
// Lettura PDA e piano locale privato. L'applicazione SQL separata usa CAS e
// protegge stati, punteggi, anagrafica, verifiche e documenti esistenti.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {createClient}=require('@supabase/supabase-js');
const {readPdfData}=require('../netlify/functions/_lib/pda-pdf-text');
const Fixed=require('../js/fisso-core');
const Pda=require('../js/vendita-pda-core');
const out=path.resolve('.backup-private/fisso-20261117');
const checked=r=>{if(r.error) throw new Error(r.error.message);return r.data;};
const hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
async function main(){
  fs.mkdirSync(out,{recursive:true,mode:0o700});
  if(fs.existsSync(path.join(out,'apply-result.txt')) && /COMMIT/.test(fs.readFileSync(path.join(out,'apply-result.txt'),'utf8'))) throw new Error('Storico gia applicato: non sovrascrivere le prove private');
  const secretPath=path.resolve('.backup-private/private.json'),stat=fs.lstatSync(secretPath);
  if(!stat.isFile() || (stat.mode & 0o077) || stat.uid!==process.getuid()) throw new Error('Configurazione privata non protetta');
  const config=JSON.parse(fs.readFileSync(secretPath,'utf8'));
  const db=createClient('https://lbgwamhjkjjfwgusafbi.supabase.co',config.storage_key,{auth:{persistSession:false,autoRefreshToken:false}});
  const contracts=checked(await db.from('vendita_contratti').select('*').eq('categoria_snapshot','Fisso').order('id'));
  const existingCodes=[];
  for(let n=0;;n+=1000){const rows=checked(await db.from('vendita_contratti').select('id,codice_contratto').not('codice_contratto','is',null).order('id').range(n,n+999));existingCodes.push(...rows);if(rows.length<1000)break;}
  const controls=checked(await db.from('post_vendita_controllo_fissi').select('*').order('id'));
  const documents=[];
  for(let i=0;i<contracts.length;i+=40) documents.push(...checked(await db.from('vendita_documenti').select('*').in('contratto_id',contracts.slice(i,i+40).map(c=>c.id)).eq('tipo_documento','contratto')));
  const registry=[];
  for(let i=0;i<contracts.length;i+=40) registry.push(...checked(await db.from('anagrafica_codici_cliente_windtre').select('anagrafica_id,codice_cliente').in('anagrafica_id',[...new Set(contracts.slice(i,i+40).map(c=>c.anagrafica_id))])));
  fs.writeFileSync(path.join(out,'before.json'),JSON.stringify({contracts,controls,documents,registry,existingCodes},null,2),{mode:0o600});
  const manual=fs.existsSync(path.join(out,'manual.json'))?JSON.parse(fs.readFileSync(path.join(out,'manual.json'),'utf8')):[];
  const plan=[];let next=0;
  const cache=path.join(out,'pda');fs.mkdirSync(cache,{recursive:true,mode:0o700});
  async function worker(){for(;;){
    const i=next++;if(i>=contracts.length)return;
    const c=contracts[i],docs=documents.filter(d=>d.contratto_id===c.id);
    const results=[];
    for(const d of docs){
      try{
        const local=path.join(cache,d.id+'.pdf');let bytes;
        if(fs.existsSync(local))bytes=fs.readFileSync(local);
        else{const blob=checked(await db.storage.from(d.storage_bucket).download(d.storage_path));bytes=Buffer.from(await blob.arrayBuffer());fs.writeFileSync(local,bytes,{mode:0o600});}
        const digest=hash(bytes);
        if(d.sha256 && d.sha256!==digest)throw new Error('Impronta documento discordante');
        const parsed=await readPdfData(bytes);
        const override=manual.find(m=>m.id===c.id && m.doc===d.id && m.sha256===digest);
        const fields=override?{...parsed.fields,tecnologia_fisso:override.technology}:parsed.fields;
        results.push({id:d.id,sha256:digest,fields,complete:parsed.completeText&&!parsed.hasRasterBody,...(override?{manual_evidence:override}: {})});
      }catch(error){results.push({id:d.id,error:error.message});}
    }
    const control=controls.find(r=>r.contratto_id===c.id);
    const box=Fixed.business(c.cluster_cliente)?/fritz|fritbox|professional\s*box/i.test(c.nome_offerta_snapshot||''):false;
    const known=Pda.code(c.codice_contratto)||Pda.code(control?.cod_contratto);
    const family=/^FTTC/i.test(c.nome_offerta_snapshot)?'FTTC':/^FTTH/i.test(c.nome_offerta_snapshot)?'FTTH':'FWA';
    const matched=results.filter(r=>r.fields?.tecnologia_fisso?.startsWith(family));
    const sameCode=known ? results.filter(r=>r.fields?.tecnologia_fisso && r.fields?.codice_contratto===known):[];
    const fixedSources=results.filter(r=>r.fields?.tecnologia_fisso);
    const evidence=sameCode.length?sameCode:matched.length?matched:fixedSources.length===1?fixedSources:[];
    const technologies=[...new Set(evidence.map(r=>r.fields?.tecnologia_fisso).filter(Boolean))];
    let technology=technologies.length===1?technologies[0]:null;
    if(!technology && !technologies.length){
      const name=String(c.nome_offerta_snapshot||'');
      if(family==='FTTH' && control?.tecnologia==='FTTH_FWCOP')technology='FTTH OF-FWCOP';
      if(/fwa.*indoor/i.test(name))technology='FWA Indoor';
      else if(/fwa.*outdoor/i.test(name))technology='FWA Outdoor';
      else if(/fwa.*voce/i.test(name))technology='FWA Voce';
    }
    const codes=[...new Set(evidence.map(r=>Pda.customerCode(r.fields?.codice_cliente)).filter(Boolean))];
    const customer=codes.length===1?codes[0]:codes.length?null:Pda.customerCode(control?.codice_cliente)
      || (registry.filter(r=>r.anagrafica_id===c.anagrafica_id).length===1?Pda.customerCode(registry.find(r=>r.anagrafica_id===c.anagrafica_id).codice_cliente):null);
    const contractCodes=[...new Set(evidence.map(r=>Pda.code(r.fields?.codice_contratto)).filter(Boolean))];
    const contractCode=known||(contractCodes.length===1?contractCodes[0]:null);
    const patch={tecnologia_fisso:Fixed.label(technology,box),professional_box:box,codice_cliente_fisso:customer,codice_pos_fisso:Fixed.POS};
    if(!c.codice_contratto && contractCode)patch.codice_contratto=contractCode;
    const issues=[];if(!technology)issues.push('tecnologia non determinabile');if(!customer)issues.push('codice cliente mancante/discordante');if(!contractCode)issues.push('codice contratto mancante');
    if(technologies.length>1)issues.push('PDA con tecnologie discordanti');
    plan.push({id:c.id,expected_updated_at:c.updated_at,patch,issues,documents:results});
    if((i+1)%25===0)console.log('PDA analizzate',i+1,'/',contracts.length);
  }}
  await Promise.all([worker(),worker()]);
  const proposed=new Map();
  for(const p of plan)if(p.patch.codice_contratto){const group=proposed.get(p.patch.codice_contratto)||[];group.push(p.id);proposed.set(p.patch.codice_contratto,group);}
  for(const p of plan){const code=p.patch.codice_contratto;if(code && ((proposed.get(code)||[]).length>1 || existingCodes.some(c=>c.codice_contratto===code && c.id!==p.id))){delete p.patch.codice_contratto;p.issues.push('codice contratto gia usato: conservato senza assegnazione duplicata');}}
  plan.sort((a,b)=>a.id.localeCompare(b.id));
  fs.writeFileSync(path.join(out,'plan.json'),JSON.stringify(plan,null,2),{mode:0o600});
  const summary={contratti:plan.length,completi:plan.filter(p=>!p.issues.length).length,da_verificare:plan.filter(p=>p.issues.length).length,professional_box:plan.filter(p=>p.patch.professional_box).length,tecnologie:{}};
  for(const p of plan)summary.tecnologie[p.patch.tecnologia_fisso||'Da verificare']=(summary.tecnologie[p.patch.tecnologia_fisso||'Da verificare']||0)+1;
  fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2),{mode:0o600});console.log(JSON.stringify(summary));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
