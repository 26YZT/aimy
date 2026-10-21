import { syncBuiltinESMExports } from 'node:module'
import { Socket } from 'node:net'

/** Test host only. Chromium keeps its own sandbox; native browser requests use webRequest separately. */
export function installOfflineNodeNetworkGuard(ports: readonly number[]) {
  if (!ports.length || ports.some(port => !Number.isSafeInteger(port) || port < 1 || port > 65535))
    throw new Error('OFFLINE_NETWORK_PORT_INVALID')
  const allowed = new Set(ports)
  const original = Socket.prototype.connect
  let blocked = 0
  const guarded = function (this: Socket, ...input: unknown[]) {
    // Node HTTP and Undici can pass Node's pre-normalized argument tuple.
    const args = Array.isArray(input[0]) ? input[0] : input
    const first = args[0]
    const options = first && typeof first === 'object' ? first as Record<string, unknown> : undefined
    const port = options ? Number(options.port) : Number(first)
    const host = options?.host ?? (typeof args[1] === 'string' ? args[1] : 'localhost')
    if ((options?.path !== undefined && options.path !== null) || !allowed.has(port) || !['127.0.0.1', '::1', 'localhost'].includes(String(host))) {
      blocked++
      throw new Error('OFFLINE_NODE_NETWORK_DENIED')
    }
    return Reflect.apply(original, this, input)
  } as typeof original
  Socket.prototype.connect = guarded
  syncBuiltinESMExports()
  return {
    summary: () => ({ blockedConnections: blocked }),
    restore() {
      if (Socket.prototype.connect === guarded) {
        Socket.prototype.connect = original
        syncBuiltinESMExports()
      }
    },
  }
}
