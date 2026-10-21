import type {
  MemoryEnvelope,
  MemoryJob,
  MemoryJobSnapshot,
  MemoryLeaseRef,
  MemoryModelRoute,
  MemoryMutationRequest,
  MemoryMutationResult,
  MemoryOwnerLease,
  MemoryReceipt,
  MemoryScope,
} from '../../types/memory'

import { applyCandidates, applyMutation, assertJobSnapshot, assertOwner, assertSources, createEnvelope } from '../../stores/memory/policy'
import { MemoryOperationError, parseCandidates, parseEnvelope, parseJobSnapshot, parseModelRoute, parseMutation, parseScope } from '../../stores/memory/schema'
import { storage, updateRawLocal } from '../storage'

interface OwnerRequest {
  ownerId: string
  now: number
  leaseMs: number
  initialActivationId: string
}

interface BeginJobRequest {
  jobId: string
  lease: MemoryLeaseRef
  route: MemoryModelRoute
  now: number
}

interface CommitRequest {
  snapshot: MemoryJobSnapshot
  currentRoute: MemoryModelRoute
  lease: MemoryLeaseRef
  now: number
  mutationId: string
  payloadDigest: string
  candidates: unknown
}

function keyFor(scope: MemoryScope) {
  return `local:memory/v1/${encodeURIComponent(scope.principalId)}/${encodeURIComponent(scope.characterId)}`
}

function validateTime(now: number) {
  if (!Number.isFinite(now) || now < 0)
    throw new MemoryOperationError('INVALID_INPUT')
}

function validateId(id: string) {
  if (typeof id !== 'string' || id.length === 0 || id.length > 128 || id.trim() !== id)
    throw new MemoryOperationError('INVALID_INPUT')
}

function readEnvelope(value: unknown, scope: MemoryScope) {
  if (value === undefined || value === null)
    throw new MemoryOperationError('NOT_READY')
  const envelope = parseEnvelope(value)
  if (envelope.scope.principalId !== scope.principalId || envelope.scope.characterId !== scope.characterId)
    throw new MemoryOperationError('SCOPE_MISMATCH')
  return envelope
}

function canonical(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([name, item]) => `${JSON.stringify(name)}:${canonical(item)}`).join(',')}}`
  }
  const encoded = JSON.stringify(value)
  if (encoded === undefined)
    throw new MemoryOperationError('INVALID_INPUT')
  return encoded
}

async function digest(value: unknown) {
  const bytes = new TextEncoder().encode(canonical(value))
  const result = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('')
}

function priorReceipt(envelope: MemoryEnvelope, operationId: string, payloadDigest: string, commandDigest: string) {
  const receipt = envelope.receipts.find(item => item.operationId === operationId)
  if (receipt && (receipt.payloadDigest !== payloadDigest || receipt.commandDigest !== commandDigest))
    throw new MemoryOperationError('IDEMPOTENCY_MISMATCH')
  return receipt
}

function addReceipt(envelope: MemoryEnvelope, operationId: string, payloadDigest: string, commandDigest: string, now: number, changes: { factIds: string[], jobIds: string[], result?: MemoryMutationResult }): MemoryReceipt {
  envelope.revision++
  const receipt: MemoryReceipt = {
    operationId,
    payloadDigest,
    commandDigest,
    status: 'succeeded',
    revision: envelope.revision,
    memoryEpoch: envelope.memoryEpoch,
    persistedAt: now,
    factIds: changes.factIds,
    jobIds: changes.jobIds,
    ...(changes.result === undefined ? {} : { result: structuredClone(changes.result) }),
  }
  envelope.receipts.push(receipt)
  return receipt
}

/**
 * Owns one atomic memory key per scope. Only this repository commits memory business state.
 * The host authorizes scope and revokes runtime guards before invoking destructive commands.
 * Source journals and model/network side effects remain outside this storage transaction.
 */
export class MemoryRepository {
  /** Missing data stays missing. Corrupt or unsupported data never becomes an empty account. */
  async read(rawScope: MemoryScope): Promise<MemoryEnvelope | null> {
    const scope = parseScope(rawScope)
    const value = await storage.getItemRaw<unknown>(keyFor(scope))
    if (value === null || value === undefined)
      return null
    return readEnvelope(value, scope)
  }

  /** Creates the first activation or takes an expired lease with a strictly newer fencing token. */
  async acquireOwner(rawScope: MemoryScope, request: OwnerRequest): Promise<MemoryOwnerLease> {
    const scope = parseScope(rawScope)
    validateId(request.ownerId)
    validateId(request.initialActivationId)
    validateTime(request.now)
    if (!Number.isFinite(request.leaseMs) || request.leaseMs <= 0 || request.leaseMs > 300_000)
      throw new MemoryOperationError('INVALID_INPUT')
    let result: MemoryOwnerLease | undefined
    await updateRawLocal<MemoryEnvelope>(keyFor(scope), (current) => {
      const envelope = current === undefined ? createEnvelope(scope, request.initialActivationId) : readEnvelope(current, scope)
      if (envelope.lease && envelope.lease.expiresAt > request.now) {
        if (envelope.lease.ownerId !== request.ownerId)
          throw new MemoryOperationError('STALE_OWNER')
        envelope.lease.expiresAt = request.now + request.leaseMs
      }
      else {
        envelope.leaseCounter++
        envelope.memoryEpoch++
        envelope.lease = { ownerId: request.ownerId, token: envelope.leaseCounter, expiresAt: request.now + request.leaseMs }
        for (const job of envelope.jobs) {
          if (job.status !== 'running')
            continue
          job.status = 'pending'
          delete job.snapshot
        }
      }
      result = { ...envelope.lease }
      return parseEnvelope(envelope)
    })
    if (!result)
      throw new MemoryOperationError('STORAGE_FAILED')
    return result
  }

  /** Renews an unexpired lease without changing the UI's fact revision. */
  async renewOwner(rawScope: MemoryScope, lease: MemoryLeaseRef, now: number, leaseMs: number): Promise<MemoryOwnerLease> {
    const scope = parseScope(rawScope)
    validateTime(now)
    if (!Number.isFinite(leaseMs) || leaseMs <= 0 || leaseMs > 300_000)
      throw new MemoryOperationError('INVALID_INPUT')
    let result: MemoryOwnerLease | undefined
    await updateRawLocal<MemoryEnvelope>(keyFor(scope), (current) => {
      const envelope = readEnvelope(current, scope)
      assertOwner(envelope, lease, now)
      envelope.lease = { ...lease, expiresAt: now + leaseMs }
      result = { ...envelope.lease }
      return parseEnvelope(envelope)
    })
    if (!result)
      throw new MemoryOperationError('STORAGE_FAILED')
    return result
  }

  /** Invalidates this owner's completions before another renderer acquires the key. */
  async releaseOwner(rawScope: MemoryScope, lease: MemoryLeaseRef, now: number): Promise<void> {
    const scope = parseScope(rawScope)
    validateTime(now)
    await updateRawLocal<MemoryEnvelope>(keyFor(scope), (current) => {
      const envelope = readEnvelope(current, scope)
      assertOwner(envelope, lease, now)
      envelope.lease = null
      envelope.memoryEpoch++
      return parseEnvelope(envelope)
    })
  }

  /** Duplicate commands return the original receipt. Changed payloads never reuse that receipt. */
  async mutate(rawScope: MemoryScope, rawRequest: MemoryMutationRequest): Promise<MemoryReceipt> {
    const scope = parseScope(rawScope)
    const request = parseMutation(rawRequest)
    validateId(request.mutationId)
    const commandDigest = await digest({ scope, command: request.command })
    let result: MemoryReceipt | undefined
    await updateRawLocal<MemoryEnvelope>(keyFor(scope), (current) => {
      const envelope = readEnvelope(current, scope)
      const previous = priorReceipt(envelope, request.mutationId, request.payloadDigest, commandDigest)
      if (previous) {
        result = previous
        return envelope
      }
      assertOwner(envelope, request.lease, request.now)
      if (request.expectedRevision !== envelope.revision)
        throw new MemoryOperationError('REVISION_CONFLICT')
      const changes = applyMutation(envelope, request.command, request.mutationId, request.now)
      result = addReceipt(envelope, request.mutationId, request.payloadDigest, commandDigest, request.now, changes)
      return parseEnvelope(envelope)
    })
    if (!result)
      throw new MemoryOperationError('STORAGE_FAILED')
    return structuredClone(result)
  }

  /** Captures durable sources and route once. The worker owns provider and abort checks outside this key. */
  async beginJob(rawScope: MemoryScope, request: BeginJobRequest): Promise<MemoryJobSnapshot> {
    const scope = parseScope(rawScope)
    const route = parseModelRoute(request.route)
    validateTime(request.now)
    validateId(request.jobId)
    let result: MemoryJobSnapshot | undefined
    await updateRawLocal<MemoryEnvelope>(keyFor(scope), (current) => {
      const envelope = readEnvelope(current, scope)
      assertOwner(envelope, request.lease, request.now)
      const job = envelope.jobs.find(item => item.jobId === request.jobId)
      if (!job || job.status !== 'pending')
        throw new MemoryOperationError('STALE_RESULT')
      if (job.activationId !== undefined
        && (!envelope.policy.enabled || job.activationId !== envelope.policy.activationId)) {
        throw new MemoryOperationError('STALE_RESULT')
      }
      if (envelope.modelPolicy.mode === 'override'
        && (envelope.modelPolicy.providerId !== route.providerId
          || envelope.modelPolicy.modelId !== route.modelId
          || envelope.modelPolicy.reasoningMode !== route.reasoningMode)) {
        throw new MemoryOperationError('STALE_RESULT')
      }
      assertSources(envelope, job.sourceVersions, true)
      job.attempt++
      job.status = 'running'
      const snapshot: MemoryJobSnapshot = {
        jobId: job.jobId,
        attempt: job.attempt,
        scope,
        memoryEpoch: envelope.memoryEpoch,
        routePolicyRevision: envelope.routePolicyRevision,
        lease: { ownerId: request.lease.ownerId, token: request.lease.token },
        ...(job.activationId === undefined ? {} : { activationId: job.activationId }),
        sourceVersions: structuredClone(job.sourceVersions),
        route,
      }
      job.snapshot = snapshot
      result = structuredClone(snapshot)
      return parseEnvelope(envelope)
    })
    if (!result)
      throw new MemoryOperationError('STORAGE_FAILED')
    return result
  }

  /** Commits an unchanged job. The optional in-process host guard runs inside the final storage updater. */
  async commitCandidates(rawScope: MemoryScope, request: CommitRequest, assertCurrent?: () => void): Promise<MemoryReceipt> {
    const scope = parseScope(rawScope)
    const snapshot = parseJobSnapshot(request.snapshot)
    const currentRoute = parseModelRoute(request.currentRoute)
    const candidates = parseCandidates(request.candidates)
    validateTime(request.now)
    validateId(request.mutationId)
    validateId(request.payloadDigest)
    const commandDigest = await digest({ scope, snapshot, candidates })
    let result: MemoryReceipt | undefined
    await updateRawLocal<MemoryEnvelope>(keyFor(scope), (current) => {
      try {
        assertCurrent?.()
      }
      catch {
        // Host revocation is a semantic rejection, distinct from an IDB transaction abort.
        throw new MemoryOperationError('STALE_RESULT')
      }
      const envelope = readEnvelope(current, scope)
      const previous = priorReceipt(envelope, request.mutationId, request.payloadDigest, commandDigest)
      if (previous) {
        result = previous
        return envelope
      }
      if (canonical(snapshot.route) !== canonical(currentRoute))
        throw new MemoryOperationError('STALE_RESULT')
      assertJobSnapshot(envelope, snapshot, request.lease, request.now)
      const factIds = applyCandidates(envelope, candidates, snapshot.sourceVersions, request.mutationId, request.now)
      const job = envelope.jobs.find(item => item.jobId === snapshot.jobId)
      if (!job)
        throw new MemoryOperationError('STALE_RESULT')
      job.status = 'succeeded'
      delete job.snapshot
      result = addReceipt(envelope, request.mutationId, request.payloadDigest, commandDigest, request.now, { factIds, jobIds: [job.jobId] })
      return parseEnvelope(envelope)
    })
    if (!result)
      throw new MemoryOperationError('STORAGE_FAILED')
    return structuredClone(result)
  }

  /** Returns an interrupted attempt to pending without resurrecting cancelled or replaced work. */
  async deferJob(rawScope: MemoryScope, request: { snapshot: MemoryJobSnapshot, lease: MemoryLeaseRef, now: number }): Promise<boolean> {
    return await this.finishAttempt(rawScope, request, 'pending')
  }

  /** Persists a bounded failure. The worker never schedules an automatic retry from this state. */
  async failJob(rawScope: MemoryScope, request: { snapshot: MemoryJobSnapshot, lease: MemoryLeaseRef, now: number, reason: NonNullable<MemoryJob['failureCode']> }): Promise<boolean> {
    if (!['MODEL_UNAVAILABLE', 'INVALID_INPUT', 'BUDGET_PAUSED', 'STALE_RESULT', 'CANCELLED'].includes(request.reason))
      throw new MemoryOperationError('INVALID_INPUT')
    return await this.finishAttempt(rawScope, request, request.reason === 'CANCELLED' ? 'cancelled' : 'failed', request.reason)
  }

  private async finishAttempt(
    rawScope: MemoryScope,
    request: { snapshot: MemoryJobSnapshot, lease: MemoryLeaseRef, now: number },
    status: 'pending' | 'cancelled' | 'failed',
    failureCode?: MemoryJob['failureCode'],
  ): Promise<boolean> {
    const scope = parseScope(rawScope)
    const snapshot = parseJobSnapshot(request.snapshot)
    validateTime(request.now)
    let changed = false
    await updateRawLocal<MemoryEnvelope>(keyFor(scope), (current) => {
      const envelope = readEnvelope(current, scope)
      assertOwner(envelope, request.lease, request.now)
      if (snapshot.scope.principalId !== scope.principalId || snapshot.scope.characterId !== scope.characterId)
        throw new MemoryOperationError('SCOPE_MISMATCH')
      const job = envelope.jobs.find(item => item.jobId === snapshot.jobId)
      if (!job || job.status !== 'running' || !job.snapshot || canonical(job.snapshot) !== canonical(snapshot))
        return envelope
      if (snapshot.lease.ownerId !== request.lease.ownerId || snapshot.lease.token !== request.lease.token)
        throw new MemoryOperationError('STALE_OWNER')
      job.status = status
      delete job.snapshot
      if (failureCode === undefined)
        delete job.failureCode
      else
        job.failureCode = failureCode
      changed = true
      return parseEnvelope(envelope)
    })
    return changed
  }

  /** A user-requested retry rechecks the original activation and sources before a new attempt. */
  async retryJob(rawScope: MemoryScope, request: { jobId: string, lease: MemoryLeaseRef, now: number }): Promise<void> {
    const scope = parseScope(rawScope)
    validateTime(request.now)
    validateId(request.jobId)
    await updateRawLocal<MemoryEnvelope>(keyFor(scope), (current) => {
      const envelope = readEnvelope(current, scope)
      assertOwner(envelope, request.lease, request.now)
      const job = envelope.jobs.find(item => item.jobId === request.jobId)
      if (!job || (job.status !== 'failed' && job.status !== 'cancelled'))
        throw new MemoryOperationError('STALE_RESULT')
      if (job.activationId !== undefined && (!envelope.policy.enabled || envelope.policy.activationId !== job.activationId))
        throw new MemoryOperationError('STALE_RESULT')
      assertSources(envelope, job.sourceVersions, true)
      job.status = 'pending'
      delete job.snapshot
      delete job.failureCode
      return parseEnvelope(envelope)
    })
  }

  /** Returns a durable operation without replaying it or creating another mutation. */
  async getOperation(scope: MemoryScope, operationId: string): Promise<MemoryReceipt | null> {
    validateId(operationId)
    const envelope = await this.read(scope)
    if (!envelope)
      return null
    const receipt = envelope.receipts.find(item => item.operationId === operationId)
    return receipt ?? null
  }
}

export const memoryRepository = new MemoryRepository()
