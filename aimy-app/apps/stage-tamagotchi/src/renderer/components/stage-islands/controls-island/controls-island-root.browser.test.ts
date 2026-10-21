import { expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { defineComponent, h } from 'vue'

import ControlsIslandRoot from './controls-island-root.vue'

import { useControlsIslandPlacement } from './use-controls-island-placement'

it('keeps the right dock across four viewport shapes and frozen interaction changes', async () => {
  const consumer = defineComponent({
    setup() {
      const placement = useControlsIslandPlacement()
      return () => h('output', { 'data-testid': 'placement' }, `${placement.dock.value}/${placement.motionPhase.value}/${placement.isLeft.value}`)
    },
  })
  const screen = await render(ControlsIslandRoot, { props: { frozen: false }, slots: { default: () => h(consumer) } })
  for (const [width, height, frozen] of [[450, 600, false], [600, 450, true], [250, 600, false], [600, 250, true]] as const) {
    await page.viewport(width, height)
    await screen.rerender({ frozen })
    await expect.element(screen.getByTestId('placement')).toHaveTextContent('top-right/idle/false')
  }
  screen.unmount()
})
