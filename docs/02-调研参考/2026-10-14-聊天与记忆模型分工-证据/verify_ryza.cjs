const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = '/Users/mima1234/Documents/资料/拆解项目/ryza-ai-revive-master/web/js';
const captures = [];
const checks = [];
const db = new Map();
let llm = {model:'fake-shared-A',baseUrl:'https://synthetic.invalid/v1',apiKey:'fake-only',historyTurns:4,maxTokens:400};
class FakeXHR {
  open(method,url) { this.url=url; this.method=method; }
  setRequestHeader() {}
  send(body) {
    captures.push({url:this.url,body:JSON.parse(body)});
    this.status=200;
    this.responseText=JSON.stringify({choices:[{message:{content:'{"digest":"synthetic summary","entries":[]}'}}]});
    this.onload();
  }
  abort() { if(this.onabort) this.onabort(); }
}
const sandbox = {
  console, Promise, Date, Math, JSON, setTimeout, clearTimeout,
  XMLHttpRequest: FakeXHR,
  location:{origin:'https://synthetic-ui.invalid'},
  localStorage:{getItem:k=>db.get(k)||null,setItem:(k,v)=>db.set(k,v),removeItem:k=>db.delete(k)},
  Config:{section:k=>k==='llm'?llm:k==='chara'?{name:'Synthetic',traits:[]}:{},llmReady:()=>true,get:()=>undefined},
};
sandbox.window=sandbox;
const ctx=vm.createContext(sandbox);
for (const file of ['api.js','longterm.js']) vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx,{filename:file});
function check(name,condition) {assert(condition,name);checks.push({name,passed:true});}
(async()=>{
  await sandbox.Api.chat([], 'synthetic chat', {standalone:true,lang:'zh'});
  await sandbox.Api.complete('synthetic system','synthetic memory',{});
  check('ryza_chat_and_complete_share_model_and_endpoint',captures[0].body.model==='fake-shared-A'&&captures[1].body.model==='fake-shared-A'&&captures[0].url===captures[1].url);
  check('ryza_shared_model_still_uses_separate_requests_and_prompts',captures.length===2 && JSON.stringify(captures[0].body.messages)!==JSON.stringify(captures[1].body.messages));
  check('ryza_memory_completion_uses_its_own_temperature',captures[1].body.temperature===0.2&&captures[0].body.temperature===0.9);
  await sandbox.Api.complete('synthetic system','synthetic memory',{model:'fake-override'});
  check('ryza_complete_opts_does_not_override_shared_model',captures.at(-1).body.model==='fake-shared-A');
  sandbox.LongTerm.setLLM((sys,body,opts)=>sandbox.Api.complete(sys,body,Object.assign({standalone:true},opts||{})));
  sandbox.LongTerm.note('user','synthetic-only preference');
  const epoch=sandbox.Api.turnEpoch();
  await sandbox.LongTerm.consolidate();
  check('ryza_longterm_host_hook_uses_shared_model',captures.at(-1).body.model==='fake-shared-A'&&captures.at(-1).body.max_tokens===1200);
  check('ryza_background_completion_does_not_allocate_chat_epoch',sandbox.Api.turnEpoch()===epoch);
  llm={...llm,model:'fake-shared-B'};
  await sandbox.Api.chat([], 'synthetic chat', {standalone:true,lang:'zh'});
  await sandbox.Api.complete('synthetic system','synthetic memory',{});
  check('ryza_switching_chat_configuration_also_switches_memory_model',captures.at(-2).body.model==='fake-shared-B'&&captures.at(-1).body.model==='fake-shared-B');
  fs.writeFileSync(path.join(__dirname,'ryza-results.json'),JSON.stringify({kind:'isolated_original_js_with_fake_xhr',real_model_calls:0,real_credentials_read:false,checks,captures,scope:'Original api.js and longterm.js in an empty VM. Synthetic config and XHR only; app wiring reproduced exactly. Not real memory accuracy or app acceptance.'},null,2)+'\n');
  console.log(JSON.stringify({checks:checks.length,passed:true,real_model_calls:0}));
})().catch(e=>{console.error(e);process.exitCode=1});

