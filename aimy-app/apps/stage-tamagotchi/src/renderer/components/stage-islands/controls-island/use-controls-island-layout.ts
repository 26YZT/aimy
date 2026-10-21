import type { Ref } from 'vue'

import { computed, nextTick, watch } from 'vue'

/** One vertical viewport owns the whole rail. Expanding never changes its width or moves controls sideways. */
export function useControlsIslandLayout(viewport: Readonly<Ref<HTMLElement | undefined>>, expanded: Ref<boolean>) {
  watch(expanded, async () => {
    await nextTick()
    // Start at the toggle when reopening. User scrolling then remains untouched.
    viewport.value?.scrollTo({ top: 0, left: 0 })
  }, { flush: 'post' })

  return {
    direction: computed(() => 'down' as const),
    scrollWholeIsland: computed(() => true),
    panelStyle: computed(() => ({ maxWidth: '40px' })),
    layoutClasses: computed(() => ['flex-col-reverse', 'items-end']),
    arrowRotation: computed(() => expanded.value ? 0 : 180),
    motionOffset: computed(() => '0, -0.5rem'),
  }
}
