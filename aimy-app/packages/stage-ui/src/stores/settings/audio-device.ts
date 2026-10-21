import { errorMessageFrom } from '@moeru/std'
import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { refManualReset } from '@vueuse/core'
import { defineStore } from 'pinia'
import { onScopeDispose, ref, watch } from 'vue'

import { useAudioDevice } from '../../composables/audio'
import { disableResourceAccess, getResourcePolicy, onResourceRevoked, requestResourceAccess } from '../../services/resource-policy'

function isAbort(cause: unknown) {
  return cause instanceof DOMException && cause.name === 'AbortError'
}

/**
 * Stores microphone preferences and keeps the selected microphone open while it is enabled.
 *
 * `input` is the shared input for the selected device. Consumers subscribe with their own signal.
 * The enabled preference holds one extra subscription, so later consumers start without waiting for permission.
 */
export const useSettingsAudioDevice = defineStore('settings-audio-devices', () => {
  const selectedAudioInput = useLocalStorageManualReset<string>('settings/audio/input', '')
  const device = useAudioDevice(selectedAudioInput)
  // Desktop consent is a process-local choice. A saved continuous-listening preference cannot reopen capture at startup.
  const enabled = getResourcePolicy() ? refManualReset(false) : useLocalStorageManualReset<boolean>('settings/audio/input/enabled', false)
  const microphoneEnabled = ref(!getResourcePolicy() && enabled.value)
  const permissionPending = ref(false)
  const error = ref<string>()
  let permissionStatus: PermissionStatus | undefined
  let disposed = false
  let initialized = false
  let holding: AbortController | undefined
  let applyingHostRevocation = false
  let preservingPermission = false
  let permissionGeneration = 0
  let permissionRequest: { controller: AbortController, signal: AbortSignal, promise: Promise<void> } | undefined

  /** Holds the current input open. A failure other than release turns the preference off. */
  async function hold(requestAccess = false) {
    holding?.abort('Microphone hold replaced')
    if (!enabled.value || !initialized || getResourcePolicy()?.isWindowClosing) {
      return
    }

    const current = new AbortController()
    holding = current
    error.value = undefined
    try {
      const policy = getResourcePolicy()
      if (policy)
        await policy.ready()
      if (current.signal.aborted || !enabled.value)
        return
      if (requestAccess)
        await requestResourceAccess('microphone')
      else
        policy?.acquire('microphone').release()
      if (current.signal.aborted || !enabled.value)
        return
    }
    catch (cause) {
      if (holding === current && !current.signal.aborted) {
        error.value = errorMessageFrom(cause) ?? 'Could not start the microphone'
        enabled.value = false
      }
      return
    }
    void device.input.value.subscribe({ signal: current.signal }).pipeTo(new WritableStream()).catch((cause) => {
      if (holding !== current || current.signal.aborted || isAbort(cause))
        return
      error.value = errorMessageFrom(cause) || 'Could not start the microphone'
      enabled.value = false
    })
  }

  watch([enabled, device.input], ([value], [previous]) => void hold(value && !previous), { flush: 'sync' })
  watch(enabled, (value, previous) => {
    if (previous && !value && !applyingHostRevocation && !preservingPermission)
      void setMicrophoneEnabled(false).catch(() => {})
  }, { flush: 'sync' })
  const offRevoked = onResourceRevoked((reason, kind) => {
    if (!kind || kind === 'microphone') {
      holding?.abort('Microphone permission revoked')
      permissionGeneration++
      permissionRequest?.controller.abort(new DOMException('Microphone permission revoked', 'AbortError'))
      microphoneEnabled.value = false
      if (reason === 'window-close')
        return
      applyingHostRevocation = true
      try {
        enabled.value = false
      }
      finally {
        applyingHostRevocation = false
      }
    }
  })

  /** Only the audio host calls this before a user-requested recording or continuous-listening change. */
  async function requestCaptureAccess(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    if (microphoneEnabled.value && (!getResourcePolicy() || getResourcePolicy()?.state.microphone.enabled)) {
      getResourcePolicy()?.acquire('microphone').release()
      return
    }
    if (permissionRequest) {
      const previous = permissionRequest
      // A fresh user intent can wait out a cancelled recording without inheriting its cancellation.
      // Advancing first prevents that old request's cleanup from revoking the new intent.
      if (previous.signal.aborted) {
        const generation = ++permissionGeneration
        await previous.promise.catch(() => {})
        signal?.throwIfAborted()
        if (disposed || generation !== permissionGeneration)
          throw new DOMException('Microphone choice changed', 'AbortError')
        return requestCaptureAccess(signal)
      }
      const requestedGeneration = permissionGeneration
      try {
        await previous.promise
      }
      catch (cause) {
        signal?.throwIfAborted()
        if (requestedGeneration === permissionGeneration && previous.controller.signal.aborted && isAbort(cause))
          return requestCaptureAccess(signal)
        throw cause
      }
      signal?.throwIfAborted()
      return
    }
    const generation = ++permissionGeneration
    const controller = new AbortController()
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    permissionPending.value = true
    error.value = undefined
    const promise = (async () => {
      try {
        await device.askPermission(combined)
        combined.throwIfAborted()
        if (disposed || generation !== permissionGeneration)
          throw new DOMException('Microphone choice changed', 'AbortError')
        microphoneEnabled.value = true
      }
      catch (cause) {
        if (generation === permissionGeneration) {
          microphoneEnabled.value = false
          if (!isAbort(cause))
            error.value = errorMessageFrom(cause) ?? 'Could not start the microphone'
          await disableResourceAccess('microphone').catch(() => {})
        }
        throw cause
      }
      finally {
        permissionRequest = undefined
        permissionPending.value = false
      }
    })()
    permissionRequest = { controller, signal: combined, promise }
    return promise
  }

  /** Revocation precedes state publication so neither window can accept a late capture result. */
  async function setMicrophoneEnabled(value: boolean): Promise<void> {
    if (value)
      return requestCaptureAccess()
    permissionGeneration++
    permissionRequest?.controller.abort(new DOMException('Microphone disabled', 'AbortError'))
    microphoneEnabled.value = false
    holding?.abort('Microphone disabled')
    applyingHostRevocation = true
    try {
      enabled.value = false
    }
    finally {
      applyingHostRevocation = false
    }
    await disableResourceAccess('microphone')
  }

  /** Continuous listening is separate from permission and from one manually recorded message. */
  async function setContinuousListening(value: boolean): Promise<void> {
    if (value) {
      await requestCaptureAccess()
      if (!microphoneEnabled.value)
        throw new DOMException('Microphone choice changed', 'AbortError')
      getResourcePolicy()?.acquire('microphone').release()
    }
    preservingPermission = true
    try {
      enabled.value = value
    }
    finally {
      preservingPermission = false
    }
  }

  function initialize() {
    if (initialized || disposed)
      return
    initialized = true
    hold()
    void navigator.permissions?.query({ name: 'microphone' }).then((status) => {
      if (disposed)
        return
      permissionStatus = status
      status.onchange = () => {
        if (status.state !== 'granted')
          void setMicrophoneEnabled(false).catch(() => {})
      }
    }).catch(() => {})
  }

  /**
   * Requests microphone access and reports whether it succeeded.
   *
   * Denial is an expected user choice, so it never rejects. The reason stays in `error`.
   * Controls call this from watchers, where a rejection would reach the app error boundary.
   */
  async function askPermission(): Promise<boolean> {
    error.value = undefined
    try {
      await requestCaptureAccess()
      return true
    }
    catch (cause) {
      if (!isAbort(cause))
        error.value = errorMessageFrom(cause) || 'Could not start the microphone'
      return false
    }
  }

  function resetState() {
    error.value = undefined
    selectedAudioInput.reset()
    enabled.reset()
  }

  onScopeDispose(() => {
    offRevoked()
    disposed = true
    permissionGeneration++
    permissionRequest?.controller.abort(new DOMException('Microphone owner disposed', 'AbortError'))
    holding?.abort('Microphone settings disposed')
    if (permissionStatus)
      permissionStatus.onchange = null
  })

  return {
    error,
    enabled,
    microphoneEnabled,
    permissionPending,
    selectedAudioInput,
    audioInputs: device.audioInputs,
    audioInputOptions: device.audioInputOptions,
    deviceConstraints: device.deviceConstraints,
    permissionGranted: device.permissionGranted,
    stream: device.stream,
    input: device.input,
    source: device.source,
    askPermission,
    requestCaptureAccess,
    setMicrophoneEnabled,
    setContinuousListening,
    initialize,
    resetState,
  }
})
