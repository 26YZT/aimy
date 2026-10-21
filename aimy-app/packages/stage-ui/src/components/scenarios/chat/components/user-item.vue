<script setup lang="ts">
import type { ChatHistoryItem } from '../../../../types/chat'
import type { ChatHistoryReplyPayload } from '../reply'

import { isStageCapacitor, isStageWeb } from '@proj-airi/stage-shared'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import ChatReplyQuote from './reply-quote.vue'
import VoiceMessagePlayer from './voice-message-player.vue'

import { useVoiceControlsStore } from '../../../../stores/voice-controls'
import { MarkdownRenderer } from '../../../markdown'
import { ChatActionMenu } from '../components/action-menu'
import { getChatHistoryItemCopyText } from '../utils'

const props = withDefaults(defineProps<{
  message: Extract<ChatHistoryItem, { role: 'user' }>
  label: string
  replyTarget?: ChatHistoryReplyPayload
  canReply?: boolean
  scrollContainer?: HTMLElement | null
  variant?: 'desktop' | 'mobile'
  /** How the bubble paints its background; see `ChatHistory`'s `surface`. */
  surface?: 'translucent' | 'opaque'
  appearance?: 'stage' | 'messenger'
  avatar?: string
}>(), {
  canReply: false,
  scrollContainer: null,
  variant: 'desktop',
  surface: 'translucent',
  appearance: 'stage',
})

const emit = defineEmits<{
  (e: 'copy'): void
  (e: 'delete'): void
  (e: 'reply'): void
}>()

const { t } = useI18n()
const content = computed(() => {
  const raw = props.message.content
  if (typeof raw === 'string')
    return raw

  if (Array.isArray(raw)) {
    return raw.filter(part => part.type === 'text').map(part => part.text).join('\n')
  }

  return ''
})

const emptyImages: readonly string[] = Object.freeze([])
const images = computed(() => typeof props.message.content === 'string'
  ? emptyImages
  : props.message.content.filter(part => part.type === 'image_url').map(part => part.image_url.url))
const voiceControls = useVoiceControlsStore()
/** The voice host still transcribes this message after its submit. */
const transcribing = computed(() => voiceControls.messages.some(item => item.id === props.message.id && (item.phase === 'sending' || item.phase === 'transcribing')))
/** Each recording with its transcript, when one was stored. Transcripts follow the audio part order. */
const audio = computed(() => typeof props.message.content === 'string'
  ? []
  : props.message.content.filter(part => part.type === 'input_audio').map((part, index) => ({
      source: `data:audio/${part.input_audio.format === 'mp3' ? 'mpeg' : 'wav'};base64,${part.input_audio.data}`,
      transcript: props.message.audioTranscripts?.[index]?.trim(),
    })))

/** A message that only holds recordings is a voice message. Its bubble fits the player instead of a text block. */
const voiceOnly = computed(() => audio.value.length > 0 && !images.value.length && !content.value.trim() && !props.replyTarget)

const containerClasses = computed(() => [
  'flex',
  props.appearance === 'messenger'
    ? 'ml-0 flex-row-reverse items-start gap-2.5 pl-10 font-sans text-base leading-relaxed'
    : ['font-cute', props.variant === 'mobile' ? 'ml-0 flex-row' : 'ml-12 flex-row-reverse'],
])

const boxClasses = computed(() => {
  if (props.appearance === 'messenger')
    return ['messenger-outgoing relative min-w-0 px-3 py-2']
  const spacing = voiceOnly.value
    ? 'px-1.5 py-1.5'
    : props.variant === 'mobile' ? 'px-2 py-1.5 text-sm' : 'px-3 py-2'
  if (props.surface === 'opaque')
    return [spacing, 'bg-neutral-100 shadow-md dark:bg-neutral-800']

  return [
    spacing,
    props.variant === 'mobile'
      ? 'bg-neutral-100/60 backdrop-blur-xl dark:bg-neutral-800/60'
      : 'bg-neutral-100/80 dark:bg-neutral-800/80',
  ]
})
const copyText = computed(() => getChatHistoryItemCopyText(props.message))
</script>

<template>
  <div v-if="message.role === 'user'" :class="['ph-no-capture', containerClasses]" :data-appearance="appearance">
    <ChatActionMenu
      :can-reply="canReply"
      :copy-text="copyText"
      placement="left"
      :press-feedback-enabled="variant === 'mobile'"
      :scroll-container="scrollContainer"
      @copy="emit('copy')"
      @delete="emit('delete')"
      @reply="emit('reply')"
    >
      <template #default="{ setMeasuredElement }">
        <div
          :ref="setMeasuredElement"
          :class="[
            'chat-message-item-container flex flex-col',
            appearance === 'stage' ? (voiceOnly ? 'rounded-2xl' : 'min-w-20 rounded-xl') : '',
            'h-unset <sm:h-fit',
            appearance === 'stage' ? 'shadow-sm shadow-neutral-200/50 dark:shadow-none' : '',
            boxClasses,
            (isStageWeb() || isStageCapacitor()) && props.variant === 'mobile' ? 'select-none sm:select-auto' : '',
          ]"
        >
          <ChatReplyQuote v-if="replyTarget" :target="replyTarget" />
          <div v-if="variant === 'mobile' && appearance === 'stage'">
            <span :class="['inline <sm:hidden text-sm font-normal', 'text-black/60 dark:text-white/65']">{{ label }}</span>
          </div>
          <div v-if="images.length" :class="['flex flex-wrap gap-2 py-2']">
            <img v-for="(image, index) in images" :key="index" :src="image" :alt="t('stage.chat.images.description')" :class="['max-h-64 max-w-full rounded-xl object-contain']">
          </div>
          <div v-for="(recording, index) in audio" :key="index" :class="['flex flex-col gap-0.5', !voiceOnly && 'py-1']">
            <VoiceMessagePlayer :audio="recording.source" surface="none" :aria-label="t('stage.chat.voice-message.preview')" />
            <p v-if="recording.transcript" :class="['m-0 max-w-64 px-1 pb-0.5 text-xs leading-snug opacity-75']">
              {{ recording.transcript }}
            </p>
            <p v-else-if="transcribing" :class="['m-0 px-1 pb-0.5 text-xs opacity-60 animate-pulse motion-reduce:animate-none']">
              {{ t('stage.chat.voice-message.transcribing') }}
            </p>
          </div>
          <MarkdownRenderer
            v-if="content"
            :content="content as string"
            class="break-words"
          />
        </div>
      </template>
    </ChatActionMenu>
  </div>
</template>

<style scoped>
.messenger-outgoing { border-radius: 20px 20px 4px 20px; background: linear-gradient(115deg, var(--aimy-outgoing, #f0e3e8), var(--aimy-outgoing-end, #eacdd8)); color: var(--aimy-outgoing-ink, #543a45); box-shadow: none; }
.messenger-outgoing :deep(a) { color: inherit; text-decoration: underline; }
:global(.dark .messenger-outgoing) { background: linear-gradient(115deg, var(--aimy-outgoing, #614551), var(--aimy-outgoing-end, #503a44)); color: var(--aimy-outgoing-ink, #f8e8ef); }
</style>
