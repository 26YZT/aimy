/** Real Silero/AudioWorklet/WebAudio + file fake microphone + localhost SDKs. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright'
import { createMediaFixtureServer, createOfflineAudioFixtures, toneWav } from './media-fixtures.mjs'

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const evidenceDirectory = await mkdtemp(join(tmpdir(), 'aimy-media-smoke-'))
const keys = Object.fromEntries(['llm', 'asr', 'tts'].map(kind => [kind, `fake-${kind}-only-${randomUUID()}`]))
const checks = []
const observations = []
const nativeLogs = []
const rendererLogs = []
const externalRendererRequests = []
const onlyConversation = process.argv.includes('--conversation-only')
let current
let server
let fixtures
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
async function eventually(predicate, label, timeout = 30_000) {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (await predicate()) return; await delay(80) }
  throw new Error(`Timed out: ${label}`)
}
function record(check) { checks.push(check); console.log(JSON.stringify({ check, status: 'passed' })) }
const redact = text => Object.values(keys).reduce((result, key) => result.split(key).join('[redacted]'), String(text)).replace(/data:[^\s'"]+;base64,[A-Za-z0-9+/=]+/gu, 'data:[local-asset]').slice(-2500)

// Forward native APIs without replacing the real device, detector, decode or playback.
const probe = `(() => {
  if (window.__aimyNativeMediaProbe) return;
  const state = { streams: [], events: [], controls: [], mediaSnapshots: [], getUserMediaCalls: [], decoded: 0, decodeFailures: 0, vadFrames: 0, maxInputRms: 0 };
  window.__aimyNativeMediaProbe = state;
  if(window.aimy?.onMediaState) window.aimy.onMediaState(next => state.mediaSnapshots.push({ at:Date.now(), revision:next.revision, mic:next.mic.enabled, speech:next.speech.enabled, screen:next.screen.enabled }));
  window.addEventListener('click', event => {
    const control=event.target?.closest?.('[data-testid="microphone-status"],[data-testid="speech-status"]');
    if(control) state.controls.push({ type:'click',at:Date.now(),control:control.dataset.testid,pressed:control.getAttribute('aria-pressed') });
  },true);
  new MutationObserver(records => {
    if(records.some(record=>record.target.matches?.('[data-testid="conversation"],[data-testid="microphone-status"],[data-testid="speech-status"]'))) {
      const panel=document.querySelector('[data-testid="conversation"]');
      state.controls.push({type:'dom',at:Date.now(),vad:panel?.dataset.vad,listening:panel?.dataset.listening,speaking:panel?.dataset.speaking,mic:document.querySelector('[data-testid="microphone-status"]')?.getAttribute('aria-pressed'),speech:document.querySelector('[data-testid="speech-status"]')?.getAttribute('aria-pressed')});
    }
  }).observe(document,{subtree:true,attributes:true,attributeFilter:['data-vad','data-listening','data-speaking','aria-pressed']});
  const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async function(constraints) {
    state.getUserMediaCalls.push({ at: Date.now(), audio: !!constraints.audio, video: !!constraints.video });
    const stream = await gum(constraints); state.streams.push(stream); return stream;
  };
  const NativeWorklet = window.AudioWorkletNode;
  window.AudioWorkletNode = new Proxy(NativeWorklet, { construct(target, args, newTarget) {
    const node = Reflect.construct(target, args, newTarget);
    if (String(args[1]).includes('vad')) {
      node.port.addEventListener('message', event => {
        const samples = event.data?.buffer;
        if (samples?.length) { state.vadFrames++; let sum = 0; for (let index = 0; index < samples.length; index++) sum += samples[index] ** 2; state.maxInputRms = Math.max(state.maxInputRms, Math.sqrt(sum / samples.length)); }
      }); node.port.start();
    }
    return node;
  } });
  const ids = new WeakMap(); let id = 0;
  const identify = source => { if (!ids.has(source)) ids.set(source, ++id); return ids.get(source); };
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function(...args) {
    const result = start.apply(this, args); const nodeId = identify(this); const buffer = this.buffer;
    let rms = 0, crossings = 0, frequency = 0;
    if (buffer) { const samples = buffer.getChannelData(0); const count = Math.min(samples.length, Math.round(buffer.sampleRate * .2));
      for (let i = 0; i < count; i++) { rms += samples[i] ** 2; if (i && samples[i - 1] <= 0 && samples[i] > 0) crossings++; }
      rms = Math.sqrt(rms / Math.max(1, count)); frequency = crossings / (count / buffer.sampleRate);
    }
    state.events.push({ type: 'start', id: nodeId, at: Date.now(), durationMs: (buffer?.duration || 0) * 1000, rms, frequency });
    this.addEventListener('ended', () => state.events.push({ type: 'ended', id: nodeId, at: Date.now() }), { once: true }); return result;
  };
  const stop = AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.stop = function(...args) { const result = stop.apply(this, args); state.events.push({ type: 'stop', id: identify(this), at: Date.now() }); return result; };
  const decode = BaseAudioContext.prototype.decodeAudioData;
  BaseAudioContext.prototype.decodeAudioData = function(...args) { const result = decode.apply(this, args); if (result?.then) result.then(() => state.decoded++, () => state.decodeFailures++); return result; };
})()`
async function capture() {
  return current.page.evaluate(`(() => { const p = window.__aimyNativeMediaProbe; return { events: p.events, controls:p.controls,mediaSnapshots:p.mediaSnapshots,decoded: p.decoded, decodeFailures: p.decodeFailures, vadFrames: p.vadFrames, maxInputRms: p.maxInputRms, getUserMediaCalls: p.getUserMediaCalls, tracks: p.streams.flatMap(s => s.getTracks().map(t => ({ kind: t.kind, readyState: t.readyState }))) }; })()`)
}
function caseRequests() { return server.records.slice(current.requestStart) }
async function open(name, audioName = 'single', mode = 'normal', configure = true) {
  server.setMode(mode, name)
  const requestStart = server.records.length
  const profile = join(evidenceDirectory, `profile-${name}`)
  await mkdir(profile, { recursive: true, mode: 0o700 })
  const electron = await _electron.launch({
    executablePath: require('electron'), cwd: appDirectory,
    args: [join(appDirectory, 'out/main/index.js'), '--disable-features=AudioServiceSandbox', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${fixtures.files[audioName].path}%noloop`, '--autoplay-policy=no-user-gesture-required'],
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? tmpdir(), LANG: process.env.LANG ?? 'en_US.UTF-8', APP_USER_DATA_PATH: profile, AIMY_TEST_MODE: '1' }, timeout: 30_000,
  })
  electron.process().stdout?.on('data', data => nativeLogs.push(String(data)))
  electron.process().stderr?.on('data', data => nativeLogs.push(String(data)))
  const page = await electron.firstWindow()
  current = { name, profile, electron, page, requestStart, nativeLogStart: nativeLogs.length }
  page.setDefaultTimeout(15_000)
  page.on('console', message => rendererLogs.push(message.text()))
  page.on('pageerror', error => rendererLogs.push(error.message))
  page.on('request', request => { if (/^https?:/u.test(request.url()) && new URL(request.url()).hostname !== '127.0.0.1') externalRendererRequests.push(request.url()) })
  await page.addInitScript(probe)
  await page.evaluate(probe)
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true))
  const protection = await electron.evaluate(({ app, BrowserWindow, safeStorage }) => {
    const preferences = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
    return { sandbox: preferences.sandbox, contextIsolation: preferences.contextIsolation, nodeIntegration: preferences.nodeIntegration, globalNoSandbox: app.commandLine.hasSwitch('no-sandbox'), audioUtilitySandboxDisabled: app.commandLine.getSwitchValue('disable-features').split(',').includes('AudioServiceSandbox'), mockKeychain: app.commandLine.hasSwitch('use-mock-keychain'), encryptionAvailable: safeStorage.isEncryptionAvailable() }
  })
  assert.equal(protection.sandbox, true); assert.equal(protection.contextIsolation, true); assert.equal(protection.nodeIntegration, false)
  assert.equal(protection.globalNoSandbox, false); assert.equal(protection.audioUtilitySandboxDisabled, true)
  observations.push({ case: name, nativeProtection: protection })
  await page.getByTestId('aimy-app').waitFor({ state: 'visible' })
  await eventually(() => page.getByTestId('conversation').getAttribute('data-ready').then(value => value === 'true'), 'local conversation ready')
  const state = await page.evaluate(() => window.aimy.getMediaState())
  assert(Number.isSafeInteger(state.revision) && state.revision >= 0, 'Media revisions must be nonnegative safe integers')
  assert(['mic', 'screen', 'speech'].every(kind => state[kind].enabled === false), 'All capabilities must start disabled')
  assert.equal(caseRequests().length, 0)
  assert.equal((await capture()).getUserMediaCalls.length, 0)
  if (configure) await configureServices(page)
  return current
}
async function configureServices(page) {
  await page.getByTestId('open-settings').click()
  for (const [tab, kind] of [['chat', 'llm'], ['asr', 'asr'], ['tts', 'tts']]) {
    await page.getByTestId(`settings-tab-${tab}`).click()
    await page.getByTestId('settings-endpoint').fill(server.baseUrl)
    await page.getByTestId('settings-model').fill(`fixture-${kind}-model`)
    if (kind === 'tts') await page.getByTestId('settings-voice').fill('fixture-voice')
    await page.getByTestId('settings-key').fill(keys[kind])
    await page.getByTestId('settings-save').click()
    await page.getByTestId('settings-message').waitFor({ state: 'visible' })
    await eventually(() => page.getByTestId('settings-key').inputValue().then(value => value === ''), 'capability key input cleared')
  }
  await page.getByRole('button', { name: '关闭设置' }).click()
  const settings = await page.evaluate(() => window.aimy.getSettings())
  assert(settings.configured && settings.asr?.configured && settings.tts?.configured)
  assert.equal(Object.values(keys).some(key => JSON.stringify(settings).includes(key)), false)
}
async function enableMic(speech = false) {
  if (speech) await current.page.getByTestId('speech-status').click()
  await current.page.getByTestId('microphone-status').click()
  await eventually(() => current.page.getByTestId('conversation').getAttribute('data-vad').then(value => value === 'ready'), 'real local Silero ready', 60_000)
  await delay(120)
  assert(!nativeLogs.slice(current.nativeLogStart).join('').match(/Failed to read .*input to the fake device/u), 'Chromium could not read the authorized fake WAV; silence assertions would be invalid')
  assert.equal(await current.page.getByTestId('conversation').getAttribute('data-listening'), 'true')
  assert((await capture()).tracks.some(track => track.kind === 'audio' && track.readyState === 'live'))
}
async function close() {
  if (!current) return
  const owned = current
  current = undefined
  let timer
  const cutoff = new Promise((_resolve, reject) => { timer = setTimeout(() => { owned.electron.process().kill('SIGKILL'); reject(new Error('Owned media test Electron failed to close gracefully')) }, 7000) })
  try { await Promise.race([owned.electron.close(), cutoff]) } finally { clearTimeout(timer) }
}
async function assertOff() {
  const state = await current.page.evaluate(() => window.aimy.getMediaState())
  assert.equal(state.mic.enabled, false)
  const data = await capture()
  assert(data.tracks.every(track => track.readyState === 'ended'), 'All caller-owned input tracks must stop')
  assert.equal(await current.page.getByTestId('conversation').getAttribute('data-listening'), 'false')
}
async function secretsProtected() {
  const data = await current.page.evaluate(async () => {
    const databaseData = []
    for (const description of await indexedDB.databases()) {
      if (!description.name) continue
      const database = await new Promise((resolve, reject) => { const request = indexedDB.open(description.name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
      try { for (const name of database.objectStoreNames) databaseData.push(await new Promise((resolve, reject) => { const request = database.transaction(name).objectStore(name).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })) }
      finally { database.close() }
    }
    return { settings: await window.aimy.getSettings(), local: { ...localStorage }, session: { ...sessionStorage }, databaseData, dom: document.body.innerHTML, inputs: [...document.querySelectorAll('input')].map(input => input.value) }
  })
  for (const key of Object.values(keys)) assert.equal(JSON.stringify(data).includes(key), false, 'Independent fake service key leaked into renderer')
}
async function textFallback() {
  await current.page.getByTestId('chat-input').fill('文字回退仍然可以使用。')
  await current.page.getByTestId('send-message').click()
  await eventually(() => current.page.getByTestId('message-assistant').count().then(value => value > 0), 'text fallback reply')
  await eventually(() => current.page.getByTestId('chat-input').isEnabled(), 'text fallback settled')
}

try {
  fixtures = await createOfflineAudioFixtures(join(evidenceDirectory, 'public-fixtures'))
  server = await createMediaFixtureServer(keys)
  if (!onlyConversation) {
  await open('default', 'silence', 'normal', false)
  await delay(500)
  assert.equal(caseRequests().length, 0)
  assert.equal((await capture()).getUserMediaCalls.length, 0)
  await close()
  record('Default app opens no input device and sends no provider request')

  await open('ipc-authority', 'silence')
  await enableMic(true)
  const authority = await current.page.evaluate(async () => {
    const media = await window.aimy.getMediaState()
    const voice = await window.aimy.send({ requestId: crypto.randomUUID(), sessionId: 'invalid-receipt-case', messages: [], text: 'This voice text was never transcribed.', source: 'voice', captureToken: media.mic.token, receiptId: 'never-issued' })
    const tts = await window.aimy.synthesize({ requestId: crypto.randomUUID(), token: media.speech.token, turnId: 'never-generated', text: 'This speech was never generated by the main process.' })
    return { voice: voice.status, tts: tts.status, staleToken: media.mic.token }
  })
  assert(['failed', 'cancelled'].includes(authority.voice))
  assert(['failed', 'cancelled'].includes(authority.tts))
  assert.equal(caseRequests().length, 0, 'Missing receipt or arbitrary TTS text must not reach a provider')
  await current.page.getByTestId('microphone-status').click()
  await assertOff()
  const rejected = await current.page.evaluate(({ token, audioBase64 }) => window.aimy.transcribe({ requestId: crypto.randomUUID(), token, audioBase64 }), { token: authority.staleToken, audioBase64: toneWav(.1).toString('base64') })
  assert.equal(rejected.status, 'cancelled')
  assert.equal(caseRequests().length, 0)
  await close()
  record('Missing transcript receipt, arbitrary synthesis text and revoked capture token are rejected by real main IPC before any HTTP request')

  for (const name of ['silence', 'pulse']) {
    await open(name, name)
    await enableMic()
    await delay(fixtures.files[name].durationMs + 1000)
    assert((await capture()).vadFrames > 50, 'Real input AudioWorklet must actually deliver frames to the detector')
    assert.equal(caseRequests().length, 0, 'Real Silero must reject silence/very short pulse')
    await current.page.getByTestId('microphone-status').click()
    await assertOff()
    observations.push({ case: name, ...await capture() })
    await close()
    record(`Real bundled Silero initialization and ${name} rejection; actual AudioWorklet/file-backed stream`)
  }
  }

  await open('conversation', 'conversation')
  await enableMic(true)
  await eventually(() => caseRequests().filter(request => request.kind === 'asr' && request.finished).length >= 2, 'two real ASR uploads', 60_000)
  await eventually(() => caseRequests().filter(request => request.kind === 'llm' && request.finished).length >= 2, 'two multi-turn Agent requests', 60_000)
  await eventually(async () => (await capture()).events.filter(event => event.type === 'start').length >= 2 && await current.page.getByTestId('conversation').getAttribute('data-speaking') === 'false', 'real ordered TTS playback settles', 30_000)
  const turns = caseRequests().filter(request => request.kind === 'llm')
  assert.equal(turns[0].userCount, 1); assert.equal(turns[1].userCount, 2)
  assert(caseRequests().filter(request => request.kind === 'asr').every(request => request.nonzeroAudio && request.audioBytes > 1000))
  const playback = await capture()
  const frequencies = playback.events.filter(event => event.type === 'start').map(event => event.frequency)
  assert(frequencies.length >= 2 && frequencies.every(value => value > 0))
  for (let index = 1; index < frequencies.length; index++) assert(frequencies[index] > frequencies[index - 1] - 12, 'Out-of-order TTS completion must retain ordered native playback')
  const permission = await current.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(`(async () => { try { const stream = await navigator.mediaDevices.getUserMedia({audio:true,video:true}); stream.getTracks().forEach(track => track.stop()); return 'allowed'; } catch(error) { return error.name; } })()`, true))
  assert.equal(permission, 'NotAllowedError', 'Combined camera/audio request must be rejected')
  await secretsProtected()
  observations.push({ case: 'conversation', ...playback })
  await current.page.screenshot({ path: join(evidenceDirectory, 'voice-conversation.png'), fullPage: true })
  await close()
  record('Two real Silero segments → SDK ASR → multi-turn Agent → SDK WAV TTS → ordered native playback; camera combination denied')

  if (!onlyConversation) {
  await open('short-barge', 'shortBarge', 'barge')
  await enableMic(true)
  await eventually(async () => (await capture()).events.some(event => event.type === 'start' && event.durationMs >= 4500), 'long output before tiny spoken pulse', 60_000)
  await delay(5600)
  const pulseResult = await capture()
  const pulseLong = pulseResult.events.find(event => event.type === 'start' && event.durationMs >= 4500)
  const pulseStop = pulseResult.events.find(event => event.type === 'stop' && event.id === pulseLong.id)
  assert(pulseStop && pulseStop.at - pulseLong.at >= 4500, '60ms spoken pulse must not confirm barge-in or stop native audio early')
  assert.equal(caseRequests().filter(request => request.kind === 'asr').length, 1)
  assert.equal(caseRequests().find(request => request.kind === 'llm').aborted, false)
  observations.push({ case: 'short-barge', ...pulseResult })
  await close()
  record('A real 60ms spoken pulse does not confirm barge-in or interrupt ongoing native playback')

  await open('barge', 'barge', 'barge')
  await enableMic(true)
  await eventually(async () => (await capture()).events.some(event => event.type === 'start' && event.durationMs >= 4500), 'long first native playback', 60_000)
  await eventually(() => caseRequests().some(request => request.kind === 'llm' && request.ordinal === 1 && request.aborted), 'confirmed speech cancels previous LLM', 45_000)
  await eventually(() => caseRequests().some(request => request.kind === 'tts' && request.aborted), 'confirmed speech cancels pending TTS', 15_000)
  await eventually(() => caseRequests().filter(request => request.kind === 'asr').length >= 2, 'barge-in becomes new input', 30_000)
  await delay(6500)
  const interrupted = await capture()
  const long = interrupted.events.find(event => event.type === 'start' && event.durationMs >= 4500)
  const stopped = interrupted.events.find(event => event.type === 'stop' && event.id === long.id)
  assert(stopped && stopped.at - long.at < long.durationMs - 500, 'Confirmed barge-in must stop actual playback early')
  assert(!interrupted.events.some(event => event.type === 'start' && Math.abs(event.frequency - 660) < 12), 'Late old second TTS must never start')
  observations.push({ case: 'barge', ...interrupted })
  await close()
  record('Real confirmed barge-in aborts LLM/TTS, stops actual audio early, accepts another utterance and drops old audio')

  for (const action of ['off', 'hide', 'reload', 'quit']) {
    await open(`late-asr-${action}`, 'single', 'slow-asr')
    await enableMic(true)
    await eventually(() => caseRequests().some(request => request.kind === 'asr' && request.audioBytes), `ASR started before ${action}`, 60_000)
    const active = caseRequests().find(request => request.kind === 'asr')
    const owned = current
    if (action === 'off') { await current.page.getByTestId('microphone-status').click(); await assertOff() }
    else if (action === 'hide') { await current.page.getByTestId('hide-window').click(); await assertOff(); await current.electron.evaluate(({ app }) => app.emit('activate')); await assertOff() }
    else if (action === 'reload') { await current.page.reload(); await eventually(() => current.page.getByTestId('conversation').getAttribute('data-ready').then(value => value === 'true'), 'session restored after reload'); await assertOff() }
    else { const closed = current.electron.waitForEvent('close', { timeout: 15000 }); await current.page.getByTestId('quit-window').click().catch(error => { if (!current.page.isClosed()) throw error }); await closed; current = undefined }
    const count = server.records.length
    await delay(6000)
    assert.equal(active.aborted, true, `${action} must abort the real ASR request`)
    assert.equal(server.records.length, count, `${action} must cause no new provider POST`)
    if (current) { assert.equal((await capture()).events.filter(event => event.type === 'start').length, 0); await assertOff(); await close() }
    observations.push({ case: `late-asr-${action}`, profile: owned.profile, aborted: active.aborted, noNewPosts: true })
    record(`${action}: native capture stops, real ASR aborts, late reply causes zero new provider requests or playback`)
  }

  await open('late-tts-off', 'single', 'slow-tts')
  await enableMic(true)
  await eventually(() => caseRequests().some(request => request.kind === 'tts'), 'pending real TTS', 60_000)
  await current.page.getByTestId('speech-status').click()
  const postCount = server.records.length
  await delay(7000)
  assert.equal(server.records.length, postCount)
  assert(caseRequests().filter(request => request.kind === 'tts').every(request => request.aborted))
  assert.equal((await capture()).events.filter(event => event.type === 'start').length, 0)
  await close()
  record('Disabling speech aborts every pending TTS and no late WAV starts playback')

  await open('late-decode-off', 'single', 'normal')
  // Forward the real native decode, delaying only its resolved notification.
  await current.page.evaluate(`(() => {
    const nativeDecode = BaseAudioContext.prototype.decodeAudioData;
    window.__aimyNativeMediaProbe.decodeHeld = 0;
    BaseAudioContext.prototype.decodeAudioData = function(...args) {
      return nativeDecode.apply(this, args).then(audio => {
        window.__aimyNativeMediaProbe.decodeHeld++;
        return new Promise(resolve => setTimeout(() => resolve(audio), 1500));
      });
    };
  })()`)
  await enableMic(true)
  await eventually(() => current.page.evaluate(() => window.__aimyNativeMediaProbe.decodeHeld > 0), 'real native WAV decode completed before delayed notification', 60_000)
  await current.page.getByTestId('speech-status').click()
  await delay(2200)
  assert.equal((await capture()).events.filter(event => event.type === 'start').length, 0)
  observations.push({ case: 'late-decode-off', nativeDecodeNotificationDelayMs: 1500, ...await capture() })
  await close()
  record('Speech disabled during a real native decode drops its delayed completion without starting audio')

  for (const mode of ['asr-error', 'tts-error', 'tts-invalid']) {
    await open(mode, 'single', mode)
    await enableMic(true)
    await current.page.getByTestId('chat-error').waitFor({ state: 'visible', timeout: 60000 })
    await secretsProtected()
    await textFallback()
    await close()
    record(`${mode}: safe error, no exposed credential and text conversation remains usable`)
  }
  }

  let scannedFiles = 0
  async function inspectFiles(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await inspectFiles(path)
      else if (entry.isFile()) { scannedFiles++; const bytes = await readFile(path); for (const key of Object.values(keys)) assert.equal(bytes.includes(Buffer.from(key)), false, 'Fake capability key persisted in plaintext') }
    }
  }
  for (const entry of await readdir(evidenceDirectory, { withFileTypes: true })) if (entry.isDirectory() && entry.name.startsWith('profile-')) await inspectFiles(join(evidenceDirectory, entry.name))
  for (const log of [nativeLogs.join(''), rendererLogs.join('')]) for (const key of Object.values(keys)) assert.equal(log.includes(key), false, 'Logs leaked a capability fake key')
  assert.equal(nativeLogs.join('').includes('FAKE_INTERNAL_'), false)
  assert.equal(rendererLogs.join('').includes('FAKE_INTERNAL_'), false)
  assert.equal(externalRendererRequests.length, 0, 'Silero/ONNX/WASM assets must be local')
  const result = { status: 'passed', scope: onlyConversation ? 'conversation-only' : 'full-media-suite', evidenceDirectory, checks, fixtures, observations, requests: server.safeRecords(), scannedFiles, limitations: ['File-backed fake microphone and explicitly fake system permission; real macOS microphone permission not certified', 'Chromium AudioServiceSandbox disabled only in test process for file fixture access; renderer isolation and sandbox verified', 'Real bundled Silero, AudioWorklet, WebAudio and SDKs; ASR/LLM/TTS responses are localhost fixtures', 'Audio output is muted; actual hearing, echo, recognition quality, natural voice and viseme quality remain unverified', 'Native safeStorage calls tested; production Keychain policy not independently audited', 'No actual microphone/screen/camera or user Aimy window was operated'] }
  await writeFile(join(evidenceDirectory, 'media-result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ status: result.status, scope: result.scope, evidenceDirectory, checks, requestCount: result.requests.length, scannedFiles, limitations: result.limitations }, null, 2))
}
catch (error) {
  if (current) await current.page.screenshot({ path: join(evidenceDirectory, 'media-failure.png'), fullPage: true }).catch(() => {})
  const nativeState = current ? await capture().catch(() => undefined) : undefined
  const uiState = current ? await current.page.evaluate(() => ({ vad: document.querySelector('[data-testid="conversation"]')?.dataset.vad, listening: document.querySelector('[data-testid="conversation"]')?.dataset.listening, speaking: document.querySelector('[data-testid="conversation"]')?.dataset.speaking, error: document.querySelector('[data-testid="chat-error"]')?.textContent })).catch(() => undefined) : undefined
  const result = { status: 'failed', evidenceDirectory, checks, reason: redact(error instanceof Error ? error.message : 'Media smoke failed'), observations, nativeState, uiState, requests: server?.safeRecords(), rendererDiagnostic: redact(rendererLogs.join('\n')), nativeDiagnostic: redact(nativeLogs.join('\n')) }
  await writeFile(join(evidenceDirectory, 'media-result.json'), JSON.stringify(result, null, 2))
  console.error(JSON.stringify(result, null, 2)); process.exitCode = 1
}
finally { await close().catch(() => {}); await server?.close() }
