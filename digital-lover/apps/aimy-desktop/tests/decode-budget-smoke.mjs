/** Native decode ownership across multiple cancelled generations; no input device. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright'
import { createMediaFixtureServer } from './media-fixtures.mjs'

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const evidenceDirectory = await mkdtemp(join(tmpdir(), 'aimy-decode-budget-'))
const profile = join(evidenceDirectory, 'profile')
const keys = { llm:`fake-budget-chat-${randomUUID()}`, tts:`fake-budget-tts-${randomUUID()}`, asr:'unused' }
const checks=[]
let electron;let server
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function eventually(predicate,label,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await delay(60)}throw new Error(`Timed out: ${label}`)}
try {
  await mkdir(profile,{recursive:true,mode:0o700})
  server=await createMediaFixtureServer(keys);server.setMode('normal','decode-budget')
  electron=await _electron.launch({executablePath:require('electron'),cwd:appDirectory,args:[join(appDirectory,'out/main/index.js'),'--use-fake-device-for-media-stream'],env:{PATH:process.env.PATH??'',HOME:process.env.HOME??'',TMPDIR:process.env.TMPDIR??tmpdir(),LANG:process.env.LANG??'en_US.UTF-8',APP_USER_DATA_PATH:profile,AIMY_TEST_MODE:'1'},timeout:30000})
  const page=await electron.firstWindow();page.setDefaultTimeout(15000)
  await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true))
  await eventually(()=>page.getByTestId('conversation').getAttribute('data-ready').then(value=>value==='true'),'local session ready')
  await page.getByTestId('open-settings').click()
  for(const [tab,kind]of[['chat','llm'],['tts','tts']]){
    await page.getByTestId(`settings-tab-${tab}`).click();await page.getByTestId('settings-endpoint').fill(server.baseUrl);await page.getByTestId('settings-model').fill(`fixture-${kind}-model`)
    if(kind==='tts')await page.getByTestId('settings-voice').fill('fixture-voice')
    await page.getByTestId('settings-key').fill(keys[kind]);await page.getByTestId('settings-save').click();await page.getByTestId('settings-message').waitFor({state:'visible'})
    assert.equal(await page.getByTestId('settings-key').inputValue(),'')
  }
  await page.getByRole('button',{name:'关闭设置'}).click()
  await page.evaluate(`(() => {
    const state={calls:0,pending:0,maxPending:0,starts:[],held:[]};window.__aimyBudgetProbe=state;
    const decode=BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData=function(...args){
      state.calls++;state.pending++;state.maxPending=Math.max(state.maxPending,state.pending);
      const ordinal=state.calls;
      return decode.apply(this,args).then(audio=>ordinal<=2?new Promise(resolve=>state.held.push(()=>resolve(audio))):audio).finally(()=>state.pending--);
    };
    const start=AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start=function(...args){const value=start.apply(this,args);state.starts.push({at:Date.now(),durationMs:(this.buffer?.duration||0)*1000});return value;};
  })()`)
  await page.getByTestId('speech-status').click()
  const send=async text=>{await page.getByTestId('chat-input').fill(text);await page.getByTestId('send-message').click();await eventually(()=>page.getByTestId('chat-input').isEnabled(),'typed turn complete')}
  await send('第一轮只测试原生解码占用。')
  await eventually(()=>page.evaluate(()=>window.__aimyBudgetProbe.held.length===2),'two real decodes completed with notifications held')
  for(let generation=0;generation<3;generation++){
    await page.getByTestId('speech-status').click();await page.getByTestId('speech-status').click()
    await send(`新的取消代次 ${generation} 仍应受到全局解码限制。`)
    await delay(500)
    const state=await page.evaluate(()=>({calls:window.__aimyBudgetProbe.calls,pending:window.__aimyBudgetProbe.pending,starts:window.__aimyBudgetProbe.starts}))
    assert.equal(state.calls,2,'Cancellation must not clear ownership of unsettled native decoder promises')
    assert.equal(state.pending,2);assert.equal(state.starts.length,0)
  }
  checks.push('Three cancelled generations retain the original two native decode reservations; no third decode and no stale playback')
  await page.evaluate(()=>{const state=window.__aimyBudgetProbe;for(const resolve of state.held.splice(0))resolve()})
  await eventually(()=>page.evaluate(()=>window.__aimyBudgetProbe.pending===0),'old native decoder notifications settle')
  assert.equal(await page.evaluate(()=>window.__aimyBudgetProbe.starts.length),0)
  await send('旧的解码已经释放，现在可以正常朗读。')
  await eventually(()=>page.evaluate(()=>window.__aimyBudgetProbe.starts.length>0),'fresh turn actually starts native audio')
  await eventually(()=>page.getByTestId('conversation').getAttribute('data-speaking').then(value=>value==='false'),'fresh native playback settles')
  const native=await page.evaluate(()=>({calls:window.__aimyBudgetProbe.calls,pending:window.__aimyBudgetProbe.pending,maxPending:window.__aimyBudgetProbe.maxPending,starts:window.__aimyBudgetProbe.starts}))
  assert(native.maxPending<=2)
  checks.push('Settling old decodes releases physical reservations; a new typed turn successfully decodes and plays real audio')
  const media=await page.evaluate(()=>window.aimy.getMediaState());assert.equal(media.mic.enabled,false);assert.equal(media.screen.enabled,false)
  await page.screenshot({path:join(evidenceDirectory,'decode-budget-recovery.png'),fullPage:true})
  await electron.close();electron=undefined
  const result={status:'passed',scope:'native-decode-budget',evidenceDirectory,checks,native,requests:server.safeRecords(),limitations:['Real native decode runs; only completion notifications of its first two promises are artificially held','No microphone or screen input; localhost fake LLM/TTS and muted output','This focused check supplements, rather than replaces, the full D1 media suite']}
  await writeFile(join(evidenceDirectory,'budget-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}catch(error){
  const page=electron?.windows()[0];await page?.screenshot({path:join(evidenceDirectory,'budget-failure.png'),fullPage:true}).catch(()=>{})
  const native=page?await page.evaluate(()=>({calls:window.__aimyBudgetProbe?.calls,pending:window.__aimyBudgetProbe?.pending,maxPending:window.__aimyBudgetProbe?.maxPending,starts:window.__aimyBudgetProbe?.starts})).catch(()=>undefined):undefined
  const reason=Object.values(keys).reduce((value,key)=>value.split(key).join('[redacted]'),error instanceof Error?error.message:'Budget smoke failed')
  const result={status:'failed',scope:'native-decode-budget',evidenceDirectory,checks,reason,native,requests:server?.safeRecords()};await writeFile(join(evidenceDirectory,'budget-result.json'),JSON.stringify(result,null,2));console.error(JSON.stringify(result,null,2));process.exitCode=1
}finally{if(electron){const owned=electron;const timer=setTimeout(()=>owned.process().kill('SIGKILL'),7000);await owned.close().catch(()=>{});clearTimeout(timer)}await server?.close()}
