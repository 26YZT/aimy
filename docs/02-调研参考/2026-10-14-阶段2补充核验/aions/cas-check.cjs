const fs=require('node:fs'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const r=createRequire('/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/package.json');const {update,get}=r('idb-keyval');
let tail=Promise.resolve();const values=new Map();let failCommit=false;
// Deterministic IDBObjectStore event simulator. The installed idb-keyval.update/get functions execute unchanged.
function useStore(mode,callback){
 const run=()=>{
  const tx={error:null};
  const store={transaction:tx,get(key){const req={result:structuredClone(values.get(key)),error:null};queueMicrotask(()=>req.onsuccess?.());return req;},
   put(value,key){const safe=structuredClone(value);queueMicrotask(()=>{if(failCommit){failCommit=false;tx.error=Object.assign(new Error('synthetic quota'),{name:'QuotaExceededError'});tx.onabort?.();}else{values.set(key,safe);tx.oncomplete?.();}});}};
  try{return Promise.resolve(callback(store));}catch(e){return Promise.reject(e);}
 };
 const next=tail.then(run);tail=next.catch(()=>{});return next;
}
const key='airi-local:aimy:memory:v1:local:main';const results=[];
async function mutate(expectedRevision,expectedEpoch,mutator){
 let receipt;
 try{
  await update(key,old=>{const current=old??{schemaVersion:1,revision:0,epoch:0,facts:{},jobs:{},tombstones:{}};
   if(current.revision!==expectedRevision||current.epoch!==expectedEpoch){const e=new Error('conflict');e.code='CONFLICT';e.currentRevision=current.revision;e.currentEpoch=current.epoch;throw e;}
   const next=mutator(structuredClone(current));next.revision=current.revision+1;receipt={revision:next.revision,epoch:next.epoch};return next;
  },useStore);
  return {status:'committed',...receipt};
 }catch(e){return e.code==='CONFLICT'?{status:'conflict',revision:e.currentRevision,epoch:e.currentEpoch}:{status:'failed',errorName:e.name};}
}
(async()=>{
 assert.equal((await mutate(0,0,s=>s)).status,'committed');
 const concurrent=await Promise.all([mutate(1,0,s=>{s.facts.a='a';return s;}),mutate(1,0,s=>{s.facts.b='b';return s;})]);
 assert.equal(concurrent.filter(v=>v.status==='committed').length,1);assert.equal(concurrent.filter(v=>v.status==='conflict').length,1);
 results.push({check:'installed_idb_keyval_update_sync_CAS_concurrent',results:concurrent});
 const caught=await Promise.race([mutate(999,0,s=>s),new Promise(resolve=>setTimeout(()=>resolve({status:'timed-out'}),100))]);assert.equal(caught.status,'conflict');
 results.push({check:'updater_exception_rejects_without_hanging',result:caught});
 const before=await get(key,useStore);failCommit=true;const quota=await mutate(before.revision,before.epoch,s=>{s.facts.quota='never commit';return s;});assert.equal(quota.status,'failed');assert.equal(quota.errorName,'QuotaExceededError');assert.equal((await get(key,useStore)).facts.quota,undefined);
 results.push({check:'transaction_abort_does_not_return_committed_receipt',result:quota});
 const revision=before.revision;const barrier=await mutate(revision,0,s=>{s.epoch++;s.facts={};s.tombstones.u1={reason:'forget',createdAt:1};return s;});assert.equal(barrier.status,'committed');
 const stale=await mutate(revision,0,s=>{s.facts.stale='old model result';return s;});assert.equal(stale.status,'conflict');assert.equal((await get(key,useStore)).facts.stale,undefined);
 results.push({check:'forget_barrier_rejects_captured_model_revision_epoch',barrier,stale});
 fs.writeFileSync('/tmp/aimy-20261014-aions-planning/cas-results.json',JSON.stringify({scope:'Actual installed idb-keyval 6.3.0 update/get; deterministic ObjectStore event simulator and proposed wrapper. NOT real browser IndexedDB, NOT production MemoryRepo.',checks:results},null,2));console.log(JSON.stringify({checks:results.length,failed:0,results},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
