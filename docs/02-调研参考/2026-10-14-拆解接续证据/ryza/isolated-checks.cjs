'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const path = require('path');
const SOURCE = '/Users/mima1234/Documents/资料/拆解项目/ryza-ai-revive-master';
const OUT = '/tmp/aimy-20261014-ryza-audit';
const results = [];
function store(seed = {}) { const d = { ...seed }; return { d, get length() { return Object.keys(d).length; }, getItem(k) { return k in d ? d[k] : null; }, setItem(k,v) { d[k] = String(v); }, removeItem(k) { delete d[k]; }, clear() { for(const k of Object.keys(d)) delete d[k]; }, key(i) { return Object.keys(d)[i] || null; } }; }
function sandbox(extra = {}) { const s = { Promise, Math, Date, JSON, Number, String, Object, Array, RegExp, Error, parseInt, Uint32Array, Float32Array, Int16Array, Uint8Array, DataView, ArrayBuffer, Blob, AbortController, setTimeout, clearTimeout, localStorage: store(), URL: { createObjectURL() { return 'blob:synthetic'; }, revokeObjectURL() {} }, Util: { clamp(v,l,h) { return Math.max(l,Math.min(h,v)); } }, ...extra }; s.window = s; s.globalThis = s; vm.createContext(s); return s; }
function load(s,file) { vm.runInContext(fs.readFileSync(path.join(SOURCE,file),'utf8'),s,{filename:file,timeout:2000}); }
async function ticks() { for(let i=0;i<12;i++) await Promise.resolve(); }
function record(id,kind,evidence) { results.push({id,kind,evidence}); }
(async () => {
  // Actual turn.js in a VM; injected synthesis/playback never access devices or network.
  {
    const s=sandbox(); load(s,'web/js/turn.js'); const played=[], settlers={};
    s.Turn.setSynth(text=>Promise.resolve('blob:'+text));
    s.Turn.setPlayer(url=>{ played.push(url); return new Promise(r=>{settlers[url]=r;}); });
    s.Turn.speak('active',{priority:10}); await ticks();
    s.Turn.speak('low',{priority:1,behavior:'queue'}); s.Turn.speak('high',{priority:50,behavior:'queue'});
    settlers['blob:active'](); await ticks(); settlers['blob:low'](); await ticks(); settlers['blob:high'](); await ticks();
    assert.deepEqual(played,['blob:active','blob:low','blob:high']);
    record('T01','confirmed-behavior',{queuedPlaybackOrder:played,meaning:'Waiting intents are FIFO; priority controls preemption only. AIRI speech-pipeline sorts priority.'});
  }
  {
    const revoked=[],played=[]; const s=sandbox({URL:{revokeObjectURL(u){revoked.push(u);}}}); load(s,'web/js/turn.js'); let reply;
    s.Turn.setSynth(()=>new Promise(r=>{reply=r;})); s.Turn.setPlayer(u=>{played.push(u);return Promise.resolve();});
    s.Turn.speak('cancelled'); s.Turn.stopAll('test'); reply('blob:cancelled'); await ticks();
    assert.equal(played.length,0); assert.deepEqual(revoked,['blob:cancelled']);
    record('T02','pass',{playedCount:played.length,revoked,meaning:'Cancelled late synthesis output is discarded.'});
  }
  {
    const s=sandbox(); load(s,'web/js/turn.js'); const played=[];
    s.Turn.setSynth(t=>Promise.resolve('blob:'+t)); s.Turn.setPlayer((u,signal)=>new Promise(r=>{played.push(u);signal.addEventListener('abort',r);}));
    let epoch=0; s.Turn.setTurnCanceller(()=>++epoch);
    s.Turn.speak('active'); await ticks(); s.Turn.speak('queued'); s.Turn.interrupt('user-barge-in'); await ticks();
    assert.deepEqual(played,['blob:active','blob:queued']);
    record('T03','risk-reproduced',{played,epoch,stateAfterBargeIn:s.Turn.state(),meaning:'App barge-in calls interrupt, which promotes rather than drops queued speech.'}); s.Turn.stopAll('cleanup'); await ticks();
  }
  {
    const s=sandbox(); load(s,'web/js/stt.js'); s.Stt.setTranscriber(()=>Promise.resolve('synthetic transcript'));
    for(let i=0;i<1000;i++) s.Stt._pushFrame(new Int16Array(128).fill(1000),true);
    const retained=s.Stt._state(); const blob=s.Stt._close(8000); const data=await blob.arrayBuffer(); const dv=new DataView(data); const samples=dv.getUint32(40,true)/2;
    assert.equal(samples,2816);
    record('T04','defect-reproduced',{inputSamples:128000,inputDurationMs:8000,retainedFrames:retained.frames,wavSamples:samples,wavDurationMs:samples*1000/dv.getUint32(24,true),meaning:'WAV contains only last 176 ms for 128-sample audio render blocks.'}); await ticks();
  }
  {
    const s=sandbox(); load(s,'web/js/stt.js'); load(s,'web/js/voice.js'); let reply; const delivered=[];
    s.Voice.setSink(t=>delivered.push(t)); s.Stt.setSink(t=>s.Voice._accept(t)); s.Stt.setTranscriber(()=>new Promise(r=>{reply=r;}));
    s.Stt._pushFrame(new Int16Array(800),true); s.Stt._close(1000); await ticks(); s.Voice.stop(); reply('late text after microphone off'); await ticks();
    assert.equal(delivered.length,1);
    record('T05','defect-reproduced',{voiceListening:s.Voice.isListening(),sttListening:s.Stt.isListening(),delivered,meaning:'Actual asynchronous Stt + Voice gate accepts late provider text after stop; no generation/permission guard.'});
  }
  {
    let grant,stops=0;
    const s=sandbox({navigator:{mediaDevices:{getUserMedia:()=>new Promise(r=>{grant=r;})}},AudioContext:class { constructor(){this.sampleRate=16000;this.destination={};} createMediaStreamSource(){return{connect(){},disconnect(){}};} createScriptProcessor(){return{connect(){},disconnect(){}};} createGain(){return{gain:{value:1},connect(){}};} close(){} }}); load(s,'web/js/stt.js');
    const p=s.Stt.start(); s.Stt.stop(); grant({getTracks(){return[{stop(){stops++;}}];}}); const ok=await p;
    assert.equal(stops,0); assert.equal(s.Stt.isListening(),false); assert.equal(ok,true);
    record('T06','defect-reproduced',{mockCaptureStartResolved:ok,userWantsMic:s.Stt.isListening(),tracksStoppedBeforeCleanup:stops,meaning:'Stop during pending getUserMedia does not invalidate its eventual stream; mock host reproduces startup race.'}); s.Stt.stop(); assert.equal(stops,1);
  }
  {
    const s=sandbox(); load(s,'web/js/longterm.js'); let reply,sent;
    s.LongTerm.setLLM((_sys,body)=>{sent=body;return new Promise(r=>{reply=r;});});
    s.LongTerm.note('user','old fact',{noConsolidate:true}); const pending=s.LongTerm.consolidate(); s.LongTerm.note('user','new fact during request',{noConsolidate:true}); reply('{"entries":[]}'); await pending;
    assert.equal(s.LongTerm.pendingTurns(),0);
    record('T07','defect-reproduced',{sentDialogue:JSON.parse(sent).dialogue.map(t=>t.text),pendingAfter:s.LongTerm._state().pending,meaning:'New dialogue after request serialization is cleared by old consolidation response.'});
  }
  {
    const s=sandbox(); load(s,'web/js/longterm.js'); let reply;
    const e=s.LongTerm.add('deleted preference',{date:'2026-10-14'}); s.LongTerm.setLLM(()=>new Promise(r=>{reply=r;}));
    const pending=s.LongTerm.consolidate(); s.LongTerm.remove(e.id); reply(JSON.stringify({entries:[e]})); await pending;
    assert.equal(s.LongTerm.list().length,1);
    record('T08','defect-reproduced',{afterDeleteThenStaleResponse:s.LongTerm.list().map(e=>e.summary),meaning:'Consolidation in flight can resurrect an entry removed by deterministic API.'});
  }
  {
    const storage=store(),s=sandbox({localStorage:storage}); load(s,'web/js/memory.js'); let reply;
    s.Memory.setSummarizer(()=>new Promise(r=>{reply=r;})); s.Memory.ingest('user fact','assistant fact'); const pending=s.Memory.flushNow(); await ticks();
    const diskDuringRequest=JSON.parse(storage.getItem(s.Memory.KEY)); const restarted=sandbox({localStorage:storage}); load(restarted,'web/js/memory.js');
    assert.equal(restarted.Memory.list().pending.length,0); assert.equal(restarted.Memory.list().sessions.length,0);
    record('T09','defect-reproduced',{primaryDuringInflight:diskDuringRequest,freshVmLoadStatus:restarted.Memory.lastLoad(),freshVmRecoveredPending:restarted.Memory.list().pending.length,meaning:'A new VM with identical storage observes valid-but-empty primary while summary is in flight; simulated restart, not real process crash.'}); reply('summary'); await pending;
  }
  {
    const ws=require(path.join(SOURCE,'desktop/web-storage.js'));
    class Storage { constructor(){this.d={'ryza.old':'stale'};} get length(){return Object.keys(this.d).length;} key(i){return Object.keys(this.d)[i]||null;} getItem(k){return this.d[k]??null;} setItem(k,v){this.d[k]=String(v);} removeItem(k){delete this.d[k];} clear(){this.d={};} }
    const local=new Storage(); const s=sandbox({Storage,localStorage:local,document:{addEventListener(){}},addEventListener(){},ryzaShell:{saveWebStorage(){},saveWebStorageSync(){}}});
    vm.runInContext(ws.bootScript({}).replace(/^<script>/,'').replace(/<\/script>$/,''),s,{timeout:1000});
    assert.equal(local.getItem('ryza.old'),'stale');
    record('T10','risk-reproduced',{diskProfile:{},cachedProfile:local.d,meaning:'Empty disk snapshot does not clear an existing Chromium cache; persistent erase/restore semantics need a durable empty-generation marker.'});
  }
  {
    const {proxyTargetAllowed}=require(path.join(SOURCE,'desktop/proxy-target.js'));
    const matrix=['https://example.invalid/v1','http://127.0.0.1:11434/v1','http://localhost:1234','http://[::1]:50021','http://192.168.1.1','http://127.0.0.1.evil.invalid','file:///tmp/nope'].map(url=>({url,allowed:proxyTargetAllowed(url)}));
    assert.deepEqual(matrix.map(x=>x.allowed),[true,true,true,true,false,false,false]); record('T11','pass',{matrix,meaning:'Actual desktop initial-target policy accepts HTTPS and loopback HTTP; no network requested and redirect handling untested.'});
  }
  {
    const s=sandbox(); load(s,'web/js/echo.js'); s.Echo.remember('这是角色刚刚说过的一段测试文本',1000);
    assert.equal(s.Echo.looksLikeEcho('这是角色刚刚说过的一段测试文本',2000),true); assert.equal(s.Echo.looksLikeEcho('这是角色刚刚说过的一段测试文本',22001),false);
    record('T12','pass',{exactEchoWithinWindow:true,expiredEcho:false,meaning:'Actual echo pure algorithm passes exact text and expiry checks; no physical AEC, language quality or false-positive measurement.'});
  }
  {
    const native=new Map(),s=sandbox({VoiceBank:{pick(){return '';}}}); load(s,'web/js/alarm.js');
    // Faithful model of RyzaAlarm.schedule: upsert all supplied ids; omitted ids are untouched.
    s.Alarm.setNative({isSupported(){return true;},schedule(json){for(const a of JSON.parse(json)) native.set(a.id,a);},list(){return JSON.stringify([...native.values()]);},cancel(id){native.delete(id);},cancelAll(){native.clear();}});
    const alarm={time:'08:00',type:'goodMorning'}; s.Alarm.add(alarm); const id=alarm.id; s.Alarm.remove(id);
    assert.equal(s.Alarm.items.length,0); assert.equal(native.has(id),true);
    record('T13','contract-risk-reproduced',{webAlarms:s.Alarm.items.length,nativeAlarms:native.size,meaning:'Actual web Alarm.remove only pushes an upsert array. Java schedule has same upsert semantics; deleted ids require cancel, which web never calls. Native implementation is modeled, not executed on Android.'});
  }
  const output={date:'2026-10-14 Asia/Shanghai',source:SOURCE,networkCalls:0,realModelCalls:0,realMicCalls:0,sourceWrites:0,checks:results.length,results};
  fs.writeFileSync(path.join(OUT,'isolated-results.json'),JSON.stringify(output,null,2)); console.log(JSON.stringify(output,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
