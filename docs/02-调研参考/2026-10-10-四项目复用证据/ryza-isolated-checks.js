'use strict';
const fs=require('fs');
const vm=require('vm');
const root='/Users/mima1234/Documents/资料/ryza-ai-revive-master/';
const lines=(file,a,b)=>fs.readFileSync(root+file,'utf8').split('\n').slice(a-1,b).join('\n');
(async()=>{
  // Only the already-reviewed functions below are evaluated; no module bootstrap,
  // repository tests, native bridge, network, filesystem or model code is run.
  const sandbox={Math,Number,String,Int16Array,Promise,_pcm:[],_pcmSamples:0,
    PRE_ROLL_MS:700,TRAILING_MS:400,CANDIDATE_SILENCE_MS:300,FRAME_MS:50,
    _rate:16000,_speaking:true,_voicedSince:1,_silentSince:1,_sentAt:0,
    _busy:false,_transcribe:null,_sink:null,notice(){},lang(){return 'zh';},
    wavBlob(frames,rate){sandbox.captured={frames:frames.length,samples:frames.reduce((n,f)=>n+f.length,0),durationMs:frames.reduce((n,f)=>n+f.length,0)*1000/rate};return sandbox.captured;},
    emit(t){sandbox.delivered=t;}};
  vm.createContext(sandbox);
  vm.runInContext(lines('web/js/stt.js',189,225),sandbox,{timeout:1000});
  for(let i=0;i<1000;i++) sandbox.pushFrame(new Int16Array(128),true);
  sandbox.closeUtterance(8000);
  console.log('STT 128-sample input: '+JSON.stringify({retainedFrames:sandbox._pcm.length,...sandbox.captured}));
  sandbox._pcm=[];sandbox._pcmSamples=0;
  for(let i=0;i<100;i++) sandbox.pushFrame(new Int16Array(800),true);
  sandbox.closeUtterance(8000);
  console.log('STT 800-sample input: '+JSON.stringify(sandbox.captured));
  let resolveASR;
  sandbox._transcribe=()=>new Promise(r=>{resolveASR=r;});
  sandbox.closeUtterance(9000);
  await Promise.resolve();
  // Equivalent to teardown's state reset while the request remains in flight.
  sandbox._want=false;sandbox._pcm=[];sandbox._busy=false;
  resolveASR('returned after mic was stopped');
  await Promise.resolve();await Promise.resolve();await Promise.resolve();
  console.log('STT stale response: '+JSON.stringify({want:sandbox._want,delivered:sandbox.delivered}));

  let resolveLLM,inputBody;
  const mem={Promise,JSON,String,state:{digest:'',entries:[],pending:[{role:'user',text:'old fact'}]},
    _llm(_sys,body){inputBody=body;return new Promise(r=>{resolveLLM=r;});},
    nowInfo(){return{iso:'2026-10-10T20:00:00'};},DIALOGUE_MAX:12000,CONSOLIDATE_SYS:'',DIGEST_MAX:1600,
    parseConsolidation(t){return JSON.parse(t);},mergeConsolidation(){},clip(s,n){return s.slice(0,n);},persist(){}};
  vm.createContext(mem);
  let functionText=lines('web/js/longterm.js',277,305).replace(/^\s*consolidate:\s*/, '').replace(/,\s*$/, '');
  vm.runInContext('consolidate=('+functionText+')',mem,{timeout:1000});
  const pending=mem.consolidate();
  mem.state.pending.push({role:'user',text:'new fact while request in flight'});
  resolveLLM('{"entries":[]}');
  await pending;
  console.log('LONGTERM delayed response: '+JSON.stringify({sent:JSON.parse(inputBody).dialogue,pendingAfter:mem.state.pending}));
})().catch(e=>{console.error(e);process.exitCode=1;});
