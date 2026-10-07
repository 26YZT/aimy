import type { IntentHandle } from '@proj-airi/pipelines-audio'
import type { AimyBridge, MediaState } from '../../shared/contracts'
import type { VAD } from '../airi-voice/workers/vad/vad'
import type { useLocalConversation } from './use-local-conversation'

import { toWav } from '@proj-airi/audio/encoding'
import { createPlaybackManager, createSpeechPipeline } from '@proj-airi/pipelines-audio'
import { computed, onScopeDispose, reactive, ref, shallowRef } from 'vue'

import { createVoiceInputTranscriptionChain } from '../airi-voice/composables/audio/voice-input-transcription-chain'
import { createVADStates } from '../airi-voice/libs/audio/vad'
import workletUrl from '../airi-voice/workers/vad/process.worklet?worker&url'
import { createDecodedAudioBudget, estimateWavCost } from './decoded-audio-budget'
import { copyMediaState, newerMediaState } from './media-state-order'

function base64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let text = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    text += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return btoa(text)
}

function audioBytes(value: string) {
  const decoded = atob(value)
  const bytes = new Uint8Array(decoded.length)
  for (let index = 0; index < decoded.length; index++)
    bytes[index] = decoded.charCodeAt(index)
  return bytes
}

/** Browser graph ownership only; credentials and all model requests stay in main. */
export function useVoiceInteraction(bridge: AimyBridge, conversation: ReturnType<typeof useLocalConversation>) {
  const state = ref<MediaState>({ revision: -1, mic: { enabled: false }, screen: { enabled: false }, speech: { enabled: false } })
  const initialized = ref(false)
  const preparingMic = ref(false)
  const listening = ref(false)
  const speaking = ref(false)
  const hearingSpeech = ref(false)
  const error = ref('')
  const lastTranscript = ref('')
  const audioContext = shallowRef<AudioContext>()
  const audioSource = shallowRef<AudioBufferSourceNode>()
  const transcriptionChain = createVoiceInputTranscriptionChain()
  const inputRequests = reactive(new Map<string, number>())
  const outputRequests = new Set<string>()
  const decodedBudget = createDecodedAudioBudget()
  const audioReservations = new WeakMap<AudioBuffer, NonNullable<ReturnType<typeof decodedBudget.reserve>>>()
  let stream: MediaStream | undefined
  let vad: VAD | undefined
  let graph: ReturnType<typeof createVADStates> | undefined
  let micEpoch = 0
  let controlEpoch = 0
  let speechControlEpoch = 0
  let outputEpoch = 0
  const pendingSegments = ref(0)
  const transcriptionGeneration = ref(0)
  let replacementCancellation: Promise<unknown> = Promise.resolve()
  let currentIntent: IntentHandle | undefined
  let currentTurn = ''
  let forwardedText = ''
  let disposed = false
  const transcribing = computed(() => [...inputRequests.values()].some(generation => generation === transcriptionGeneration.value))
  const inputBusy = computed(() => hearingSpeech.value || preparingMic.value || transcribing.value || pendingSegments.value > 0)

  function applyState(next: MediaState) {
    if (!newerMediaState(state.value, next))
      return false
    const previous = state.value
    state.value = copyMediaState(next)
    if ((previous.mic.enabled && !next.mic.enabled) || (previous.mic.token && previous.mic.token !== next.mic.token))
      void stopMic().catch(() => { error.value = '麦克风停止未完成，请重试关闭。' })
    if ((previous.speech.enabled && !next.speech.enabled) || (previous.speech.token && previous.speech.token !== next.speech.token))
      stopOutput('speech-disabled')
    return true
  }

  const playback = createPlaybackManager<AudioBuffer>({
    maxVoices: 1, maxVoicesPerOwner: 1, overflowPolicy: 'queue',
    play: async (item, signal) => {
      const context = audioContext.value
      if (!context || signal.aborted || !state.value.speech.enabled)
        return
      if (context.state === 'suspended')
        await context.resume()
      if (signal.aborted || context !== audioContext.value || !state.value.speech.enabled)
        return
      const source = context.createBufferSource()
      source.buffer = item.audio
      source.connect(context.destination)
      audioSource.value = source
      speaking.value = true
      await new Promise<void>((resolve) => {
        let settled = false
        const stop = () => {
          if (settled)
            return
          settled = true
          signal.removeEventListener('abort', stop)
          try { source.stop(); source.disconnect() }
          catch { /* The source may already have ended. */ }
          if (audioSource.value === source) {
            audioSource.value = undefined
            speaking.value = false
          }
          resolve()
        }
        source.onended = stop
        signal.addEventListener('abort', stop, { once: true })
        if (signal.aborted) { stop(); return }
        try { source.start() }
        catch { stop() }
      })
    },
  })
  const releaseAudio = (audio: AudioBuffer) => {
    const reservation = audioReservations.get(audio)
    if (reservation) {
      decodedBudget.release(reservation)
      audioReservations.delete(audio)
    }
  }
  playback.onEnd(event => releaseAudio(event.item.audio))
  playback.onInterrupt(event => releaseAudio(event.item.audio))
  playback.onReject(event => releaseAudio(event.item.audio))
  const pipeline = createSpeechPipeline<AudioBuffer>({
    playback, ttsMaxConcurrent: 2,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    tts: async (request, signal) => {
      const token = state.value.speech.token
      const context = audioContext.value
      if (!token || !context || signal.aborted || !request.text || !state.value.speech.enabled)
        return null
      const epoch = outputEpoch
      const requestId = crypto.randomUUID()
      outputRequests.add(requestId)
      const abort = () => { void bridge.cancelMedia({ requestId }).catch(() => {}) }
      signal.addEventListener('abort', abort, { once: true })
      try {
        const result = await bridge.synthesize({ requestId, token, turnId: request.turnId || currentTurn, text: request.text })
        if (signal.aborted || epoch !== outputEpoch || token !== state.value.speech.token)
          return null
        if (result.status !== 'complete' || !result.audioBase64) {
          if (result.status !== 'cancelled')
            error.value = result.message || '语音合成未完成，文字对话仍可使用。'
          return null
        }
        const bytes = audioBytes(result.audioBase64)
        let reservation: ReturnType<typeof decodedBudget.reserve>
        let handedOff = false
        try {
          const cost = estimateWavCost(bytes, context.sampleRate)
          reservation = cost ? decodedBudget.reserve(cost) : undefined
          if (!reservation) {
            stopOutput('audio-budget')
            error.value = '这一轮语音内容过多，已停止朗读。文字回复仍会保留。'
            return null
          }
          // decodeAudioData may transfer/detach its argument. Keep ownership of
          // the original bytes so cleanup cannot turn successful decoding into an error.
          const audio = await context.decodeAudioData(bytes.buffer.slice(0))
          if (signal.aborted || epoch !== outputEpoch)
            return null
          if (!decodedBudget.markReady(reservation, { bytes: audio.length * audio.numberOfChannels * 4, seconds: audio.duration })) {
            stopOutput('audio-budget')
            error.value = '这一轮语音内容过多，已停止朗读。文字回复仍会保留。'
            return null
          }
          audioReservations.set(audio, reservation)
          handedOff = true
          return audio
        }
        finally {
          bytes.fill(0)
          if (reservation && !handedOff)
            decodedBudget.release(reservation)
        }
      }
      catch {
        if (!signal.aborted && epoch === outputEpoch)
          error.value = '语音暂时不可用，文字对话仍可使用。'
        return null
      }
      finally {
        signal.removeEventListener('abort', abort)
        outputRequests.delete(requestId)
      }
    },
  })

  function stopOutput(reason = 'user-stop') {
    outputEpoch++
    currentIntent?.cancel(reason)
    currentIntent = undefined
    currentTurn = ''
    forwardedText = ''
    pipeline.stopAll(reason)
    playback.stopAll(reason)
    decodedBudget.reset()
    for (const requestId of outputRequests)
      void bridge.cancelMedia({ requestId }).catch(() => {})
    try { audioSource.value?.stop(); audioSource.value?.disconnect() }
    catch { /* Already ended. */ }
    audioSource.value = undefined
    speaking.value = false
  }

  function updateTurn(requestId: string, text: string) {
    if (!currentIntent || currentTurn !== requestId || !state.value.speech.enabled)
      return
    if (!text.startsWith(forwardedText)) {
      stopOutput('revised-text')
      error.value = '回复文字发生修订，已停止这一轮朗读。'
      return
    }
    const delta = text.slice(forwardedText.length)
    forwardedText = text
    if (delta)
      currentIntent.writeLiteral(delta)
  }

  const removeTurn = conversation.onTurn({
    start(requestId) {
      stopOutput('new-turn')
      if (!state.value.speech.enabled || !audioContext.value)
        return
      currentTurn = requestId
      currentIntent = pipeline.openIntent({ turnId: requestId, ownerId: 'aimy', behavior: 'replace' })
    },
    update: updateTurn,
    end(requestId, text, complete) {
      if (!complete) { stopOutput('turn-ended'); return }
      updateTurn(requestId, text)
      currentIntent?.writeFlush()
      currentIntent?.end()
    },
    cancel() { stopOutput('cancelled') },
  })

  function stopMic() {
    micEpoch++
    // Tracks are released synchronously before any transport/model cleanup await.
    const failures: unknown[] = []
    stream?.getTracks().forEach((track) => {
      try { track.stop() }
      catch (failure) { failures.push(failure) }
    })
    stream = undefined
    listening.value = false
    hearingSpeech.value = false
    preparingMic.value = false
    transcriptionGeneration.value++
    transcriptionChain.reset()
    try { graph?.dispose() }
    catch (failure) { failures.push(failure) }
    graph = undefined
    const previous = vad
    vad = undefined
    for (const requestId of inputRequests.keys())
      void bridge.cancelMedia({ requestId }).catch(() => {})
    return (previous?.dispose() ?? Promise.resolve()).then(() => {
      if (failures.length)
        throw new Error('Microphone cleanup failed')
    })
  }

  function enqueueSegment(buffer: Float32Array, epoch: number, token: string) {
    if (epoch !== micEpoch || !state.value.mic.enabled || token !== state.value.mic.token)
      return
    if (pendingSegments.value >= 4) {
      error.value = '语音处理跟不上输入，已关闭麦克风。请稍后重新开启。'
      void toggleMic(false)
      return
    }
    const wav = toWav(buffer.slice().buffer, 16000)
    buffer.fill(0)
    pendingSegments.value++
    void transcriptionChain.enqueue(async (ticket) => {
      await replacementCancellation
      if (!ticket.isCurrent() || epoch !== micEpoch)
        return
      const requestId = crypto.randomUUID()
      inputRequests.set(requestId, transcriptionGeneration.value)
      try {
        const result = await bridge.transcribe({ requestId, token, audioBase64: base64(wav) })
        if (!ticket.isCurrent() || epoch !== micEpoch || token !== state.value.mic.token)
          return
        if (result.status !== 'complete' || !result.text?.trim() || !result.receiptId) {
          if (result.status !== 'cancelled')
            error.value = result.message || '这段语音未能识别，请重试或改用文字。'
          return
        }
        lastTranscript.value = result.text
        await conversation.waitForSend()
        if (!ticket.isCurrent() || epoch !== micEpoch || token !== state.value.mic.token)
          return
        const sent = await conversation.send(result.text, undefined, undefined, { source: 'voice', captureToken: token, receiptId: result.receiptId })
        if (!sent && epoch === micEpoch)
          error.value = '这段语音未能发送，请检查本地保存状态或模型配置。'
      }
      catch {
        if (ticket.isCurrent() && epoch === micEpoch)
          error.value = '语音识别未完成，请重试或改用文字。'
      }
      finally {
        inputRequests.delete(requestId)
      }
    }).catch(() => {
      if (epoch === micEpoch)
        error.value = '语音处理未完成，请重试。'
    }).finally(() => { new Uint8Array(wav).fill(0); pendingSegments.value-- })
  }

  async function startMic(token: string) {
    const epoch = ++micEpoch
    preparingMic.value = true
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false })
      if (disposed || epoch !== micEpoch || token !== state.value.mic.token || !state.value.mic.enabled) {
        acquired.getTracks().forEach(track => track.stop())
        return
      }
      stream = acquired
      const { VAD: Detector } = await import('../airi-voice/workers/vad/vad')
      if (epoch !== micEpoch)
        return
      const detector = new Detector({ sampleRate: 16000, speechThreshold: 0.52, exitThreshold: 0.156, minSilenceDurationMs: 600, speechPadMs: 200, minSpeechDurationMs: 250, maxPendingFrames: 8 })
      vad = detector
      detector.on('speech-start', () => { if (epoch === micEpoch) hearingSpeech.value = true })
      detector.on('speech-end', () => { if (epoch === micEpoch) hearingSpeech.value = false })
      detector.on('speech-cancel', () => { if (epoch === micEpoch) hearingSpeech.value = false })
      detector.on('speech-confirmed', () => {
        if (epoch === micEpoch && token === state.value.mic.token && state.value.mic.enabled) {
          // Segmented HTTP prototype: a new confirmed utterance replaces unfinished
          // older ASR work, while the microphone and this segment's PCM stay alive.
          transcriptionGeneration.value++
          transcriptionChain.reset()
          stopOutput('barge-in')
          replacementCancellation = Promise.allSettled([
            conversation.cancel(),
            // Always notify main, including when no renderer chat is active.
            bridge.cancel(),
            ...[...inputRequests.keys()].map(requestId => bridge.cancelMedia({ requestId })),
          ])
        }
      })
      detector.on('speech-ready', ({ buffer }) => enqueueSegment(buffer, epoch, token))
      detector.on('status', (event) => {
        if (event.type === 'error' && epoch === micEpoch) {
          error.value = '语音检测暂时不可用，已关闭麦克风。文字对话仍可使用。'
          void toggleMic(false)
        }
      })
      await detector.initialize()
      if (epoch !== micEpoch) { await detector.dispose(); return }
      const activeGraph = createVADStates(detector, workletUrl, { audioContextOptions: { sampleRate: 16000, latencyHint: 'interactive' } })
      graph = activeGraph
      await activeGraph.initialize()
      if (epoch !== micEpoch) { activeGraph.dispose(); return }
      await activeGraph.start(acquired)
      if (epoch === micEpoch)
        listening.value = true
    }
    catch {
      if (epoch === micEpoch) {
        error.value = '无法开启麦克风或语音检测，请检查系统权限与本地语音资源。'
        await toggleMic(false)
      }
    }
    finally {
      if (epoch === micEpoch)
        preparingMic.value = false
    }
  }

  async function toggleMic(enabled: boolean) {
    const control = ++controlEpoch
    if (!enabled)
      void stopMic().catch(() => { error.value = '麦克风停止未完成，请重试关闭。' })
    error.value = enabled ? '' : error.value
    try {
      const result = await bridge.setMediaState({ kind: 'mic', enabled })
      if (control !== controlEpoch || disposed)
        return
      applyState(result.state)
      if (!result.ok) { error.value = result.message || '麦克风未能开启，请检查语音服务配置。'; return }
      if (enabled && state.value.mic.enabled && state.value.mic.token === result.state.mic.token && state.value.mic.token)
        await startMic(state.value.mic.token)
    }
    catch { error.value = '无法更新麦克风状态，请重试。' }
  }

  async function toggleSpeech(enabled: boolean) {
    const control = ++speechControlEpoch
    if (!enabled)
      stopOutput('speech-disabled')
    try {
      const result = await bridge.setMediaState({ kind: 'speech', enabled })
      if (control !== speechControlEpoch || disposed)
        return
      applyState(result.state)
      if (!result.ok) { error.value = result.message || '朗读未能开启，请先配置语音合成。'; return }
      if (enabled && state.value.speech.enabled && state.value.speech.token === result.state.speech.token && state.value.speech.token) {
        audioContext.value ??= new AudioContext({ latencyHint: 'interactive' })
        await audioContext.value.resume()
      }
    }
    catch { if (control === speechControlEpoch) error.value = '无法开启朗读，文字对话仍可使用。' }
  }

  async function suspend() {
    controlEpoch++
    speechControlEpoch++
    const stopped = stopMic()
    stopOutput('suspended')
    const context = audioContext.value
    audioContext.value = undefined
    const closed = context && context.state !== 'closed' ? context.close() : Promise.resolve()
    const results = await Promise.allSettled([stopped, closed])
    return results.every(result => result.status === 'fulfilled')
  }

  async function disableAll() {
    const local = suspend()
    await Promise.allSettled(['mic', 'speech', 'screen'].map(async kind => {
      const result = await bridge.setMediaState({ kind: kind as 'mic' | 'speech' | 'screen', enabled: false })
      applyState(result.state)
    }))
    return local
  }

  const removeState = bridge.onMediaState(applyState)
  void bridge.getMediaState().then(applyState).catch(() => {
    error.value = '无法读取设备状态，采集保持关闭。'
  }).finally(() => { initialized.value = true })

  const stopForPageExit = () => { void suspend() }
  window.addEventListener('beforeunload', stopForPageExit)
  window.addEventListener('pagehide', stopForPageExit)

  onScopeDispose(() => {
    disposed = true
    removeTurn()
    removeState()
    window.removeEventListener('beforeunload', stopForPageExit)
    window.removeEventListener('pagehide', stopForPageExit)
    void suspend()
  })
  return { state, initialized, preparingMic, listening, transcribing, speaking, inputBusy, error, lastTranscript, audioContext, audioSource, toggleMic, toggleSpeech, suspend, disableAll, stopOutput, stopTurn: (turnId: string) => { if (currentTurn === turnId) stopOutput('screen-disabled') } }
}
