import {readFileSync,writeFileSync}from'node:fs';import{createHash}from'node:crypto';
import {CdpClient,findDebugTarget}from'/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/scripts/lib/remote-debug.ts';
const mode=process.argv[2]||'save';const base='/Users/mima1234/Library/Caches/Aimy-Build/Rose-20261020/native-package/';
const c=await CdpClient.connect((await findDebugTarget(62720,'isolated rose avatar',t=>t.type==='page'&&t.url.includes('synced-leader=true'))).webSocketDebuggerUrl);
try{
 const data='data:image/png;base64,'+readFileSync('/Users/mima1234/Documents/aimy/docs/05-实施手册/2026-10-20-侧栏头像语音与雾蒙粉/颜色参考.png').toString('base64');
 if(mode==='save')await c.evaluate(`(async()=>{const p=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;const s=p._s.get('airi-card');await s.updateCardAvatar({cardId:s.activeCardId,ownerId:'local',activeCardId:s.activeCardId,expectedAvatar:s.activeCard?.metadata?.avatar??null,avatar:${JSON.stringify(data)},requestId:crypto.randomUUID(),requestedAt:Date.now()});return true})()`);
 const r=await c.evaluate(`(()=>{const p=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;const s=p._s.get('airi-card');const image=s.activeCard?.metadata?.avatar;return {avatar:image,cardId:s.activeCardId,theme:document.documentElement.className,accent:getComputedStyle(document.documentElement).getPropertyValue('--aimy-accent'),voice:p._s.get('voice-controls')?.snapshot}})()`);
 const receipt={mode,cardId:r.cardId,avatarMatches:r.avatar===data,avatarSha256:createHash('sha256').update(r.avatar||'').digest('hex'),theme:r.theme,accent:r.accent,voice:r.voice};if(!receipt.avatarMatches)throw Error('Avatar mismatch');
 writeFileSync(base+'avatar-'+mode+'.json',JSON.stringify(receipt,null,2));console.log(receipt);
}finally{c.close()}
