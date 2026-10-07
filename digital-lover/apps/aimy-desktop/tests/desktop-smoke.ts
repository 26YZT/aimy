/**
 * Real Electron + Vue + AIRI integration smoke, using only a local fake provider.
 * No runtime source imports, page/store mocks, external services or credentials.
 * The explicit Electron executable skips Playwright's default loader. This
 * tests native safeStorage calls, not a full production Keychain policy audit.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright'
import type { ElectronApplication, Page } from 'playwright'

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const electronBinary = require('electron') as string
const evidenceDirectory = await mkdtemp(join(tmpdir(), 'aimy-desktop-smoke-'))
const profileDirectory = join(evidenceDirectory, 'profile')
const secret = `fake-aimy-only-${randomUUID()}`
const staleText = 'STALE_CANCELLED_FIXTURE_MUST_NEVER_APPEAR'
const internalText = 'INTERNAL_PROVIDER_STACK_MUST_NEVER_APPEAR'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64')
const checks: string[] = []
const nativeLogs: string[] = []
const rendererLogs: string[] = []
const externalRequests: string[] = []
interface RecordedRequest {
  model: string
  messageCount: number
  userCount: number
  assistantCount: number
  imageCount: number
  images: string[]
  text: string
  authenticated: boolean
  toolsDisabled: boolean
  aborted: boolean
  lateChunkAttempted: boolean
}
const requests: RecordedRequest[] = []
const timers = new Set<ReturnType<typeof setTimeout>>()
let electron: ElectronApplication | undefined
let normalReplies = 0

function delay(milliseconds: number) { return new Promise<void>(resolve => setTimeout(resolve, milliseconds)) }
async function eventually(predicate: () => boolean | Promise<boolean>, label: string, timeout = 15_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await predicate()) return
    await delay(50)
  }
  throw new Error(`Timed out: ${label}`)
}
function schedule(callback: () => void, milliseconds: number) {
  const timer = setTimeout(() => { timers.delete(timer); callback() }, milliseconds)
  timers.add(timer)
}
const server = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404).end()
    return
  }
  try {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { model: string; messages: Array<{ role: string; content: unknown }>; tools?: unknown[]; tool_choice?: unknown; stream?: boolean }
    const users = body.messages.filter(message => message.role === 'user')
    const last = users.at(-1)?.content
    const text = typeof last === 'string' ? last : Array.isArray(last) ? last.filter(part => part.type === 'text').map(part => part.text).join('') : ''
    // AIRI prepends a stable time reference to user text in model projections.
    const command = text.match(/fixture-(slow|hide|error)\s*$/u)?.[1]
    const images = Array.isArray(last) ? last.filter(part => part.type === 'image_url').map(part => part.image_url?.url as string) : []
    const recorded: RecordedRequest = {
      model: body.model, messageCount: body.messages.length, userCount: users.length,
      assistantCount: body.messages.filter(message => message.role === 'assistant').length,
      imageCount: images.length, images, text,
      authenticated: request.headers.authorization === `Bearer ${secret}`,
      toolsDisabled: (!body.tools || body.tools.length === 0) && (!body.tool_choice || body.tool_choice === 'none'),
      aborted: false, lateChunkAttempted: false,
    }
    requests.push(recorded)
    assert.equal(body.stream, true, 'The actual provider must request streaming')
    if (command === 'error') {
      response.writeHead(500, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { message: `${secret} ${internalText}`, type: 'fixture-only' } }))
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    response.on('close', () => { if (!response.writableEnded) recorded.aborted = true })
    const writeChunk = (content: string, finish = false) => {
      if (response.destroyed) return
      response.write(`data: ${JSON.stringify({ id: 'local-fixture', object: 'chat.completion.chunk', created: 0, model: body.model, choices: [{ index: 0, delta: finish ? {} : { role: 'assistant', content }, finish_reason: finish ? 'stop' : null }] })}\n\n`)
      if (finish) response.end('data: [DONE]\n\n')
    }
    if (command === 'slow' || command === 'hide') {
      // AIRI's special-marker parser retains a short suffix between chunks.
      // The extra literal guarantees the full sentinel is already displayed.
      writeChunk('LOCAL_SLOW_PREFIX waiting...')
      schedule(() => { recorded.lateChunkAttempted = true; writeChunk(staleText); writeChunk('', true) }, 3_000)
    }
    else {
      if (!images.length) normalReplies += 1
      const reply = images.length ? 'LOCAL_IMAGE_REPLY' : `LOCAL_REPLY_${normalReplies}`
      writeChunk(reply.slice(0, 6))
      schedule(() => writeChunk(reply.slice(6)), 120)
      schedule(() => writeChunk('', true), 250)
    }
  }
  catch {
    if (!response.headersSent) response.writeHead(500)
    response.end()
  }
})
await new Promise<void>((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})
const address = server.address()
assert(address && typeof address === 'object')
const endpoint = `http://127.0.0.1:${address.port}/v1/`

async function launch() {
  electron = await _electron.launch({
    executablePath: electronBinary, args: [join(appDirectory, 'out/main/index.js')], cwd: appDirectory,
    env: {
      PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? tmpdir(),
      LANG: process.env.LANG ?? 'en_US.UTF-8', APP_USER_DATA_PATH: profileDirectory,
    }, timeout: 30_000,
  })
  electron.process().stdout?.on('data', data => nativeLogs.push(String(data)))
  electron.process().stderr?.on('data', data => nativeLogs.push(String(data)))
  const page = await electron.firstWindow()
  page.setDefaultTimeout(15_000)
  page.on('console', message => rendererLogs.push(message.text()))
  page.on('pageerror', error => rendererLogs.push(error.message))
  page.on('request', request => {
    const url = request.url()
    if (/^https?:/u.test(url) && new URL(url).hostname !== '127.0.0.1') externalRequests.push(url)
  })
  await page.getByTestId('aimy-app').waitFor({ state: 'visible' })
  await eventually(() => page.getByTestId('conversation').getAttribute('data-ready').then(value => value === 'true'), 'local session restored')
  await eventually(() => page.getByTestId('chat-input').isEnabled(), 'composer ready')
  return page
}
async function closeApp() {
  if (electron) {
    const instance = electron
    electron = undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    const cutoff = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        // Only the Electron child created by this isolated test is eligible.
        if (instance.process().exitCode === null) instance.process().kill('SIGKILL')
        reject(new Error('Graceful test app cleanup exceeded 5 seconds'))
      }, 5_000)
    })
    try { await Promise.race([instance.close(), cutoff]) }
    finally { if (timeout) clearTimeout(timeout) }
  }
}
async function quitFromUi(page: Page) {
  assert(electron)
  const instance = electron
  const closed = instance.waitForEvent('close', { timeout: 15_000 })
  const started = Date.now()
  try { await page.getByTestId('quit-window').click() }
  catch (error) { if (!page.isClosed()) throw error }
  await closed
  electron = undefined
  return Date.now() - started
}
async function send(page: Page, text: string) {
  await page.getByTestId('chat-input').fill(text)
  await page.getByTestId('send-message').click()
}
async function completed(page: Page) {
  await eventually(() => page.getByTestId('chat-input').isEnabled(), 'generation finished')
  assert.equal(await page.getByTestId('stop-generation').count(), 0)
}
async function publicAndRendererProtected(page: Page) {
  const data = await page.evaluate(async () => {
    const settings = await (window as unknown as { aimy: { getSettings: () => Promise<unknown> } }).aimy.getSettings()
    const local = { ...localStorage }
    const session = { ...sessionStorage }
    const databases: unknown[] = []
    for (const description of await indexedDB.databases()) {
      if (!description.name) continue
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(description.name!); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('Cannot inspect test IndexedDB'))
      })
      try {
        for (const name of database.objectStoreNames) {
          databases.push(await new Promise<unknown>((resolve, reject) => {
            const request = database.transaction(name).objectStore(name).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('Cannot inspect test store'))
          }))
        }
      }
      finally { database.close() }
    }
    return { settings, local, session, databases, dom: document.body.innerHTML, inputs: Array.from(document.querySelectorAll('input')).map(input => input.value), exposed: { require: typeof (window as unknown as { require?: unknown }).require, electron: typeof (window as unknown as { electron?: unknown }).electron } }
  })
  assert.equal(JSON.stringify(data).includes(secret), false, 'Fake key leaked into public settings, renderer storage or DOM')
  assert.equal(data.exposed.require, 'undefined')
  assert.equal(data.exposed.electron, 'undefined')
  assert.equal('apiKey' in (data.settings as object), false)
  return data
}
async function inspectProfile() {
  let files = 0
  async function scan(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await scan(path)
      else if (entry.isFile()) { files += 1; assert.equal((await readFile(path)).includes(Buffer.from(secret)), false, 'Plaintext fake key found in temporary app profile') }
    }
  }
  await scan(profileDirectory)
  return files
}

try {
  let page = await launch()
  assert.equal(requests.length, 0, 'App called provider before user submission')
  assert.match(await page.getByTestId('screen-status').innerText(), /关闭/u)
  assert.match(await page.getByTestId('microphone-status').innerText(), /关闭/u)
  await page.getByTestId('open-settings').click()
  await page.getByTestId('settings-endpoint').fill(endpoint)
  await page.getByTestId('settings-model').fill('fixture-chat-model')
  await page.getByTestId('settings-vision-model').fill('fixture-vision-model')
  await page.getByTestId('settings-key').fill(secret)
  await page.getByTestId('settings-save').click()
  await page.getByTestId('settings-message').waitFor({ state: 'visible' })
  await eventually(() => page.getByTestId('settings-key').inputValue().then(value => value === ''), 'credential input cleared')
  const configured = await publicAndRendererProtected(page)
  assert.equal((configured.settings as { configured: boolean }).configured, true)
  await page.getByRole('button', { name: '回到对话' }).click()
  checks.push('UI configuration saved; fake key confined to main process and ciphertext')

  for (let index = 1; index <= 3; index += 1) {
    await send(page, `fixture-turn-${index}`)
    if (index === 1) {
      await eventually(() => page.getByTestId('stream-text').textContent().then(value => !!value?.includes('LOCAL_')), 'visible incremental reply')
    }
    await eventually(() => page.getByTestId('message-assistant').allTextContents().then(texts => texts.some(text => text.includes(`LOCAL_REPLY_${index}`))), `reply ${index}`)
    await completed(page)
    const recorded = requests[index - 1]!
    assert.equal(recorded.userCount, index)
    assert.equal(recorded.assistantCount, index - 1)
    assert.equal(recorded.model, 'fixture-chat-model')
    assert.equal(recorded.authenticated, true)
    assert.equal(recorded.toolsDisabled, true)
  }
  checks.push('Three actual streamed SDK requests preserve multi-turn history; tools disabled')

  await send(page, 'fixture-slow')
  await eventually(() => page.getByTestId('stream-text').textContent().then(value => !!value?.includes('LOCAL_SLOW_PREFIX')), 'partial streamed response')
  const cancelled = requests.at(-1)!
  await page.getByTestId('stop-generation').click()
  await completed(page)
  await send(page, 'fixture-after-cancel')
  await eventually(() => page.getByTestId('message-assistant').allTextContents().then(texts => texts.some(text => text.includes('LOCAL_REPLY_4'))), 'fresh reply after cancellation')
  await completed(page)
  await eventually(() => cancelled.lateChunkAttempted, 'old provider completion attempted', 5_000)
  assert.equal(cancelled.aborted, true, 'Cancellation must abort actual provider HTTP stream')
  assert.equal((await page.locator('body').innerText()).includes(staleText), false)
  checks.push('Cancel aborts live local HTTP stream and rejects stale output in a subsequent turn')

  await page.getByTestId('image-input').setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: png })
  await page.getByTestId('attachment-preview').waitFor({ state: 'visible' })
  await send(page, 'fixture-image')
  await eventually(() => page.getByTestId('message-assistant').allTextContents().then(texts => texts.some(text => text.includes('LOCAL_IMAGE_REPLY'))), 'image reply')
  await completed(page)
  const vision = requests.at(-1)!
  assert.equal(vision.model, 'fixture-vision-model')
  assert.equal(vision.imageCount, 1)
  assert.equal(vision.images[0], `data:image/png;base64,${png.toString('base64')}`)
  assert.equal(await page.locator('[data-testid="message-user"] img').count(), 1)
  checks.push('Image is shared through actual vision provider request and stored in local conversation')

  await send(page, 'fixture-error')
  await page.getByTestId('chat-error').waitFor({ state: 'visible' })
  await completed(page)
  assert.equal((await page.locator('body').innerText()).includes(internalText), false)
  await publicAndRendererProtected(page)
  await send(page, 'fixture-recovery')
  await eventually(() => page.getByTestId('message-assistant').allTextContents().then(texts => texts.some(text => text.includes('LOCAL_REPLY_5'))), 'recovery after failed provider')
  await completed(page)
  checks.push('Provider failure produces safe message and permits a subsequent successful turn')

  assert(electron)
  const preferences = await electron.evaluate(({ app, BrowserWindow, safeStorage }) => {
    const window = BrowserWindow.getAllWindows()[0]!
    // Electron retains this diagnostic method but omits it from public types.
    const preferences = (window.webContents as unknown as {
      getLastWebPreferences: () => { sandbox?: boolean; nodeIntegration?: boolean; contextIsolation?: boolean }
    }).getLastWebPreferences()
    return { userData: app.getPath('userData'), encryption: safeStorage.isEncryptionAvailable(), mockKeychain: app.commandLine.hasSwitch('use-mock-keychain'), sandbox: preferences.sandbox, nodeIntegration: preferences.nodeIntegration, contextIsolation: preferences.contextIsolation }
  })
  assert.equal(preferences.userData, profileDirectory)
  assert.equal(preferences.sandbox, true)
  assert.equal(preferences.nodeIntegration, false)
  assert.equal(preferences.contextIsolation, true)
  assert.equal(preferences.encryption, true)
  assert.equal(preferences.mockKeychain, false)
  const denied = await electron.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!
    return window.webContents.executeJavaScript(`(async () => {
      const results = [];
      for (const method of ['getUserMedia', 'getDisplayMedia']) {
        try {
          const stream = await Promise.race([
            navigator.mediaDevices[method](method === 'getUserMedia' ? { audio: true } : { video: true }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Permission test timeout')), 5000)),
          ]);
          stream.getTracks().forEach(track => track.stop()); results.push({ method, allowed: true });
        } catch (error) { results.push({ method, allowed: false, name: error.name }); }
      }
      return results;
    })()`, true)
  }) as Array<{ method: string; allowed: boolean; name?: string }>
  assert.deepEqual(denied.map(item => item.allowed), [false, false])
  assert(denied.every(item => item.name === 'NotAllowedError' || item.name === 'NotReadableError'), 'Media must be denied by the permission boundary, not unavailable or timed out')
  checks.push('Sandboxed renderer cannot use Node; microphone and display API requests are denied')

  await eventually(() => page.getByTestId('avatar-stage').getAttribute('data-state').then(value => value === 'mounted'), 'actual VRM mounted', 60_000)
  assert.equal(await page.getByTestId('avatar-error').count(), 0)
  const canvases = await page.locator('[data-testid="avatar-stage"] canvas').evaluateAll(elements => elements.map(element => {
    const canvas = element as HTMLCanvasElement
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    return { width: canvas.width, height: canvas.height, visible: canvas.getBoundingClientRect().width > 0 && canvas.getBoundingClientRect().height > 0, webgl: !!context }
  }))
  assert(canvases.some(canvas => canvas.webgl && canvas.visible && canvas.width > 0 && canvas.height > 0), 'A real visible WebGL canvas is required')
  await page.screenshot({ path: join(evidenceDirectory, 'desktop-conversation.png'), fullPage: true })
  checks.push('Bundled sample VRM loads into a visible real WebGL canvas; screenshot captured')

  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setBounds({ x: 80, y: 100, width: 880, height: 650 }))
  await eventually(async () => {
    const settings = JSON.parse(await readFile(join(profileDirectory, 'settings-v1.json'), 'utf8')) as { bounds?: { width: number; height: number } }
    return settings.bounds?.width === 880 && settings.bounds.height === 650
  }, 'native window bounds saved')
  await page.screenshot({ path: join(evidenceDirectory, 'desktop-narrow.png'), fullPage: true })

  await send(page, 'fixture-hide')
  await eventually(() => page.getByTestId('stream-text').textContent().then(value => !!value?.includes('LOCAL_SLOW_PREFIX')), 'stream before hiding')
  const hiddenRequest = requests.at(-1)!
  await page.getByTestId('hide-window').click()
  await eventually(() => electron!.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows()[0]!.isVisible()), 'window hidden')
  await eventually(() => hiddenRequest.aborted, 'hide cancels provider request')
  await electron.evaluate(({ app }) => { app.emit('activate') })
  await eventually(() => electron!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible()), 'window reopened')
  await completed(page)
  checks.push('Hide stops active provider stream; activate reopens without enabling capture')

  const beforeRestartUsers = await page.getByTestId('message-user').count()
  const beforeRestartAssistants = await page.getByTestId('message-assistant').count()
  await publicAndRendererProtected(page)
  await closeApp()
  const disk = JSON.parse(await readFile(join(profileDirectory, 'settings-v1.json'), 'utf8')) as { keyCiphertext?: string }
  assert(disk.keyCiphertext && !disk.keyCiphertext.includes(secret))
  assert.equal((await stat(join(profileDirectory, 'settings-v1.json'))).mode & 0o777, 0o600)
  page = await launch()
  assert.equal(await page.getByTestId('message-user').count(), beforeRestartUsers)
  assert.equal(await page.getByTestId('message-assistant').count(), beforeRestartAssistants)
  assert.equal(await page.locator('[data-testid="message-user"] img').count(), 1)
  const restored = await publicAndRendererProtected(page)
  assert.equal((restored.settings as { configured: boolean }).configured, true)
  assert.equal((restored.settings as { model: string }).model, 'fixture-chat-model')
  assert.equal(JSON.stringify(restored.databases).includes(staleText), false)
  const restoredBounds = await electron!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBounds())
  assert.equal(restoredBounds.width, 880)
  assert.equal(restoredBounds.height, 650)
  checks.push('A fresh Electron process restores configuration, text history, shared image and native window bounds')

  await send(page, 'fixture-slow')
  await eventually(() => page.getByTestId('stream-text').textContent().then(value => !!value?.includes('LOCAL_SLOW_PREFIX')), 'partial response before immediate quit')
  const shutdownRequest = requests.at(-1)!
  // Use a plain JS string: tsx keepNames helpers are not present in the renderer.
  await page.evaluate(`(() => {
    const originalPut = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      const request = originalPut.apply(this, args)
      const store = this
      const deadline = performance.now() + 300
      function holdTransaction() {
        const keepAlive = store.get('__aimy_smoke_missing_keep_alive_key__')
        keepAlive.onsuccess = () => { if (performance.now() < deadline) holdTransaction() }
      }
      // Real reads retain the real write transaction until its commit deadline.
      // idb-keyval awaits transaction.oncomplete, so this tests the shutdown flush.
      if (store.transaction.mode === 'readwrite') holdTransaction()
      return request
    }
  })()`)
  await electron!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setBounds({ x: 90, y: 120, width: 920, height: 680 }))
  const shutdownDurationMs = await quitFromUi(page)
  assert(shutdownDurationMs >= 250, 'Immediate quit must await the delayed real IndexedDB commit')
  await eventually(() => shutdownRequest.aborted, 'immediate quit aborts provider stream')
  page = await launch()
  const shutdownMessages = await page.getByTestId('message-assistant').allTextContents()
  assert(shutdownMessages.at(-1)?.includes('LOCAL_SLOW_PREFIX'), 'Partial assistant response must survive an immediate quit')
  assert.equal(shutdownMessages.join('').includes(staleText), false)
  const immediateBounds = await electron!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBounds())
  assert.equal(immediateBounds.width, 920)
  assert.equal(immediateBounds.height, 680)
  await eventually(() => page.getByTestId('avatar-stage').getAttribute('data-state').then(value => value === 'mounted'), 'VRM rendered after immediate-quit restart', 60_000)
  await page.screenshot({ path: join(evidenceDirectory, 'desktop-immediate-shutdown-restored.png'), fullPage: true })
  checks.push(`Immediate UI quit awaits delayed IndexedDB commit (${shutdownDurationMs} ms), restores partial reply and latest window bounds`)

  await page.getByTestId('clear-conversation').click()
  await page.getByTestId('confirm-clear').click()
  await eventually(async () => await page.getByTestId('message-user').count() === 0 && await page.getByTestId('chat-input').isEnabled(), 'conversation cleared')
  await closeApp()
  page = await launch()
  assert.equal(await page.getByTestId('message-user').count(), 0)
  assert.equal(await page.getByTestId('message-assistant').count(), 0)
  assert.equal(await page.locator('[data-testid="message-user"] img').count(), 0)
  const cleared = await publicAndRendererProtected(page)
  assert.equal(JSON.stringify(cleared.databases).includes('fixture-turn-1'), false)
  assert.equal(JSON.stringify(cleared.databases).includes(png.toString('base64')), false)
  assert.equal((cleared.settings as { configured: boolean }).configured, true)
  await eventually(() => page.getByTestId('avatar-stage').getAttribute('data-state').then(value => value === 'mounted'), 'VRM rendered after clear and restart', 60_000)
  await page.screenshot({ path: join(evidenceDirectory, 'desktop-cleared.png'), fullPage: true })
  checks.push('Clear removes stored messages and images; another fresh process remains empty')

  // Only the resource transport fails: the real app, stores and bridge stay intact.
  await page.route('**/assets/AvatarSample_A.vrm', route => route.abort('failed'))
  await page.reload()
  await page.getByTestId('aimy-app').waitFor({ state: 'visible' })
  await eventually(() => page.getByTestId('conversation').getAttribute('data-ready').then(value => value === 'true'), 'session ready despite unavailable VRM')
  await page.getByTestId('avatar-error').waitFor({ state: 'visible', timeout: 30_000 })
  await send(page, 'fixture-avatar-unavailable')
  await eventually(() => page.getByTestId('message-assistant').allTextContents().then(texts => texts.some(text => text.includes('LOCAL_REPLY_6'))), 'text reply despite unavailable VRM')
  await completed(page)
  await page.getByTestId('open-settings').click()
  await page.getByTestId('settings-drawer').waitFor({ state: 'visible' })
  await page.getByRole('button', { name: '关闭设置' }).click()
  await page.screenshot({ path: join(evidenceDirectory, 'desktop-avatar-unavailable.png'), fullPage: true })
  await page.getByTestId('clear-conversation').click()
  await page.getByTestId('confirm-clear').click()
  await eventually(async () => await page.getByTestId('message-user').count() === 0 && await page.getByTestId('chat-input').isEnabled(), 'negative-case history cleared')
  await closeApp()
  checks.push('Real VRM resource failure shows an actionable error while text conversation and settings remain usable')

  const scannedFiles = await inspectProfile()
  assert.equal(nativeLogs.join('').includes(secret), false, 'Native logs leaked fake key')
  assert.equal(rendererLogs.join('').includes(secret), false, 'Renderer logs leaked fake key')
  assert.equal(nativeLogs.join('').includes(internalText), false, 'Native logs leaked provider error')
  assert.equal(rendererLogs.join('').includes(internalText), false, 'Renderer logs leaked provider error')
  assert.equal(externalRequests.length, 0, 'Renderer attempted external network request')
  assert(requests.every(request => request.authenticated && request.toolsDisabled))
  checks.push('Temporary profile and logs contain no plaintext fake key or internal provider error; no external renderer request')
  const summary = {
    status: 'passed', evidenceDirectory, profileDirectory, checks, scannedFiles, mediaDenial: denied, shutdownDurationMs, mockKeychain: preferences.mockKeychain,
    actualRequests: requests.map(({ model, messageCount, userCount, assistantCount, imageCount, authenticated, toolsDisabled, aborted }) => ({ model, messageCount, userCount, assistantCount, imageCount, authenticated, toolsDisabled, aborted })),
    limitations: ['Fake localhost provider only; real models and quality not verified', 'Native safeStorage calls tested; production macOS Keychain policy not independently audited', 'Media denial verified; live microphone and screen capture are not enabled or tested', 'VRoid sample is a prototype asset, not a final Aimy character'],
  }
  await writeFile(join(evidenceDirectory, 'result.json'), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary, null, 2))
}
catch (error) {
  const reason = (error instanceof Error ? error.message : 'Desktop smoke failed').split(secret).join('[redacted]')
  await electron?.windows()[0]?.screenshot({ path: join(evidenceDirectory, 'desktop-failure.png'), fullPage: true }).catch(() => {})
  const redact = (value: string) => value.split(secret).join('[redacted]').replace(/data:[^\s'"]+;base64,[A-Za-z0-9+/=]+/gu, 'data:[local-base64-asset]').slice(-2_000)
  const result = {
    status: 'failed', evidenceDirectory, checks, reason,
    actualRequests: requests.map(({ model, messageCount, userCount, assistantCount, imageCount, text, aborted }) => ({ model, messageCount, userCount, assistantCount, imageCount, text: redact(text), aborted })),
    rendererDiagnostic: redact(rendererLogs.join('\n')), nativeDiagnostic: redact(nativeLogs.join('\n')),
  }
  await writeFile(join(evidenceDirectory, 'result.json'), JSON.stringify(result, null, 2))
  console.error(JSON.stringify(result, null, 2))
  process.exitCode = 1
}
finally {
  await closeApp().catch(() => {})
  for (const timer of timers) clearTimeout(timer)
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
}
