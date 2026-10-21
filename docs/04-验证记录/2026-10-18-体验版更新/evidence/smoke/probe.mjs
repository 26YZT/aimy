import {writeFileSync} from 'node:fs';
import {CdpClient,findDebugTarget,waitFor} from '/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/scripts/lib/remote-debug.ts';
const target=await findDebugTarget(62686,'packaged main',t=>t.type==='page'&&t.url.includes('synced-leader=true'));
const cdp=await CdpClient.connect(target.webSocketDebuggerUrl);
const phase=process.argv[2]??'first';
try {
await waitFor('packaged stores',async()=>await cdp.evaluate(`!!document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('companion-settings')?.ready`)||undefined,30000,200);
const result=await cdp.evaluate(`(async()=>{const globals=document.querySelector('#app').__vue_app__.config.globalProperties;const settings=globals.$pinia._s.get('companion-settings');const runtime=globals.$pinia._s.get('companion-runtime');const before=JSON.parse(JSON.stringify(settings.snapshot));await globals.$router.push('/settings/companion');await new Promise(r=>setTimeout(r,300));let saved=false;if(${JSON.stringify(phase)}==='first'){const next=JSON.parse(JSON.stringify(before.preferences));next.followup.delayMinutes=17;await settings.save(next,before.rules,before.revision);saved=true;}return {route:globals.$router.currentRoute.value.path,headings:[...document.querySelectorAll('h2')].map(e=>e.textContent.trim()),buttons:[...document.querySelectorAll('button')].map(e=>e.textContent.trim()).filter(Boolean),before,after:JSON.parse(JSON.stringify(settings.snapshot)),saved,error:runtime.error};})()`);
writeFileSync(`/tmp/aimy-preview-package-20261018/smoke/${phase}.json`,JSON.stringify(result,null,2));
if(result.route!='/settings/companion'||result.headings.length<5)throw Error('Companion settings not rendered');
if(result.error)throw Error('Companion runtime error');
if(phase==='restart'&&(result.before.preferences.followup.delayMinutes!==17||result.before.revision!==1))throw Error('Settings did not survive restart');
const p=result.after.preferences;
if([p.followup.enabled,p.review.idleEnabled,p.speech.translationEnabled,p.speech.directorEnabled,p.speech.echoFilterEnabled,p.speech.adaptiveSilenceEnabled,p.interaction.enabled].some(Boolean))throw Error('Automatic enhancement unexpectedly enabled');
console.log(JSON.stringify({phase,route:result.route,headings:result.headings,revision:result.after.revision,delayMinutes:p.followup.delayMinutes,allEnhancementsOff:true}));
}finally{cdp.close();}
