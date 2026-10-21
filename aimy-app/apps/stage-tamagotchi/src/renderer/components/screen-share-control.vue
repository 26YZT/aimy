<script setup lang="ts">
import type { ScreenSharingMode } from '../stores/screen-sharing'

import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { BasicButton } from '@proj-airi/ui'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { computed, onScopeDispose, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import ControlButton from './stage-islands/controls-island/control-button.vue'

import { useScreenSharingStore } from '../stores/screen-sharing'

const props = defineProps<{ compact?: boolean, useStageSession?: boolean, buttonStyle?: string, iconClass?: string }>()
const emit = defineEmits<{ interactionChange: [active: boolean] }>()
const requestId = ref('')
const screen = useScreenSharingStore()
const sessions = useChatSessionStore()
const { t } = useI18n()
const open = ref(false)
const busy = ref(false)
const localError = ref('')
const active = computed(() => screen.status === 'sharing' || screen.status === 'starting')
const errorCode = computed(() => localError.value || screen.error)
const knownErrors = new Set(['SCREEN_OWNER_UNAVAILABLE', 'SCREEN_MODE_INVALID', 'SCREEN_MODEL_REQUIRED', 'SCREEN_SYSTEM_PERMISSION_REQUIRED', 'SCREEN_NO_SOURCES', 'SCREEN_PERMISSION_FAILED', 'SCREEN_VIDEO_TIMEOUT', 'SCREEN_READ_FAILED', 'SCREEN_CHOICE_REQUIRED', 'SCREEN_SOURCE_INVALID', 'SCREEN_START_FAILED', 'SCREEN_SESSION_UNAVAILABLE', 'SCREEN_CHOICE_EXPIRED'])
const errorText = computed(() => errorCode.value ? t(`tamagotchi.screenSharing.errors.${knownErrors.has(errorCode.value) ? errorCode.value : 'SCREEN_START_FAILED'}`) : '')
const statusText = computed(() => {
  if (screen.status === 'sharing')
    return t(`tamagotchi.screenSharing.${screen.lastObservedAt ? 'sharing' : 'waiting'}`, { source: screen.sourceName })
  return t(`tamagotchi.screenSharing.status.${screen.status}`)
})
async function act(action: () => Promise<unknown>) {
  busy.value = true
  localError.value = ''
  try {
    await action()
  }
  catch (error) {
    localError.value = error instanceof Error && knownErrors.has(error.message) ? error.message : 'SCREEN_START_FAILED'
  }
  finally {
    busy.value = false
  }
}
function inspectOrChoose(mode: ScreenSharingMode) {
  if (props.compact && errorText.value) {
    open.value = true
    return
  }
  void choose(mode)
}
async function choose(mode: ScreenSharingMode) {
  requestId.value = crypto.randomUUID()
  open.value = true
  await act(() => screen.choose(mode, props.useStageSession ? undefined : sessions.activeSessionId, requestId.value))
}
async function start(id: string) {
  await act(() => screen.start(id, requestId.value))
  if (active.value)
    open.value = false
}
async function stop() {
  await act(() => screen.stop())
  open.value = false
}
function close(value: boolean) {
  const wasOpen = open.value
  open.value = value
  if (!value && wasOpen && (busy.value || screen.status === 'choosing' || screen.status === 'starting'))
    void act(() => screen.cancelChoice(requestId.value))
}
watch(errorText, (message) => {
  if (props.compact && message && requestId.value)
    open.value = true
})
watch([open, busy], ([isOpen, pending]) => emit('interactionChange', isOpen || pending), { immediate: true })
onScopeDispose(() => {
  emit('interactionChange', false)
  if (open.value && requestId.value && (busy.value || screen.status === 'choosing' || screen.status === 'starting'))
    void screen.cancelChoice(requestId.value).catch(() => {})
})
</script>

<template>
  <div :class="['screen-share-control', { compact }]">
    <div :class="['screen-share-buttons']">
      <component
        :is="compact ? ControlButton : BasicButton"
        :button-style="compact ? (buttonStyle || 'size-10! min-w-10! min-h-10! shrink-0!') : undefined"
        :class="[compact ? 'screen-share-rail-button' : 'screen-share-button', { active, failed: !!errorText }]"
        :aria-label="t(`tamagotchi.screenSharing.${active ? 'stop' : 'start'}`)"
        :title="errorText || statusText"
        :aria-pressed="active" :disabled="busy && !active"
        @click="active ? stop() : inspectOrChoose('screen')"
      >
        <span :class="[active ? 'i-lucide:monitor-off' : 'i-lucide:monitor', iconClass || 'size-5']" aria-hidden="true" />
        <span v-if="!compact">{{ t(`tamagotchi.screenSharing.${active ? 'stop' : 'start'}`) }}</span>
      </component>
      <component
        :is="compact ? ControlButton : BasicButton"
        :button-style="compact ? (buttonStyle || 'size-10! min-w-10! min-h-10! shrink-0!') : undefined"
        :class="[compact ? 'screen-share-rail-button' : 'screen-share-button', { active: active && screen.mode === 'game' }]" :disabled="busy"
        :aria-pressed="active && screen.mode === 'game'"
        :aria-label="t('tamagotchi.screenSharing.game')" :title="t('tamagotchi.screenSharing.game')"
        @click="inspectOrChoose('game')"
      >
        <span :class="['i-lucide:gamepad-2', iconClass || 'size-5']" aria-hidden="true" />
        <span v-if="!compact">{{ t('tamagotchi.screenSharing.game') }}</span>
      </component>
    </div>
    <p v-if="!compact" :class="['screen-share-status']" role="status">
      {{ statusText }}
    </p>
    <p v-if="!compact && errorText && !open" :class="['screen-share-error']" role="alert">
      {{ errorText }}
    </p>
    <DialogRoot :open="open" @update:open="close">
      <DialogPortal>
        <DialogOverlay :class="['fixed inset-0 z-100 bg-black/40']" />
        <DialogContent :class="['screen-share-dialog fixed left-1/2 top-1/2 z-101 w-[min(440px,92vw)] max-h-[85vh] flex flex-col gap-4 overflow-y-auto rounded-xl bg-white p-5 text-neutral-900 shadow-lg dark:bg-neutral-900 dark:text-neutral-100']">
          <DialogTitle :class="['text-lg font-semibold']">
            {{ t(`tamagotchi.screenSharing.${screen.mode === 'game' ? 'game' : 'choose'}`) }}
          </DialogTitle>
          <DialogDescription :class="['text-sm text-neutral-600 dark:text-neutral-300']">
            {{ t('tamagotchi.screenSharing.disclosure') }}
          </DialogDescription>
          <p v-if="screen.mode === 'game'" :class="['text-sm']">
            {{ t('tamagotchi.screenSharing.gameNote') }}
          </p>
          <p v-if="compact" role="status">
            {{ statusText }}
          </p>
          <BasicButton v-if="compact && errorText && !busy" @click="choose(screen.mode)">
            {{ t('tamagotchi.screenSharing.start') }}
          </BasicButton>
          <p v-if="busy" role="status">
            {{ t('tamagotchi.screenSharing.loading') }}
          </p>
          <p v-if="errorText" role="alert">
            {{ errorText }}
          </p>
          <div :class="['flex flex-col gap-2']">
            <BasicButton v-for="source in screen.sources" :key="source.id" :disabled="busy" @click="start(source.id)">
              <span :class="[source.kind === 'screen' ? 'i-lucide:monitor' : 'i-lucide:app-window', 'size-5 shrink-0']" aria-hidden="true" />
              <span :class="['min-w-0 break-all text-left']">{{ source.name }}</span>
            </BasicButton>
          </div>
          <BasicButton v-if="active" @click="stop()">
            {{ t('tamagotchi.screenSharing.stop') }}
          </BasicButton>
          <BasicButton variant="secondary" @click="close(false)">
            {{ t('tamagotchi.screenSharing.cancel') }}
          </BasicButton>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  </div>
</template>

<style scoped>
.screen-share-buttons { display: flex; flex-wrap: wrap; gap: 6px; }
.screen-share-button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 36px; padding: 8px; border-radius: 8px; }
.screen-share-button.active { background: var(--aimy-soft, #f6edf1); color: var(--aimy-accent, #98546c); }
.screen-share-status { max-width: 26em; margin: 4px 0 0; font-size: 12px; color: #647267; overflow-wrap: anywhere; }
.screen-share-error { max-width: 26em; font-size: 12px; color: #b44424; }
.screen-share-dialog { transform: translate(-50%, -50%); }
.compact, .compact .screen-share-buttons { display: contents; }
.screen-share-rail-button.active { background: var(--aimy-surface-accent, #f0e3e8); }
.screen-share-rail-button.failed { outline: 1px solid #a85c72; outline-offset: -2px; }
</style>
