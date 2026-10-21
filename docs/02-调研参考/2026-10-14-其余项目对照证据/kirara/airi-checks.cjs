/* Current source transpilation; no compilation/source writes or device/network IO. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const A='/Users/mima1234/Documents/aimy/aimy-app',O='/tmp/aimy-20261014-remaining-kirara';
const ts=require(A+'/node_modules/typescript/lib/typescript.js');
const {createRequire}=require('node:module');const pkgRequire=createRequire(A+'/packages/stage-ui/package.json');
const loaded=[],rows=[],cache=new Map();
function hash(p){return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')}
function record(p,symbol,start,end){loaded.push({path:p,sha256:hash(p),symbol,start,end})}
function transpile(code,name){return ts.transpileModule(code,{fileName:name,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText}
const service=A+'/services/computer-use-mcp/src';
function load(p){
 if(cache.has(p))return cache.get(p).exports;
 if(!p.startsWith(service+'/'))throw Error('outside allowed pure module root: '+p);
 const source=fs.readFileSync(p,'utf8');const m={exports:{}};cache.set(p,m);record(p,'whole transpiled module',1,source.split('\n').length);
 function req(id){if(id==='node:crypto'||id==='node:process')return require(id);if(id==='@moeru/std')return pkgRequire(id);if(!id.startsWith('.'))throw Error('unapproved runtime dependency '+id);return load(path.resolve(path.dirname(p),id)+'.ts')}
 vm.runInThisContext('(function(require,module,exports){'+transpile(source,p)+'\n})',{filename:p})(req,m,m.exports);
 return m.exports;
}
function row(id,kind,got,expected,unit){assert.deepEqual(got,expected,id);rows.push({id,kind,observed:got,expected,assertion_passed:true,original_unit:unit})}
function exprAt(p,find){const s=fs.readFileSync(p,'utf8'),tree=ts.createSourceFile(p,s,ts.ScriptTarget.Latest,true);let found;function walk(n){if(find(n))found=n;ts.forEachChild(n,walk)}walk(tree);assert(found,p);record(p,found.kind+' expression',tree.getLineAndCharacterOfPosition(found.getStart()).line+1,tree.getLineAndCharacterOfPosition(found.end).line+1);return found.getText(tree)}
function evalTS(expr,ctx,p){const code=transpile('const __result = ('+expr+');exports.result=__result;',p);const box={...ctx,exports:{}};vm.runInNewContext(code,box,{filename:p});return box.exports.result}
async function main(){
 const {executeWorkflow,resumeWorkflow}=load(service+'/workflows/engine.ts');const {RunStateManager}=load(service+'/state.ts');
 const workflow={id:'synthetic-two-strings',name:'同输入字符串顺序',description:'fake action sink only',maxRetries:3,steps:[{label:'a',kind:'run_command',description:'first',params:{command:'你好'}},{label:'b',kind:'run_command',description:'second',params:{command:'世界'}}]};
 let calls=[];let sm=new RunStateManager();const executeAction=async(a)=>{calls.push(a.input.command);return {content:[{type:'text',text:'fake IO success'}]}};
 let result=await executeWorkflow({workflow,executeAction,stateManager:sm});
 row('KI-A01','adjacent-positive',[result.status,calls.join('')],['completed','你好世界'],'AIRI original executeWorkflow+RunStateManager+strategy, fake action sink, same strings KI-P01');
 // Simulate a tool refusing the same second input: no native command is run.
 calls=[];sm=new RunStateManager();result=await executeWorkflow({workflow:{...workflow,steps:workflow.steps.map(s=>({...s,critical:true}))},executeAction:async(a)=>{calls.push(a.input.command);return {content:[{type:'text',text:'synthetic denied'}],isError:true}},stateManager:sm});
 row('KI-A02','adjacent-rejection',[result.status,calls],['failed',['你好']],'AIRI critical tool error stops ordered workflow; original engine and real state');
 // Approval pause then reject demonstrates existing continuation, fake approval reply.
 sm=new RunStateManager();result=await executeWorkflow({workflow,executeAction:async()=>({content:[],structuredContent:{status:'approval_required'}}),stateManager:sm});
 row('KI-A03','adjacent-positive',result.status,'paused','AIRI original approval suspension');
 const rejected=await resumeWorkflow({suspension:result.suspension,approved:false,executeAction,stateManager:sm});
 row('KI-A04','adjacent-rejection',rejected.status,'failed','AIRI original resumeWorkflow rejects denied approval');
 const {resolveStepAction}=load(service+'/workflows/types.ts');
 row('KI-A05','bounded-counterexample',resolveStepAction({label:'bad',kind:'type_into',description:'synthetic',params:{text:17}}).input.text,17,'step resolver casts TS types; downstream policy/executor not checked in this case; no generic block port checker claimed');

 // Real installed Zod library + original OpenAI configSchema expression and metadata callback.
 const z=require(A+'/packages/provider-inference/node_modules/zod').z;
 const genPath=A+'/packages/provider-inference/src/generation.ts';const genCode=fs.readFileSync(genPath,'utf8');const genModule={exports:{}};
 vm.runInNewContext(transpile(genCode,genPath),{exports:genModule.exports,URL});record(genPath,'whole transpiled module',1,genCode.split('\n').length);
 const gen=genModule.exports,p=A+'/packages/provider-inference/src/providers/cloud/openai/index.ts';
 const schemaExpr=exprAt(p,n=>ts.isVariableDeclaration(n)&&n.name.getText()==='configSchema').replace(/^configSchema\s*=\s*/,'');
 const configSchema=evalTS(schemaExpr,{z,...gen},p);
 const configFactory=evalTS(exprAt(p,n=>ts.isPropertyAssignment(n)&&n.name.getText()==='createProviderConfig').replace(/^createProviderConfig\s*:\s*/,''),{z,...gen,configSchema},p);
 const schema=configFactory({t:s=>'translated:'+s,config:{api:'responses'}});
 const good=schema.safeParse({apiKey:'SYNTHETIC-NOT-A-CREDENTIAL',webSearch:false});
 row('KI-A06','adjacent-positive',[good.success,good.data.webSearch,good.data.api,good.data.baseUrl],[true,false,'responses','https://api.openai.com/v1'],'AIRI original provider schema same default bool as KI-P04, actual Zod4.4.3, fake t only');
 row('KI-A07','adjacent-positive',[schema.shape.webSearch.meta().type,typeof schema.shape.webSearch.meta().descriptionLocalized,schema.shape.apiKey.meta().type],['boolean','string','password'],'original metadata callback helps settings, existing AIRI capability');
 row('KI-A08','adjacent-rejection',schema.safeParse({apiKey:'SYNTHETIC-NOT-A-CREDENTIAL',webSearch:'false'}).success,false,'actual schema rejects wrong bool; no connectivity validators/model invoked');
 row('KI-A09','adjacent-rejection',schema.safeParse({webSearch:false}).success,false,'actual schema requires synthetic API field');

 // Original Discord MessageCreate callback without constructing adapter or client.
 const dp=A+'/integrations/discord-bot/src/adapters/airi-adapter.ts';
 const normalize=evalTS(exprAt(dp,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='normalizeDiscordMetadata'),{},dp);
 const cbExpr=exprAt(dp,n=>ts.isCallExpression(n)&&n.expression.getText().endsWith('discordClient.on')&&n.arguments[0]?.getText()==='Events.MessageCreate');
 const sent=[],self={discordClient:{user:{id:'synthetic-bot'}},airiClient:{send:e=>sent.push(e)}};
 const cb=evalTS('function(){return ('+cbExpr.slice(cbExpr.indexOf(',')+1,-1)+')}',{normalizeDiscordMetadata:normalize,log:{log(){}},ContextUpdateStrategy:{AppendSelf:'synthetic-AppendSelf-tag'}},dp).call(self);
 const msg=(text,{dm=false,mention=true,bot=false,channel='c1'}={})=>({content:text,author:{id:'u1',username:'synthetic',tag:'synthetic',bot},guild:dm?null:{id:'g1',name:'synthetic-guild'},guildId:dm?null:'g1',channelId:channel,mentions:{has:()=>mention},member:null});
 await cb.call(self,msg('!你好'));row('KI-A10','adjacent-positive',[sent.length,sent[0].data.text,sent[0].data.overrides.sessionId],[1,'!你好','discord-guild-g1'],'original AIRI Discord message gating/normalization/sessionId, fake message+send sink; same text KI-P05');
 await cb.call(self,msg('!你好',{mention:false}));row('KI-A11','adjacent-rejection',sent.length,1,'AIRI group unmentioned ignored; Kirara independently configurable predicates');
 await cb.call(self,msg('!你好',{dm:true,mention:false}));row('KI-A12','adjacent-positive',[sent.length,sent[1].data.overrides.sessionId],[2,'discord-dm-u1'],'AIRI DM session segmentation already present');
 await cb.call(self,msg('!你好',{bot:true}));row('KI-A13','adjacent-rejection',sent.length,2,'AIRI ignores bot authors before reply');
 await cb.call(self,msg('!你好',{channel:'c2'}));row('KI-A14','bounded-counterexample',sent[2].data.overrides.sessionId,sent[0].data.overrides.sessionId,'AIRI current Discord same guild different channels share guild session; source behavior, not a general chat-isolation claim');

 fs.writeFileSync(O+'/airi-results.json',JSON.stringify({runtime:process.version,real_libraries:{typescript:require(A+'/node_modules/typescript/package.json').version,zod:require(A+'/packages/provider-inference/node_modules/zod/package.json').version},fake_boundaries:['executeAction terminal command sink: commands never executed','approval reply fixture','t translation callback','Discord input message/client send sink','ContextUpdateStrategy tag only'],observations:rows},null,2));
 fs.writeFileSync(O+'/executed-airi.json',JSON.stringify(loaded,null,2));console.log(JSON.stringify({observations:rows.length,all_assertions_passed:true,loaded_sources:loaded.length}));
}
main().catch(e=>{console.error(e);process.exitCode=1});
