<script setup lang="ts">
import { HearingConfig } from '@proj-airi/stage-ui/components'
import { useHearingStore } from '@proj-airi/stage-ui/stores/modules/hearing'
import { storeToRefs } from 'pinia'
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle, VisuallyHidden } from 'reka-ui'
import { nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const show = defineModel('show', { type: Boolean, default: false })
const { autoSendEnabled } = storeToRefs(useHearingStore())
const { t } = useI18n()
let trigger: HTMLElement | undefined
watch(show, async (open) => {
  if (open) {
    trigger = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    return
  }
  await nextTick()
  if (trigger?.isConnected)
    trigger.focus()
})
</script>

<template>
  <slot />
  <!-- Opening device settings never requests permission or creates a second capture/analyzer owner. -->
  <DialogRoot :open="show" @update:open="show = $event">
    <DialogPortal>
      <DialogOverlay :class="['fixed inset-0 z-[9999]']" />
      <DialogContent :aria-describedby="undefined" :class="['fixed left-1/2 top-1/2 z-[9999] max-h-[90vh] w-[min(440px,92vw)] overflow-y-auto rounded-2xl bg-white p-6 text-neutral-900 shadow-xl outline-none -translate-x-1/2 -translate-y-1/2 dark:bg-neutral-900 dark:text-neutral-100']">
        <VisuallyHidden>
          <DialogTitle>{{ t('tamagotchi.stage.controls-island.open-hearing-controls') }}</DialogTitle>
        </VisuallyHidden>
        <HearingConfig v-model:auto-send="autoSendEnabled" />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
