import { describe, expect, it, vi } from 'vitest'
import type { GenerationProvider } from '@proj-airi/provider-inference'
import { streamChatTurn } from './chat-session'

const provider = { generation: () => ({ protocol: 'chat-completions', config: { apiKey: 'test', baseURL: 'https://example.test/v1', model: 'test' } }) } as GenerationProvider

describe('streamChatTurn', () => {
  it('concatenates AIRI text deltas in order', async () => {
    const chunks: string[] = []
    const streamFrom = vi.fn(async ({ options }) => {
      await options?.onStreamEvent?.({ type: 'text-delta', text: '你' })
      await options?.onStreamEvent?.({ type: 'text-delta', text: '好' })
      await options?.onStreamEvent?.({ type: 'finish' })
    })
    await expect(streamChatTurn({ model: 'test', provider, userText: ' hi ', streamFrom, onTextDelta: chunk => void chunks.push(chunk) })).resolves.toBe('你好')
    expect(chunks).toEqual(['你', '好'])
    expect(streamFrom).toHaveBeenCalledWith(expect.objectContaining({ model: 'test', options: expect.objectContaining({ supportsTools: false }) }))
  })

  it('rejects empty input', async () => {
    await expect(streamChatTurn({ model: 'test', provider, userText: ' ', streamFrom: vi.fn() })).rejects.toThrow(/empty/)
  })

  it('propagates stream failures', async () => {
    const streamFrom = vi.fn(async ({ options }) => { await options?.onStreamEvent?.({ type: 'error', error: new Error('provider failed') }) })
    await expect(streamChatTurn({ model: 'test', provider, userText: 'hello', streamFrom })).rejects.toThrow('provider failed')
  })
})
