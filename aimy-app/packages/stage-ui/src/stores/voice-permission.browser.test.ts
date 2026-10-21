import type { TranscriptionEvent } from '@proj-airi/core-agent'

import type { VoiceMessageSnapshot } from '../libs/voice/voice-message'
import type { ResourceSnapshot } from '../services/resource-policy'

import { defineInvoke } from '@moeru/eventa'
import { Playback } from '@proj-airi/pipelines-audio'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'

import VoiceInputButton from '../components/scenarios/chat/components/voice-input-button.vue'
import HearingConfig from '../components/scenarios/dialogs/audio-input/hearing-config.vue'

import { configureLocalOnly } from '../services/local-data-policy'
import { installResourcePolicy, ResourcePolicy } from '../services/resource-policy'
import { getSpeechBusContext, voiceMessageCommand, voiceMessagesChanged } from '../services/speech/bus'
import { useHearingStore } from './modules/hearing'
import { useSettingsAudioDevice } from './settings/audio-device'
import { useVoiceStore } from './voice'
import { useVoiceControlsStore } from './voice-controls'
import { useVoiceMessagesStore } from './voice-messages'

const source = vi.hoisted(() => ({ opens: 0, closes: 0, scores: 0, disposing: 0, closeGate: undefined as Promise<void> | undefined }))
configureLocalOnly()
vi.mock('../workers/vad/silero-vad', () => ({ SileroVad: class {
  async score() {
    source.scores++
    return 0
  }

  async close() {
    source.disposing++
    await source.closeGate
  }
} }))
vi.mock('@proj-airi/audio/browser', async (original) => {
  const actual = await original<typeof import('@proj-airi/audio/browser')>()
  return { ...actual, microphoneSource: (_constraints: MediaStreamConstraints, options: { onStream?: (stream: MediaStream | undefined) => void }) => ({
    live: true,
    echoCancellation: true,
    open(signal: AbortSignal) {
      source.opens++
      const sourceId = crypto.randomUUID()
      let timer: ReturnType<typeof setInterval>
      return new ReadableStream({
        start(controller) {
          let frame = 0
          options.onStream?.(new MediaStream())
          const push = () => {
            controller.enqueue({ sampleRate: 16000, range: { sourceId, startFrame: frame, endFrame: frame + 512 }, channels: [new Float32Array(512)] })
            frame += 512
          }
          push()
          timer = setInterval(push, 20)
          signal.addEventListener('abort', () => {
            clearInterval(timer)
            source.closes++
            options.onStream?.(undefined)
            controller.close()
          }, { once: true })
        },
        cancel() { clearInterval(timer) },
      })
    },
  }) }
})

let revision = 0
let snapshot: ResourceSnapshot
let permissionGate: Promise<void> | undefined
const request = vi.fn(async (kind: 'microphone' | 'screen', enabled: boolean) => {
  if (snapshot[kind].enabled === enabled)
    return snapshot
  const result = { ...snapshot, revision: ++revision, reason: enabled ? 'permission-on' : 'permission-off', [kind]: { enabled, epoch: snapshot[kind].epoch + 1 } }
  snapshot = result
  if (enabled)
    await permissionGate
  return result
})
const policy = new ResourcePolicy({ setEnabled: request })
installResourcePolicy(policy)
const cleanup: Array<() => void | Promise<void>> = []
const unexpectedNetwork: string[] = []
beforeEach(() => {
  localStorage.clear()
  source.opens = 0
  source.closes = 0
  source.scores = 0
  source.disposing = 0
  source.closeGate = undefined
  request.mockClear()
  permissionGate = undefined
  unexpectedNetwork.length = 0
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href)
    if (url.origin === location.origin && /\.(?:png|webp|jpg|jpeg|svg|avif)(?:\?|$)/.test(url.pathname))
      return new Response(new Blob(['synthetic local background'], { type: 'image/webp' }))
    if (url.pathname === '/v1/feature-flags')
      return Response.json({})
    unexpectedNetwork.push(`${url.origin}${url.pathname}`)
    throw new Error('Provider network is forbidden in microphone permission tests')
  }))
  snapshot = { revision: ++revision, appEpoch: revision, active: true, reason: 'fixture', microphone: { enabled: false, epoch: revision }, screen: { enabled: false, epoch: revision } }
  policy.apply(snapshot)
})
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse())
    await close()
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function host(fullVoice = false) {
  const pinia = createPinia()
  let messages!: ReturnType<typeof useVoiceMessagesStore>
  let voice: ReturnType<typeof useVoiceStore> | undefined
  const app = createApp({ setup() {
    messages = useVoiceMessagesStore()
    if (fullVoice)
      voice = useVoiceStore()
    return () => null
  } })
  app.use(pinia).use(createI18n({ legacy: false, locale: 'en', messages: { en: {} }, missingWarn: false, fallbackWarn: false })).mount(document.createElement('div'))
  const devices = useSettingsAudioDevice(pinia)
  devices.initialize()
  const disconnect = voice
    ? voice.connectOutput(() => ({ playback: new Playback({ nowMs: () => 0, play: () => { throw new Error('Speech playback is forbidden') } }), synthesize: async () => null }))
    : messages.connect()
  let latest: readonly VoiceMessageSnapshot[] = []
  const unwatch = getSpeechBusContext().on(voiceMessagesChanged, event => latest = event.body ?? [])
  cleanup.push(() => {
    disconnect()
    unwatch()
    app.unmount()
    disposePinia(pinia)
  })
  return { pinia, devices, latest: () => latest, command: defineInvoke(getSpeechBusContext(), voiceMessageCommand) }
}

function follower() {
  const pinia = createPinia()
  const controls = useVoiceControlsStore(pinia)
  cleanup.push(() => disposePinia(pinia))
  return controls
}

it('authorizes the real recording host from an initially disabled microphone', async () => {
  const runtime = host()
  await expect(runtime.command({ type: 'record', id: 'first', sessionId: 'fixture' })).resolves.toMatchObject({ status: 'accepted' })
  expect(request).toHaveBeenCalledWith('microphone', true, expect.any(Number))
  await expect.poll(() => runtime.latest()[0]?.phase).toBe('capturing')
  expect(runtime.devices.enabled).toBe(false)
  await runtime.command({ type: 'discard', id: 'first' })
})

it('waits for host permission before opening a recording source', async () => {
  const gate = Promise.withResolvers<void>()
  permissionGate = gate.promise
  const runtime = host()
  const result = runtime.command({ type: 'record', id: 'delayed', sessionId: 'fixture' })
  const assertion = expect(result).resolves.toMatchObject({ status: 'accepted' })
  await expect.poll(() => request.mock.calls.length).toBe(1)
  expect(source.opens).toBe(0)
  gate.resolve()
  await assertion
  await expect.poll(() => runtime.latest()[0]?.phase).toBe('capturing')
  await runtime.command({ type: 'discard', id: 'delayed' })
})

it('rejects permission that arrives after the shared microphone was switched off', async () => {
  const gate = Promise.withResolvers<void>()
  permissionGate = gate.promise
  const runtime = host()
  const outcome = runtime.command({ type: 'record', id: 'late', sessionId: 'fixture' }).catch(error => error)
  await expect.poll(() => request.mock.calls.length).toBe(1)
  await runtime.devices.setMicrophoneEnabled(false)
  gate.resolve()
  expect(await outcome).toMatchObject({ name: 'AbortError' })
  expect(source.opens).toBe(0)
  expect(runtime.latest()).toEqual([])
  expect(runtime.devices.microphoneEnabled).toBe(false)
})

it('keeps continuous listening off after one voice message ends', async () => {
  const runtime = host()
  await runtime.command({ type: 'record', id: 'one-shot', sessionId: 'fixture' })
  await expect.poll(() => runtime.latest()[0]?.phase).toBe('capturing')
  await runtime.command({ type: 'finish', id: 'one-shot', send: false })
  await expect.poll(() => runtime.latest()[0]?.phase).toBe('ready')
  expect(runtime.devices.enabled).toBe(false)
  await expect.poll(() => runtime.devices.stream).toBeUndefined()
})

it('uses one host for two windows, pauses automatic capture for a manual message and revokes both windows on disable', async () => {
  const runtime = host(true)
  const stage = follower()
  const chat = follower()
  await stage.setMicrophoneEnabled(true)
  await expect.poll(() => stage.continuousListening && chat.continuousListening).toBe(true)
  await expect.poll(() => stage.microphoneActive && chat.microphoneActive).toBe(true)
  await expect.poll(() => source.scores).toBeGreaterThan(0)
  const opens = source.opens
  await chat.messageCommand({ type: 'record', id: 'shared', sessionId: 'fixture' })
  await expect.poll(() => stage.snapshot.microphone?.recording).toBe(true)
  expect(source.opens).toBe(opens)
  expect(chat.microphoneEnabled).toBe(true)
  const scores = source.scores
  await new Promise(resolve => setTimeout(resolve, 80))
  expect(source.scores).toBe(scores)
  await chat.messageCommand({ type: 'finish', id: 'shared', send: false })
  await expect.poll(() => source.scores).toBeGreaterThan(scores)
  await stage.setMicrophoneEnabled(false)
  await expect.poll(() => !stage.microphoneEnabled && !chat.microphoneEnabled).toBe(true)
  await expect.poll(() => runtime.devices.stream).toBeUndefined()
  expect(runtime.latest()).toEqual([])
  expect(runtime.devices.enabled).toBe(false)
  expect(unexpectedNetwork).toEqual([])
})

it('publishes a shared starting state but opens no source before permission and lets another window cancel it', async () => {
  const gate = Promise.withResolvers<void>()
  permissionGate = gate.promise
  host(true)
  const stage = follower()
  const chat = follower()
  const result = stage.setMicrophoneEnabled(true).catch(error => error)
  await expect.poll(() => chat.microphonePending).toBe(true)
  expect(source.opens).toBe(0)
  await chat.setMicrophoneEnabled(false)
  gate.resolve()
  expect(await result).toMatchObject({ name: 'AbortError' })
  await expect.poll(() => stage.microphonePending).toBe(false)
  expect(stage.microphoneEnabled).toBe(false)
  expect(source.opens).toBe(0)
})

it('does not start capture from level monitoring while disabled or from a saved enabled preference at startup', async () => {
  localStorage.setItem('settings/audio/input/enabled', 'true')
  const runtime = host(true)
  const controls = follower()
  controls.monitorLevel(1500)
  await Promise.resolve()
  expect(runtime.devices.enabled).toBe(false)
  expect(request).not.toHaveBeenCalled()
  expect(source.opens).toBe(0)
})

it('keeps the actual character and desktop chat microphone buttons synchronized without follower capture', async () => {
  const runtime = host(true)
  const stagePinia = createPinia()
  const chatPinia = createPinia()
  const i18n = () => createI18n({ legacy: false, locale: 'en', messages: { en: {} }, missingWarn: false, fallbackWarn: false })
  const stage = render(HearingConfig, { global: { plugins: [stagePinia, i18n()] } })
  const chat = render(VoiceInputButton, {
    props: { sharedInput: true, sessionId: 'fixture', modelValue: '', statusElement: null, attachmentElement: null },
    global: { plugins: [chatPinia, i18n()] },
  })
  cleanup.push(() => {
    stage.unmount()
    chat.unmount()
    disposePinia(stagePinia)
    disposePinia(chatPinia)
  })
  expect(source.opens).toBe(0)
  await stage.getByTestId('microphone-access-button').click()
  await expect.element(chat.getByTestId('voice-input-button')).toHaveAttribute('aria-pressed', 'true')
  await expect.element(chat.getByTestId('voice-input-button')).toHaveAttribute('data-microphone-active', 'true')
  await chat.getByTestId('voice-input-button').click()
  await expect.element(stage.getByTestId('microphone-access-button')).toHaveAttribute('aria-label', 'stage.chat.voice-composer.microphone-enable')
  await expect.poll(() => runtime.devices.stream).toBeUndefined()
  expect(runtime.latest()).toEqual([])
  expect(useSettingsAudioDevice(stagePinia).stream).toBeUndefined()
  expect(useSettingsAudioDevice(chatPinia).stream).toBeUndefined()
  await chat.getByTestId('voice-input-button').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'stage.chat.voice-composer.record-message', exact: true }).click()
  await expect.poll(() => runtime.latest()[0]?.phase).toBe('capturing')
  expect(runtime.devices.enabled).toBe(false)
  await chat.getByTestId('voice-input-button').click({ button: 'right' })
  await page.getByTestId('voice-menu-microphone').click()
  await expect.poll(() => runtime.latest()).toEqual([])
  await expect.poll(() => runtime.devices.stream).toBeUndefined()
  await expect.element(chat.getByTestId('voice-input-button')).toHaveAttribute('aria-pressed', 'false')
})

it('honors a new enable after a cancelled pending choice without reviving the old request', async () => {
  const gate = Promise.withResolvers<void>()
  permissionGate = gate.promise
  const runtime = host(true)
  const stage = follower()
  const chat = follower()
  const first = stage.setMicrophoneEnabled(true).catch(error => error)
  await expect.poll(() => chat.microphonePending).toBe(true)
  await chat.setMicrophoneEnabled(false)
  const second = chat.setMicrophoneEnabled(true)
  gate.resolve()
  expect(await first).toMatchObject({ name: 'AbortError' })
  await expect(second).resolves.toMatchObject({ status: 'accepted' })
  await expect.poll(() => stage.microphoneActive && chat.microphoneActive).toBe(true)
  await stage.setMicrophoneEnabled(false)
  await expect.poll(() => runtime.devices.stream).toBeUndefined()
})

it('does not retry either of two pending enables after a newer disable', async () => {
  const gate = Promise.withResolvers<void>()
  permissionGate = gate.promise
  const runtime = host(true)
  const stage = follower()
  const chat = follower()
  const first = stage.setMicrophoneEnabled(true).catch(error => error)
  await expect.poll(() => chat.microphonePending).toBe(true)
  const second = chat.setMicrophoneEnabled(true).catch(error => error)
  await Promise.resolve()
  await stage.setMicrophoneEnabled(false)
  gate.resolve()
  expect(await first).toMatchObject({ name: 'AbortError' })
  expect(await second).toMatchObject({ name: 'AbortError' })
  expect(source.opens).toBe(0)
  expect(runtime.devices.microphoneEnabled).toBe(false)
})

it('rejects late dictated text after another window disables the shared microphone', async () => {
  const runtime = host(true)
  const hearing = useHearingStore(runtime.pinia)
  hearing.activeTranscriptionProvider = 'browser-web-speech-api'
  let events: ReadableStreamDefaultController<TranscriptionEvent> | undefined
  let signal: AbortSignal | undefined
  vi.spyOn(hearing, 'createTranscriber').mockReturnValue({ transcribe(request) {
    signal = request.signal
    return new ReadableStream<TranscriptionEvent>({
      start(controller) { events = controller },
    })
  } })
  const stage = follower()
  const chat = follower()
  await chat.command({ type: 'begin', requestId: 'late-dictation', sessionId: 'fixture', target: 'composer' })
  await expect.poll(() => events).toBeDefined()
  await stage.setMicrophoneEnabled(false)
  expect(signal?.aborted).toBe(true)
  try {
    events!.enqueue({ type: 'update', revision: 1, segments: [{ id: 'late', revision: 1, text: 'must not arrive', tokens: [], final: true }] })
    events!.enqueue({ type: 'complete', revision: 1 })
    events!.close()
  }
  catch { /* A cancelled reader can already have closed the synthetic provider stream. */ }
  await expect(chat.command({ type: 'end', requestId: 'late-dictation' })).resolves.toMatchObject({ status: 'closed' })
  expect(chat.snapshot.drafts).toEqual([])
  expect(runtime.latest()).toEqual([])
  expect(unexpectedNetwork).toEqual([])
})

it('reserves an audio recording while the prior continuous listener is still disposing', async () => {
  const runtime = host(true)
  vi.spyOn(useHearingStore(runtime.pinia), 'createTranscriber').mockReturnValue({ transcribe: () => new ReadableStream() })
  const stage = follower()
  const chat = follower()
  await stage.setMicrophoneEnabled(true)
  await expect.poll(() => source.scores).toBeGreaterThan(0)
  const gate = Promise.withResolvers<void>()
  source.closeGate = gate.promise
  const recording = chat.messageCommand({ type: 'record', id: 'reserved-audio', sessionId: 'fixture' })
  try {
    await expect.poll(() => source.disposing).toBeGreaterThan(0)
    await expect(stage.command({ type: 'begin', requestId: 'competing-dictation', sessionId: 'fixture', target: 'composer' })).resolves.toEqual({ status: 'closed' })
    expect(runtime.latest()).toEqual([])
  }
  finally {
    gate.resolve()
    await recording
    await stage.setMicrophoneEnabled(false)
  }
})

it('opens a fresh total switch after a cancelled manual authorization without reviving that recording', async () => {
  const gate = Promise.withResolvers<void>()
  permissionGate = gate.promise
  const runtime = host(true)
  const controls = follower()
  const old = controls.messageCommand({ type: 'record', id: 'cancelled-manual', sessionId: 'fixture' }).catch(error => error)
  await expect.poll(() => request.mock.calls.length).toBe(1)
  await controls.messageCommand({ type: 'discard', id: 'cancelled-manual' })
  const fresh = controls.setMicrophoneEnabled(true).catch(error => error)
  gate.resolve()
  expect(await old).toMatchObject({ name: 'AbortError' })
  expect(await fresh).toEqual({ status: 'accepted' })
  await expect.poll(() => controls.continuousListening).toBe(true)
  expect(runtime.latest()).toEqual([])
  await controls.setMicrophoneEnabled(false)
})

it('releases a cancelled dictation reservation without letting its cleanup release the next audio request', async () => {
  const runtime = host(true)
  const controls = follower()
  await controls.setMicrophoneEnabled(true)
  await expect.poll(() => source.scores).toBeGreaterThan(0)
  const gate = Promise.withResolvers<void>()
  source.closeGate = gate.promise
  const old = controls.command({ type: 'begin', requestId: 'cancelled-before-input', sessionId: 'fixture', target: 'composer' }).catch(error => error)
  await expect.poll(() => source.disposing).toBeGreaterThan(0)
  await controls.command({ type: 'cancel', requestId: 'cancelled-before-input' })
  const fresh = controls.messageCommand({ type: 'record', id: 'fresh-audio', sessionId: 'fixture' }).catch(error => error)
  await new Promise(resolve => setTimeout(resolve, 20))
  gate.resolve()
  expect(await old).toMatchObject({ name: 'AbortError' })
  expect(await fresh).toEqual({ status: 'accepted' })
  await expect.poll(() => runtime.latest()[0]?.phase).toBe('capturing')
  expect(controls.snapshot.microphone?.recording).toBe(true)
  await controls.setMicrophoneEnabled(false)
})
