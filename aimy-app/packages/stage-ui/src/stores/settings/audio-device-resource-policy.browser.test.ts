import type { ResourceSnapshot } from '../../services/resource-policy'

import { createPinia, disposePinia } from 'pinia'
import { expect, it, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'

import { installResourcePolicy, ResourcePolicy } from '../../services/resource-policy'
import { useSettingsAudioDevice } from './audio-device'

it('closing a settings renderer releases its input without revoking the stage microphone', () => {
  const snapshot: ResourceSnapshot = {
    revision: 1,
    appEpoch: 0,
    active: true,
    reason: 'permission-on',
    microphone: { enabled: true, epoch: 1 },
    screen: { enabled: false, epoch: 0 },
  }
  const setEnabled = vi.fn(async () => snapshot)
  const stagePolicy = new ResourcePolicy({ setEnabled })
  const settingsPolicy = new ResourcePolicy({ setEnabled })
  stagePolicy.apply(snapshot)
  settingsPolicy.apply(snapshot)
  installResourcePolicy(settingsPolicy)
  const stageCapture = stagePolicy.acquire('microphone')
  const pinia = createPinia()
  let devices: ReturnType<typeof useSettingsAudioDevice> | undefined
  const app = createApp(defineComponent({ setup() {
    devices = useSettingsAudioDevice()
    return () => h('div')
  } }))
  app.use(pinia).use(createI18n({ legacy: false, locale: 'en', messages: { en: {} } }))
  const element = document.createElement('div')
  document.body.append(element)
  app.mount(element)
  try {
    devices!.enabled = true
    settingsPolicy.stopLocal('window-close')
    expect(devices!.enabled).toBe(true)
    expect(setEnabled).not.toHaveBeenCalled()
    expect(stageCapture.signal.aborted).toBe(false)
    expect(() => stageCapture.assertCurrent()).not.toThrow()
  }
  finally {
    app.unmount()
    disposePinia(pinia)
    element.remove()
    stageCapture.release()
    localStorage.removeItem('settings/audio/input/enabled')
  }
})
