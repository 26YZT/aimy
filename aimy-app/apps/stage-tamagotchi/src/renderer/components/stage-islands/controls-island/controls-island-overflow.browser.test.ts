import type { VoiceHostSnapshot } from '@proj-airi/stage-ui/services/speech/bus'

import en from '@proj-airi/i18n/locales/en'

import { defineInvokeHandler } from '@moeru/eventa'
import { configureLocalOnly } from '@proj-airi/stage-ui/services/local-data-policy'
import { getSpeechBusContext, voiceMicrophoneCommand, voiceRequestSnapshot, voiceSnapshotChanged } from '@proj-airi/stage-ui/services/speech/bus'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { useSettings, useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings'
import { useVoiceControlsStore } from '@proj-airi/stage-ui/stores/voice-controls'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h, ref } from 'vue'
import { createI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

import ControlsIslandRoot from './controls-island-root.vue'
import ControlsIsland from './index.vue'

import { electronOpenSettings } from '../../../../shared/eventa'
import { useScreenSharingStore } from '../../../stores/screen-sharing'

import '@unocss/reset/tailwind.css'
import '@proj-airi/ui/main.css'
import 'virtual:uno.css'

const outside = ref(false)
const openSettings = vi.fn().mockResolvedValue(undefined)
vi.mock('@proj-airi/electron-vueuse', () => ({
  getElectronEventaContext: () => ref({ on: vi.fn(() => vi.fn()), emit: vi.fn() }),
  useElectronEventaContext: () => ref({ on: vi.fn(() => vi.fn()), emit: vi.fn() }),
  useElectronEventaInvoke: (event: unknown) => event === electronOpenSettings ? openSettings : vi.fn().mockResolvedValue(false),
  useElectronMouseInElement: () => ({ isOutside: outside }),
}))
vi.mock('@moeru/eventa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@moeru/eventa')>()
  return { ...actual, defineInvoke: (context: Parameters<typeof actual.defineInvoke>[0], event: Parameters<typeof actual.defineInvoke>[1]) => event === voiceMicrophoneCommand ? actual.defineInvoke(context, event) : vi.fn() }
})
vi.mock('@proj-airi/stage-ui/libs/auth-fetch', () => ({ authedFetch: () => {
  throw new Error('No cloud in rail fixture')
} }))

const hostDisposers: Array<() => void> = []

const mounts: Array<{ screen: Awaited<ReturnType<typeof render>>, pinia: ReturnType<typeof createPinia> }> = []
async function mountRail() {
  const pinia = createPinia()
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
  const view = defineComponent({ setup() {
    useSettingsAudioDevice()
    return () => h(ControlsIslandRoot, { frozen: false }, { default: () => h(ControlsIsland) })
  } })
  const screen = await render(view, { global: { stubs: { 'transition': false, 'transition-group': false }, plugins: [pinia, i18n], directives: { 'track-button': {} } } })
  mounts.push({ screen, pinia })
  const island = screen.getByTestId('controls-island').element() as HTMLElement
  const main = screen.getByTestId('main-controls').element() as HTMLElement
  const label = (key: string) => i18n.global.t(`tamagotchi.stage.controls-island.${key}`)
  await vi.waitFor(() => expect(main.getBoundingClientRect().width).toBe(40))
  return { screen, pinia, island, main, label, sharing: useScreenSharingStore(pinia) }
}
function visibleButtons(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button')).filter(button => !button.closest('[inert]') && button.getBoundingClientRect().height > 0)
}
function expectColumn(container: HTMLElement) {
  const buttons = visibleButtons(container).filter(button => button.getBoundingClientRect().width >= 20)
  expect(buttons.length).toBeGreaterThan(4)
  for (const button of buttons) {
    const box = button.getBoundingClientRect()
    expect(Math.abs(box.right - (window.innerWidth - 8))).toBeLessThanOrEqual(1)
    expect(box.width, `${button.outerHTML.slice(0, 160)} ${JSON.stringify(box.toJSON())}`).toBe(40)
    expect(box.height, `${button.outerHTML.slice(0, 160)} ${JSON.stringify(box.toJSON())}`).toBe(40)
  }
}

beforeEach(() => {
  configureLocalOnly()
  outside.value = false
  openSettings.mockClear()
})
afterEach(() => {
  for (const dispose of hostDisposers.splice(0))
    dispose()
  vi.restoreAllMocks()
  for (const { screen, pinia } of mounts.splice(0)) {
    screen.unmount()
    disposePinia(pinia)
  }
})

describe('fixed right rail', () => {
  for (const [width, height] of [[450, 600], [640, 480], [220, 600], [300, 250]] as const) {
    it(`keeps every button in one column at ${width} x ${height}`, async () => {
      await page.viewport(width, height)
      const { screen, island, main, label } = await mountRail()
      expectColumn(main)
      await screen.getByLabelText(label('expand'), { exact: true }).click()
      await vi.waitFor(() => expect(island.dataset.direction).toBe('down'))
      await vi.waitFor(() => expectColumn(island))
      expect(island.getBoundingClientRect().right).toBe(width - 8)
      expect(island.getBoundingClientRect().height).toBeLessThanOrEqual(height - 16)
      await page.screenshot({ path: `__screenshots__/rail21-${width}-${height}.png` })
    })
  }

  it('keeps width and icon size stable for long names, errors and waiting states', async () => {
    await page.viewport(450, 600)
    const { screen, island, main, label, sharing, pinia } = await mountRail()
    const mainWidth = main.getBoundingClientRect().width
    sharing.error = 'SCREEN_PERMISSION_FAILED'
    expectColumn(main)
    expect(main.querySelector('[role="alert"]')).toBeNull()
    sharing.status = 'sharing'
    sharing.sourceName = 'A synthetic source with a long title '.repeat(10)
    sharing.lastObservedAt = null
    await vi.waitFor(() => expect(main.getBoundingClientRect().width).toBe(mainWidth))
    expect(main.querySelector('[role="status"]')).toBeNull()
    await screen.getByLabelText(label('expand'), { exact: true }).click()
    const auth = useAuthStore(pinia)
    auth.token = 'synthetic-test-token'
    auth.user = { id: 'synthetic', name: 'Long account name '.repeat(10), email: 'fixture@example.test', emailVerified: true, createdAt: new Date(0), updatedAt: new Date(0) }
    await vi.waitFor(() => expectColumn(island))
    useSettings(pinia).controlsIslandIconSize = 'small'
    await vi.waitFor(() => expectColumn(island))
    await page.screenshot({ path: '__screenshots__/rail21-long-state.png' })
  })

  it('scrolls a short window to every control and opens settings without moving the rail', async () => {
    await page.viewport(220, 180)
    const { screen, island, label } = await mountRail()
    await screen.getByLabelText(label('expand'), { exact: true }).click()
    await vi.waitFor(() => expectColumn(island))
    const buttons = visibleButtons(island).filter(button => button.getBoundingClientRect().width >= 20)
    for (const button of buttons) {
      button.focus()
      button.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      const rect = button.getBoundingClientRect()
      expect(rect.top).toBeGreaterThanOrEqual(7)
      expect(rect.bottom).toBeLessThanOrEqual(173)
      expect(rect.right).toBe(212)
    }
    await screen.getByLabelText(label('open-settings'), { exact: true }).click()
    expect(openSettings).toHaveBeenCalledWith({ route: '/settings' })
    await screen.getByLabelText(label('collapse'), { exact: true }).click()
    await vi.waitFor(() => expect(screen.getByTestId('controls-menu').element().closest('[aria-hidden]')?.getAttribute('aria-hidden')).toBe('true'))
  })

  it('keeps compact failures accessible through the icon without a wide inline message', async () => {
    await page.viewport(450, 600)
    const { main, sharing } = await mountRail()
    sharing.error = 'SCREEN_SYSTEM_PERMISSION_REQUIRED'
    const screenButton = main.querySelector<HTMLButtonElement>('.screen-share-rail-button')!
    await vi.waitFor(() => expect(screenButton.title.length).toBeGreaterThan(10))
    screenButton.click()
    await expect.element(page.getByRole('dialog')).toBeVisible()
    await expect.element(page.getByRole('alert')).toBeVisible()
    expect(main.getBoundingClientRect().width).toBe(40)
    expectColumn(main)
    await page.screenshot({ path: '__screenshots__/rail21-error-dialog.png' })
  })
  it('keeps the profile popup usable and preserves the tooltip portal', async () => {
    await page.viewport(450, 600)
    const { screen, island, label } = await mountRail()
    await screen.getByLabelText(label('expand'), { exact: true }).click()
    await vi.waitFor(() => expectColumn(island))
    await screen.getByRole('combobox').click()
    await expect.element(page.getByRole('listbox')).toBeVisible()
    expect(island.dataset.direction).toBe('down')
    await page.getByRole('listbox').element().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await screen.getByLabelText(label('open-settings'), { exact: true }).hover()
    await vi.waitFor(() => expect(document.querySelector('.controls-island-tooltip')).not.toBeNull())
    const portal = document.querySelector('[data-reka-popper-content-wrapper]:has(.controls-island-tooltip)')!
    expect(getComputedStyle(portal).zIndex).toBe('1000')
  })
  it('uses one click for microphone power and right-click or ArrowDown only for settings', async () => {
    const context = getSpeechBusContext()
    let snapshot: VoiceHostSnapshot = { connected: true, drafts: [], microphone: { enabled: false, ready: false, pending: false, listening: false } }
    const commands: Array<{ enabled: boolean, continuous?: boolean }> = []
    hostDisposers.push(context.on(voiceRequestSnapshot, () => context.emit(voiceSnapshotChanged, snapshot)))
    hostDisposers.push(defineInvokeHandler(context, voiceMicrophoneCommand, (command) => {
      commands.push(command)
      snapshot = { ...snapshot, microphone: { enabled: command.enabled, ready: false, pending: false, listening: command.enabled } }
      context.emit(voiceSnapshotChanged, snapshot)
      return { status: 'accepted' as const }
    }))
    await page.viewport(450, 600)
    const { screen, pinia } = await mountRail()
    const permission = vi.spyOn(useSettingsAudioDevice(pinia), 'askPermission')
    const button = screen.getByTestId('stage-microphone-button')
    await button.click()
    await vi.waitFor(() => expect(commands).toEqual([{ enabled: true, continuous: true }]))
    await expect.element(button).toHaveAttribute('aria-pressed', 'true')
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    await button.click()
    await vi.waitFor(() => expect(commands[1]).toEqual({ enabled: false, continuous: false }))
    await expect.element(button).toHaveAttribute('aria-pressed', 'false')
    await button.click({ button: 'right' })
    await expect.element(page.getByRole('dialog')).toBeVisible()
    expect(commands).toHaveLength(2)
    expect(permission).not.toHaveBeenCalled()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    button.element().focus()
    await userEvent.keyboard('{ArrowDown}')
    await expect.element(page.getByRole('dialog')).toBeVisible()
    expect(commands).toHaveLength(2)
    expect(permission).not.toHaveBeenCalled()
  })

  it('keeps pending microphone permission cancellable and reports a host failure', async () => {
    const context = getSpeechBusContext()
    const snapshot: VoiceHostSnapshot = { connected: true, drafts: [], microphone: { enabled: false, ready: false, pending: true, listening: false } }
    const commands: boolean[] = []
    hostDisposers.push(context.on(voiceRequestSnapshot, () => context.emit(voiceSnapshotChanged, snapshot)))
    hostDisposers.push(defineInvokeHandler(context, voiceMicrophoneCommand, (command) => {
      commands.push(command.enabled)
      throw new Error('Synthetic host failure')
    }))
    const notice = vi.spyOn(toast, 'error')
    await page.viewport(450, 600)
    const { screen, pinia } = await mountRail()
    const button = screen.getByTestId('stage-microphone-button')
    await expect.element(button).toHaveAttribute('aria-busy', 'true')
    await expect.element(button).toBeEnabled()
    await button.click()
    await vi.waitFor(() => expect(commands).toEqual([false]))
    await vi.waitFor(() => expect(notice).toHaveBeenCalledOnce())
    expect(useVoiceControlsStore(pinia).error).toContain('Synthetic host failure')
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  })
})
