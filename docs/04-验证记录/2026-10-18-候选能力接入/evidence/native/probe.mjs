import {writeFileSync} from 'node:fs';
import {CdpClient} from '/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/scripts/lib/remote-debug.ts';
const targets=await (await fetch('http://127.0.0.1:62665/json/list')).json();
const target=targets.find(t=>t.type==='page'&&t.url.includes('synced-leader=true#/'));
if(!target?.webSocketDebuggerUrl)throw Error('MAIN_TARGET_MISSING');
const cdp=await CdpClient.connect(target.webSocketDebuggerUrl);
try {
const result=await cdp.evaluate(`(async()=>{const app=document.querySelector('#app')?.__vue_app__;const global=app?.config.globalProperties;const pinia=global?.$pinia;const router=global?.$router;const settings=pinia?._s.get('companion-settings');const runtime=pinia?._s.get('companion-runtime');const resolved=router?.resolve('/settings/companion');const component=resolved?.matched.at(-1)?.components?.default;const loaded=typeof component==='function'?await component():undefined;return {title:document.title,mainRoute:router?.currentRoute.value.path,appMounted:!!app,canvasCount:document.querySelectorAll('canvas').length,routeRegistered:!!resolved?.matched.length,routePaths:resolved?.matched.map(r=>r.path),lazyComponentLoaded:!!loaded?.default,settingsReady:settings?.ready,settingsRevision:settings?.snapshot.revision,preferences:JSON.parse(JSON.stringify(settings?.snapshot.preferences)),runtime:{plans:runtime?.plans.length,reviews:runtime?.reviews.length,error:runtime?.error},passwordFields:document.querySelectorAll('input[type=password]').length,bodyExcerpt:document.body.innerText.slice(0,500)}})()`);
writeFileSync('/tmp/aimy-round2-native-smoke/probe.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
}finally{cdp.close()}
