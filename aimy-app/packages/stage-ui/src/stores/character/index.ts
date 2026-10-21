import type { SpeechClient } from '../../services/speech/speech-client'

import { nanoid } from 'nanoid'
import { defineStore, storeToRefs } from 'pinia'
import { computed, reactive, ref } from 'vue'

import { useLlmmarkerParser } from '../../composables/llm-marker-parser'
import { SpeechClient as Speech } from '../../services/speech/speech-client'
import { useChatSessionStore } from '../chat/session-store'
import { useAiriCardStore } from '../modules'

export * from './notebook'
export * from './orchestrator'

export interface CharacterSparkNotifyReaction {
  id: string
  message: string
  createdAt: number
  sourceEventId?: string
  metadata?: Record<string, unknown>
}

interface StreamingReactionState {
  reaction: CharacterSparkNotifyReaction
  speech: SpeechClient
  parser: ReturnType<ParserFactory>
}

const MAX_REACTIONS = 200
type ParserFactory = typeof useLlmmarkerParser
let parserFactory: ParserFactory = useLlmmarkerParser

export function setCharacterLlmMarkerParserFactoryForTest(factory: ParserFactory | null) {
  parserFactory = factory ?? useLlmmarkerParser
}

export const useCharacterStore = defineStore('character', () => {
  const { activeCard, systemPrompt } = storeToRefs(useAiriCardStore())

  const name = computed(() => activeCard.value?.name ?? '')

  const reactions = ref<CharacterSparkNotifyReaction[]>([])
  const streamingReactions = ref<Map<string, StreamingReactionState>>(new Map())
  const sessions = useChatSessionStore()
  const followupSpeech = new Map<string, { speech: SpeechClient, cancelled: boolean }>()

  async function emitTextOutput(text: string) {
    const speech = new Speech({ sessionId: sessions.activeSessionId, turnId: nanoid() }, 'read-aloud')

    const parser = parserFactory({
      onLiteral: async (literal) => {
        if (literal)
          await speech.write(literal)
      },
      onSpecial: async (special) => {
        if (special)
          await speech.special(special)
      },
    })

    await parser.consume(text)
    await parser.end()

    await speech.end()
    void speech.finish().catch(error => console.error('Speech output failed', error))
  }

  function onSparkNotifyReactionStreamEvent(sparkEventId: string, chunk: string, options?: { metadata?: Record<string, unknown> }) {
    if (!streamingReactions.value.has(sparkEventId)) {
      const newReaction = reactive({
        id: nanoid(),
        message: '',
        createdAt: Date.now(),
        sourceEventId: sparkEventId,
        metadata: options?.metadata,
      }) satisfies CharacterSparkNotifyReaction

      const speech = new Speech({ sessionId: sessions.activeSessionId, turnId: `spark:${sparkEventId}` }, 'notification')

      const parser = parserFactory({
        onLiteral: async (literal) => {
          if (literal)
            await speech.write(literal)
        },
        onSpecial: async (special) => {
          if (special)
            await speech.special(special)
        },
      })

      streamingReactions.value.set(sparkEventId, { reaction: newReaction, speech, parser })
    }

    const state = streamingReactions.value.get(sparkEventId)!
    state.reaction.message += chunk
    void state.parser.consume(chunk)
  }

  function onSparkNotifyReactionStreamEnd(sparkEventId: string, fullText: string, options?: { metadata?: Record<string, unknown> }) {
    const state = streamingReactions.value.get(sparkEventId)
    if (!state)
      return

    state.reaction.message = fullText
    recordSparkNotifyReaction(sparkEventId, fullText, { metadata: options?.metadata })

    void state.parser.end().then(async () => {
      await state.speech.end()
      streamingReactions.value.delete(sparkEventId)
      await state.speech.finish()
    }).catch(error => console.error('Notification speech failed', error))
  }

  function recordSparkNotifyReaction(sparkEventId: string, message: string, options?: { metadata?: Record<string, unknown> }) {
    const newReaction = {
      id: nanoid(),
      message,
      createdAt: Date.now(),
      sourceEventId: sparkEventId,
      metadata: options?.metadata,
    } satisfies CharacterSparkNotifyReaction

    reactions.value.push(newReaction)

    if (reactions.value.length > MAX_REACTIONS) {
      reactions.value.splice(0, reactions.value.length - MAX_REACTIONS)
    }
  }

  /** Keeps internal notification speech cancellable until the existing host drains playback. */
  function deliverFollowup(eventId: string, text: string, isCurrent: () => boolean): boolean {
    if (!isCurrent() || !text.trim() || followupSpeech.has(eventId))
      return false
    const speech = new Speech({ sessionId: sessions.activeSessionId, turnId: `followup:${eventId}` }, 'notification')
    const owned = { speech, cancelled: false }
    followupSpeech.set(eventId, owned)
    const current = () => !owned.cancelled && isCurrent()
    const parser = parserFactory({
      onLiteral: async (literal) => {
        if (current() && literal)
          await speech.write(literal)
      },
      onSpecial: async (special) => {
        if (current() && special)
          await speech.special(special)
      },
    })
    recordSparkNotifyReaction(eventId, text, { metadata: { source: 'companion-followup' } })
    void (async () => {
      try {
        if (!current())
          return
        await parser.consume(text)
        if (!current())
          return
        await parser.end()
        if (!current())
          return
        await speech.end()
        if (!current())
          return
        await speech.finish()
      }
      finally {
        if (!current())
          await speech.cancel('Followup no longer current').catch(() => {})
        if (followupSpeech.get(eventId) === owned)
          followupSpeech.delete(eventId)
      }
    })().catch(() => { void speech.cancel('Followup speech failed').catch(() => {}) })
    return true
  }

  /** Revokes only internally scheduled followups, preserving ordinary external Spark speech. */
  function cancelFollowups(reason: string) {
    for (const owned of followupSpeech.values()) {
      owned.cancelled = true
      void owned.speech.cancel(reason).catch(() => {})
    }
  }

  function clearReactions() {
    reactions.value = []
  }

  return {
    name,
    reactions,
    systemPrompt,

    recordSparkNotifyReaction,
    onSparkNotifyReactionStreamEvent,
    onSparkNotifyReactionStreamEnd,
    clearReactions,
    deliverFollowup,
    cancelFollowups,

    emitTextOutput,
  }
})
