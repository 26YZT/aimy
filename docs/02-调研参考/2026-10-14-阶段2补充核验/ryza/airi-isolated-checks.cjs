'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const ROOT='/Users/mima1234/Documents/aimy/aimy-app/';
const OUT='/tmp/aimy-20261014-ryza-planning/';
const lines=(f,a,b)=>fs.readFileSync(ROOT+f,'utf8').split('\n').slice(a-1,b).join('\n');
const results=[];
function ctx(extra={}){const s={Promise,Date,Math,Error,performance:{now:()=>0},setTimeout(){return 1;},clearTimeout(){},clearInterval(){},...extra};vm.createContext(s);return s;}
function defer(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
async function ticks(){for(let i=0;i<8;i++)await Promise.resolve();}
function screenContext(){
 const grants=[],stopped=[];
 const s=ctx({activeSourceId:{value:'screen:A'},activeStream:{value:null},activeStreamSourceId:{value:''},selectWithSource:(_select,use)=>use(),navigator:{mediaDevices:{getDisplayMedia(){const d=defer();grants.push(d);return d.promise;}}}});
 const source='apps/stage-tamagotchi/src/renderer/composables/use-vision-screen-capture.ts';
 vm.runInContext(lines(source,50,68).replace('stream: MediaStream | null | undefined','stream')+'\n'+lines(source,79,88).replace('stream: MediaStream, sourceId: string','stream, sourceId')+'\n'+lines(source,120,148).replace("activeStream.value!", "activeStream.value"),s,{timeout:1000});
 function stream(name){const track={readyState:'live',stop(){stopped.push(name);this.readyState='ended';},addEventListener(){}};return {getTracks:()=>[track],getVideoTracks:()=>[track]};}
 return {s,grants,stopped,stream};
}
(async()=>{
 {
  const {s,grants,stopped,stream}=screenContext();const pending=s.startStream();s.stopStream();grants[0].resolve(stream('A'));await pending;
  assert.equal(s.activeStreamSourceId.value,'screen:A');assert.equal(stopped.length,0);
  results.push({id:'AP-01',kind:'defect-reproduced',actualFunctions:['startStream','stopStream','clearActiveStream','isActiveStream','attachStreamLifecycle'],evidence:{lateStreamInstalled:true,stoppedTracksBeforeCleanup:stopped.length},scope:'Actual extracted source functions, mocked selection and stream; no OS screen capture.'});s.stopStream();
 }
 {
  const {s,grants,stopped,stream}=screenContext();const first=s.startStream();s.activeSourceId.value='screen:B';const second=s.startStream();grants[1].resolve(stream('B'));await second;grants[0].resolve(stream('A'));await first;
  assert.equal(s.activeSourceId.value,'screen:B');assert.equal(s.activeStreamSourceId.value,'screen:A');
  results.push({id:'AP-02',kind:'defect-reproduced',evidence:{selected:s.activeSourceId.value,installed:s.activeStreamSourceId.value,stoppedTracks:stopped.slice()},scope:'Both source selections are pending before a stream exists, so the existing source-id watcher has no old stream to clear. Vue watchers are modeled only through this exact precondition.'});s.stopStream();
 }
 {
  const d=defer(),captures=[];const s=ctx({tickHandler:{value:()=>d.promise},isProcessing:{value:false},isRunning:{value:true},skippedTicks:{value:0},lastTickAt:{value:null},tickCount:{value:0},lastError:{value:null},intervalHandle:1,recordCapture:t=>captures.push(t),recordContextUpdates(){},recordProcessingDuration(){},errorMessageFrom:String});
  const f='packages/stage-ui/src/stores/modules/vision/processing-store.ts';vm.runInContext(lines(f,93,123)+'\n'+lines(f,140,145),s,{timeout:1000});const pending=s.runTick();s.stopTicker();d.resolve({capturedAt:123,contextUpdates:1});await pending;
  assert.equal(s.isRunning.value,false);assert.deepEqual(captures,[123]);results.push({id:'AP-03',kind:'defect-reproduced',evidence:{running:false,capturesRecordedAfterStop:captures},scope:'Actual ticker functions with deferred handler, no timer or network.'});
 }
 {
  const d=defer(),published=[];let actualSignal;const s=ctx({activeProvider:{value:'fake-provider'},activeModel:{value:'fake-model'},lastWorkloadId:{value:''},lastResultText:{value:''},lastResultAt:{value:null},lastError:{value:null},runVisionInference:input=>{actualSignal=input.abortSignal;return d.promise;},getVisionWorkload:id=>({id,label:id}),ContextUpdateStrategy:{ReplaceSelf:'replace-self'},modsServerChannelStore:{sendContextUpdate:e=>published.push(e)},recordError(){}});
  const f='packages/stage-ui/src/stores/modules/vision/orchestrator.ts';const fn=lines(f,61,116).replace('payload: VisionCapturePayload','payload').replace(': CommonContentPart[]','');vm.runInContext("function getVisionContextId(payload) {\n"+lines(f,32,35)+"\n"+fn,s,{timeout:1000});
  const controller=new AbortController();const pending=s.processCapture({imageDataUrl:'data:image/jpeg;base64,synthetic',workloadId:'screen:interpret',sourceId:'screen:A',publishContext:true,abortSignal:controller.signal});controller.abort('screen disabled');d.resolve('late screen description');await pending;
  assert.equal(actualSignal,undefined);assert.equal(published.length,1);results.push({id:'AP-04',kind:'defect-reproduced',evidence:{signalForwarded:false,publishedAfterCallerAborted:published.length,lastResult:s.lastResultText.value},scope:'Actual processCapture body; caller signal is an extra proposed field that current payload ignores. Fake inference resolves; no image/model call.'});
 }
 {
  const s=ctx({pendingNotifies:{value:[]},scheduledNotifies:{value:[]},attentionConfig:{value:{maxAttempts:3}},computeNextRunAt:()=>0});
  const f='packages/stage-ui/src/stores/character/orchestrator/store.ts';vm.runInContext('function enqueueSparkNotify(event, options) {\n'+lines(f,104,117),s,{timeout:1000});const e={type:'spark:notify',data:{id:'same-event',urgency:'soon'}};s.enqueueSparkNotify(e);s.enqueueSparkNotify(e);
  assert.equal(s.pendingNotifies.value.length,1);assert.equal(s.scheduledNotifies.value.length,2);results.push({id:'AP-05',kind:'defect-reproduced',evidence:{pending:1,scheduled:2},scope:'Actual enqueue body; timing helper mocked, no model.'});
 }
 {
  const providers=[],calls=[];const s=ctx({activeProvider:{value:'fake-provider'},activeModel:{value:'fake-model'},processing:{value:false},consciousnessStore:{getChatProviderInstance(){const d=defer();providers.push(d);return d.promise;}},sparkNotifyAgent:{async handle(request){calls.push(request.event.data.id);return {commands:[]};}},systemPrompt:{value:''},runtimePrompt:{value:''},enqueueSparkNotify(){},modsServerChannelStore:{send(){}},console:{warn(){}}});
  const f='packages/stage-ui/src/stores/character/orchestrator/store.ts';vm.runInContext('async function processSparkNotify(event, control) {\n'+lines(f,120,157)+'\nasync function handleIncomingSparkNotify(event, control) {\n'+lines(f,160,166),s,{timeout:1000});
  const p1=s.handleIncomingSparkNotify({data:{id:'first',urgency:'immediate'}});const p2=s.handleIncomingSparkNotify({data:{id:'second',urgency:'immediate'}});assert.equal(providers.length,2);providers.forEach(d=>d.resolve({}));await Promise.all([p1,p2]);assert.equal(calls.length,2);
  results.push({id:'AP-06',kind:'race-reproduced',evidence:{providerStartsBeforeProcessingLock:2,modelHandlerCalls:calls},scope:'Actual orchestration functions; injected provider/agent are inert promises. Production provider lookup is asynchronous too; no production model called.'});
 }
 const summary={date:'2026-10-14 Asia/Shanghai',sourceRoot:ROOT,checks:results.length,networkCalls:0,realModels:0,realDevices:0,productWrites:0,results};fs.writeFileSync(OUT+'airi-isolated-results.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
