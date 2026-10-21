import type { AcceptanceBudgetPort, AcceptanceBudgetStatus } from '../stores/memory/budget'
import type { MemoryDiagnosticsSummary, MemoryReadRequest, MemoryScope } from '../types/memory'
import type { ResourcePolicy as ResourcePolicyType } from './resource-policy'

import { createPinia, defineStore, disposePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { readMemoryAcceptanceDiagnostics } from './memory-acceptance-diagnostics'
import { ResourcePolicy } from './resource-policy'

const ports = vi.hoisted(() => ({ budget: undefined as AcceptanceBudgetPort | undefined, resources: undefined as ResourcePolicyType | undefined }))
vi.mock('../stores/memory/budget', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../stores/memory/budget')>()
  return { ...actual, getAcceptanceBudget: () => ports.budget }
})
vi.mock('./resource-policy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./resource-policy')>()
  return { ...actual, getResourcePolicy: () => ports.resources }
})

const piniaInstances: ReturnType<typeof createPinia>[] = []
const initialScope: MemoryScope = { principalId: 'synthetic-person', characterId: 'synthetic-character' }

function memorySnapshot(scope: MemoryScope | null = initialScope): MemoryDiagnosticsSummary {
  return {
    scope: scope ? { ...scope } : null,
    snapshotRevision: 4,
    memoryEpoch: 7,
    state: 'ready',
    busy: false,
    enabled: true,
    recoveryUntil: null,
    errorCode: null,
    counts: { facts: { current: 2, history: 1 }, sources: { current: 2, changed: 1, deleted: 0 }, jobs: { pending: 1, running: 0, succeeded: 2, cancelled: 0, failed: 0 }, pendingSourceChanges: 0, extractionBlocks: 1, replayBlocks: 1, persistenceFailures: 0 },
    operations: [],
    sources: [],
    truncated: { operations: false, sources: false },
  }
}

function createOwner() {
  const pinia = createPinia()
  piniaInstances.push(pinia)
  let read: ((request: MemoryReadRequest) => Promise<MemoryDiagnosticsSummary>) | undefined
  const owner = defineStore('synthetic-diagnostics-owner', () => {
    const scope = ref<MemoryScope | null>({ ...initialScope })
    async function diagnosticsSummary(request: MemoryReadRequest = {}) {
      return read ? read(request) : memorySnapshot(scope.value)
    }
    return { scope, diagnosticsSummary }
  })(pinia)
  return { owner, useRead(value: NonNullable<typeof read>) {
    read = value
  } }
}

function budgetSnapshot(): AcceptanceBudgetStatus {
  return { campaignId: 'synthetic-campaign', maxCostMicroYuan: 10_000_000, accountedMicroYuan: 250, reservedMicroYuan: 50, remainingMicroYuan: 9_999_700, paused: false, attempts: 1 }
}

function budget(read = async () => budgetSnapshot()) {
  const port: AcceptanceBudgetPort = {
    status: vi.fn(read),
    reserve: vi.fn(async () => {
      throw new Error('A diagnostic cannot reserve funds')
    }),
    started: vi.fn(async () => {}),
    releaseNotSent: vi.fn(async () => {}),
    settle: vi.fn(async () => budgetSnapshot()),
  }
  ports.budget = port
  return port
}

beforeEach(() => {
  ports.budget = undefined
  ports.resources = undefined
})
afterEach(() => {
  piniaInstances.splice(0).forEach(pinia => disposePinia(pinia))
  vi.restoreAllMocks()
})

describe('memory acceptance diagnostics aggregation', () => {
  it('reports unconfigured owners explicitly instead of inventing zero usage', async () => {
    const { owner } = createOwner()
    const result = await readMemoryAcceptanceDiagnostics(owner, { expectedScope: initialScope })
    expect(result.consistency).toBe('independent-snapshots')
    expect(result.memory.status).toBe('available')
    expect(result.budget).toEqual({ status: 'not-configured', observedAt: expect.any(Number) })
    expect(result.resources.status).toBe('not-configured')
    expect('snapshot' in result.budget).toBe(false)
    expect(result.scope).toEqual(initialScope)
    expect(result.completedAt).toBeGreaterThanOrEqual(result.startedAt)
  })

  it('keeps bounded metadata and strips extra evidence, configuration, raw errors and resource reasons', async () => {
    const { owner, useRead } = createOwner()
    const original = {
      ...memorySnapshot(),
      prompt: 'PRIVATE_PROMPT_CANARY',
      nativeError: new Error('PRIVATE_ERROR_CANARY'),
      operations: Array.from({ length: 25 }, (_, index) => ({ operationId: `operation-${index}`, status: 'succeeded' as const, revision: index, persistedAt: 100 + index, payload: 'PRIVATE_OPERATION_CANARY' })),
      sources: Array.from({ length: 25 }, (_, index) => ({ sourceId: `source-${index}`, sourceRevision: 1, kind: 'chat-message' as const, lifecycle: 'current' as const, text: 'PRIVATE_SOURCE_CANARY' })),
    }
    useRead(async () => original)
    const port = budget(async () => ({ ...budgetSnapshot(), config: { apiKey: 'PRIVATE_KEY_CANARY' } }))
    const setEnabled = vi.fn(async () => {
      throw new Error('A diagnostic cannot change grants')
    })
    const policy = new ResourcePolicy({ setEnabled })
    policy.apply({ revision: 1, appEpoch: 3, active: true, reason: 'PRIVATE_REASON_CANARY', microphone: { enabled: false, epoch: 1 }, screen: { enabled: false, epoch: 4 } })
    ports.resources = policy
    const result = await readMemoryAcceptanceDiagnostics(owner)
    expect(result.memory.status).toBe('available')
    if (result.memory.status !== 'available')
      throw new Error('Expected valid memory metadata')
    expect(result.memory.snapshot.operations).toHaveLength(20)
    expect(result.memory.snapshot.sources).toHaveLength(20)
    expect(result.memory.snapshot.truncated).toEqual({ operations: true, sources: true })
    expect(original.operations).toHaveLength(25)
    expect(result.budget.status).toBe('available')
    expect(result.resources.status).toBe('available')
    expect(JSON.stringify(result)).not.toContain('PRIVATE_')
    expect(port.reserve).not.toHaveBeenCalled()
    expect(port.settle).not.toHaveBeenCalled()
    expect(setEnabled).not.toHaveBeenCalled()
  })

  it.each([false, true])('rejects a scope transition while budget status is pending (returned=%s)', async (returnToOriginal) => {
    const { owner } = createOwner()
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    budget(async () => {
      entered.resolve()
      await release.promise
      return budgetSnapshot()
    })
    const result = readMemoryAcceptanceDiagnostics(owner, { expectedScope: initialScope })
    const rejection = expect(result).rejects.toMatchObject({ code: 'SCOPE_MISMATCH' })
    await entered.promise
    owner.scope = { principalId: 'another-person', characterId: 'another-character' }
    if (returnToOriginal)
      owner.scope = { ...initialScope }
    release.resolve()
    await rejection
  })

  it('rejects an owner response for a different scope even when the local projection did not change', async () => {
    const { owner, useRead } = createOwner()
    useRead(async () => memorySnapshot({ principalId: 'wrong-person', characterId: 'wrong-character' }))
    await expect(readMemoryAcceptanceDiagnostics(owner)).rejects.toMatchObject({ code: 'SCOPE_MISMATCH' })
  })

  it('reports safe per-owner errors without serializing their native messages', async () => {
    const { owner, useRead } = createOwner()
    useRead(async () => {
      throw new Error('PRIVATE_MEMORY_ERROR')
    })
    budget(async () => {
      throw Object.assign(new Error('PRIVATE_BUDGET_ERROR'), { code: 'storage-failed', body: 'PRIVATE_BODY' })
    })
    ports.resources = new ResourcePolicy({ setEnabled: vi.fn() })
    const result = await readMemoryAcceptanceDiagnostics(owner)
    expect(result.memory).toMatchObject({ status: 'unavailable', code: 'UNAVAILABLE' })
    expect(result.budget).toMatchObject({ status: 'unavailable', code: 'storage-failed' })
    expect(result.resources).toMatchObject({ status: 'unavailable', code: 'NOT_READY' })
    expect(JSON.stringify(result)).not.toContain('PRIVATE_')
  })

  it('rejects invalid counters and oversized IDs without returning the rejected payload', async () => {
    const { owner, useRead } = createOwner()
    useRead(async () => ({ ...memorySnapshot(), operations: [{ operationId: 'x'.repeat(129), status: 'succeeded', revision: 1, persistedAt: 1 }] }))
    budget(async () => ({ ...budgetSnapshot(), remainingMicroYuan: -1 }))
    const result = await readMemoryAcceptanceDiagnostics(owner)
    expect(result.memory).toMatchObject({ status: 'unavailable', code: 'INVALID_SNAPSHOT' })
    expect(result.budget).toMatchObject({ status: 'unavailable', code: 'INVALID_SNAPSHOT' })
    expect(JSON.stringify(result)).not.toContain('x'.repeat(129))
  })

  it('rejects a foreign expected scope before requesting any metadata', async () => {
    const { owner, useRead } = createOwner()
    const read = vi.fn(async () => memorySnapshot())
    useRead(read)
    const port = budget()
    await expect(readMemoryAcceptanceDiagnostics(owner, { expectedScope: { principalId: 'foreign', characterId: 'foreign' } })).rejects.toMatchObject({ code: 'SCOPE_MISMATCH' })
    expect(read).not.toHaveBeenCalled()
    expect(port.status).not.toHaveBeenCalled()
  })

  it('preserves separate observation times instead of claiming one atomic resource and budget snapshot', async () => {
    const { owner } = createOwner()
    const release = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    budget(async () => {
      entered.resolve()
      await release.promise
      return budgetSnapshot()
    })
    const policy = new ResourcePolicy({ setEnabled: vi.fn() })
    policy.apply({ revision: 1, appEpoch: 0, active: true, reason: 'shown', microphone: { enabled: false, epoch: 0 }, screen: { enabled: false, epoch: 0 } })
    ports.resources = policy
    const pending = readMemoryAcceptanceDiagnostics(owner)
    await entered.promise
    policy.apply({ ...policy.state, revision: 2, appEpoch: 1, active: false, reason: 'hidden' })
    release.resolve()
    const result = await pending
    expect(result.consistency).toBe('independent-snapshots')
    expect(result.resources).toMatchObject({ status: 'available', snapshot: { revision: 1, active: true } })
    expect(policy.state.revision).toBe(2)
    expect(result.budget.observedAt).toBeGreaterThanOrEqual(result.resources.observedAt)
  })
})
