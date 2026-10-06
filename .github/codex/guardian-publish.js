'use strict';

const crypto = require('node:crypto');
const { validWorkerTarget } = require('./worker-target');
const { REPOSITORY, PRODUCTION_URL, validateContract, inspectPull, githubRequest,
  parsePublishedInfo, releaseError } = require('../../netlify/functions/_lib/guardian-release');

function createWorkerClient(env, request = fetch) {
  if (!validWorkerTarget(env.GUARDIAN_WORKER_URL, env.TARGET_ENVIRONMENT) || !env.GUARDIAN_WORKER_SECRET) {
    throw new Error('Worker production non configurato');
  }
  return async (action, payload = {}) => {
    const body = JSON.stringify({ action, execution_id: env.EXECUTION_ID, ...payload });
    const signature = crypto.createHmac('sha256', env.GUARDIAN_WORKER_SECRET).update(body).digest('hex');
    const response = await request(env.GUARDIAN_WORKER_URL, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Guardian-Worker-Signature': signature },
      body, signal: AbortSignal.timeout(30000) });
    const data = await response.json();
    if (!response.ok || !data.ok) throw releaseError('worker_release_failed', 'Il worker non ha autorizzato o registrato la pubblicazione (HTTP ' + response.status + ').');
    return data;
  };
}

async function publish({ worker, github = githubRequest, inspect = inspectPull, request = fetch,
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)), token, runId, maxPolls = 45 }) {
  const claimed = await worker('claim', { workflow_run_id: runId });
  const lease = claimed.lease_token;
  const result = { merged: false, deploy_status: 'not_started', health_ok: false };
  const contract = claimed.context?.release_contract;
  let failure;
  try {
    validateContract(contract);
    const options = { token };
    let pr = await inspect(contract, options);
    if (pr.draft) {
      const ready = await github('/graphql', { ...options, method: 'POST', body: {
        query: 'mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{id}}}',
        variables: { id: pr.node_id }
      } });
      if (ready.errors || !ready.data?.markPullRequestReadyForReview?.pullRequest?.id) {
        throw releaseError('draft_release_failed', 'GitHub non ha aperto la proposta per la pubblicazione.');
      }
    }
    pr = await inspect(contract, options);
    if (pr.mergeable !== true) throw releaseError('release_not_mergeable', 'GitHub non conferma che la proposta possa essere unita. Ripeti la verifica.');
    const authorization = await worker('release_authorization', { lease_token: lease });
    if (JSON.stringify(authorization.release_contract) !== JSON.stringify(contract)) throw releaseError('release_changed', 'La versione approvata è cambiata.');
    const root = '/repos/' + REPOSITORY;
    const current = await github(root + '/git/ref/heads/main', options);
    if (current.object?.sha !== contract.base_sha) throw releaseError('release_changed', 'La produzione è cambiata dopo i test. Ripeti la verifica.');
    let merge;
    try {
      merge = await github(root + '/pulls/' + contract.pull_number + '/merge', { ...options, method: 'PUT',
        body: { sha: contract.head_sha, merge_method: 'merge', commit_title: 'fix(guardian): applica modifica approvata da Telegram' } });
    } catch (error) {
      // A timeout can happen after GitHub accepts the merge: reconcile before reporting.
      const after = await github(root + '/pulls/' + contract.pull_number, options).catch(() => null);
      if (!after?.merged || after.head?.sha !== contract.head_sha) throw error;
      merge = { merged: true, sha: after.merge_commit_sha };
    }
    if (!merge?.merged) throw releaseError('merge_failed', 'GitHub non ha applicato il merge.');
    Object.assign(result, { merged: true, approved_head_sha: contract.head_sha,
      merge_commit_sha: merge.sha, deploy_status: 'unconfirmed' });
    const commit = await github(root + '/commits/' + merge.sha, options);
    if (commit.parents?.length !== 2 || commit.parents[0].sha !== contract.base_sha || commit.parents[1].sha !== contract.head_sha) {
      throw releaseError('merge_base_changed', 'La base del merge non coincide con quella verificata. Occorre controllare il rilascio.');
    }
    for (let attempt = 0; attempt < maxPolls; attempt++) {
      await worker('heartbeat', { lease_token: lease, progress: result });
      const live = await request(PRODUCTION_URL + '/js/config.js?guardian_release=' + merge.sha + '&attempt=' + attempt,
        { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(20000) }).catch(() => null);
      const info = live?.ok ? parsePublishedInfo(await live.text()) : null;
      if (info?.environment === 'production' && info.commit_sha === merge.sha) {
        result.deploy_id = info.deploy_id || null;
        if(contract.catalog_plan) {
          const applied=await worker('apply_catalog',{lease_token:lease,merge_commit_sha:merge.sha});
          if(applied.catalog?.ok!==true || applied.catalog.hash!==contract.catalog_plan.hash)throw releaseError('catalog_apply_failed','Piano catalogo non applicato: il rilascio non è completo.');
          result.catalog_applied={hash:applied.catalog.hash,ok:true};
        }
        const health = await worker('health');
        if (!health.ok) throw releaseError('release_health_failed', 'La versione è online ma i controlli Guardian non sono superati.');
        Object.assign(result, { deploy_status: 'ready', health_ok: true });
        break;
      }
      if (attempt + 1 < maxPolls) await pause(15000);
    }
    if (result.deploy_status !== 'ready') throw releaseError('deploy_unconfirmed', 'Netlify non ha pubblicato la versione approvata entro il tempo previsto.');
  } catch (error) { failure = error; }
  const body = { lease_token: lease, success: !failure, result,
    ...(contract ? { branch_name: contract.branch, pull_request_url: contract.pull_request_url } : {}),
    result_commit_sha: result.merge_commit_sha || null,
    ...(failure ? { error_code: failure.code || 'publication_failed', error: failure.message } : {}),
    summary: failure ? 'Pubblicazione non completata.' : 'Merge e pubblicazione production verificati.' };
  await worker('result', body);
  if (failure) throw failure;
  return result;
}

if (require.main === module) {
  if (process.env.GITHUB_REF !== 'refs/heads/main') {
    console.error('Il rilascio deve usare il workflow attendibile su main.'); process.exitCode = 1;
  } else {
    publish({ worker: createWorkerClient(process.env), token: process.env.GH_TOKEN,
      runId: Number(process.env.GITHUB_RUN_ID) }).then(result => {
      console.log('Pubblicazione verificata:', result.merge_commit_sha);
    }).catch(error => { console.error('Pubblicazione Guardian:', error.code || 'publication_failed'); process.exitCode = 1; });
  }
}
module.exports = { publish, createWorkerClient };
