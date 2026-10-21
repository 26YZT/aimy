import messages from '@proj-airi/i18n/locales'

import { createPinia, disposePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createI18n } from 'vue-i18n'

import CompanionSettings from './companion-settings.vue'

import { storage } from '../../../database/storage'
import { CompanionSettingsRepository } from '../../../services/companion/settings'

import '@proj-airi/ui/main.css'
import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

vi.mock('../../../composables/api', () => ({ client: {} }))
const pinia = createPinia()
const runtime = createSyncedPiniaPlugin({ namespace: `companion-ui:${crypto.randomUUID()}`, leadership: 'leader-only' })
pinia.use(runtime.plugin)
afterEach(async () => {
  runtime.dispose()
  disposePinia(pinia)
  await storage.removeItem('local:companion/settings/v1')
})

it('renders the actual localized settings, saves a choice, and rejects incomplete rules', async () => {
  await storage.removeItem('local:companion/settings/v1')
  await page.viewport(720, 900)
  const screen = await render(CompanionSettings, { global: { plugins: [pinia, createI18n({ legacy: false, locale: 'zh-Hans', fallbackLocale: 'en', missingWarn: false, fallbackWarn: false, messages })] } })
  screen.container.style.width = '600px'
  screen.container.style.padding = '24px'
  screen.container.style.boxSizing = 'border-box'
  screen.container.style.fontFamily = 'system-ui, sans-serif'
  await expect.poll(() => runtime.isLeader()).toBe(true)
  const input = page.getByRole('spinbutton', { name: '聊天结束后等待几分钟（1–60）' })
  await expect.element(input).toBeVisible()
  await input.fill('9')
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await expect.element(page.getByRole('status').first()).toHaveTextContent('已保存')
  expect((await new CompanionSettingsRepository().read()).preferences.followup.delayMinutes).toBe(9)
  expect((await new CompanionSettingsRepository().read()).preferences.followup.enabled).toBe(false)
  await page.getByRole('button', { name: '添加规则', exact: true }).click()
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await expect.element(page.getByRole('status').first()).toHaveTextContent('没有保存成功')
  expect((await new CompanionSettingsRepository().read()).rules).toEqual([])
  await page.getByRole('textbox', { name: '话题包含哪些文字（必填）' }).fill('工作')
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await expect.element(page.getByRole('status').first()).toHaveTextContent('已保存')
  expect((await new CompanionSettingsRepository().read()).rules).toHaveLength(1)
  const cards = screen.container.querySelectorAll('.h-fit')
  expect(cards.length).toBeGreaterThanOrEqual(5)
  for (const [index, card] of Array.from(cards).entries()) {
    card.scrollIntoView({ block: 'start' })
    await page.elementLocator(card).screenshot({ path: `/tmp/aimy-round2-root/companion-card-${index}.png` })
  }
})
