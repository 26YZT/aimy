import { getResourcePolicy } from '@proj-airi/stage-ui/services/resource-policy'
import { expect, it, vi } from 'vitest'

import { resourceSnapshot, shutdownCompleted, shutdownRequested, windowCloseAborted } from '../../shared/eventa/aimy-lifecycle'
import { installDesktopResourcePolicy, registerDesktopShutdownParticipant } from './resource-policy'

const transport = vi.hoisted(() => ({
  listeners: new Map<string, (event: { body?: unknown }) => unknown>(),
  acknowledgements: [] as unknown[],
}))
vi.mock('@proj-airi/electron-vueuse', () => ({
  getElectronEventaContext: () => ({
    on: (event: { id: string }, handler: (event: { body?: unknown }) => unknown) => {
      transport.listeners.set(event.id, handler)
      return () => transport.listeners.delete(event.id)
    },
  }),
}))
vi.mock('@moeru/eventa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@moeru/eventa')>()
  return {
    ...actual,
    defineInvoke: (_context: unknown, event: { sendEvent: { id: string } }) => async (input: unknown) => {
      if (event.sendEvent.id === resourceSnapshot.sendEvent.id) {
        return { revision: 1, appEpoch: 0, active: true, reason: 'shown', microphone: { enabled: false, epoch: 0 }, screen: { enabled: false, epoch: 0 } }
      }
      if (event.sendEvent.id === shutdownCompleted.sendEvent.id)
        transport.acknowledgements.push(input)
    },
  }
})

it('flushes a closing window without stopping shared work and ignores an old close failure', async () => {
  installDesktopResourcePolicy()
  await getResourcePolicy()!.ready()
  const firstFlush = Promise.withResolvers<void>()
  const secondFlush = Promise.withResolvers<void>()
  const stop = vi.fn()
  const flush = vi.fn().mockReturnValueOnce(firstFlush.promise).mockReturnValueOnce(secondFlush.promise)
  const unregister = registerDesktopShutdownParticipant({ id: 'synthetic', stop, flush })
  const close = transport.listeners.get(shutdownRequested.id)!
  const failed = transport.listeners.get(windowCloseAborted.id)!
  const first = close({ body: { shutdownId: 'first', phase: 'prepare', deadline: Date.now() + 1000, scope: 'window' } })
  const second = close({ body: { shutdownId: 'second', phase: 'prepare', deadline: Date.now() + 1000, scope: 'window' } })
  expect(getResourcePolicy()!.isWindowClosing).toBe(true)
  failed({ body: { shutdownId: 'first', reason: 'persistence-incomplete' } })
  expect(getResourcePolicy()!.isWindowClosing).toBe(true)
  firstFlush.resolve()
  secondFlush.resolve()
  await Promise.all([first, second])
  expect(stop).not.toHaveBeenCalled()
  expect(flush).toHaveBeenCalledTimes(2)
  expect(transport.acknowledgements).toContainEqual({ shutdownId: 'first', phase: 'prepare', stopped: true, persisted: true, failed: [] })
  failed({ body: { shutdownId: 'second', reason: 'persistence-incomplete' } })
  expect(getResourcePolicy()!.isWindowClosing).toBe(false)
  unregister()
})
