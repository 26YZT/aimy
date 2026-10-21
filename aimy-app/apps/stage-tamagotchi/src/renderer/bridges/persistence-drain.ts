import type { StoreActions, StoreGeneric } from 'pinia'

import type { ShutdownReceipt, ShutdownRequest } from '../../shared/eventa/aimy-lifecycle'

interface PendingWrite {
  label: string
  done: Promise<void>
  resolve: () => void
}

interface CloseBatch {
  pending: Set<number>
  failed: Set<string>
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    && 'then' in value && typeof value.then === 'function'
}

/** Tracks accepted writes in this window without retaining arguments, results, or errors. */
export class PersistenceDrain {
  private sequence = 0
  private readonly pending = new Map<number, PendingWrite>()
  private readonly batches = new Map<string, CloseBatch>()

  /** Starts a fresh close attempt. Failures that settled before this point do not poison later closes. */
  begin(shutdownId: string): void {
    if (!this.batches.has(shutdownId))
      this.batches.set(shutdownId, { pending: new Set(this.pending.keys()), failed: new Set() })
  }

  abort(shutdownId: string): void {
    this.batches.delete(shutdownId)
  }

  private start(label: string): number {
    const id = ++this.sequence
    const completion = Promise.withResolvers<void>()
    this.pending.set(id, { label, done: completion.promise, resolve: completion.resolve })
    for (const batch of this.batches.values())
      batch.pending.add(id)
    return id
  }

  private finish(id: number, failed: boolean): void {
    const write = this.pending.get(id)
    if (!write)
      return
    for (const batch of this.batches.values()) {
      if (batch.pending.delete(id) && failed)
        batch.failed.add(write.label)
    }
    this.pending.delete(id)
    write.resolve()
  }

  private observe(result: unknown, id: number): unknown {
    if (!isThenable(result)) {
      this.finish(id, false)
      return result
    }
    return Promise.resolve(result).then(
      (value) => {
        this.finish(id, false)
        return value
      },
      (error) => {
        this.finish(id, true)
        throw error
      },
    )
  }

  /**
   * Watches actual caller promises and owner-side Pinia execution.
   * Synced Pinia forwards follower calls before its normal action hooks run.
   * The method wrapper covers that RPC and local secure-save prefixes. The hook covers inbound owner calls.
   */
  track<T extends StoreGeneric>(store: T, names: readonly Extract<keyof StoreActions<T>, string>[]): () => void {
    const selected = new Set<string>(names)
    const wrapping = new Map<string, number>()
    const restore: Array<() => void> = []
    const unhook = store.$onAction(({ name, after, onError }) => {
      if (!selected.has(name) || wrapping.has(name))
        return
      const id = this.start(`${store.$id}.${name}`)
      after(() => this.finish(id, false))
      onError(() => this.finish(id, true))
    }, true)
    for (const name of names) {
      const original: unknown = Reflect.get(store, name)
      if (typeof original !== 'function')
        throw new TypeError('A persistence action is unavailable')
      const tracked = (...args: unknown[]) => {
        const id = this.start(`${store.$id}.${name}`)
        wrapping.set(name, (wrapping.get(name) ?? 0) + 1)
        try {
          return this.observe(Reflect.apply(original, store, args), id)
        }
        catch (error) {
          this.finish(id, true)
          throw error
        }
        finally {
          const depth = (wrapping.get(name) ?? 1) - 1
          if (depth)
            wrapping.set(name, depth)
          else
            wrapping.delete(name)
        }
      }
      Reflect.set(store, name, tracked)
      restore.push(() => {
        if (Reflect.get(store, name) === tracked)
          Reflect.set(store, name, original)
      })
    }
    return () => {
      unhook()
      restore.forEach(untrack => untrack())
    }
  }

  /** Waits through async write continuations, within the host's original shutdown deadline. */
  async waitFor(shutdownId: string, deadline: number): Promise<void> {
    const batch = this.batches.get(shutdownId)
    if (!batch)
      throw new Error('The close attempt is unavailable')
    while (true) {
      const remaining = deadline - Date.now()
      if (remaining <= 0)
        throw new Error('Accepted writes did not finish before the deadline')
      const writes = [...batch.pending].flatMap(id => this.pending.get(id)?.done ?? [])
      let timer: ReturnType<typeof setTimeout> | undefined
      const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Accepted writes did not finish before the deadline')), remaining)
      })
      try {
        await Promise.race([Promise.all(writes), expired])
        // An awaited action can start the next save in its caller's continuation.
        // A quiet event-loop turn includes those microtasks before the window acknowledges persistence.
        await Promise.race([new Promise<void>(resolve => setTimeout(resolve, 0)), expired])
      }
      finally {
        clearTimeout(timer)
      }
      if (!batch.pending.size)
        break
    }
    if (batch.failed.size)
      throw new Error('A write accepted before close failed')
  }
}

export interface ShutdownParticipant {
  id: string
  begin?: (request: ShutdownRequest) => void
  drain?: (request: ShutdownRequest) => void | Promise<void>
  stop: () => void | Promise<void>
  flush: () => void | Promise<void>
  finalize?: () => void | Promise<void>
  abort?: (shutdownId: string) => void
}

/** Executes one renderer's prepare/finalize protocol. The host selects which window can finalize ownership. */
export class WindowShutdownCoordinator {
  private readonly prepared = new Set<string>()
  private readonly executions = new Map<string, Promise<ShutdownReceipt>>()

  constructor(private readonly participants: ReadonlySet<ShutdownParticipant>) {}

  abort(shutdownId: string): void {
    this.prepared.delete(shutdownId)
    this.executions.delete(`${shutdownId}:prepare`)
    this.executions.delete(`${shutdownId}:finalize`)
    for (const owner of this.participants)
      owner.abort?.(shutdownId)
  }

  /** Repeated delivery of one phase returns the original receipt instead of repeating side effects. */
  run(request: ShutdownRequest): Promise<ShutdownReceipt> {
    const key = `${request.shutdownId}:${request.phase}`
    const existing = this.executions.get(key)
    if (existing)
      return existing
    const execution = this.execute(request)
    this.executions.set(key, execution)
    return execution
  }

  private async stage(owners: ShutdownParticipant[], request: ShutdownRequest, phase: 'stop' | 'drain' | 'flush' | 'finalize'): Promise<string[]> {
    const remaining = request.deadline - Date.now()
    if (remaining <= 0)
      return [`shutdown:${phase}:deadline`]
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([
        Promise.allSettled(owners.map(owner => Promise.resolve().then(() => phase === 'drain' ? owner.drain?.(request) : owner[phase]?.()))),
        new Promise<null>((resolve) => {
          timer = setTimeout(resolve, remaining, null)
        }),
      ])
      if (result === null)
        return [`shutdown:${phase}:deadline`]
      return result.flatMap((item, index) => item.status === 'rejected' ? [`${owners[index].id}:${phase}`] : [])
    }
    finally {
      clearTimeout(timer)
    }
  }

  private async execute(request: ShutdownRequest): Promise<ShutdownReceipt> {
    const owners = [...this.participants]
    const failed: string[] = []
    if (request.phase === 'finalize' && (request.scope !== 'application' || !this.prepared.has(request.shutdownId)))
      return { shutdownId: request.shutdownId, phase: request.phase, stopped: false, persisted: false, failed: ['shutdown:not-prepared'] }
    if (request.phase === 'prepare') {
      for (const owner of owners) {
        try {
          owner.begin?.(request)
        }
        catch {
          failed.push(`${owner.id}:begin`)
        }
      }
    }
    const stops = request.phase === 'prepare' && request.scope === 'application'
      ? await this.stage(owners, request, 'stop')
      : []
    failed.push(...stops)
    failed.push(...await this.stage(owners, request, 'drain'))
    failed.push(...await this.stage(owners, request, 'flush'))
    failed.push(...await this.stage(owners, request, 'drain'))
    if (request.phase === 'finalize' && !failed.length)
      failed.push(...await this.stage(owners, request, 'finalize'))
    if (request.phase === 'prepare' && request.scope === 'application' && !failed.length)
      this.prepared.add(request.shutdownId)
    return { shutdownId: request.shutdownId, phase: request.phase, stopped: stops.length === 0, persisted: failed.length === 0, failed: [...new Set(failed)] }
  }
}
