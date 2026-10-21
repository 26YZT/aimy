import localforage from 'localforage'

import { autoAnimatePlugin } from '@formkit/auto-animate/vue'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { createI18n } from 'vue-i18n'

import fixtureUrl from '../../../../../docs/02-调研参考/2026-10-14-其余项目对照证据/charakuru/minimal-no-face.vrm?url'
import ModelSelector from '../components/scenarios/dialogs/model-selector/model-selector.vue'

import { useDisplayModelsStore } from '../stores/display-models'

const pinia = createPinia()

afterEach(async () => {
  vi.restoreAllMocks()
  const store = useDisplayModelsStore(pinia)
  for (const model of store.displayModels)
    await store.removeDisplayModel(model.id)
  disposePinia(pinia)
})

it('shows warnings in the actual selector and blocks a corrupt file before preview', async () => {
  const screen = await render(ModelSelector, {
    global: { plugins: [pinia, autoAnimatePlugin, createI18n({ legacy: false, locale: 'en', missingWarn: false, fallbackWarn: false, messages: {} })] },
  })
  const store = useDisplayModelsStore(pinia)
  await store.initialize()
  const input = screen.container.querySelector('input[type="file"][accept=".vrm"]')
  expect(input).not.toBeNull()
  const bytes = await (await fetch(fixtureUrl)).arrayBuffer()
  await userEvent.upload(input!, new File([bytes], 'synthetic.vrm'))
  await expect.element(page.getByRole('status')).toHaveTextContent('settings.model-select.vrm-report.warning')
  await expect.element(page.getByRole('button', { name: 'settings.model-select.vrm-report.import', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'settings.model-select.vrm-report.close', exact: true }).click()
  await expect.element(page.getByRole('status')).not.toBeInTheDocument()
  await userEvent.upload(input!, new File([bytes], 'synthetic.vrm'))
  // ROOT CAUSE: addDisplayModel swallowed write failures and published the model before persistence.
  // The selector now retains the pending file and shows an error until the write succeeds.
  const write = vi.spyOn(localforage, 'setItem').mockRejectedValueOnce(new Error('synthetic-storage-failure'))
  await page.getByRole('button', { name: 'settings.model-select.vrm-report.import', exact: true }).click()
  await expect.element(page.getByRole('alert')).toHaveTextContent('settings.model-select.vrm-report.import-failed')
  expect(store.displayModels).toEqual([])
  write.mockRestore()
  await page.getByRole('button', { name: 'settings.model-select.vrm-report.import', exact: true }).click()
  await expect.poll(() => store.displayModels[0]?.name).toBe('synthetic.vrm')
  expect(store.displayModels[0]?.previewImage).toContain('data:image/')
  expect((await store.getDisplayModel(store.displayModels[0]!.id))?.name).toBe('synthetic.vrm')
  await expect.element(page.getByRole('status')).not.toBeInTheDocument()
  await userEvent.upload(input!, new File(['broken'], 'broken.vrm'))
  await expect.element(page.getByRole('status')).toHaveTextContent('settings.model-select.vrm-report.errors.invalid-container')
  await expect.element(page.getByRole('button', { name: 'settings.model-select.vrm-report.import', exact: true })).not.toBeInTheDocument()
  expect(store.displayModels).toHaveLength(1)
})
