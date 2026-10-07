/** Real own-WebContents capture only; test source registry never enumerates OS screens. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright'
import { createMediaFixtureServer } from './media-fixtures.mjs'

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const evidenceDirectory = await mkdtemp(join(tmpdir(), 'aimy-screen-smoke-'))
const key = `fake-vision-only-${randomUUID()}`
const keys = { llm: key, asr: 'unused-asr', tts: 'unused-tts' }
const sourceId = 'window:aimy-media-fixture'
const checks = []
const observations = []
const nativeLogs = []
const rendererLogs = []
let current
let server
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
async function eventually(predicate, label, timeout = 30_000) {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (await predicate()) return; await delay(80) }
  throw new Error(`Timed out: ${label}`)
}
function record(check) { checks.push(check); console.log(JSON.stringify({ check, status: 'passed' })) }
const probe = `(() => {
  if(window.__aimyScreenProbe) return;
  const state = { streams: [], requests: [], denials: [], jpegCount: 0, jpegBytes: 0 }; window.__aimyScreenProbe = state;
  const capture = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getDisplayMedia = async function(constraints) {
    state.requests.push({ at: Date.now(), audio: !!constraints.audio, video: !!constraints.video });
    try { const stream = await capture(constraints); state.streams.push(stream); return stream; }
    catch(error) { state.denials.push({ name:error.name, at:Date.now() }); throw error; }
  };
  const encode = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {
    return encode.call(this, blob => { if(blob?.type==='image/jpeg') { state.jpegCount++; state.jpegBytes+=blob.size; } callback(blob); }, ...args);
  };
})()`
async function nativeCapture() {
  return current.page.evaluate(`(() => { const state=window.__aimyScreenProbe; return { requests:state.requests,denials:state.denials,jpegCount:state.jpegCount,jpegBytes:state.jpegBytes,tracks:state.streams.flatMap(s=>s.getTracks().map(t=>({kind:t.kind,readyState:t.readyState}))) }; })()`)
}
async function databases() {
  return current.page.evaluate(async () => {
    const values = []
    for (const description of await indexedDB.databases()) {
      if (!description.name) continue
      const database = await new Promise((resolve, reject) => { const request = indexedDB.open(description.name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
      try { for (const name of database.objectStoreNames) values.push(await new Promise((resolve, reject) => { const request = database.transaction(name).objectStore(name).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })) }
      finally { database.close() }
    }
    return values
  })
}
async function open(name, mode = 'normal') {
  const profile = join(evidenceDirectory, `profile-${name}`)
  await mkdir(profile, { recursive: true, mode: 0o700 })
  server.setMode(mode, name)
  const requestStart = server.records.length
  const electron = await _electron.launch({ executablePath: require('electron'), cwd: appDirectory,
    args: [join(appDirectory, 'out/main/index.js'), '--use-fake-device-for-media-stream'],
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? tmpdir(), LANG: process.env.LANG ?? 'en_US.UTF-8', APP_USER_DATA_PATH: profile, AIMY_TEST_MODE: '1' }, timeout: 30000 })
  electron.process().stdout?.on('data', data => nativeLogs.push(String(data)))
  electron.process().stderr?.on('data', data => nativeLogs.push(String(data)))
  const page = await electron.firstWindow()
  current = { name, profile, electron, page, requestStart }
  page.setDefaultTimeout(15000)
  page.on('console', message => rendererLogs.push(message.text()))
  page.on('pageerror', error => rendererLogs.push(error.message))
  await page.addInitScript(probe); await page.evaluate(probe)
  const conditions = await electron.evaluate(({ app, BrowserWindow }) => ({ path: app.getPath('userData'), temporaryRoot: app.getPath('temp'), test: process.env.AIMY_TEST_MODE, fakeDevice: app.commandLine.hasSwitch('use-fake-device-for-media-stream'), fakeUi: app.commandLine.hasSwitch('use-fake-ui-for-media-stream'), noSandbox: app.commandLine.hasSwitch('no-sandbox'), sandbox: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().sandbox }))
  assert.equal(conditions.path, profile); assert.equal(conditions.test, '1'); assert.equal(conditions.fakeDevice, true); assert.equal(conditions.fakeUi, false); assert.equal(conditions.noSandbox, false); assert.equal(conditions.sandbox, true)
  assert(profile.startsWith(tmpdir()), 'Test-only own-window registry conditions must hold before opening source picker')
  await page.getByTestId('aimy-app').waitFor({ state: 'visible' })
  await eventually(() => page.getByTestId('conversation').getAttribute('data-ready').then(value => value === 'true'), 'local conversation ready')
  assert.equal((await page.evaluate(() => window.aimy.getMediaState())).screen.enabled, false)
  assert.equal(server.records.length, requestStart)
  await page.getByTestId('open-settings').click()
  await page.getByTestId('settings-tab-chat').click()
  await page.getByTestId('settings-endpoint').fill(server.baseUrl)
  await page.getByTestId('settings-model').fill('fixture-chat-model')
  await page.getByTestId('settings-vision-model').fill('fixture-vision-model')
  await page.getByTestId('settings-key').fill(key)
  await page.getByTestId('settings-save').click()
  await page.getByTestId('settings-message').waitFor({ state: 'visible' })
  assert.equal(await page.getByTestId('settings-key').inputValue(), '')
  await page.getByRole('button', { name: '关闭设置' }).click()
  await eventually(() => page.getByTestId('avatar-stage').getAttribute('data-state').then(value => value === 'mounted'), 'actual own-window VRM content ready', 60000)
}
function requests() { return server.records.slice(current.requestStart) }
async function share() {
  await current.page.getByTestId('screen-status').click()
  await current.page.getByTestId('screen-picker').waitFor({ state: 'visible' })
  await eventually(() => current.page.getByTestId('screen-source').count().then(value => value > 0), 'test source registry ready')
  const identifiers = await current.page.getByTestId('screen-source').evaluateAll(elements => elements.map(element => element.dataset.sourceId))
  assert.deepEqual(identifiers, [sourceId], 'Fake-mode registry must only contain the test-owned WebContents; no OS screen enumeration')
  await current.page.locator(`[data-testid="screen-source"][data-source-id="${sourceId}"]`).click()
  await eventually(() => current.page.getByTestId('screen-status').getAttribute('aria-pressed').then(value => value === 'true'), 'explicit own-frame sharing enabled')
  await eventually(async () => {
    const state = await nativeCapture()
    if (state.denials.length) throw new Error(`Native own-frame getDisplayMedia denied: ${state.denials.at(-1).name}`)
    return state.tracks.some(track => track.kind === 'video' && track.readyState === 'live')
  }, 'actual own-frame video stream returned')
}
async function off() {
  await current.page.getByTestId('screen-status').click()
  await eventually(() => current.page.getByTestId('screen-status').getAttribute('aria-pressed').then(value => value === 'false'), 'screen disabled')
  assert((await nativeCapture()).tracks.every(track => track.readyState === 'ended'), 'All real own-window video tracks must stop')
}
async function close() {
  if (!current) return
  const owned = current; current = undefined
  let timer
  const cutoff = new Promise((_resolve, reject) => { timer = setTimeout(() => { owned.electron.process().kill('SIGKILL'); reject(new Error('Owned screen test did not close gracefully')) }, 7000) })
  try { await Promise.race([owned.electron.close(), cutoff]) } finally { clearTimeout(timer) }
}

try {
  server = await createMediaFixtureServer(keys)
  await open('normal')
  assert.equal((await nativeCapture()).requests.length, 0)
  await share()
  await eventually(() => requests().some(request => request.kind === 'vision' && request.finished), 'real Canvas JPEG reached actual Vision SDK')
  await eventually(() => current.page.getByTestId('message-assistant').allTextContents().then(texts => texts.some(text => text.includes('画面里是 Aimy'))), 'authorized observation text persisted')
  await off()
  assert.equal(requests().length, 1, 'One interpretation must not invoke a second chat model')
  const image = requests()[0]
  assert.equal(image.kind, 'vision'); assert.equal(image.model, 'fixture-vision-model'); assert.equal(image.jpegValid, true)
  const captured = await nativeCapture()
  assert(captured.jpegCount >= 1 && captured.jpegBytes > 1000)
  assert(captured.requests.every(request => request.video && !request.audio))
  assert(captured.tracks.every(track => track.kind === 'video'))
  const persisted = JSON.stringify(await databases())
  assert.equal(persisted.includes('data:image/'), false)
  assert.equal(persisted.includes('imageBase64'), false)
  assert.equal(persisted.includes(key), false)
  observations.push({ case: 'normal', ...captured })
  await current.page.screenshot({ path: join(evidenceDirectory, 'own-window-observation.png'), fullPage: true })
  await close()
  record('Actual own-frame getDisplayMedia → real Canvas JPEG → real Vision SDK → one authorized observation; no second LLM and no image in IndexedDB')

  for (const action of ['off', 'hide', 'reload', 'quit']) {
    await open(`late-${action}`, 'slow-vision')
    await share()
    await eventually(() => requests().some(request => request.kind === 'vision' && request.imageBytes), 'pending own-window Vision request')
    const pending = requests()[0]
    const owned = current
    if (action === 'off') await off()
    else if (action === 'hide') { await current.page.getByTestId('hide-window').click(); assert((await nativeCapture()).tracks.every(track => track.readyState === 'ended')); await current.electron.evaluate(({ app }) => app.emit('activate')) }
    else if (action === 'reload') { await current.page.reload(); await eventually(() => current.page.getByTestId('conversation').getAttribute('data-ready').then(value => value === 'true'), 'reload ready') }
    else { const exited = current.electron.waitForEvent('close', { timeout:15000 }); await current.page.getByTestId('quit-window').click().catch(error => { if (!current.page.isClosed()) throw error }); await exited; current = undefined }
    const count = server.records.length
    await delay(6000)
    assert.equal(pending.aborted, true); assert.equal(server.records.length, count)
    if (current) { assert.equal((await current.page.evaluate(() => window.aimy.getMediaState())).screen.enabled, false); assert.equal(await current.page.getByTestId('message-assistant').count(), 0); assert.equal(JSON.stringify(await databases()).includes('画面里是 Aimy'), false); await close() }
    observations.push({ case: `late-${action}`, profile: owned.profile, requestAborted: pending.aborted })
    record(`${action}: actual video stops, Vision request aborts, late observation cannot publish and sharing does not reopen`)
  }

  await open('commit-revoke')
  await current.page.evaluate(`(() => {
    window.__aimyScreenProbe.heldWrites=0;
    const nativePut=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(...args) {
      const request=nativePut.apply(this,args); const store=this; const deadline=performance.now()+350;
      window.__aimyScreenProbe.heldWrites++;
      function hold() { const next=store.get('__own_window_commit_keep_alive__'); next.onsuccess=()=>{if(performance.now()<deadline)hold()}; }
      hold(); return request;
    };
  })()`)
  await share()
  await eventually(() => current.page.evaluate(() => window.__aimyScreenProbe.heldWrites > 0), 'actual observation IndexedDB transaction delayed')
  await off()
  await delay(1500)
  assert.equal(await current.page.getByTestId('message-assistant').count(), 0)
  assert.equal(JSON.stringify(await databases()).includes('画面里是 Aimy'), false)
  await current.page.reload()
  await eventually(() => current.page.getByTestId('conversation').getAttribute('data-ready').then(value => value === 'true'), 'rollback survives reload')
  assert.equal(await current.page.getByTestId('message-assistant').count(), 0)
  await close()
  record('Revocation during a delayed real IndexedDB commit rolls back the observation in UI, database and reload')

  await open('permissions')
  const camera = await current.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(`(async()=>{try{const stream=await navigator.mediaDevices.getUserMedia({video:true});stream.getTracks().forEach(t=>t.stop());return 'allowed'}catch(error){return error.name}})()`, true))
  assert.equal(camera, 'NotAllowedError')
  await share()
  const activeCamera = await current.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(`(async()=>{try{const stream=await navigator.mediaDevices.getUserMedia({video:true});stream.getTracks().forEach(t=>t.stop());return 'allowed'}catch(error){return error.name}})()`, true))
  assert.equal(activeCamera, 'NotAllowedError', 'Granting an own-window display surface must not grant camera permission')
  const activeCombined = await current.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(`(async()=>{try{const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:true});stream.getTracks().forEach(t=>t.stop());return 'allowed'}catch(error){return error.name}})()`, true))
  assert.equal(activeCombined, 'NotAllowedError', 'Own-window display grant must not permit combined camera/audio capture')
  const renewed = await current.page.evaluate(id => window.aimy.setMediaState({ kind: 'screen', enabled: true, sourceId: id }), sourceId)
  assert.equal(renewed.ok, true, 'Audio+display negative case must have an otherwise valid selected source')
  const audioDisplay = await current.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(`(async()=>{try{const stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:true});stream.getTracks().forEach(t=>t.stop());return 'allowed'}catch(error){return error.name}})()`, true))
  // Electron 43 documents callback(null) as denial; Chromium returns AbortError.
  assert.equal(audioDisplay, 'AbortError')
  assert((await nativeCapture()).tracks.every(track => track.kind === 'video'), 'The rejected audio+display request must not create an audio track')
  await off()
  await close()
  record('Actual permission handlers reject camera and audio+display requests without fake-ui bypass')

  await open('vision-error', 'vision-error')
  await share()
  await current.page.getByTestId('chat-error').waitFor({ state: 'visible' })
  assert.equal((await current.page.evaluate(() => window.aimy.getMediaState())).screen.enabled, false)
  assert((await nativeCapture()).tracks.every(track => track.readyState === 'ended'))
  await current.page.getByTestId('chat-input').fill('画面服务失败后仍然可以打字。')
  await current.page.getByTestId('send-message').click()
  await eventually(() => current.page.getByTestId('message-assistant').count().then(value => value > 0), 'text fallback after Vision failure')
  await eventually(() => current.page.getByTestId('chat-input').isEnabled(), 'fallback turn settled')
  await close()
  record('Vision failure safely closes the own-window stream and keeps text conversation usable')

  let scannedFiles = 0
  async function inspectFiles(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await inspectFiles(path)
      else if (entry.isFile()) { scannedFiles++; assert.equal((await readFile(path)).includes(Buffer.from(key)), false, 'Fake Vision key persisted in plaintext') }
    }
  }
  for (const entry of await readdir(evidenceDirectory, { withFileTypes: true })) if (entry.isDirectory() && entry.name.startsWith('profile-')) await inspectFiles(join(evidenceDirectory, entry.name))
  assert.equal(nativeLogs.join('').includes(key), false); assert.equal(rendererLogs.join('').includes(key), false)
  assert.equal(nativeLogs.join('').includes('FAKE_INTERNAL_VISION_ERROR'), false); assert.equal(rendererLogs.join('').includes('FAKE_INTERNAL_VISION_ERROR'), false)
  assert.equal(nativeLogs.join('').includes('UnhandledPromiseRejection'), false, 'Legitimate display denial must not create an unhandled Electron rejection')

  const result = { status:'passed',scope:'own-window-screen-suite',evidenceDirectory,checks,observations,requests:server.safeRecords(),scannedFiles,limitations:['Only the test-owned WebContents fake registry source was used; no OS desktopCapturer enumeration or real screen/window capture','Actual native getDisplayMedia, Canvas JPEG, Vision SDK and IndexedDB; provider response is a localhost fixture','Actual macOS screen-recording permission, external applications, system audio and Vision quality remain unverified'] }
  await writeFile(join(evidenceDirectory,'screen-result.json'),JSON.stringify(result,null,2))
  console.log(JSON.stringify({status:result.status,scope:result.scope,evidenceDirectory,checks,requestCount:result.requests.length},null,2))
}
catch(error) {
  await current?.page.screenshot({path:join(evidenceDirectory,'screen-failure.png'),fullPage:true}).catch(()=>{})
  const nativeState=current?await nativeCapture().catch(()=>undefined):undefined
  const clean=text=>String(text).split(key).join('[redacted]').slice(-2500)
  const result={status:'failed',scope:'own-window-screen-suite',evidenceDirectory,checks,reason:clean(error instanceof Error?error.message:'Screen smoke failed'),nativeState,requests:server?.safeRecords(),rendererDiagnostic:clean(rendererLogs.join('\n')),nativeDiagnostic:clean(nativeLogs.join('\n'))}
  await writeFile(join(evidenceDirectory,'screen-result.json'),JSON.stringify(result,null,2));console.error(JSON.stringify(result,null,2));process.exitCode=1
}
finally {await close().catch(()=>{});await server?.close()}
