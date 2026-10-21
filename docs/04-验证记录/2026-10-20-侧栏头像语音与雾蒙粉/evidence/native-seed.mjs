import { writeFileSync } from 'node:fs'
import { CdpClient, findDebugTarget, waitFor } from '/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/scripts/lib/remote-debug.ts'
const target=await findDebugTarget(62720,'isolated Rose check',t=>t.type==='page'&&t.url.includes('synced-leader=true'))
const c=await CdpClient.connect(target.webSocketDebuggerUrl)
try {
 await waitFor('isolated sessions',async()=>await c.evaluate(`!!document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('chat-session')?.activeSessionId`)||undefined,30000,100)
 const receipt=await c.evaluate(`(()=>{
 const p=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
 const s=p._s.get('chat-session'),cards=p._s.get('airi-card'),chat=p._s.get('consciousness');
 chat.activeProvider='openai';chat.activeModel='synthetic-no-request';
 const card=cards.cards.get(cards.activeCardId);if(card)card.name='小晴';
 const id=s.activeSessionId;const rows=[['user','今天有点累，想和你聊一会儿。'],['assistant','回来啦。先把包放下，歇一会儿。'],['user','事情总是一件接一件，好像停不下来。'],['assistant','那现在就先慢下来。你想聊聊今天，还是一起听首歌？'],['user','先陪我聊聊吧。'],['assistant','好呀，我在。今天最让你在意的是什么？']];
 rows.forEach(([role,content],i)=>s.appendSessionMessage(id,{id:'rose-fixture-'+i,role,content,createdAt:Date.now()-120000+i*1000,...(role==='assistant'?{slices:[],tool_results:[]}:{})}));
 return {fixtureMessages:rows.length,modelCalled:false,sessionCreatedInIsolatedProfile:true};
 })()`)
 writeFileSync('/Users/mima1234/Library/Caches/Aimy-Build/Rose-20261020/native-package/seed.json',JSON.stringify(receipt,null,2));console.log(receipt)
}finally{c.close()}
