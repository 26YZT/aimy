const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const root='/Users/mima1234/Documents/aimy/aimy-app';
const rq=createRequire(root+'/package.json'),rs=createRequire(root+'/packages/stage-ui/package.json');
const ts=rq('typescript'),{createStorage}=rs('unstorage'),memory=rs('unstorage/drivers/memory');
const base=createStorage({driver:memory()});
// IDB structured-clones values; memory-driver references alone would conceal lost-update behavior.
const storage={async getItemRaw(k){return structuredClone(await base.getItemRaw(k));},async setItemRaw(k,v){return base.setItemRaw(k,structuredClone(v));},async removeItem(k){return base.removeItem(k);}};
function load(rel,imports={}){
 const file=root+'/'+rel,source=fs.readFileSync(file,'utf8');
 const out=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const sandbox={exports:{},require(n){if(n in imports)return imports[n];throw Error('Unexpected source import '+n)},structuredClone,console,Date,Map,Set,crypto:globalThis.crypto};
 vm.runInNewContext(out,sandbox,{filename:file});return sandbox.exports;
}
const repo=load('packages/stage-ui/src/database/repos/chat-sessions.repo.ts',{'../storage':{storage}}).chatSessionsRepo;
const rows=[];function emit(name,evidence){rows.push({check:name,...evidence});}
(async()=>{
 await repo.saveSession('s1',{meta:{sessionId:'s1',userId:'local',characterId:'c1',createdAt:1,updatedAt:1},messages:[{id:'u1',role:'user',content:'synthetic fact'}]});
 assert.equal((await repo.getSession('s1')).messages[0].id,'u1');
 await repo.addTombstone('local','a');await repo.addTombstone('local','a');assert.equal((await repo.getTombstones('local')).length,1);
 emit('actual_repo_roundtrip_and_idempotent_tombstone',{passed:true,backend:'unstorage memoryDriver with clone boundary; not real IndexedDB'});
 await storage.removeItem('local:chat/tombstones/race');
 await Promise.all([repo.addTombstone('race','a'),repo.addTombstone('race','b')]);
 const lost=await repo.getTombstones('race');assert.equal(lost.length,1);
 emit('actual_repo_concurrent_read_modify_write_loses_update',{reproduced:true,stored:lost,meaning:'Raw repository has no CAS; real app caller serializes operations. This does not prove the routed leader app loses data.'});
 await storage.removeItem('local:chat/tombstones/serial');
 let serial=Promise.resolve();const enqueue=fn=>{const next=serial.then(fn);serial=next.catch(()=>{});return next;};
 await Promise.all([enqueue(()=>repo.addTombstone('serial','a')),enqueue(()=>repo.addTombstone('serial','b'))]);
 assert.equal((await repo.getTombstones('serial')).length,2);
 emit('serialized_actual_repo_preserves_two_mutations',{passed:true,queue:'synthetic single-writer queue; current repo function bodies unchanged'});
 const {createContextRegistry}=load('packages/core-agent/src/runtime/context-registry.ts');
 const registry=createContextRegistry();registry.ingest({source:'memory',contextId:'scope-A',createdAt:1,strategy:'replace-self',text:'A facts'});registry.ingest({source:'memory',contextId:'scope-B',createdAt:2,strategy:'replace-self',text:'B facts'});
 const snapshot=registry.snapshot();assert.equal(snapshot.memory[0].text,'B facts');
 emit('actual_context_registry_does_not_scope_by_contextId',{passed:true,observed:snapshot.memory[0].contextId,meaning:'Same source bucket replaces previous scope; runtime providers/snapshot do not receive session id. Memory projection must be request-scoped.'});
 const {compactConversationEntries}=load('packages/core-agent/src/messages/compaction.ts');
 const compacted=compactConversationEntries({entries:[{role:'user',segments:[{type:'history-block',items:[{type:'turn',turnIndex:1,text:'synthetic forgotten fact'},{type:'turn',turnIndex:2,text:'recent'}]}]}],recentTurnLimit:1,summarizeCompactedHistory:()=> 'synthetic forgotten fact'});
 assert.equal(compacted[0].segments[0].items[0].text,'synthetic forgotten fact');
 const recompact=compactConversationEntries({entries:compacted,recentTurnLimit:1,summarizeCompactedHistory:()=> 'redacted'});
 assert.equal(recompact[0].segments[0].items[0].text,'synthetic forgotten fact');
 emit('actual_compaction_preserves_existing_compacted_summary',{passed:true,meaning:'When an application supplied sensitive summary text, setting a new formatter later does not rebuild compacted=true history. Default AIRI formatter only records removed-turn count; this is conditional provenance risk, not evidence current AIRI summarizes secrets.'});
 fs.writeFileSync('/tmp/aimy-20261014-aions-planning/offline-results.json',JSON.stringify({scope:'Actual selected current TS sources transpiled unchanged; dependency/IO boundaries injected. No model/device/network/real database. No production file written.',checks:rows},null,2));
 console.log(JSON.stringify({checks:rows.length,failed:0,results:rows},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
