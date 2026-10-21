<script lang="ts">
/** A local presentation of existing session metadata. This view never saves conversations. */
</script>

<script setup lang="ts">
import { BasicButton, Input } from '@proj-airi/ui'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import '../../styles/aimy-palette.css'

export interface MessengerConversation {
  id: string
  title: string
  preview: string
  time: string
  avatar?: string
}
/** A selectable projection of an existing character card. */
export interface MessengerContact {
  id: string
  name: string
  description: string
  avatar?: string
}
export type MessengerTab = 'chats' | 'contacts' | 'me'

const props = defineProps<{
  conversations: MessengerConversation[]
  contacts: MessengerContact[]
  activeSessionId: string
  activeContactId: string
  activeName: string
  activeAvatar?: string
  busy?: boolean
  error?: string
}>()
const emit = defineEmits<{
  selectSession: [id: string]
  selectContact: [id: string]
  newSession: []
  manageContacts: []
  editAvatar: [id: string]
}>()
const tab = defineModel<MessengerTab>('tab', { default: 'chats' })
const conversationOpen = ref(true)
const search = ref('')
const { t } = useI18n()
const visibleConversations = computed(() => props.conversations.filter(item => `${item.title} ${item.preview}`.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())))
const visibleContacts = computed(() => props.contacts.filter(item => item.name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())))
const tabs = computed(() => [
  { id: 'chats' as const, icon: 'i-lucide:message-circle', label: t('tamagotchi.messenger.chats') },
  { id: 'contacts' as const, icon: 'i-lucide:users-round', label: t('tamagotchi.messenger.contacts') },
  { id: 'me' as const, icon: 'i-lucide:user-round', label: t('tamagotchi.messenger.me') },
])
function selectSession(id: string) {
  conversationOpen.value = true
  emit('selectSession', id)
}
function selectContact(id: string) {
  conversationOpen.value = true
  emit('selectContact', id)
}
function selectTab(value: MessengerTab) {
  tab.value = value
  search.value = ''
  if (value === 'chats')
    conversationOpen.value = false
}
</script>

<template>
  <div
    :class="['messenger-view', { 'conversation-open': conversationOpen && tab === 'chats' }]"
    :data-messenger-tab="tab"
  >
    <nav :class="['messenger-navigation']" :aria-label="t('tamagotchi.messenger.navigation')">
      <span :class="['messenger-wordmark']" aria-hidden="true">A</span>
      <BasicButton
        v-for="item in tabs" :key="item.id" size="unset"
        :class="['messenger-nav-button', { selected: tab === item.id }]"
        :aria-current="tab === item.id ? 'page' : undefined"
        :aria-label="item.label" :disabled="busy"
        @click="selectTab(item.id)"
      >
        <span :class="[item.icon, 'size-6']" aria-hidden="true" />
        <span>{{ item.label }}</span>
      </BasicButton>
    </nav>

    <section v-show="tab !== 'me'" :class="['messenger-list']" :aria-label="t(`tamagotchi.messenger.${tab === 'contacts' ? 'contacts' : 'chats'}`)">
      <header :class="['messenger-list-heading']">
        <h1>{{ t(`tamagotchi.messenger.${tab === 'contacts' ? 'contacts' : 'chats'}`) }}</h1>
        <BasicButton
          size="unset" :class="['messenger-icon-button']" :disabled="busy"
          :aria-label="t(tab === 'contacts' ? 'tamagotchi.messenger.manageContacts' : 'tamagotchi.messenger.newChat')"
          @click="tab === 'contacts' ? emit('manageContacts') : emit('newSession')"
        >
          <span :class="['i-lucide:square-pen size-5']" aria-hidden="true" />
        </BasicButton>
      </header>
      <div :class="['messenger-search']">
        <span :class="['i-lucide:search size-4']" aria-hidden="true" />
        <Input v-model="search" :aria-label="t('tamagotchi.messenger.search')" :placeholder="t('tamagotchi.messenger.search')" />
      </div>
      <div :class="['messenger-list-scroll']">
        <template v-if="tab === 'chats'">
          <p v-if="!visibleConversations.length" :class="['messenger-empty-list']">
            {{ t('tamagotchi.messenger.noChats') }}
          </p>
          <BasicButton
            v-for="item in visibleConversations" :key="item.id" size="unset"
            :class="['messenger-list-row', { selected: activeSessionId === item.id }]"
            :disabled="busy" :aria-current="activeSessionId === item.id ? 'true' : undefined"
            @click="selectSession(item.id)"
          >
            <span :class="['messenger-avatar']" aria-hidden="true">
              <img v-if="item.avatar" :src="item.avatar" alt="">
              <span v-else>{{ item.title.slice(0, 1) }}</span>
            </span>
            <span :class="['messenger-row-copy']"><strong>{{ item.title }}</strong><span>{{ item.preview }}</span></span>
            <time>{{ item.time }}</time>
          </BasicButton>
        </template>
        <template v-else>
          <p :class="['messenger-list-caption']">
            {{ t('tamagotchi.messenger.characterCards') }}
          </p>
          <p v-if="!visibleContacts.length" :class="['messenger-empty-list']">
            {{ t('tamagotchi.messenger.noContacts') }}
          </p>
          <div v-for="item in visibleContacts" :key="item.id" :class="['messenger-contact-row', { selected: activeContactId === item.id }]">
            <BasicButton size="unset" :class="['messenger-avatar messenger-avatar-edit']" :disabled="busy" :aria-label="t('tamagotchi.avatar.edit', { name: item.name })" @click="emit('editAvatar', item.id)">
              <img v-if="item.avatar" :src="item.avatar" alt="" referrerpolicy="no-referrer"><span v-else aria-hidden="true">{{ Array.from(item.name)[0] }}</span>
            </BasicButton>
            <BasicButton size="unset" :class="['messenger-contact-select']" :disabled="busy" :aria-pressed="activeContactId === item.id" @click="selectContact(item.id)">
              <span :class="['messenger-row-copy']"><strong>{{ item.name }}</strong><span>{{ item.description || t('tamagotchi.messenger.startWithCharacter') }}</span></span>
              <span v-if="activeContactId === item.id" :class="['i-lucide:check size-4 messenger-selected-icon']" :aria-label="t('tamagotchi.messenger.currentCharacter')" />
            </BasicButton>
          </div>
          <BasicButton size="unset" :class="['messenger-manage-link']" @click="emit('manageContacts')">
            <span :class="['i-lucide:contact-round size-4']" aria-hidden="true" />{{ t('tamagotchi.messenger.manageContacts') }}
          </BasicButton>
        </template>
      </div>
    </section>

    <section v-show="tab === 'chats'" :class="['messenger-conversation']" :aria-label="activeName">
      <header :class="['messenger-conversation-heading']">
        <BasicButton size="unset" :class="['messenger-back messenger-icon-button']" :aria-label="t('tamagotchi.messenger.backToChats')" @click="conversationOpen = false">
          <span :class="['i-lucide:chevron-left size-5']" aria-hidden="true" />
        </BasicButton>
        <BasicButton size="unset" :class="['messenger-avatar messenger-avatar-edit messenger-header-avatar']" :disabled="busy" :aria-label="t('tamagotchi.avatar.edit', { name: activeName })" @click="emit('editAvatar', activeContactId)">
          <img v-if="activeAvatar" :src="activeAvatar" alt="" referrerpolicy="no-referrer"><span v-else aria-hidden="true">{{ Array.from(activeName)[0] }}</span>
        </BasicButton>
        <div :class="['min-w-0 flex-1']">
          <h2>{{ activeName }}</h2>
        </div>
        <div :class="['messenger-header-actions']">
          <slot name="actions" />
        </div>
      </header>
      <slot name="sharing-status" />
      <div :class="['messenger-conversation-body']">
        <slot />
      </div>
    </section>
    <section v-if="tab === 'contacts'" :class="['messenger-contact-intro']">
      <span :class="['i-lucide:contact-round size-12']" aria-hidden="true" />
      <h2>{{ t('tamagotchi.messenger.chooseCharacter') }}</h2>
      <p>{{ t('tamagotchi.messenger.contactsDescription') }}</p>
    </section>
    <section v-show="tab === 'me'" :class="['messenger-me']" :aria-label="t('tamagotchi.messenger.me')">
      <slot name="me" />
    </section>
    <slot name="overlay" />
    <p v-if="error" role="alert" :class="['messenger-error']">
      {{ error }}
    </p>
  </div>
</template>

<style scoped>
.messenger-view {
  position: relative;
  --messenger-canvas: var(--aimy-canvas, #fffbfd);
  --messenger-panel: var(--aimy-panel, #fffdfd);
  --messenger-ink: var(--aimy-ink, #4e3c45);
  --messenger-muted: var(--aimy-muted, #76616c);
  --messenger-line: var(--aimy-line, #eadce2);
  --messenger-accent: var(--aimy-accent, #98546c);
  --messenger-soft: var(--aimy-soft, #f6edf1);
  --messenger-hover: var(--aimy-hover, #faf1f5);
  display: grid;
  grid-template-columns: 64px 280px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  height: 100%; min-height: 0; overflow: hidden;
  color: var(--messenger-ink); background: var(--messenger-canvas);
  font: 15px/1.5 -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

.messenger-navigation { display: flex; flex-direction: column; align-items: center; gap: 24px; padding: 24px 5px; background: var(--messenger-panel); border-right: 1px solid var(--messenger-line); }
.messenger-wordmark { display: grid; place-items: center; width: 35px; height: 35px; margin-bottom: 18px; border-radius: 50%; background: var(--messenger-soft); color: var(--messenger-accent); font-size: 22px; font-weight: 500; }
.messenger-nav-button { width: 52px; padding: 8px 3px; color: var(--messenger-muted); font-size: 11px; }
.messenger-nav-button :deep(.basic-button-content) { flex-direction: column; gap: 3px; }
.messenger-nav-button.selected, .messenger-selected-icon { color: var(--messenger-accent); }
.messenger-nav-button:focus-visible, .messenger-list-row:focus-visible, .messenger-icon-button:focus-visible { outline: 2px solid var(--messenger-accent); outline-offset: -3px; }
.messenger-list { display: flex; flex-direction: column; min-width: 0; min-height: 0; border-right: 1px solid var(--messenger-line); background: var(--messenger-panel); }
.messenger-list-heading { display: flex; align-items: center; justify-content: space-between; padding: 28px 20px 16px; }
h1, h2 { margin: 0; font-weight: 500; letter-spacing: -.025em; }
h1 { font-size: 30px; }
h2 { font-size: 22px; }
.messenger-search { display: flex; align-items: center; gap: 7px; margin: 0 16px 12px; padding: 0 12px; border-radius: 20px; color: var(--messenger-muted); background: var(--messenger-soft); }
.messenger-search :deep(input) { border: 0; box-shadow: none; background: transparent; padding: 7px 0; min-width: 0; font-size: 14px; font-weight: 400; color: var(--messenger-ink); }
.messenger-list-scroll { overflow: auto; min-height: 0; flex: 1; }
.messenger-list-row { display: flex; align-items: center; gap: 12px; width: 100%; min-width: 0; min-height: 82px; padding: 14px 16px; border-radius: 0; text-align: left; position: relative; }
.messenger-list-row::after { content: ''; position: absolute; bottom: 0; left: 16px; right: 16px; border-bottom: 1px solid var(--messenger-line); }
.messenger-list-row :deep(.basic-button-content) { width: 100%; justify-content: flex-start; min-width: 0; gap: 12px; }
.messenger-list-row:hover { background: var(--messenger-hover); }
.messenger-list-row.selected { background: var(--messenger-hover); }
.messenger-avatar { display: grid; place-items: center; width: 48px; height: 48px; flex: 0 0 48px; overflow: hidden; border-radius: 50%; background: var(--messenger-soft); color: var(--messenger-accent); font-size: 22px; font-weight: 400; }
.messenger-avatar img { width: 100%; height: 100%; object-fit: cover; }
.messenger-row-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 2px; }
.messenger-row-copy strong, .messenger-row-copy > span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.messenger-row-copy strong { font-size: 16px; font-weight: 400; }
.messenger-row-copy > span { font-size: 13px; line-height: 18px; color: var(--messenger-muted); }
.messenger-list-row time { align-self: flex-start; flex-shrink: 0; padding-top: 3px; font-size: 11px; font-weight: 400; color: var(--messenger-muted); }
.messenger-list-caption, .messenger-empty-list { margin: 14px 20px; font-size: 13px; color: var(--messenger-muted); }
.messenger-list-caption { display: none; }
.messenger-manage-link { display: flex; align-items: center; gap: 9px; margin: 20px; padding: 10px 0; color: var(--messenger-accent); }
.messenger-conversation { display: flex; min-width: 0; min-height: 0; flex-direction: column; }
.messenger-conversation-heading { display: flex; align-items: center; gap: 10px; min-height: 72px; padding: 12px 20px; border-bottom: 1px solid var(--messenger-line); background: var(--messenger-panel); }
.messenger-header-actions { display: flex; align-items: center; gap: 5px; }
.messenger-icon-button { display: grid; place-items: center; width: 36px; height: 36px; flex-shrink: 0; border-radius: 50%; }
.messenger-icon-button:hover { background: var(--messenger-soft); }
.messenger-conversation-body { min-height: 0; flex: 1; }
.messenger-back { display: none; }
.messenger-contact-intro { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; padding: 32px; color: var(--messenger-muted); text-align: center; }
.messenger-contact-intro p { max-width: 28em; margin: 0; }
.messenger-me { grid-column: 2 / 4; overflow: auto; background: var(--messenger-canvas); }
.messenger-error { position: absolute; bottom: 60px; left: 12px; right: 12px; margin: 0; padding: 10px 14px; border: 1px solid #e4bba9; border-radius: 7px; background: #fff0e8; color: #8b321b; z-index: 30; }
@container (max-width: 680px) {
  .messenger-view { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) 58px; }
  .messenger-navigation { grid-row: 2; grid-column: 1 / -1; flex-direction: row; justify-content: space-around; gap: 0; padding: 5px 12px; border-top: 1px solid var(--messenger-line); border-right: 0; }
  .messenger-wordmark { display: none; }
  .messenger-nav-button { width: 80px; padding: 4px 8px; }
  .messenger-list { grid-column: 1 / -1; grid-row: 1; border: 0; }
  .messenger-conversation { grid-column: 1 / -1; grid-row: 1 / -1; display: none; }
  .conversation-open .messenger-list, .conversation-open .messenger-navigation { display: none; }
  .conversation-open .messenger-conversation { display: flex; }
  .messenger-conversation-heading { min-height: 64px; padding: 8px 12px; }
  .messenger-back { display: grid; }
  .messenger-contact-intro { display: none; }
  .messenger-me { grid-column: 1 / -1; grid-row: 1; }
}
@media (max-width: 680px) { .messenger-view { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) 58px; } }

.messenger-contact-row { display: flex; align-items: center; gap: 12px; padding: 10px 20px; }
.messenger-contact-row.selected { background: var(--messenger-soft); }
.messenger-contact-select { flex: 1; min-width: 0; padding: 8px 0; text-align: left; }
.messenger-contact-select :deep(.basic-button-content) { width: 100%; min-width: 0; gap: 10px; justify-content: flex-start; }
.messenger-avatar-edit { padding: 0; border: 0; }
.messenger-avatar-edit :deep(.basic-button-content) { width: 100%; height: 100%; }
.messenger-header-avatar { width: 34px; height: 34px; flex-basis: 34px; font-size: 16px; }
.messenger-avatar-edit:focus-visible { outline: 2px solid var(--messenger-accent); outline-offset: 3px; }
</style>
