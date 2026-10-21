import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'

import { configureLocalOnly } from '../../services/local-data-policy'
import { createChatWsClient } from './ws-client'

describe('local-only chat WebSocket', () => {
  it('does not open, authenticate, send or pull after the desktop disables replicas', async () => {
    configureLocalOnly()
    const sends = vi.spyOn(WebSocket.prototype, 'send')
    const scope = effectScope()
    const client = scope.run(() => createChatWsClient({ serverUrl: 'https://example.invalid', getToken: () => 'synthetic-token' }))!
    try {
      client.connect()
      await nextTick()
      expect(client.status()).toBe('idle')
      await expect(client.sendMessages({ chatId: 'synthetic-chat', messages: [] })).rejects.toThrow('Cloud replicas are disabled')
      await expect(client.pullMessages({ chatId: 'synthetic-chat', afterSeq: 0 })).rejects.toThrow('Cloud replicas are disabled')
      client.disconnect()
      client.connect()
      await nextTick()
      expect(client.status()).toBe('idle')
      // Vitest has its own control socket in this realm. Inspect only the product transport.
      const productSends = sends.mock.contexts.filter(socket => socket instanceof WebSocket && new URL(socket.url).hostname === 'example.invalid')
      expect(productSends).toHaveLength(0)
    }
    finally {
      client.destroy()
      scope.stop()
      sends.mockRestore()
    }
  })
})
