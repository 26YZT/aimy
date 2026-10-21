<script setup lang="ts">
import type { ProviderSecretAccessStatus } from '@proj-airi/stage-ui/services/provider-secret-storage'
import type { ChatSessionMeta } from '@proj-airi/stage-ui/types/chat-session'

import type { ChatDraftHandover } from '../../../shared/eventa'
import type { MessengerContact, MessengerConversation, MessengerTab } from './messenger-view.vue'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { extractMessageText } from '@proj-airi/stage-ui/libs/chat-sync/wire-message'
import { getProviderSecretStorage } from '@proj-airi/stage-ui/services/provider-secret-storage'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { BasicButton } from '@proj-airi/ui'
import { until, useEventListener } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onScopeDispose, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import InteractiveArea from '../InteractiveArea.vue'
import CharacterAvatarEditor from './character-avatar-editor.vue'
import MessengerView from './messenger-view.vue'

import { electronOpenSettings } from '../../../shared/eventa'
import { useScreenSharingStore } from '../../stores/screen-sharing'

const props = withDefaults(defineProps<{
  floating?: boolean
  composerFoldable?: boolean
  passive?: boolean
  expiredBefore?: number
  danmaku?: boolean
}>(), { floating: false, composerFoldable: false, passive: false, expiredBefore: 0, danmaku: false })
const composerFolded = defineModel<boolean>('composerFolded', { default: false })
const tab = defineModel<MessengerTab>('tab', { default: 'chats' })
const area = useTemplateRef<InstanceType<typeof InteractiveArea>>('area')
const { t, locale } = useI18n()
const auth = useAuthStore()
const cards = useAiriCardStore()
const sessions = useChatSessionStore()
const screenSharing = useScreenSharingStore()
const { activeCardId, activeCard } = storeToRefs(cards)
const { activeSessionId, sessionMetas, sessionMessages } = storeToRefs(sessions)
const openSettings = useElectronEventaInvoke(electronOpenSettings)
const avatarCardId = ref<string>()
const busy = ref(false)
const error = ref('')
const userId = computed(() => auth.userId || 'local')
const displayName = computed(() => auth.user?.name || t('tamagotchi.messenger.localUser'))
const activeName = computed(() => activeCard.value?.name || t('tamagotchi.messenger.companion'))
const ownedSessions = computed(() => Object.values(sessionMetas.value).filter(meta => meta.userId === userId.value))
// Draft handovers stay in this window only. A keyed original composer prevents another character inheriting text or attachments.
const drafts = new Map<string, Promise<ChatDraftHandover | undefined>>()
let draftGeneration = 0
let navigationDraft = ''
let mountedComposerOwner = userId.value
let disposed = false
onScopeDispose(() => {
  disposed = true
})

function cardAvatar(id: string): string | undefined {
  const avatar = cards.cards.get(id)?.metadata?.avatar
  return typeof avatar === 'string' && /^(?:https?:|data:image\/|blob:)/i.test(avatar) ? avatar : undefined
}

function preview(meta: ChatSessionMeta): string {
  const messages = sessionMessages.value[meta.sessionId] ?? []
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== 'user' && message.role !== 'assistant')
      continue
    const text = extractMessageText(message).replace(/\s+/g, ' ').trim()
    if (text)
      return text.length > 88 ? `${text.slice(0, 88)}…` : text
  }
  return meta.title || t('tamagotchi.messenger.newChat')
}

const conversations = computed<MessengerConversation[]>(() => ownedSessions.value
  .toSorted((a, b) => b.updatedAt - a.updatedAt)
  .map(meta => ({
    id: meta.sessionId,
    title: meta.title || cards.cards.get(meta.characterId)?.name || t('tamagotchi.messenger.newChat'),
    preview: preview(meta),
    time: new Intl.DateTimeFormat(locale.value, { month: 'numeric', day: 'numeric' }).format(new Date(meta.updatedAt)),
    avatar: cardAvatar(meta.characterId),
  })))
const contacts = computed<MessengerContact[]>(() => Array.from(cards.cards, ([id, card]) => ({
  id,
  name: card.name,
  description: card.nickname || t('tamagotchi.messenger.startWithCharacter'),
  avatar: cardAvatar(id),
})))

const interactionSourceId = crypto.randomUUID()
let targetRegistration = 0
let interactionClaimed = false
async function registerInteractionTarget(explicit = false) {
  if (document.visibilityState !== 'visible' || props.passive)
    return
  if (explicit) {
    interactionClaimed = true
  }
  else if (!interactionClaimed || (sessions.interactionTarget
    ? sessions.interactionTarget.sourceId !== interactionSourceId
    : !document.hasFocus())) {
    return
  }
  const generation = ++targetRegistration
  const id = activeSessionId.value
  const owner = userId.value
  const character = activeCardId.value
  await nextTick()
  const meta = sessionMetas.value[id]
  const current = () => !disposed && generation === targetRegistration && activeSessionId.value === id
    && userId.value === owner && activeCardId.value === character
    && document.visibilityState === 'visible' && !props.passive && interactionClaimed
    && (explicit || sessions.interactionTarget?.sourceId === interactionSourceId)
  if (!sessions.isReady || !current() || !meta || meta.userId !== owner || meta.characterId !== character)
    return
  try {
    await sessions.setInteractionSession(id, interactionSourceId)
  }
  catch {
    if (current())
      error.value = t('tamagotchi.messenger.navigationFailed')
  }
}
watch([activeSessionId, userId, activeCardId, () => sessions.isReady, () => sessionMetas.value[activeSessionId.value]?.userId, () => sessionMetas.value[activeSessionId.value]?.characterId], () => {
  void registerInteractionTarget()
}, { immediate: true, flush: 'post' })
useEventListener(window, 'focus', () => {
  void registerInteractionTarget(true)
})
useEventListener(window, 'blur', () => {
  interactionClaimed = false
  targetRegistration++
})
useEventListener(document, 'visibilitychange', () => {
  if (document.visibilityState !== 'visible') {
    interactionClaimed = false
    targetRegistration++
  }
})

/** Each transition stops sharing first and rejects a continuation after account or window changes. */
async function navigate(operation: (current: () => boolean) => Promise<void>) {
  if (busy.value)
    return
  busy.value = true
  error.value = ''
  const owner = userId.value
  const current = () => !disposed && userId.value === owner
  try {
    try {
      await screenSharing.stop()
    }
    catch (cause) {
      // Before Stage ownership exists there is no stream to stop. Other failures keep navigation closed.
      if (screenSharing.status !== 'off' || !(cause instanceof Error) || cause.message !== 'SCREEN_OWNER_UNAVAILABLE')
        throw cause
    }
    if (!current())
      return
    const previous = activeSessionId.value
    if (previous && area.value) {
      const captured = area.value.snapshotDraft().then(draft => draft && { ...draft, sessionId: previous })
      drafts.set(previous, captured)
      navigationDraft = previous
      await captured
    }
    if (current()) {
      await operation(current)
      if (current())
        await registerInteractionTarget()
    }
  }
  catch {
    if (current())
      error.value = t('tamagotchi.messenger.navigationFailed')
  }
  finally {
    navigationDraft = ''
    busy.value = false
  }
}

async function activateCharacter(id: string, current: () => boolean): Promise<boolean> {
  if (!cards.cards.has(id))
    throw new Error('Character is unavailable')
  if (activeCardId.value !== id) {
    if (!await cards.activateCard(id) || !current())
      return false
    await until(activeCardId).toBe(id, { timeout: 5000 })
    // Join the original card watcher before choosing this window's conversation.
    await nextTick()
    await sessions.ensureCurrentSession()
    await nextTick()
  }
  return current() && activeCardId.value === id
}

async function selectSession(id: string) {
  await navigate(async (current) => {
    const meta = ownedSessions.value.find(item => item.sessionId === id)
    if (!meta || !await activateCharacter(meta.characterId, current))
      return
    if (!current() || sessionMetas.value[id]?.userId !== userId.value)
      return
    await sessions.setActiveSession(id)
    if (current())
      tab.value = 'chats'
  })
}

async function selectContact(id: string) {
  await navigate(async (current) => {
    if (!await activateCharacter(id, current))
      return
    const selected = sessionMetas.value[activeSessionId.value]
    const sessionId = selected?.characterId === id && selected.userId === userId.value
      ? selected.sessionId
      : await sessions.ensureCharacterSession(id)
    if (!current() || activeCardId.value !== id)
      return
    await sessions.setActiveSession(sessionId)
    if (current())
      tab.value = 'chats'
  })
}

async function newSession() {
  await navigate(async (current) => {
    const characterId = activeCardId.value || 'default'
    const selectionBeforeCreation = activeSessionId.value
    // Persistence runs in the leader. Navigation stays in the window that received the click.
    const id = await sessions.createSession(characterId, { setActive: false })
    if (current() && activeCardId.value === characterId && activeSessionId.value === selectionBeforeCreation) {
      await sessions.setActiveSession(id)
      tab.value = 'chats'
    }
  })
}

const access = ref<ProviderSecretAccessStatus>()
const accessBusy = ref(false)
const accessError = ref(false)
const accessRetried = ref(false)
watch(userId, () => {
  drafts.clear()
  navigationDraft = ''
  draftGeneration++
}, { flush: 'sync' })
watch(activeSessionId, (next, previous) => {
  const owner = userId.value
  const generation = ++draftGeneration
  if (previous && area.value && owner === mountedComposerOwner && navigationDraft !== previous) {
    const captured = area.value.snapshotDraft().then(draft => draft && { ...draft, sessionId: previous })
    drafts.set(previous, captured)
    void captured.catch(() => {
      if (generation === draftGeneration && !disposed)
        error.value = t('tamagotchi.messenger.navigationFailed')
    })
  }
  navigationDraft = ''
  void (async () => {
    await nextTick()
    if (generation !== draftGeneration || owner !== userId.value || disposed)
      return
    mountedComposerOwner = owner
    const draft = await drafts.get(next)
    if (draft && generation === draftGeneration && owner === userId.value && !disposed)
      await area.value?.restoreDraft(draft, { navigate: false })
  })().catch(() => {
    if (generation === draftGeneration && !disposed)
      error.value = t('tamagotchi.messenger.navigationFailed')
  })
}, { flush: 'sync' })
onScopeDispose(() => drafts.clear())
const secrets = getProviderSecretStorage()
const accessMessage = computed(() => {
  if (accessError.value)
    return t('tamagotchi.messenger.accessFailed')
  if (access.value?.state === 'paused')
    return t('tamagotchi.messenger.accessPaused')
  if (accessRetried.value)
    return t('tamagotchi.messenger.accessRetryReady')
  return t('tamagotchi.messenger.accessExplanation')
})

async function refreshAccess() {
  if (accessBusy.value || !secrets.getAccessStatus)
    return
  accessBusy.value = true
  accessError.value = false
  try {
    const status = await secrets.getAccessStatus()
    if (!disposed)
      access.value = status
  }
  catch { accessError.value = true }
  finally { accessBusy.value = false }
}

async function retryAccess() {
  if (accessBusy.value || !access.value || !secrets.retryAccess)
    return
  accessBusy.value = true
  accessError.value = false
  try {
    const status = await secrets.retryAccess(access.value.generation)
    if (!disposed) {
      access.value = status
      accessRetried.value = true
    }
  }
  catch { accessError.value = true }
  finally { accessBusy.value = false }
}

watch(tab, (value) => {
  if (value === 'me')
    void refreshAccess()
}, { immediate: true })

const settingRows = computed(() => [
  { icon: 'i-lucide:user-round', key: 'myProfile', route: '/settings/memory' },
  { icon: 'i-lucide:heart-handshake', key: 'companionSettings', route: '/settings/companion' },
  { icon: 'i-lucide:audio-lines', key: 'voiceSettings', route: '/settings/modules/speech' },
  { icon: 'i-lucide:mic', key: 'hearingSettings', route: '/settings/modules/hearing' },
  { icon: 'i-lucide:monitor', key: 'visionSettings', route: '/settings/modules/vision' },
  { icon: 'i-lucide:bot', key: 'modelSettings', route: '/settings/providers' },
  { icon: 'i-lucide:settings', key: 'allSettings', route: '/settings' },
])

async function snapshotDraft(): Promise<ChatDraftHandover | undefined> {
  return area.value?.snapshotDraft()
}
async function restoreDraft(draft: ChatDraftHandover): Promise<boolean> {
  await until(activeSessionId).toMatch(Boolean, { timeout: 5000 })
  const owner = userId.value
  const meta = sessionMetas.value[draft.sessionId]
  if (!meta || meta.userId !== owner)
    return false
  if (activeSessionId.value !== draft.sessionId) {
    await sessions.setActiveSession(draft.sessionId)
    await nextTick()
  }
  if (disposed || userId.value !== owner || activeSessionId.value !== draft.sessionId)
    return false
  return await area.value?.restoreDraft(draft, { navigate: false }) ?? false
}
defineExpose({ snapshotDraft, restoreDraft, historyLayer: computed(() => area.value?.historyLayer ?? null) })
</script>

<template>
  <div
    :class="['messenger-window']"
    @pointerdown.capture="registerInteractionTarget(true)"
    @focusin.capture="registerInteractionTarget(true)"
  >
    <InteractiveArea
      v-if="props.danmaku" :key="`${userId}:${activeSessionId}`" ref="area" v-model:composer-folded="composerFolded"
      :floating="props.floating" :composer-foldable="props.composerFoldable"
      :passive="props.passive" :expired-before="props.expiredBefore"
    />
    <MessengerView
      v-else v-model:tab="tab" :conversations="conversations" :contacts="contacts"
      :active-session-id="activeSessionId" :active-contact-id="activeCardId" :active-name="activeName" :active-avatar="cardAvatar(activeCardId)"
      :busy="busy" :error="error"
      @select-session="selectSession" @select-contact="selectContact" @new-session="newSession"
      @manage-contacts="openSettings({ route: '/settings/airi-card' })" @edit-avatar="avatarCardId = $event"
    >
      <template #overlay>
        <CharacterAvatarEditor :card-id="avatarCardId" @close="avatarCardId = undefined" />
      </template>
      <div :class="['h-full min-h-0']" :inert="busy" :aria-busy="busy">
        <InteractiveArea
          :key="`${userId}:${activeSessionId}`" ref="area" v-model:composer-folded="composerFolded" appearance="messenger"
          :assistant-avatar="cardAvatar(activeCardId)" :user-avatar="auth.user?.image || undefined"
          :floating="props.floating" :composer-foldable="props.composerFoldable"
          :passive="props.passive" :expired-before="props.expiredBefore"
        />
      </div>
      <template #me>
        <div :class="['messenger-profile']">
          <div :class="['messenger-profile-avatar']" aria-hidden="true">
            <img v-if="auth.user?.image" :src="auth.user.image" alt=""><span v-else>{{ displayName.slice(0, 1) }}</span>
          </div>
          <div><h2>{{ displayName }}</h2><p>{{ t('tamagotchi.messenger.localProfileHint') }}</p></div>
        </div>
        <div :class="['messenger-settings-group']">
          <BasicButton v-for="item in settingRows" :key="item.key" size="unset" :class="['messenger-setting-row']" @click="openSettings({ route: item.route })">
            <span :class="[item.icon, 'size-5 messenger-setting-icon']" aria-hidden="true" /><span>{{ t(`tamagotchi.messenger.${item.key}`) }}</span><span :class="['i-lucide:chevron-right ml-auto size-4 text-neutral-400']" aria-hidden="true" />
          </BasicButton>
        </div>
        <section v-if="secrets.getAccessStatus" :class="['messenger-access']" :aria-label="t('tamagotchi.messenger.safeStorage')">
          <h3>{{ t('tamagotchi.messenger.safeStorage') }}</h3>
          <p role="status">
            {{ accessMessage }}
          </p>
          <div :class="['flex flex-wrap gap-3']">
            <BasicButton size="unset" :class="['messenger-access-button']" :disabled="accessBusy" @click="refreshAccess">
              {{ t('tamagotchi.messenger.refreshAccess') }}
            </BasicButton>
            <BasicButton v-if="access?.state === 'paused'" size="unset" :class="['messenger-access-button retry']" :disabled="accessBusy" @click="retryAccess">
              {{ t('tamagotchi.messenger.retryAccess') }}
            </BasicButton>
          </div>
        </section>
      </template>
    </MessengerView>
  </div>
</template>

<style scoped>
.messenger-window { container-type: inline-size; width: 100%; height: 100%; min-width: 0; min-height: 0; }
.messenger-profile { display: flex; gap: 18px; align-items: center; padding: 42px 28px; background: var(--messenger-panel); }
.messenger-profile-avatar { flex: 0 0 64px; height: 64px; display: grid; place-items: center; overflow: hidden; border-radius: 50%; background: var(--messenger-soft); color: var(--messenger-accent); font-size: 30px; }
.messenger-profile-avatar img { width: 100%; height: 100%; object-fit: cover; }
.messenger-profile h2 { margin: 0; font-size: 26px; font-weight: 500; }
.messenger-profile p { margin: 7px 0 0; font-size: 12px; color: var(--messenger-muted); }
.messenger-setting-icon { color: var(--messenger-accent); }
.messenger-settings-group { margin: 0 20px; background: var(--messenger-panel); }
.messenger-setting-row { display: flex; align-items: center; gap: 16px; width: 100%; padding: 18px 8px; border-bottom: 1px solid var(--messenger-line); border-radius: 0; text-align: left; }
.messenger-setting-row :deep(.basic-button-content) { width: 100%; justify-content: flex-start; gap: 16px; }
.messenger-setting-row:hover { background: color-mix(in srgb, var(--messenger-accent) 6%, var(--messenger-panel)); }
.messenger-access { margin: 18px 20px; padding: 18px; border-radius: 16px; background: var(--messenger-soft); }
.messenger-access h3 { margin: 0; font-size: 14px; font-weight: 500; }
.messenger-access p { margin: 10px 0 16px; font-size: 12px; line-height: 1.6; color: var(--messenger-muted); }
.messenger-access-button { padding: 8px 12px; border: 1px solid var(--messenger-line); border-radius: 6px; font-size: 12px; }
.messenger-access-button.retry { color: var(--messenger-accent); }
.messenger-setting-row:focus-visible, .messenger-access-button:focus-visible { outline: 2px solid var(--messenger-accent); outline-offset: -3px; }
</style>
