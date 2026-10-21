import { writeFileSync } from 'node:fs'
import { CdpClient, findDebugTarget, waitFor } from '/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/scripts/lib/remote-debug.ts'
const connect = async predicate => CdpClient.connect((await findDebugTarget(62720,'test window',predicate)).webSocketDebuggerUrl)
async function click(cdp, expression) {
 await waitFor('visible control',async()=>await cdp.evaluate(`!!(${expression})`)||undefined,5000,100)
 await cdp.evaluate(`Promise.allSettled(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished)).then(()=>true)`)
 const rect=await cdp.evaluate(`(()=>{const el=${expression};if(!el)throw Error('missing test control');el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
 await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...rect})
 await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...rect})
}
const main=await connect(t=>t.type==='page'&&t.url.includes('synced-leader=true'))
const reports=[]
const store=`document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('desktop-screen-sharing')`
const byLabel=label=>`document.querySelector('button[aria-label=${JSON.stringify(label)}]')`
try {
 await main.evaluate(`(()=>{const p=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;const v=p._s.get('vision');v.activeProvider='offline-native-fixture';v.activeModel='offline-native-fixture';p._s.get('vision-orchestrator').processCapture=async()=>({text:'SYNTHETIC TEST: Blue square 42',contextUpdates:0});return true})()`)
 await click(main,byLabel('共享屏幕'))
 await waitFor('source choice',async()=>await main.evaluate(`${store}.status === 'choosing' && ${store}.sources.some(s=>s.name==='Aimy Synthetic Screen Test')`)||undefined,15000,100)
 await click(main,`[...document.querySelectorAll('[role="dialog"] button')].find(e=>e.textContent.includes('Aimy Synthetic Screen Test'))`)
 await waitFor('native stage capture',async()=>await main.evaluate(`${store}.status === 'sharing'`)||undefined,15000,100)
 await waitFor('first synthetic frame',async()=>await main.evaluate(`${store}.lastObservedAt!==null`)||undefined,15000,100)
 reports.push(await main.evaluate(`({surface:'stage',status:${store}.status,syntheticSource:${store}.sourceName==='Aimy Synthetic Screen Test'})`))
 await click(main,byLabel('停止共享'))
 await waitFor('stage stop',async()=>await main.evaluate(`${store}.status==='off'`)||undefined,5000,100)
 if(await main.evaluate(`!!document.querySelector('button[aria-label="打开聊天"]')`)) await click(main,byLabel('打开聊天'))
 const chat=await connect(t=>t.type==='page'&&(/#\/chat(?:\?|$)|#\/chat-floating/.test(t.url)))
 try {
  await waitFor('messenger',async()=>await chat.evaluate(`!!document.querySelector('.messenger-view')`)||undefined,15000,100)
  await click(chat,byLabel('共享屏幕'))
  await waitFor('follower source choice',async()=>await chat.evaluate(`${store}.status==='choosing' && ${store}.sources.some(s=>s.name==='Aimy Synthetic Screen Test')`)||undefined,15000,100)
  await click(chat,`[...document.querySelectorAll('[role="dialog"] button')].find(e=>e.textContent.includes('Aimy Synthetic Screen Test'))`)
  await waitFor('native follower capture',async()=>await main.evaluate(`${store}.status==='sharing'`)||undefined,15000,100)
  reports.push(await chat.evaluate(`({surface:'chat',status:${store}.status,syntheticSource:${store}.sourceName==='Aimy Synthetic Screen Test',tabs:[...document.querySelectorAll('.messenger-nav-button')].map(e=>e.textContent.trim())})`))
  await click(chat,byLabel('停止共享'))
  await waitFor('follower stop',async()=>await main.evaluate(`${store}.status==='off'`)||undefined,5000,100)
  const screenshot=await chat.send('Page.captureScreenshot',{format:'png'});writeFileSync('/tmp/aimy-oct20/native/chat-window.png',Buffer.from(screenshot.result.data,'base64'))
 }finally{chat.close()}
 writeFileSync('/tmp/aimy-oct20/native/screen-result.json',JSON.stringify({reports,stopped:true,model:'synthetic processCapture stub; no model request'},null,2));console.log(JSON.stringify({reports,stopped:true}))
}catch(e){console.log(await main.evaluate(`({status:${store}.status,error:${store}.error})`));throw e}finally{main.close()}
