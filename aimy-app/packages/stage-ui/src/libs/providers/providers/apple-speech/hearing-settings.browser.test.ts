import en from '@proj-airi/i18n/locales/en'

import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { computed, ref } from 'vue'
import { createI18n } from 'vue-i18n'

import AppleSpeechSettings from './hearing-settings.vue'

import { hearingProviderViewContextKey } from '../../hearing-view'

const mocks = vi.hoisted(() => ({ getLocales: vi.fn(async () => [{ locale: 'zh-CN', installed: true }]) }))

vi.mock('@moeru/eventa/adapters/electron/renderer', () => ({ createContext: () => ({ context: {}, dispose() {} }) }))
vi.mock('@proj-airi/stage-shared', () => ({ isElectronWindow: () => true }))
vi.mock('@xsai-apple-speech/transcription-electron-plugin', () => ({ createAppleSpeechProvider: () => ({ getLocales: mocks.getLocales }) }))

describe('apple Speech recognition settings', () => {
  it('saves the chosen mode through Hearing', async () => {
    const config = ref<Record<string, unknown>>({ locale: 'zh-CN', transcriber: 'automatic' })
    const update = vi.fn(async (patch: Record<string, unknown>) => {
      config.value = { ...config.value, ...patch }
    })
    const screen = await render(AppleSpeechSettings, {
      global: {
        plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })],
        provide: { [hearingProviderViewContextKey as symbol]: { providerConfig: computed(() => config.value), updateProviderConfig: update } },
      },
    })
    await screen.getByRole('combobox').first().click()
    await screen.getByRole('option', { name: 'Dictation (short messages)', exact: true }).click()
    expect(update).toHaveBeenCalledWith({ transcriber: 'dictation' })
    expect(config.value.transcriber).toBe('dictation')
  })
})
