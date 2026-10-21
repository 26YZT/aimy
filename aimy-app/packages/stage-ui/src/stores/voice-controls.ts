import type { VoiceMessageSnapshot } from '../libs/voice/voice-message'
import type { VoiceHostSnapshot, VoiceInputCommand, VoiceMessageCommand } from '../services/speech/bus'

import { defineInvoke } from '@moeru/eventa'
import { errorMessageFrom } from '@moeru/std'
import { defineStore } from 'pinia'
import { computed, onScopeDispose, shallowRef } from 'vue'

import { getSpeechBusContext, voiceInputCommand, voiceInputLevel, voiceLevelMonitor, voiceMessageCommand, voiceMessagesChanged, voiceMicrophoneCommand, voiceRequestMessages, voiceRequestSnapshot, voiceSnapshotChanged } from '../services/speech/bus'

/** Windows render host snapshots and send named commands. They do not acquire audio resources. */
export const useVoiceControlsStore = defineStore('voice-controls', () => {
  const snapshot = shallowRef<VoiceHostSnapshot>({ connected: false, drafts: [] })
  const error = shallowRef<string>()
  const messages = shallowRef<readonly VoiceMessageSnapshot[]>([])
  /** The latest microphone level from the host. It keeps its last value after capture ends, so controls reset their own display. */
  const level = shallowRef(0)
  const context = getSpeechBusContext()
  let connection = new AbortController()
  const stop = context.on(voiceSnapshotChanged, ({ body }) => {
    if (!body)
      return
    snapshot.value = body
    error.value = body.error
    if (!body.connected)
      connection.abort('Voice host detached')
    else if (connection.signal.aborted)
      connection = new AbortController()
  })
  context.emit(voiceRequestSnapshot, undefined)
  const stopMessages = context.on(voiceMessagesChanged, ({ body }) => {
    messages.value = body ?? []
  })
  context.emit(voiceRequestMessages, undefined)
  const stopLevel = context.on(voiceInputLevel, ({ body }) => {
    if (body)
      level.value = body.level
  })

  async function messageCommand(command: VoiceMessageCommand) {
    if (!snapshot.value.connected)
      throw new Error('Voice host is unavailable')
    error.value = undefined
    try {
      return await defineInvoke(context, voiceMessageCommand)(command, { signal: connection.signal })
    }
    catch (cause) {
      error.value = errorMessageFrom(cause) ?? 'Voice message command failed'
      throw cause
    }
  }

  async function command(command: VoiceInputCommand) {
    if (!snapshot.value.connected)
      throw new Error('Voice host is unavailable')
    error.value = undefined
    try {
      return await defineInvoke(context, voiceInputCommand)(command, { signal: connection.signal })
    }
    catch (cause) {
      error.value = errorMessageFrom(cause) ?? 'Voice command failed'
      throw cause
    }
  }

  /** Asks the host to publish the level for `durationMs`. Call it again before that ends to keep the meter live. */
  function monitorLevel(durationMs: number) {
    if (!snapshot.value.microphone?.enabled || !snapshot.value.microphone.ready)
      return
    context.emit(voiceLevelMonitor, { until: Date.now() + durationMs })
  }

  async function setMicrophoneEnabled(enabled: boolean, continuous = enabled) {
    if (!snapshot.value.connected)
      throw new Error('Voice host is unavailable')
    error.value = undefined
    try {
      return await defineInvoke(context, voiceMicrophoneCommand)({ enabled, continuous }, { signal: connection.signal })
    }
    catch (cause) {
      if (!(cause instanceof Error) || cause.name !== 'AbortError')
        error.value = errorMessageFrom(cause) ?? 'Microphone command failed'
      throw cause
    }
  }

  async function setContinuousListening(enabled: boolean) {
    if (!enabled && !snapshot.value.microphone?.enabled && !snapshot.value.microphone?.pending)
      return { status: 'accepted' as const }
    return setMicrophoneEnabled(true, enabled)
  }

  onScopeDispose(() => {
    stop()
    stopMessages()
    stopLevel()
    connection.abort('Voice controls disposed')
  })
  return { snapshot, messages, level, error, command, messageCommand, monitorLevel, setMicrophoneEnabled, setContinuousListening, microphoneEnabled: computed(() => snapshot.value.microphone?.enabled === true), microphoneActive: computed(() => snapshot.value.microphone?.ready === true), continuousListening: computed(() => snapshot.value.microphone?.listening === true), microphonePending: computed(() => snapshot.value.microphone?.pending === true) }
})
