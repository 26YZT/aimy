import { defineInvokeHandler } from '@moeru/eventa'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useCharacterStore } from '../../stores/character'
import { getSpeechBusContext, voiceSpeechCommand } from '../speech/bus'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ locale: ref('en'), t: (key: string) => key, te: () => true }) }))
const cleanups: (() => void)[] = []
beforeEach(() => setActivePinia(createPinia()))
afterEach(() => cleanups.splice(0).forEach(stop => stop()))

describe('internal followup presentation with the real speech command bus', () => {
  it('cancels speech while the host waits for playback completion', async () => {
    const commands: string[] = []
    const drained = Promise.withResolvers<{ status: 'finished' }>()
    cleanups.push(defineInvokeHandler(getSpeechBusContext(), voiceSpeechCommand, (command) => {
      commands.push(command.type)
      return command.type === 'finish' ? drained.promise : { status: 'accepted' }
    }))
    const character = useCharacterStore()
    expect(character.deliverFollowup('test-followup', 'Take a rest.', () => true)).toBe(true)
    await expect.poll(() => commands.includes('finish')).toBe(true)
    character.cancelFollowups('user-returned')
    await expect.poll(() => commands.includes('cancel')).toBe(true)
    drained.resolve({ status: 'finished' })
    expect(character.reactions).toHaveLength(1)
  })

  it('checks current state before queued parser writes and preserves external reactions', async () => {
    const commands: string[] = []
    cleanups.push(defineInvokeHandler(getSpeechBusContext(), voiceSpeechCommand, (command) => {
      commands.push(command.type)
      return { status: 'accepted' }
    }))
    const character = useCharacterStore()
    expect(character.deliverFollowup('stale', 'Old content', () => false)).toBe(false)
    character.recordSparkNotifyReaction('external', 'Original AIRI event')
    character.cancelFollowups('hidden')
    await Promise.resolve()
    expect(commands).toEqual([])
    expect(character.reactions[0].message).toBe('Original AIRI event')
  })
})
