import type { ShutdownRequest } from '../../shared/eventa/aimy-lifecycle'

import { createPinia, defineStore, disposePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PersistenceDrain, WindowShutdownCoordinator } from './persistence-drain'

const piniaInstances: ReturnType<typeof createPinia>[] = []
function createStore(action: () => Promise<void> | void) {
  const pinia = createPinia()
  piniaInstances.push(pinia)
  return defineStore('accepted-writes', { actions: { save: action } })(pinia)
}

function prepare(shutdownId: string, scope: ShutdownRequest['scope'] = 'window'): ShutdownRequest {
  return { shutdownId, phase: 'prepare', scope, deadline: Date.now() + 1000 }
}

afterEach(() => {
  piniaInstances.splice(0).forEach(pinia => disposePinia(pinia))
  vi.useRealTimers()
})

describe('accepted write drain', () => {
  it('includes a next write started by the caller after its first awaited save', async () => {
    const first = Promise.withResolvers<void>()
    const second = Promise.withResolvers<void>()
    let calls = 0
    const store = createStore(() => ++calls === 1 ? first.promise : second.promise)
    const drain = new PersistenceDrain()
    drain.track(store, ['save'])
    const chain = (async () => {
      await store.save()
      await store.save()
    })()
    drain.begin('close')
    const done = vi.fn()
    const waiting = drain.waitFor('close', Date.now() + 1000).then(done)
    first.resolve()
    await vi.waitFor(() => expect(calls).toBe(2))
    expect(done).not.toHaveBeenCalled()
    second.resolve()
    await Promise.all([chain, waiting])
    expect(done).toHaveBeenCalledOnce()
  })

  it('reports a write pending at close as failed without retaining old semantic errors across close attempts', async () => {
    const pending = Promise.withResolvers<void>()
    const store = createStore(() => pending.promise)
    const drain = new PersistenceDrain()
    drain.track(store, ['save'])
    const write = Promise.resolve(store.save()).catch(() => {})
    const coordinator = new WindowShutdownCoordinator(new Set([{
      id: 'storage',
      begin: (request: ShutdownRequest) => drain.begin(request.shutdownId),
      drain: (request: ShutdownRequest) => drain.waitFor(request.shutdownId, request.deadline),
      abort: (id: string) => drain.abort(id),
      stop: vi.fn(),
      flush: vi.fn(),
    }]))
    const close = coordinator.run(prepare('first'))
    pending.reject(new Error('Synthetic rejected write'))
    await write
    await expect(close).resolves.toMatchObject({ persisted: false, failed: ['storage:drain'] })
    coordinator.abort('first')
    await expect(coordinator.run(prepare('second'))).resolves.toMatchObject({ persisted: true, failed: [] })

    const semantic = createStore(() => {
      throw new Error('REVISION_CONFLICT')
    })
    drain.track(semantic, ['save'])
    expect(() => semantic.save()).toThrow('REVISION_CONFLICT')
    await expect(coordinator.run(prepare('third'))).resolves.toMatchObject({ persisted: true, failed: [] })
  })

  it('does not include unselected reads or generation in the close drain', async () => {
    const unresolved = new Promise<void>(() => {})
    const pinia = createPinia()
    piniaInstances.push(pinia)
    const store = defineStore('read-and-write', {
      actions: { save: async () => {}, read: () => unresolved, generate: () => unresolved },
    })(pinia)
    const drain = new PersistenceDrain()
    drain.track(store, ['save'])
    void store.read()
    void store.generate()
    drain.begin('close')
    await expect(drain.waitFor('close', Date.now() + 1000)).resolves.toBeUndefined()
  })

  it('returns a partial receipt at the original deadline for an unresolved accepted write', async () => {
    vi.useFakeTimers()
    const pending = Promise.withResolvers<void>()
    const store = createStore(() => pending.promise)
    const drain = new PersistenceDrain()
    drain.track(store, ['save'])
    const write = store.save()
    const flush = vi.fn()
    const coordinator = new WindowShutdownCoordinator(new Set([{
      id: 'storage',
      begin: (request: ShutdownRequest) => drain.begin(request.shutdownId),
      drain: (request: ShutdownRequest) => drain.waitFor(request.shutdownId, request.deadline),
      stop: vi.fn(),
      flush,
    }]))
    const close = coordinator.run({ ...prepare('bounded'), deadline: Date.now() + 20 })
    await vi.advanceTimersByTimeAsync(20)
    await expect(close).resolves.toMatchObject({ persisted: false })
    expect(flush).not.toHaveBeenCalled()
    pending.resolve()
    await write
  })
})

describe('window shutdown phases', () => {
  it('never finalizes a window close or an unprepared application, and finalizes a prepared owner only once', async () => {
    const stop = vi.fn()
    const flush = vi.fn()
    const finalize = vi.fn()
    const coordinator = new WindowShutdownCoordinator(new Set([{ id: 'owner', stop, flush, finalize }]))
    const close = prepare('window')
    await expect(coordinator.run(close)).resolves.toMatchObject({ persisted: true })
    expect(stop).not.toHaveBeenCalled()
    expect(finalize).not.toHaveBeenCalled()
    await expect(coordinator.run({ ...close, phase: 'finalize' })).resolves.toMatchObject({ persisted: false })
    const quit = prepare('quit', 'application')
    await expect(coordinator.run({ ...quit, phase: 'finalize' })).resolves.toMatchObject({ persisted: false })
    coordinator.abort('quit')
    await expect(coordinator.run(quit)).resolves.toMatchObject({ persisted: true })
    expect(stop).toHaveBeenCalledOnce()
    expect(finalize).not.toHaveBeenCalled()
    await Promise.all([coordinator.run({ ...quit, phase: 'finalize' }), coordinator.run({ ...quit, phase: 'finalize' })])
    expect(finalize).toHaveBeenCalledOnce()
  })
})
