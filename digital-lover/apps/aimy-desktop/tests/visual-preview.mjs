/** Real Electron visual QA with a fresh empty profile and no provider calls. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright'

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const evidenceDirectory = await mkdtemp(join(tmpdir(), 'aimy-visual-preview-'))
const profileDirectory = join(evidenceDirectory, 'profile')
const checks = []
const network = []
const layouts = []
let electron

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
async function eventually(predicate, label, timeout = 15_000) {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (await predicate()) return; await delay(50) }
  throw new Error(`Timed out: ${label}`)
}
function contrast(foreground, background) {
  const luminance = color => {
    const channels = color.match(/[\d.]+/gu).slice(0, 3).map(value => Number(value) / 255)
    return channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0)
  }
  const [a, b] = [luminance(foreground), luminance(background)]
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
async function inspect(page, width, height) {
  await eventually(async () => {
    const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    return size.width === width && size.height === height
  }, 'native window viewport resized')
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const result = await page.evaluate(() => {
    const box = element => {
      const rectangle = element.getBoundingClientRect()
      return { left: rectangle.left, top: rectangle.top, right: rectangle.right, bottom: rectangle.bottom, width: rectangle.width, height: rectangle.height }
    }
    const privacy = document.querySelector('.privacy-status')
    const conversation = document.querySelector('.conversation')
    return {
      viewport: { width: innerWidth, height: innerHeight },
      scroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      privacy: box(privacy), composer: box(document.querySelector('.composer')),
      avatar: box(document.querySelector('[data-testid="avatar-stage"]')), conversation: box(conversation),
      color: getComputedStyle(privacy).color, background: getComputedStyle(conversation).backgroundColor,
      fontSize: Number.parseFloat(getComputedStyle(privacy).fontSize),
      statuses: ['screen-status', 'microphone-status', 'speech-status', 'local-record-status'].map(id => document.querySelector(`[data-testid="${id}"]`)).map(element => ({ text: element.innerText, ...box(element) })),
      state: document.querySelector('[data-testid="avatar-stage"]').dataset.state,
    }
  })
  assert.equal(result.state, 'mounted')
  assert.equal(result.statuses.length, 4)
  assert(result.statuses[0].text.includes('屏幕关闭'))
  assert(result.statuses[1].text.includes('麦克风关闭'))
  assert(result.statuses[2].text.includes('朗读关闭'))
  assert(result.statuses[3].text.includes('记录留在本机'))
  for (const status of result.statuses) {
    assert(status.width > 0 && status.height > 0)
    assert(status.left >= 0 && status.top >= 0 && status.right <= width && status.bottom <= height, 'Privacy status must be fully visible')
  }
  for (let index = 1; index < result.statuses.length; index += 1) assert(result.statuses[index - 1].right <= result.statuses[index].left, 'Privacy labels must not overlap')
  assert(result.composer.bottom <= result.privacy.top, 'Composer must not obscure privacy statuses')
  assert(result.avatar.right <= result.conversation.left + 0.5, 'Character and conversation panels must not overlap')
  assert(result.scroll.width <= width && result.scroll.height <= height, 'App must fit the native viewport')
  assert(result.fontSize >= 10, 'Privacy status should retain readable size at the minimum window width')
  result.contrast = contrast(result.color, result.background)
  assert(result.contrast >= 4.5, 'Privacy text contrast must meet the requested target')
  layouts.push(result)
  await page.screenshot({ path: join(evidenceDirectory, `preview-${width}x${height}.png`), fullPage: true })
  checks.push(`Real VRM and privacy statuses visible at ${width}x${height}; ${result.fontSize}px; contrast ${result.contrast.toFixed(2)}`)
}

try {
  await mkdir(profileDirectory, { recursive: true, mode: 0o700 })
  electron = await _electron.launch({
    executablePath: require('electron'), args: [join(appDirectory, 'out/main/index.js'), '--use-fake-device-for-media-stream'], cwd: appDirectory,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? tmpdir(), LANG: process.env.LANG ?? 'en_US.UTF-8', APP_USER_DATA_PATH: profileDirectory, AIMY_TEST_MODE: '1' }, timeout: 30_000,
  })
  const page = await electron.firstWindow()
  page.setDefaultTimeout(15_000)
  page.on('request', request => { if (/^https?:/u.test(request.url())) network.push(request.url()) })
  await page.getByTestId('aimy-app').waitFor({ state: 'visible' })
  await eventually(() => page.getByTestId('conversation').getAttribute('data-ready').then(value => value === 'true'), 'fresh local conversation ready')
  await eventually(() => page.getByTestId('avatar-stage').getAttribute('data-state').then(value => value === 'mounted'), 'real sample VRM mounted', 60_000)
  const settings = await page.evaluate(() => window.aimy.getSettings())
  assert.equal(settings.configured, false)
  assert.equal('apiKey' in settings, false)
  const initialMedia = await page.evaluate(() => window.aimy.getMediaState())
  assert(Number.isSafeInteger(initialMedia.revision) && initialMedia.revision >= 0)
  assert(['mic', 'screen', 'speech'].every(kind => initialMedia[kind].enabled === false))
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 40, y: 40, width: 1040, height: 760 }))
  await inspect(page, 1040, 760)
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 40, y: 40, width: 760, height: 580 }))
  await inspect(page, 760, 580)
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 40, y: 40, width: 1040, height: 760 }))
  await eventually(() => page.evaluate(() => innerWidth === 1040 && innerHeight === 760), 'settings preview viewport ready')
  await page.getByTestId('open-settings').click()
  await page.getByTestId('settings-drawer').waitFor({ state: 'visible' })
  for (const tab of ['chat', 'asr', 'tts']) {
    await page.getByTestId(`settings-tab-${tab}`).click()
    const ids = ['settings-endpoint', 'settings-model', 'settings-key', ...(tab === 'chat' ? ['settings-vision-model'] : tab === 'tts' ? ['settings-voice'] : [])]
    for (const id of ids) assert.equal(await page.getByTestId(id).inputValue(), '', 'Fresh capability settings must contain no configured service, model or key')
    assert.equal(await page.getByTestId('settings-key').getAttribute('type'), 'password')
    await page.screenshot({ path: join(evidenceDirectory, `preview-settings-${tab}-empty.png`), fullPage: true })
  }
  checks.push('Fresh chat, ASR and TTS tabs contain no configured service, model, voice or key')
  // The UI preflight needs a model name; this inert fake config is never invoked.
  await page.getByTestId('settings-tab-chat').click()
  await page.getByTestId('settings-endpoint').fill('http://127.0.0.1:1/v1/')
  await page.getByTestId('settings-model').fill('preview-only-no-provider')
  await page.getByTestId('settings-key').fill('fake-preview-only-no-service')
  await page.getByTestId('settings-save').click()
  await page.getByTestId('settings-message').waitFor({ state: 'visible' })
  assert.equal(await page.getByTestId('settings-key').inputValue(), '')
  await page.getByRole('button', { name: '关闭设置' }).click()
  await page.getByTestId('screen-status').click()
  await page.getByTestId('screen-picker').waitFor({ state: 'visible' })
  await eventually(() => page.getByTestId('screen-source').count().then(value => value > 0), 'fake-only picker source ready')
  const sourceIds = await page.getByTestId('screen-source').evaluateAll(elements => elements.map(element => element.dataset.sourceId))
  assert.deepEqual(sourceIds, ['window:aimy-media-fixture'])
  await page.screenshot({ path: join(evidenceDirectory, 'preview-own-window-picker.png'), fullPage: true })
  await page.getByRole('button', { name: '关闭共享选择' }).click()
  const finalMedia = await page.evaluate(() => window.aimy.getMediaState())
  assert(Number.isSafeInteger(finalMedia.revision) && finalMedia.revision >= initialMedia.revision)
  assert(['mic', 'screen', 'speech'].every(kind => finalMedia[kind].enabled === false))
  checks.push('Source picker lists only test-owned own-frame registry entry; no source selected or media enabled')
  assert.equal(network.length, 0, 'Unconfigured preview must not call HTTP services')
  const closing = electron.close()
  let forcedCleanup = false
  const timeout = setTimeout(() => { if (electron.process().exitCode === null) { forcedCleanup = true; electron.process().kill('SIGKILL') } }, 5_000)
  await closing
  clearTimeout(timeout)
  assert.equal(forcedCleanup, false, 'Preview app must close gracefully')
  electron = undefined
  const result = { status: 'passed', kind: 'visual-preview-only', evidenceDirectory, profileDirectory, checks, layouts, httpRequests: network.length, limitations: ['Initial profile and all three tabs were empty; an inert fake chat config was later saved solely for the picker preflight without provider calls', 'No source selected, no microphone/screen/voice enabled; registry was explicitly test-only own-frame', 'Business and media regressions have separate scoped evidence', 'This visual check does not certify full accessibility or production Keychain'] }
  await writeFile(join(evidenceDirectory, 'preview.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
}
catch (error) {
  const result = { status: 'failed', kind: 'visual-preview-only', evidenceDirectory, checks, reason: error instanceof Error ? error.message : 'Preview failed', layouts }
  await writeFile(join(evidenceDirectory, 'preview.json'), JSON.stringify(result, null, 2))
  console.error(JSON.stringify(result, null, 2))
  process.exitCode = 1
}
finally {
  if (electron) { const instance = electron; const timer = setTimeout(() => instance.process().kill('SIGKILL'), 5_000); await instance.close().catch(() => {}); clearTimeout(timer) }
}
