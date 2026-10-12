import type { AimyBridge } from '../../shared/contracts'

import { effectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useLocalConversation } from './use-local-conversation'

const persisted = vi.hoisted(() => ({ records: new Map<string, any>(), index: undefined as any, delay: false, release: undefined as (() => void) | undefined }))
vi.mock('../airi-local/database/repos/chat-sessions.repo', () => ({ chatSessionsRepo: {
  getIndex: async () => persisted.index,
  getSession: async (id: string) => persisted.records.get(id),
  saveIndex: async (index: any) => { persisted.index = JSON.parse(JSON.stringify(index)) },
  saveSession: async (id: string, record: any) => {
    persisted.records.set(id, JSON.parse(JSON.stringify(record)))
    if (persisted.delay && record.messages.at(-1)?.id.startsWith('screen-'))
      await new Promise<void>((resolve) => { persisted.release = resolve })
  },
} }))

beforeEach(() => { persisted.records.clear(); persisted.index = undefined; persisted.delay = false; persisted.release = undefined })
afterEach(() => { vi.restoreAllMocks() })

describe('observation local commit', () => {
  it('rolls back a screen observation revoked during the asynchronous write', async () => {
    const scope = effectScope()
    const bridge = { onChatUpdate: () => () => {}, cancel: async () => {} } as unknown as AimyBridge
    const conversation = scope.run(() => useLocalConversation(bridge))!
    await conversation.restore()
    const presented = vi.fn()
    conversation.onTurn({ start: presented })
    let allowed = true
    persisted.delay = true
    const saving = conversation.appendObservation('等待保存的观察', 'observation-one', () => allowed)
    await vi.waitFor(() => expect(persisted.release).toBeTypeOf('function'))
    allowed = false
    persisted.release!()
    expect(await saving).toBe(false)
    expect(conversation.messages.value).toHaveLength(0)
    expect(persisted.records.get(conversation.record.value.meta.sessionId).messages).toHaveLength(0)
    expect(presented).not.toHaveBeenCalled()
    scope.stop()
  })
})
