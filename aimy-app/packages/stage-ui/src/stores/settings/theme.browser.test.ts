import { createPinia, disposePinia } from 'pinia'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { nextTick } from 'vue'

import { DEFAULT_THEME_COLORS_HUE, useSettingsTheme } from './theme'

const piniaInstances: ReturnType<typeof createPinia>[] = []
function instance() {
  const pinia = createPinia()
  piniaInstances.push(pinia)
  return useSettingsTheme(pinia)
}
beforeEach(() => localStorage.clear())
afterEach(() => {
  piniaInstances.splice(0).forEach(disposePinia)
  localStorage.clear()
})
it('starts with rose and persists a later choice across store recreation', async () => {
  const first = instance()
  expect(first.themeColorsHue).toBe(DEFAULT_THEME_COLORS_HUE)
  first.setThemeColorsHue(135)
  await nextTick()
  expect(instance().themeColorsHue).toBe(135)
})
it('moves the old factory hue once, then respects a manual return to that hue', async () => {
  localStorage.setItem('settings/theme/colors/hue', '220.44')
  const first = instance()
  expect(first.themeColorsHue).toBe(DEFAULT_THEME_COLORS_HUE)
  await nextTick()
  first.setThemeColorsHue(220.44)
  await nextTick()
  expect(instance().themeColorsHue).toBe(220.44)
})
it('preserves a custom or dynamic theme and can reset to the new default', async () => {
  localStorage.setItem('settings/theme/colors/hue', '140')
  localStorage.setItem('settings/theme/colors/hue-dynamic', 'true')
  const theme = instance()
  expect(theme.themeColorsHue).toBe(140)
  expect(theme.themeColorsHueDynamic).toBe(true)
  theme.resetState()
  await nextTick()
  expect(theme.themeColorsHue).toBe(DEFAULT_THEME_COLORS_HUE)
  expect(theme.themeColorsHueDynamic).toBe(false)
})
it('reflects a deliberate color change in another local settings instance', async () => {
  const first = instance()
  const second = instance()
  first.setThemeColorsHue(80)
  await nextTick()
  await nextTick()
  expect(second.themeColorsHue).toBe(80)
})
