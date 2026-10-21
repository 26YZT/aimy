import type { useMemoryStore } from '../stores/memory'
import type { AcceptanceBudgetFailure, AcceptanceBudgetStatus } from '../stores/memory/budget'
import type { MemoryDiagnosticsSummary, MemoryErrorCode, MemoryReadRequest, MemoryScope } from '../types/memory'
import type { ResourceSnapshot } from './resource-policy'

import { watch } from 'vue'

import * as v from 'valibot'

import { getAcceptanceBudget } from '../stores/memory/budget'
import { MemoryOperationError, parseMemoryReadRequest } from '../stores/memory/schema'
import { getResourcePolicy } from './resource-policy'

/** An existing owner handle. The reader never creates or replaces its store. */
export type MemoryDiagnosticsOwner = Pick<ReturnType<typeof useMemoryStore>, 'scope' | 'diagnosticsSummary'>

/** Failures carry only approved codes. Native errors and their messages remain outside the result. */
export type DiagnosticsFailure = MemoryErrorCode | AcceptanceBudgetFailure | 'INVALID_SNAPSHOT' | 'UNAVAILABLE'

/** Each part records its own observation time and availability. Missing configuration has no zero-valued substitute. */
export type DiagnosticsPart<T>
  = | { status: 'available', observedAt: number, snapshot: T }
    | { status: 'not-configured', observedAt: number }
    | { status: 'unavailable', observedAt: number, code: DiagnosticsFailure }

/** Capture metadata excludes the host's unrestricted reason string. */
export type DiagnosticsResources = Pick<ResourceSnapshot, 'revision' | 'appEpoch' | 'active' | 'microphone' | 'screen'>

/** These owners have separate transactions. This result is explicitly not one atomic application snapshot. */
export interface MemoryAcceptanceDiagnostics {
  consistency: 'independent-snapshots'
  scope: MemoryScope | null
  startedAt: number
  completedAt: number
  memory: DiagnosticsPart<MemoryDiagnosticsSummary>
  budget: DiagnosticsPart<AcceptanceBudgetStatus>
  resources: DiagnosticsPart<DiagnosticsResources>
}

const emptyRequest: MemoryReadRequest = Object.freeze({})
const identifier = v.pipe(v.string(), v.minLength(1), v.maxLength(256), v.check(value => value.trim() === value), v.regex(/^[^\u0000-\u001F\u007F]+$/u))
const integer = v.pipe(v.number(), v.finite(), v.integer(), v.minValue(0), v.maxValue(Number.MAX_SAFE_INTEGER))
const timestamp = v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(Number.MAX_SAFE_INTEGER))
const scopeSchema = v.object({ principalId: identifier, characterId: identifier })
const memoryCodes = v.picklist(['INVALID_INPUT', 'NOT_READY', 'SCOPE_MISMATCH', 'REVISION_CONFLICT', 'STALE_OWNER', 'STALE_RESULT', 'SOURCE_MISSING', 'SOURCE_CHANGED', 'SOURCE_SUPPRESSED', 'IDEMPOTENCY_MISMATCH', 'STORAGE_FAILED', 'SCHEMA_UNSUPPORTED', 'STORAGE_CORRUPT', 'FACT_MISSING', 'CURSOR_EXPIRED'])
const budgetCodes = v.picklist(['unavailable', 'invalid-input', 'locked', 'corrupt', 'campaign-mismatch', 'paused', 'cost-limit', 'attempt-conflict', 'storage-failed', 'permission-denied', 'paid-validation-disabled'])
const safeCode = v.union([memoryCodes, budgetCodes])
const memorySchema = v.object({
  scope: v.nullable(scopeSchema),
  snapshotRevision: v.nullable(integer),
  memoryEpoch: v.nullable(integer),
  state: v.picklist(['ready', 'not-ready', 'recovering', 'unavailable']),
  busy: v.boolean(),
  enabled: v.nullable(v.boolean()),
  recoveryUntil: v.nullable(timestamp),
  errorCode: v.nullable(v.union([memoryCodes, v.picklist(['MEMORY_UNAVAILABLE', 'MEMORY_PERSISTENCE_UNRESOLVED'])])),
  counts: v.nullable(v.object({
    facts: v.object({ current: integer, history: integer }),
    sources: v.object({ current: integer, changed: integer, deleted: integer }),
    jobs: v.object({ pending: integer, running: integer, succeeded: integer, cancelled: integer, failed: integer }),
    pendingSourceChanges: integer,
    extractionBlocks: integer,
    replayBlocks: integer,
    persistenceFailures: integer,
  })),
  operations: v.array(v.object({ operationId: v.pipe(identifier, v.maxLength(128)), status: v.literal('succeeded'), revision: integer, persistedAt: timestamp })),
  sources: v.array(v.object({ sourceId: identifier, sourceRevision: v.pipe(integer, v.minValue(1)), kind: v.picklist(['chat-message', 'onboarding-answer', 'profile-correction']), lifecycle: v.picklist(['current', 'changed', 'deleted']) })),
  truncated: v.object({ operations: v.boolean(), sources: v.boolean() }),
})
const budgetSchema = v.object({
  campaignId: v.pipe(identifier, v.maxLength(128)),
  maxCostMicroYuan: integer,
  accountedMicroYuan: integer,
  reservedMicroYuan: integer,
  remainingMicroYuan: integer,
  paused: v.boolean(),
  pauseReason: v.optional(v.picklist(['usage-unknown', 'reservation-exceeded', 'cost-limit'])),
  attempts: integer,
})
const resourceSchema = v.object({
  revision: integer,
  appEpoch: integer,
  active: v.boolean(),
  microphone: v.object({ enabled: v.boolean(), epoch: integer }),
  screen: v.object({ enabled: v.boolean(), epoch: integer }),
})

function scopeFrom(value: unknown): MemoryScope | null {
  if (value === null)
    return null
  const parsed = v.safeParse(scopeSchema, value)
  if (!parsed.success)
    throw new MemoryOperationError('INVALID_INPUT')
  return parsed.output
}

function sameScope(left: MemoryScope | null, right: MemoryScope | null) {
  return left === null || right === null
    ? left === right
    : left.principalId === right.principalId && left.characterId === right.characterId
}

function failureCode(error: unknown): DiagnosticsFailure {
  if (error && typeof error === 'object' && 'code' in error) {
    const parsed = v.safeParse(safeCode, error.code)
    if (parsed.success)
      return parsed.output
  }
  return 'UNAVAILABLE'
}

function parseSnapshot<T>(schema: v.GenericSchema<unknown, T>, value: unknown): DiagnosticsPart<T> {
  const result = v.safeParse(schema, value)
  return result.success
    ? { status: 'available', observedAt: Date.now(), snapshot: result.output }
    : { status: 'unavailable', observedAt: Date.now(), code: 'INVALID_SNAPSHOT' }
}

/**
 * Reads existing owner ports without modifying their data or grants.
 * Scope changes reject the whole read. Other failures affect only their own part.
 * Owner ports retain their existing RPC deadlines. This reader creates no polling loop.
 */
export async function readMemoryAcceptanceDiagnostics(owner: MemoryDiagnosticsOwner, rawRequest: MemoryReadRequest = emptyRequest): Promise<MemoryAcceptanceDiagnostics> {
  const request = parseMemoryReadRequest(rawRequest)
  const scope = scopeFrom(owner.scope)
  if (request.expectedScope && !sameScope(scope, request.expectedScope))
    throw new MemoryOperationError('SCOPE_MISMATCH')
  const startedAt = Date.now()
  let scopeChanged = false
  const stopScopeWatch = watch(() => [owner.scope?.principalId, owner.scope?.characterId], (next, previous) => {
    if (next[0] !== previous[0] || next[1] !== previous[1])
      scopeChanged = true
  }, { flush: 'sync' })
  const assertScope = () => {
    if (scopeChanged || !sameScope(scope, scopeFrom(owner.scope)))
      throw new MemoryOperationError('SCOPE_MISMATCH')
  }

  async function readPart<T>(read: () => Promise<unknown>, schema: v.GenericSchema<unknown, T>): Promise<DiagnosticsPart<T>> {
    let value: unknown
    try {
      value = await read()
    }
    catch (error) {
      assertScope()
      return { status: 'unavailable', observedAt: Date.now(), code: failureCode(error) }
    }
    assertScope()
    return parseSnapshot(schema, value)
  }

  try {
    const memoryRead = readPart(() => owner.diagnosticsSummary(scope ? { expectedScope: scope } : emptyRequest), memorySchema)
    const budget = getAcceptanceBudget()
    const budgetRead: Promise<DiagnosticsPart<AcceptanceBudgetStatus>> = budget
      ? readPart(() => budget.status(), budgetSchema)
      : Promise.resolve({ status: 'not-configured', observedAt: Date.now() })
    const policy = getResourcePolicy()
    let resources: DiagnosticsPart<DiagnosticsResources>
    if (!policy)
      resources = { status: 'not-configured', observedAt: Date.now() }
    else if (policy.state.revision < 0)
      resources = { status: 'unavailable', observedAt: Date.now(), code: 'NOT_READY' }
    else
      resources = parseSnapshot(resourceSchema, policy.state)

    const [memory, budgetResult] = await Promise.all([memoryRead, budgetRead])
    assertScope()
    if (memory.status === 'available') {
      if (!sameScope(scope, memory.snapshot.scope))
        throw new MemoryOperationError('SCOPE_MISMATCH')
      const snapshot = memory.snapshot
      snapshot.truncated = { operations: snapshot.truncated.operations || snapshot.operations.length > 20, sources: snapshot.truncated.sources || snapshot.sources.length > 20 }
      snapshot.operations = snapshot.operations.slice(-20)
      snapshot.sources = snapshot.sources.slice(-20)
    }
    return { consistency: 'independent-snapshots', scope, startedAt, completedAt: Date.now(), memory, budget: budgetResult, resources }
  }
  finally {
    stopScopeWatch()
  }
}
