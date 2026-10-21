/* Real AIRI task-memory modules, frozen fixture inputs, fake clock only. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict'),cp=require('node:child_process');
const O='/tmp/aimy-20261014-memory-ab-lm',R='/Users/mima1234/Documents/aimy/aimy-app/services/computer-use-mcp/src/task-memory',FP='/tmp/aimy-20261014-memory-ab/fixtures.json';
const EXPECTED='61b8c0b87067f9d349876f11217adcb82d321df795ddfec6e330e0f9caa14b61';
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');assert.equal(sha(FP),EXPECTED);const F=JSON.parse(fs.readFileSync(FP,'utf8'));
const ts=require('/Users/mima1234/Documents/aimy/aimy-app/node_modules/typescript/lib/typescript.js');
const loaded=[],cache=new Map();let now=F.clock_epoch*1000;
class FixedDate extends Date{static now(){return now}}
function load(p){if(cache.has(p))return cache.get(p).exports;assert(p.startsWith(R+'/'));const s=fs.readFileSync(p,'utf8'),m={exports:{}};cache.set(p,m);loaded.push({path:p,sha256:sha(p),start:1,end:s.split('\n').length,symbol:'whole original TypeScript module transpiled',scope:'original types/merge/manager; only Date.now clock boundary'});
 const code=ts.transpileModule(s,{fileName:p,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const context={require:id=>{assert(id.startsWith('.'));return load(path.resolve(path.dirname(p),id)+'.ts')},module:m,exports:m.exports,Date:FixedDate};vm.runInNewContext(code,context,{filename:p});return m.exports}
const {TaskMemoryManager}=load(R+'/manager.ts');
function state(m){return {raw_task_memory:m.get()??null,native_context:m.toContextString(),is_visible:m.isVisible(),clock_epoch_ms:now}}
function input(c,case0){const found=case0.messages.find(m=>m.id===c.sources?.[0]);return {extraction:{confirmedFacts:[c.content]},source:{sourceTurnId:c.sources?.[0]??case0.messages[0].id,sourceTurnIndex:found?.turn??case0.messages[0].turn}}}
function update(m,c,case0){const i=input(c,case0);return {original_update_input:i,original_update_result:m.update(i.extraction,i.source),state:state(m)}}
if(process.argv[2]==='--fresh'){
 const m=new TaskMemoryManager();console.log(JSON.stringify({pid:process.pid,seeded_imported_or_written_in_child:false,manager_constructed_in_new_OS_process:true,state:state(m)}));process.exit(0)
}
async function main(){const results=[];
 for(const c of F.memory_cases){now=F.clock_epoch*1000;const m=new TaskMemoryManager(),cand=c.fixed_candidates,id=c.id,observed={},trace=[];let outcome='inconclusive',unsupported=null;
  if(id==='LM01'){
   observed.before_restart=update(m,cand[0],c);const child=cp.spawnSync(process.execPath,[__filename,'--fresh'],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);observed.fresh_os_process=JSON.parse(child.stdout);assert.notEqual(observed.fresh_os_process.pid,process.pid);
   outcome='unsupported';unsupported='This native manager has no persistence/restore constructor or methods. Fresh Node process only constructs original manager; no harness storage added. Empty result does not describe desktop IndexedDB chat history.';
   trace.push('original manager.update keeps fixture fact in memory','new Node OS process loads exact same original modules and constructs manager; no parent fact payload, disk state or init seeded');
  }else if(id==='LM02'){
   observed.first=update(m,cand[0],c);observed.second=update(m,cand[0],c);outcome=m.get().confirmedFacts.length===1?'pass':'fail';trace.push('same completed-turn id/index and exact content twice; native string list dedupe only');
  }else if(id==='LM03'){
   observed.states_in_input_order=cand.map(a=>update(m,a,c));outcome='unsupported';unsupported='No native topic/current-fact replacement field. confirmedFacts merges strings; candidate topic cannot be preserved without adding implementation. Raw observations retain both old and new content.';
  }else if(id==='LM04'){
   observed.states_new_then_old=[update(m,cand[1],c),update(m,cand[0],c)];outcome=observed.states_new_then_old[1].original_update_result.status==='ignored-stale'&&m.get().confirmedFacts.length===1&&m.get().confirmedFacts[0]===cand[1].content?'pass':'fail';trace.push('new completed sourceTurnIndex=2 then old index=1; native global turn watermark, not topic-scoped preference correction');
  }else if(id==='LM05'){
   observed.nonexistent_source_update=update(m,cand[0],c);outcome='unsupported';unsupported='sourceTurnId is caller-provided provenance label/watermark, not per-fact source registry or message whitelist. Native API has no lookup for fixture U999. Accepted raw input recorded, no validation filled in by harness.';
  }else if(id==='LM06'){
   observed.waiting_candidate=copy(cand[0]);observed.external_fixture_message_before=copy(c.messages[0]);await Promise.resolve();observed.external_fixture_message_after={...c.messages[0],text:c.messages[0].text+'（已编辑）'};observed.after_external_edit_update=update(m,cand[0],c);outcome='unsupported';unsupported='No source text store/version or extraction-await consumer in this manager. External fixture edit is not a fake native edit API; supplied old extraction is accepted by native update and exact source body is unavailable to it.';
  }else if(id==='LM07'||id==='LM08'){
   observed.before_native_clear=update(m,cand[0],c);m.clear();observed.after_native_clear=state(m);if(id==='LM07')now+=31_000;observed.late_update_after_clear=update(m,id==='LM08'?cand[1]:cand[0],c);outcome='unsupported';unsupported='No per-fact delete/ref/tombstone or native pending extraction job. Nearest real clear() resets entire task and watermark; native late same-turn update rebuilds fact. This is a manager clear+update boundary probe, not desktop chat deletion or whole application forget behavior.';trace.push('one fixture fact written via original update','original clear resets whole task, not an invented per-fact delete','original update with same turn and old content accepted after clear; LM08 topic has no native field');
  }else if(id==='LM09'){
   observed.fixed_wrong_semantic_candidate=update(m,cand[0],c);outcome=m.get().confirmedFacts.includes(cand[0].content)?'fail':'pass';trace.push('deliberately wrong fixed candidate with valid sourceTurnId enters existing string-write interface','tests deterministic semantic defense absence; not real extraction/model precision');
  }else if(id==='LM10'){
   observed.fixed_long_candidate=update(m,cand[0],c);observed.fixed_candidate_characters=cand[0].content.length;observed.native_context_characters=m.toContextString().length;observed.target_characters=F.context_char_budget;outcome=observed.native_context_characters<=F.context_char_budget?'pass':'fail';trace.push('full original 1504-character fixture string enters confirmedFacts','native toContextString emitted unchanged; no harness truncation, no altered limits');
  }
  observed.final=state(m);
  results.push({case_id:id,arm:'AIRI.task-memory',contract:c.contract,contract_outcome:outcome,unsupported_reason:unsupported,observed,native_sequence:trace,true_code:['whole original task-memory/types.ts, merge.ts, manager.ts; native validation/dedupe/limits/watermark/clear/context'],fake_boundaries:['clock Date.now fixed to common fixture base; LM07 +31s logical replay time','fixed supplied candidate, no model/extraction service used'],field_mapping:{candidate_content:'confirmedFacts[0] unchanged, no truncation',candidate_sources:'first source label -> sourceTurnId; this is not native source whitelist validation',turn:'matching fixture source message turn -> sourceTurnIndex; invalid U999 falls back to triggering message turn=1',topic_category_ref:'unsupported: no corresponding native fields; kept in fixture/raw mapping, not implemented in AIRI',delete:'only actual whole-task clear nearest probe; no per-fact delete falsely added',source_edit:'external fixture metadata only, manager has no source-text API'},limitations:['this is independent computer-use task-memory; not default desktop chat IndexedDB repo/history/compaction/notebook','native turn ordering protects updates, not per-topic current preference or source-body lineage','unsupported contracts do not get zero scores or enter total winner ranking','fixed wrong semantic string tests deterministic acceptance boundary, not actual LLM quality','fresh Node process empty only proves manager has no persistence hook']});
  console.log(id,outcome);
 }
 const out={fixture_sha256:EXPECTED,initial_clock:F.clock_iso,runtime:process.version,real_compiler_version:require('/Users/mima1234/Documents/aimy/aimy-app/node_modules/typescript/package.json').version,cases:results};fs.writeFileSync(O+'/airi-results.json',JSON.stringify(out,null,2));fs.writeFileSync(O+'/airi-manifest.json',JSON.stringify(loaded,null,2));assert.equal(sha(FP),EXPECTED);
}
function copy(v){return JSON.parse(JSON.stringify(v))}
main().catch(e=>{console.error(e);process.exitCode=1});
