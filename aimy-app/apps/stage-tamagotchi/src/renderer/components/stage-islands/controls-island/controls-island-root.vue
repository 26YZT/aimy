<script setup lang="ts">
import type { ControlsIslandPlacement } from './use-controls-island-placement'

import { provide, readonly, ref } from 'vue'

import { controlsIslandPlacementKey } from './use-controls-island-placement'

// The Stage keeps this interaction prop for its click-through and collapse contract.
defineProps<{ frozen: boolean }>()
defineSlots<{ default: () => unknown }>()

const placement: ControlsIslandPlacement = {
  dock: readonly(ref('top-right' as const)),
  isLeft: readonly(ref(false)),
  isTop: readonly(ref(true)),
  motionPhase: readonly(ref('idle' as const)),
}
provide(controlsIslandPlacementKey, placement)
</script>

<template>
  <slot />
</template>
