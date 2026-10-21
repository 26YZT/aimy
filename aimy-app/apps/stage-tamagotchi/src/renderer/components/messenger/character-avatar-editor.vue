<script setup lang="ts">
import type { CharacterAvatarCancellation, CharacterAvatarErrorCode } from '@proj-airi/stage-ui/libs/character-avatar/index'

import { CharacterAvatarError, prepareCharacterAvatar } from '@proj-airi/stage-ui/libs/character-avatar/index'
import { onResourceRevoked } from '@proj-airi/stage-ui/services/resource-policy'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { BasicButton, FieldInputFile } from '@proj-airi/ui'
import { DialogContent, DialogDescription, DialogOverlay, DialogRoot, DialogTitle } from 'reka-ui'
import { computed, onScopeDispose, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ cardId?: string }>()
const emit = defineEmits<{ close: [], saved: [] }>()
const cards = useAiriCardStore()
const auth = useAuthStore()
const { t } = useI18n()
const card = computed(() => props.cardId ? cards.cards.get(props.cardId) : undefined)
const files = ref<File[]>()
const prepared = ref<string | null>()
const preparing = ref(false)
const saving = ref(false)
const error = ref<CharacterAvatarErrorCode>()
const savedAvatar = computed(() => typeof card.value?.metadata?.avatar === 'string' ? card.value.metadata.avatar : null)
const preview = computed(() => prepared.value === undefined ? savedAvatar.value : prepared.value)
let generation = 0
let expectedAvatar: string | null = null
let ownerAtOpen = ''
let activeAtOpen = ''
let disposed = false
let pendingSave: CharacterAvatarCancellation | undefined

function cancelPendingSave() {
  const token = pendingSave
  pendingSave = undefined
  saving.value = false
  if (token)
    void cards.cancelCardAvatar(token).catch(() => {})
}
function invalidate() {
  cancelPendingSave()
  generation++
  preparing.value = false
  prepared.value = undefined
  files.value = undefined
}
function close() {
  invalidate()
  emit('close')
}
function current(version: number, id: string) {
  return !disposed && generation === version && props.cardId === id
    && auth.userId === ownerAtOpen && cards.activeCardId === activeAtOpen && cards.cards.has(id)
}
function showError(cause: unknown) {
  const codes: CharacterAvatarErrorCode[] = ['format', 'size', 'image', 'dimensions', 'encoded-size', 'missing', 'changed', 'storage']
  error.value = cause instanceof CharacterAvatarError
    ? cause.code
    : codes.find(code => cause instanceof Error && cause.message === `Character avatar: ${code}`) ?? 'storage'
}

watch([() => props.cardId, () => auth.userId, () => cards.activeCardId, () => Boolean(card.value)], ([id, owner, active, exists], previous) => {
  invalidate()
  error.value = undefined
  if (!id)
    return
  if (!exists || (previous && previous[0] === id && (previous[1] !== owner || previous[2] !== active))) {
    emit('close')
    return
  }
  expectedAvatar = savedAvatar.value
  ownerAtOpen = owner
  activeAtOpen = active
}, { immediate: true, flush: 'sync' })

watch(() => files.value?.[0], async (file) => {
  cancelPendingSave()
  const version = ++generation
  error.value = undefined
  prepared.value = undefined
  preparing.value = false
  if (!file || !props.cardId)
    return
  const id = props.cardId
  preparing.value = true
  try {
    const result = await prepareCharacterAvatar(file)
    if (current(version, id))
      prepared.value = result
  }
  catch (cause) {
    if (current(version, id))
      showError(cause)
  }
  finally {
    if (version === generation)
      preparing.value = false
  }
}, { flush: 'sync' })

function remove() {
  invalidate()
  prepared.value = null
  error.value = undefined
}

async function save() {
  if (!props.cardId || prepared.value === undefined || preparing.value || saving.value)
    return
  const id = props.cardId
  const version = generation
  if (!current(version, id))
    return
  const token = { requestId: crypto.randomUUID(), requestedAt: Date.now(), ownerId: ownerAtOpen }
  pendingSave = token
  saving.value = true
  error.value = undefined
  try {
    await cards.updateCardAvatar({ ...token, cardId: id, avatar: prepared.value, expectedAvatar, activeCardId: activeAtOpen })
    if (pendingSave?.requestId === token.requestId)
      pendingSave = undefined
    if (current(version, id)) {
      invalidate()
      emit('saved')
      emit('close')
    }
  }
  catch (cause) {
    if (current(version, id))
      showError(cause)
  }
  finally {
    if (pendingSave?.requestId === token.requestId) {
      pendingSave = undefined
      saving.value = false
    }
  }
}
const stopRevocation = onResourceRevoked((_, kind) => {
  if (!kind) {
    invalidate()
    emit('close')
  }
})
onScopeDispose(() => {
  disposed = true
  stopRevocation()
  invalidate()
})
</script>

<template>
  <DialogRoot :open="Boolean(props.cardId)" @update:open="value => !value && close()">
    <DialogOverlay :class="['avatar-editor-overlay']" />
    <DialogContent :class="['avatar-editor']">
      <DialogTitle :class="['avatar-editor-title']">
        {{ t('tamagotchi.avatar.title', { name: card?.name || '' }) }}
      </DialogTitle>
      <DialogDescription :class="['avatar-editor-description']">
        {{ t('tamagotchi.avatar.description') }}
      </DialogDescription>
      <div :class="['avatar-editor-preview']" role="img" :aria-label="t('tamagotchi.avatar.preview')">
        <img v-if="preview" :src="preview" alt="" referrerpolicy="no-referrer"><span v-else>{{ Array.from(card?.name || '?')[0] }}</span>
      </div>
      <fieldset :disabled="saving" :class="['avatar-editor-file']">
        <FieldInputFile v-model="files" accept="image/png,image/jpeg,image/webp" :label="t('tamagotchi.avatar.choose')" :description="t('tamagotchi.avatar.limits')" :placeholder="t('tamagotchi.avatar.choose')" />
      </fieldset>
      <p v-if="preparing" role="status" :class="['avatar-editor-description']">
        {{ t('tamagotchi.avatar.preparing') }}
      </p>
      <p v-if="error" role="alert" :class="['avatar-editor-error']">
        {{ t(`tamagotchi.avatar.errors.${error}`) }}
      </p>
      <div :class="['avatar-editor-actions']">
        <BasicButton size="unset" :class="['avatar-editor-button']" :disabled="saving || !savedAvatar" @click="remove">
          {{ t('tamagotchi.avatar.remove') }}
        </BasicButton>
        <BasicButton size="unset" :class="['avatar-editor-button']" @click="close">
          {{ t('tamagotchi.avatar.cancel') }}
        </BasicButton>
        <BasicButton size="unset" :class="['avatar-editor-button primary']" :disabled="saving || preparing || prepared === undefined" @click="save">
          {{ t(saving ? 'tamagotchi.avatar.saving' : 'tamagotchi.avatar.save') }}
        </BasicButton>
      </div>
    </DialogContent>
  </DialogRoot>
</template>

<style scoped>
.avatar-editor-overlay { position: absolute; inset: 0; z-index: 70; background: color-mix(in srgb, var(--messenger-ink) 25%, transparent); }
.avatar-editor { position: absolute; left: 50%; top: 50%; z-index: 71; width: min(360px, calc(100% - 32px)); max-height: calc(100% - 32px); overflow: auto; transform: translate(-50%, -50%); padding: 22px; border: 1px solid var(--messenger-line); border-radius: 16px; background: var(--messenger-panel); color: var(--messenger-ink); box-shadow: 0 12px 32px color-mix(in srgb, var(--messenger-ink) 12%, transparent); }
.avatar-editor-title { margin: 0; font-size: 17px; font-weight: 600; }
.avatar-editor-description { margin: 10px 0; font-size: 12px; line-height: 1.6; color: var(--messenger-muted); }
.avatar-editor-preview { display: grid; place-items: center; width: 96px; height: 96px; margin: 20px auto; overflow: hidden; border-radius: 50%; background: var(--messenger-soft); color: var(--messenger-accent); font-size: 34px; }
.avatar-editor-preview img { width: 100%; height: 100%; object-fit: cover; }
.avatar-editor-file { border: 0; padding: 0; margin: 0; min-width: 0; }
.avatar-editor-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
.avatar-editor-button { padding: 9px 12px; border-radius: 8px; border: 1px solid var(--messenger-line); color: var(--messenger-ink); }
.avatar-editor-button.primary { background: var(--messenger-soft); color: var(--messenger-ink); border-color: var(--messenger-accent); }
.avatar-editor-button:focus-visible { outline: 2px solid var(--messenger-accent); outline-offset: 2px; }
.avatar-editor-error { font-size: 12px; line-height: 1.6; color: var(--messenger-ink); border-left: 3px solid var(--messenger-accent); padding-left: 10px; }
</style>
