import type { ContextMessage, Conversation } from '@proj-airi/core-agent'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { afterEach, describe, expect, it } from 'vitest'

import { filterScreenContextSnapshot, installScreenContextReader, projectScreenConversation, SCREEN_CONTEXT_SOURCE } from './screen-context'

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  dispose = undefined
})
const conversation: Conversation = { turns: [{ id: 'user', type: 'user', content: [{ type: 'text', text: 'What is on screen?' }] }] }

describe('screen evidence at the provider boundary', () => {
  it('leaves non-desktop requests unchanged', () => {
    expect(projectScreenConversation(conversation).context).toBe(conversation)
  })

  it('removes only legacy screen records and preserves other context in the same source', () => {
    dispose = installScreenContextReader(() => ({ available: false, revision: 'off', text: 'Screen unavailable' }))
    const screen: ContextMessage = { id: 'screen', contextId: 'vision:screen:interpret:window:1', text: 'OLD_FRAME', strategy: ContextUpdateStrategy.ReplaceSelf, createdAt: 1 }
    const other: ContextMessage = { ...screen, id: 'other', contextId: 'other', text: 'KEEP_ME' }
    expect(filterScreenContextSnapshot({ mixed: [screen, other], unrelated: [other] })).toEqual({ mixed: [other], unrelated: [other] })
  })

  it('refreshes the actual request after stop and rejects an already prepared screen response', () => {
    let enabled = true
    dispose = installScreenContextReader(sessionId => ({ available: enabled && sessionId === 'one', revision: enabled ? '1' : '2', text: enabled && sessionId === 'one' ? 'CURRENT_FRAME' : 'Screen unavailable' }))
    const first = projectScreenConversation(conversation, 'one')
    expect(JSON.stringify(first.context)).toContain('CURRENT_FRAME')
    enabled = false
    expect(() => first.assertCurrent()).toThrow('Screen sharing changed')
    const second = projectScreenConversation(first.context, 'one')
    expect(JSON.stringify(second.context)).not.toContain('CURRENT_FRAME')
    expect(JSON.stringify(second.context)).toContain('Screen unavailable')
    expect(conversation.turns[0]).not.toHaveProperty('entries')
  })

  it('does not send another session screen and preserves attachments and other modules', () => {
    dispose = installScreenContextReader(sessionId => ({ available: sessionId === 'one', revision: '1', text: sessionId === 'one' ? 'PRIVATE_FRAME' : 'Screen unavailable' }))
    const source: Conversation = { turns: [{ id: 'user', type: 'user', content: [
      { type: 'image', url: 'data:image/png;base64,synthetic' },
      { type: 'runtime-context', entries: [{ source: SCREEN_CONTEXT_SOURCE, text: 'PRIVATE_FRAME' }, { source: 'weather', text: 'SUNNY' }] },
    ] }] }
    const projected = projectScreenConversation(source, 'two').context
    expect(JSON.stringify(projected)).not.toContain('PRIVATE_FRAME')
    expect(JSON.stringify(projected)).toContain('SUNNY')
    expect(JSON.stringify(projected)).toContain('data:image/png;base64,synthetic')
  })
})
