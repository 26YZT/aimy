import fs from 'node:fs';
import crypto from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const ROOT='/Users/mima1234/Documents/airi-main';
const OUT='/tmp/aimy-round2-ab-20261018';
const fixtureBytes=fs.readFileSync('/tmp/aimy-round2-ab-20261018/proactive-fixtures.json');
const sha=crypto.createHash('sha256').update(fixtureBytes).digest('hex');
assert.equal(sha,'61b8c0b87067f9d349876f11217adcb82d321df795ddfec6e330e0f9caa14b61');
const fixtures=JSON.parse(fixtureBytes),BASE=fixtures.clock_epoch*1000,TEXT='刚才的话题还想听你说说。';
const manifest={};
function load(relative,deps,exportName,{exposeTick=false}={}) {
 const path=ROOT+'/'+relative,src=fs.readFileSync(path,'utf8');
 manifest[path]={sha256:crypto.createHash('sha256').update(src).digest('hex'),executed:'complete module factory/functions; type/import/export surface removed, injected dependency boundaries',transformation:exposeTick?'added return-only __tick exposure; original private tick body unchanged':'no function body changed'};
 let body=stripTypeScriptTypes(src).split('\n').filter(l=>!l.startsWith('import ')&&!l.startsWith('export *')&&!l.startsWith('export {')).join('\n').replace(/^export /gm,'');
 if(exposeTick)body=body.replace('    handleSparkNotify: handleIncomingSparkNotify,','    __tick: tick,\n    handleSparkNotify: handleIncomingSparkNotify,');
 return new Function(...Object.keys(deps),body+`\nreturn {${exportName}};`)(...Object.values(deps));
}
function setup(){
 let now=BASE,seq=0,session='conv-A',timerId=0,activeTimer,blocked=false,release,startedResolve;
 const stage=[],speech=[],requests=[],commands=[],timers=[];
 const started=new Promise(r=>startedResolve=r);
 const refs=new WeakMap();
 function ref(value){return {__ref:true,value}}
 function computed(fn){return {__ref:true,get value(){return fn()}}}
 function defineStore(name,factory){let store;return()=>{if(store)return store;const raw=factory();store=new Proxy(raw,{get:(o,k)=>o[k]?.__ref?o[k].value:o[k],set:(o,k,v)=>{if(o[k]?.__ref)o[k].value=v;else o[k]=v;return true}});refs.set(store,raw);return store}}
 function storeToRefs(store){const raw=refs.get(store)??store;return Object.fromEntries(Object.keys(raw).map(k=>[k,raw[k]?.__ref?raw[k]:{__ref:true,get value(){return store[k]},set value(v){store[k]=v}}]))}
 class FixedDate extends Date{static now(){return now}}
 const basic={ref,computed,reactive:v=>v,defineStore,storeToRefs,nanoid:()=>`fake-id-${++seq}`,Date:FixedDate};
 const {getEventSourceKey}=load('packages/core-agent/src/agents/spark-notify/event-source.ts',{},'getEventSourceKey');
 const {createSparkNotifyBuiltinToolsPlugin}=load('packages/core-agent/src/agents/spark-notify/plugins/builtin-tools.ts',{createSparkNotifyTools:async()=>({tools:[]})},'createSparkNotifyBuiltinToolsPlugin');
 const {createSparkNotifyReactionPlugin}=load('packages/core-agent/src/agents/spark-notify/plugins/reaction.ts',{},'createSparkNotifyReactionPlugin');
 const {createSparkNotifyAgent}=load('packages/core-agent/src/agents/spark-notify/agent.ts',{nanoid:basic.nanoid,getEventSourceKey,createSparkNotifyBuiltinToolsPlugin},'createSparkNotifyAgent');
 const sessions={get activeSessionId(){return session}};
 class Speech {
  constructor(context,kind){this.context={...context};this.kind=kind;this.text='';speech.push(this);stage.push({stage:'speech_recorder_open',time:now,sessionId:context.sessionId,kind});}
  async write(text){this.text+=text;stage.push({stage:'speech_recorder_write',time:now,sessionId:this.context.sessionId,text})}
  async special(text){stage.push({stage:'speech_recorder_special',time:now,text})}
  async end(){this.ended=true;stage.push({stage:'speech_recorder_end',time:now,sessionId:this.context.sessionId})}
  async finish(){this.finished=true;return {status:'fake-delivered'}}
 }
 const useLlmmarkerParser=({onLiteral})=>({consume:onLiteral,end:async()=>{}});
 const {useCharacterStore}=load('packages/stage-ui/src/stores/character/index.ts',{...basic,Speech,useLlmmarkerParser,useChatSessionStore:()=>sessions,useAiriCardStore:()=>({activeCard:ref({name:'合成角色'}),systemPrompt:ref('固定系统文本')})},'useCharacterStore');
 const character=useCharacterStore();
 const {useCharacterNotebookStore}=load('packages/stage-ui/src/stores/character/notebook.ts',basic,'useCharacterNotebookStore');const notebook=useCharacterNotebookStore();
 const consciousness={activeProvider:ref('fixed-provider'),activeModel:ref('fixed-model'),getChatProviderInstance:async()=>({synthetic:true})};
 async function stream(model,provider,conversation,options){requests.push({time:now,model,conversation});stage.push({stage:'generate_start',time:now});startedResolve();if(blocked)await new Promise(r=>release=r);await options.onStreamEvent({type:'text-delta',text:TEXT});stage.push({stage:'generate_complete',time:now});}
 const channel={onEvent:()=>()=>{},send:c=>commands.push(c)};
 const {useCharacterOrchestratorStore}=load('packages/stage-ui/src/stores/character/orchestrator/store.ts',{...basic,createSparkNotifyAgent,createSparkNotifyReactionPlugin,useLLM:()=>({stream}),useConsciousnessStore:()=>consciousness,useCharacterStore:()=>character,useCharacterNotebookStore:()=>notebook,useAiriRuntimePrompt:()=>ref('固定运行文本'),useModsServerChannelStore:()=>channel,setInterval:(callback,ms)=>{activeTimer={callback,ms,id:++timerId};timers.push({time:now,ms});return activeTimer.id},clearInterval:()=>{activeTimer=undefined}},'useCharacterOrchestratorStore',{exposeTick:true});
 const orchestrator=useCharacterOrchestratorStore();orchestrator.initialize();
 async function settle(){for(let i=0;i<40;i++)await Promise.resolve()}
 function plan(minutes=2){const p=notebook.scheduleTask({title:'稍后继续',details:'同一合成后续话题',dueAt:BASE+minutes*60000});stage.push({stage:'plan',time:now,task:{...p}});return p}
 async function advance({gate=false}={}){
  blocked=gate;let inFlight;
  for(let s=2;s<=120;s+=2){now=BASE+s*1000;if(!activeTimer)continue;
   // Original tick is exposed for awaiting; native timer callback uses void tick.
   const p=orchestrator.__tick();await settle();
   if(orchestrator.processing&&gate){inFlight??=p;continue}await p;await settle();
  }
  return {inFlight};
 }
 function observe(){return {stages:stage,tasks:structuredClone(notebook.tasks),pendingNotifies:structuredClone(orchestrator.pendingNotifies),scheduledNotifies:structuredClone(orchestrator.scheduledNotifies),reactions:structuredClone(character.reactions),speech_recorders:speech.map(s=>({context:s.context,kind:s.kind,text:s.text,ended:s.ended??false,finished:s.finished??false})),model_requests:requests,commands,timers,active_session:session,processing:orchestrator.processing}}
 return {notebook,orchestrator,plan,advance,settle,observe,started,setTime:v=>now=v,switchSession:()=>{session='conv-B';stage.push({stage:'switch_session',time:now,session})},userReturn:()=>stage.push({stage:'user_return_unmapped',time:now,reason:'原notebook/orchestrator无新用户消息取消入口'}),disable:()=>{orchestrator.dispose();stage.push({stage:'dispose_mapped_lifecycle_stop',time:now,reason:'原无主动enable开关；dispose为已有生命周期控制'})},finish:()=>{blocked=false;release?.()}};
}
if(process.argv.includes('--fresh')){const c=setup();console.log(JSON.stringify({pid:process.pid,tasks:c.notebook.tasks.length,scheduled:c.orchestrator.scheduledNotifies.length,reactions:c.observe().reactions.length}));process.exit(0)}
const results=[];
for(const spec of fixtures.proactive_cases){
 const c=setup();let contract_outcome,reason,extra={};
 if(spec.id==='PR09'){
  // A background-context DTO alone cannot manufacture spark:notify or a timer.
  c.notebook.addFocusEntry('合成背景记忆浮现');await c.advance();contract_outcome='inconclusive';reason='原focus笔记+空任务队列未触发模型或发言；真实记忆surfacing producer未执行，不能把笔记当其完整调用链。';
 }else if(spec.id==='PR10'){
  // Do not invent a NEXT_CHAT validator or turn 61 into an accepted two-minute task.
  await c.advance();contract_outcome='unsupported';reason='原notebook/orchestrator没有NEXT_CHAT解析协议；未为61添加计划，不以空队列冒充原validator拒绝。';
 }else{
  const task=c.plan();
  if(spec.id==='PR03')c.userReturn();
  if(spec.id==='PR04')c.disable();
  if(spec.id==='PR06')c.switchSession();
  if(spec.id==='PR05'){
   const cp=spawnSync(process.execPath,[new URL(import.meta.url).pathname,'--fresh'],{encoding:'utf8'});if(cp.status!==0)throw new Error(cp.stderr);const fresh=JSON.parse(cp.stdout);assert.notEqual(fresh.pid,process.pid);assert.equal(fresh.tasks,0);extra={parent_pid:process.pid,parent_task_count:c.notebook.tasks.length,fresh_os_process:fresh};contract_outcome='fail';reason='原ref内存计划未持久化；新OS进程无任务。未给AIRI补文件/SQLite或传入序列化计划。';
  }else if(spec.id==='PR07'||spec.id==='PR08'){
   const {inFlight}=await c.advance({gate:true});await c.started;
   if(spec.id==='PR07')c.userReturn();else c.disable();c.finish();await inFlight;await c.settle();assert.equal(c.observe().reactions.length,1);
   contract_outcome='unsupported';reason=spec.id==='PR07'?'原模块无new-user取消控制；固定生成完成后原character reaction和Speech记录器仍提交。不能冒称执行了不存在的取消API。':'原无主动toggle；映射已有dispose只能停ticker/退订，生成中dispose后原reaction+Speech记录器仍提交。生命周期反例已执行，toggle合同未原生实现。';
  }else{
   await c.advance();
   if(spec.id==='PR02'){
    for(const s of [122,124,126,128,130]){c.setTime(BASE+s*1000);await Promise.all([c.orchestrator.__tick(),c.orchestrator.__tick()]);await c.settle()}
    assert.ok(c.observe().reactions.length>=2);contract_outcome='fail';reason='正常priority两分钟原任务经默认60秒window/soon10秒处理，70秒/100秒/130秒生成；成功后任务未自动done，同任务可多次提交。是本轮单次合同不满足，不宣称违反AIRI原提醒语义。';
   }else if(spec.id==='PR01'){
    assert.equal(c.observe().reactions.length,2);contract_outcome='unsupported';reason='可转换到原scheduleTask(dueAt=+120s)，原调度→Spark→character→Speech记录器已执行；但NEXT_CHAT自动规划协议未原生接线，默认提醒窗口使70/100秒提交而非严格120秒后。';
   }else if(spec.id==='PR03'){contract_outcome='unsupported';reason='原模块没有新用户消息撤销入口；只记录同输入事件，不加自建取消逻辑；原提醒仍生成。';assert.equal(c.observe().reactions.length,2)}
   else if(spec.id==='PR04'){contract_outcome='unsupported';reason='原模块无主动toggle，映射现有dispose在生成前停止ticker，原队列保留但无提交。不能把生命周期停止当同一个toggle API。';assert.equal(c.observe().reactions.length,0)}
   else if(spec.id==='PR06'){contract_outcome='fail';reason='原task无会话绑定；实际character构造Speech使用生成时activeSessionId，切到conv-B后同任务提交给conv-B记录器。针对本轮会话隔离合同，不宣称全局提醒原设计承诺绑定。';assert.ok(c.observe().speech_recorders.every(x=>x.context.sessionId==='conv-B'))}
  }
 }
 results.push({id:spec.id,contract:spec.contract,contract_outcome,reason,observation:c.observe(),...extra,evidence_level:'original notebook+orchestrator+Spark agent/plugins+character factory; fake Vue/Pinia primitives, literal parser, model provider and Speech recorder'});
}
const report={fixture_sha256:sha,project:'AIRI',model_output:TEXT,cases:results,field_mapping:{assistant_NEXT_CHAT_2:'不解析NEXT_CHAT；转换共同意图为原notebook.scheduleTask({title,details,dueAt:fixedClock+120000})，自动规划协议阶段unsupported',two_claims:'原无claim原语；以原tick和重复native callbacks观测单次提交合同',user_return:'原notebook/orchestrator无控制入口，仅输入事件记录，unsupported',disable:'原无主动toggle；用已有orchestrator.dispose作生命周期补充观察，toggle阶段unsupported',switch_session:'原character使用真实sessions.activeSessionId字段，假会话store仅改变该字段',fresh_process:'新Node OS进程执行原store factories，不添加持久化',memory_surfacing_only:'原notebook focus入口作空调度阴性，非真实记忆producer',invalid61:'原NEXT_CHAT协议缺失，未伪造parser'},limits:['非真实Pinia/Vue或桌面装配；原工厂/调度/Spark/character函数body执行，ref/proxy注入只提供同名基础语义','Speech是记录器、parser为literal透传，未验证真实VoiceKernel拒绝/播放/UI可见/音频','固定模型，无自然时机/自然度/语义理解排名','默认notebook是全局提醒；本轮合同为陪伴续聊，不将目标合同当上游原承诺','新增return-only __tick暴露供await原私有tick，不改调度/cancel/提交逻辑','built-in tools builder返回空工具；固定文本不执行tool与副作用']};
fs.writeFileSync(OUT+'/airi-results.json',JSON.stringify(report,null,2));fs.writeFileSync(OUT+'/airi-source-manifest.json',JSON.stringify(manifest,null,2));console.log(JSON.stringify(results.map(({id,contract_outcome,observation})=>({id,contract_outcome,reactions:observation.reactions.length,speech:observation.speech_recorders.length})),null,2));
