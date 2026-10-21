import type {
  InitialMemoryProfile,
  MemoryCandidate,
  MemoryEnvelope,
  MemoryErrorCode,
  MemoryJobSnapshot,
  MemoryListCursor,
  MemoryListRequest,
  MemoryModelPolicy,
  MemoryModelRoute,
  MemoryMutationRequest,
  MemoryReadRequest,
  MemoryScope,
  MemorySourceRequest,
  MemoryWriteOptions,
} from '../../types/memory'

import * as v from 'valibot'

const identifier = v.pipe(v.string(), v.minLength(1), v.maxLength(256), v.check(value => value.trim() === value))
const text = v.pipe(v.string(), v.minLength(1), v.maxLength(1200), v.check(value => value.trim().length > 0))
const integer = v.pipe(v.number(), v.finite(), v.integer(), v.minValue(0), v.maxValue(Number.MAX_SAFE_INTEGER))
const positiveInteger = v.pipe(integer, v.minValue(1))
const timestamp = v.pipe(v.number(), v.finite(), v.minValue(0))
const keywords = v.pipe(v.array(v.pipe(v.string(), v.minLength(1), v.maxLength(64))), v.maxLength(16))

const scopeEntries = { principalId: identifier, characterId: identifier }
const versionEntries = { sourceId: identifier, sourceRevision: positiveInteger, contentHash: identifier }
const sourceEntries = {
  ...scopeEntries,
  ...versionEntries,
  authoredAt: timestamp,
  committedAt: timestamp,
  author: v.literal('user'),
}
const sourceVersionSchema = v.strictObject(versionEntries)
const sourceRefSchema = v.variant('kind', [
  v.strictObject({
    ...sourceEntries,
    kind: v.literal('chat-message'),
    sessionId: identifier,
    messageId: identifier,
    activationId: identifier,
    channel: v.picklist(['text', 'voice-final']),
  }),
  v.strictObject({
    ...sourceEntries,
    kind: v.literal('onboarding-answer'),
    submissionId: identifier,
    fieldId: identifier,
    initializationRevision: positiveInteger,
  }),
  v.strictObject({
    ...sourceEntries,
    kind: v.literal('profile-correction'),
    correctionId: identifier,
    factId: identifier,
  }),
])
const category = v.picklist(['identity', 'preference', 'boundary', 'event', 'plan', 'experience'])
const contentEntries = {
  category,
  subject: v.picklist(['user', 'user-associated']),
  label: v.pipe(v.string(), v.minLength(1), v.maxLength(120)),
  text,
  keywords,
  qualifier: v.optional(v.pipe(v.string(), v.maxLength(400))),
  dueAt: v.optional(timestamp),
  expiresAt: v.optional(timestamp),
  planStatus: v.optional(v.picklist(['planned', 'unknown', 'done', 'cancelled'])),
}
const candidateSchema = v.pipe(v.strictObject({
  ...contentEntries,
  sourceRefIds: v.pipe(v.array(identifier), v.minLength(1), v.maxLength(32)),
  targetFactId: v.optional(identifier),
  slot: v.optional(v.literal('preferred-name')),
}), v.check(candidate => candidate.slot !== 'preferred-name' || (candidate.category === 'identity' && candidate.subject === 'user')), v.check(candidate => candidate.planStatus === undefined || candidate.category === 'plan'))
const candidatesSchema = v.pipe(v.array(candidateSchema), v.maxLength(20))
const modelPolicySchema = v.variant('mode', [
  v.strictObject({ mode: v.literal('follow-chat') }),
  v.strictObject({
    mode: v.literal('override'),
    providerId: identifier,
    modelId: identifier,
    reasoningMode: v.optional(identifier),
    temperature: v.optional(v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(2))),
  }),
])
const leaseRefEntries = { ownerId: identifier, token: positiveInteger }
// Callers can pass a complete lease. Only owner and fence are trusted from that object.
const leaseRefSchema = v.object(leaseRefEntries)
const modelRouteSchema = v.strictObject({
  providerId: identifier,
  modelId: identifier,
  providerConfigRevision: integer,
  promptHash: identifier,
  reasoningMode: v.optional(identifier),
})
const snapshotSchema = v.strictObject({
  jobId: identifier,
  attempt: positiveInteger,
  scope: v.strictObject(scopeEntries),
  memoryEpoch: integer,
  routePolicyRevision: integer,
  lease: leaseRefSchema,
  activationId: v.optional(identifier),
  sourceVersions: v.pipe(v.array(sourceVersionSchema), v.minLength(1)),
  route: modelRouteSchema,
})
const mutationResultSchema = v.variant('kind', [
  v.strictObject({ kind: v.literal('profile.submit'), submissionId: identifier, typedSources: v.array(sourceRefSchema), savedFields: v.array(identifier), pendingExtraction: v.boolean() }),
  v.strictObject({ kind: v.literal('memory.setPolicy'), enabled: v.boolean(), activationId: identifier }),
  v.strictObject({ kind: v.literal('memory.setModelPolicy'), policy: modelPolicySchema, routePolicyRevision: integer }),
  v.strictObject({ kind: v.literal('memory.correct'), factId: identifier, newFactRevision: positiveInteger }),
  v.strictObject({ kind: v.literal('memory.remove'), factId: identifier, barrierRevision: integer, cleanupStatus: v.literal('complete') }),
])
const receiptSchema = v.strictObject({
  operationId: identifier,
  payloadDigest: identifier,
  commandDigest: identifier,
  status: v.literal('succeeded'),
  revision: integer,
  memoryEpoch: integer,
  persistedAt: timestamp,
  factIds: v.array(identifier),
  jobIds: v.array(identifier),
  result: v.optional(mutationResultSchema),
})
const factSchema = v.strictObject({
  ...contentEntries,
  factId: identifier,
  factKey: identifier,
  revision: positiveInteger,
  status: v.picklist(['current', 'superseded', 'removed', 'invalidated']),
  kind: v.picklist(['direct', 'derived']),
  sourceVersions: v.pipe(v.array(sourceVersionSchema), v.minLength(1)),
  dependsOnFactIds: v.array(identifier),
  confirmationAt: timestamp,
  committedAt: timestamp,
})
const blockSchema = v.strictObject({ ...versionEntries, operationId: identifier, createdAt: timestamp })
const envelopeSchema = v.strictObject({
  schemaVersion: v.literal(1),
  scope: v.strictObject(scopeEntries),
  revision: integer,
  memoryEpoch: integer,
  policy: v.strictObject({ enabled: v.boolean(), activationId: identifier }),
  modelPolicy: modelPolicySchema,
  routePolicyRevision: integer,
  sources: v.array(v.strictObject({ ref: sourceRefSchema, lifecycle: v.picklist(['current', 'changed', 'deleted']), text: v.optional(text) })),
  sourceChanges: v.array(v.strictObject({
    changeId: identifier,
    source: sourceRefSchema,
    nextContentHash: v.optional(identifier),
    status: v.picklist(['pending', 'committed', 'aborted']),
    barrierOperationId: identifier,
    createdAt: timestamp,
    finalizedAt: v.optional(timestamp),
  })),
  facts: v.array(factSchema),
  jobs: v.array(v.strictObject({
    jobId: identifier,
    sourceVersions: v.pipe(v.array(sourceVersionSchema), v.minLength(1)),
    activationId: v.optional(identifier),
    status: v.picklist(['pending', 'running', 'succeeded', 'cancelled', 'failed']),
    failureCode: v.optional(v.picklist(['MODEL_UNAVAILABLE', 'INVALID_INPUT', 'BUDGET_PAUSED', 'STALE_RESULT', 'CANCELLED'])),
    attempt: integer,
    snapshot: v.optional(snapshotSchema),
  })),
  extractionBlocks: v.array(blockSchema),
  replayBlocks: v.array(blockSchema),
  factTombstones: v.array(v.strictObject({ factId: identifier, operationId: identifier, createdAt: timestamp })),
  receipts: v.array(receiptSchema),
  profile: v.strictObject({ state: v.picklist(['unanswered', 'submitted', 'skipped']), submissionId: v.optional(identifier) }),
  lease: v.nullable(v.strictObject({ ...leaseRefEntries, expiresAt: timestamp })),
  leaseCounter: integer,
})
const commandSchema = v.variant('type', [
  v.strictObject({ type: v.literal('set-policy'), enabled: v.boolean(), activationId: identifier }),
  v.strictObject({ type: v.literal('set-model-policy'), policy: modelPolicySchema }),
  v.strictObject({ type: v.literal('enqueue-source'), source: sourceRefSchema, jobId: identifier, text: v.optional(text) }),
  v.strictObject({
    type: v.literal('submit-profile'),
    submissionId: identifier,
    skipped: v.boolean(),
    sources: v.array(v.strictObject({ ref: sourceRefSchema, text })),
    candidates: candidatesSchema,
    jobId: v.optional(identifier),
  }),
  v.strictObject({ type: v.literal('correct'), factId: identifier, source: sourceRefSchema, candidate: candidateSchema }),
  v.strictObject({ type: v.literal('remove'), factId: identifier }),
  v.strictObject({ type: v.literal('prepare-source-change'), changeId: identifier, sourceId: identifier, sourceRevision: positiveInteger, nextContentHash: v.optional(identifier) }),
  v.strictObject({ type: v.literal('finalize-source-change'), changeId: identifier, outcome: v.picklist(['committed', 'aborted']) }),
  v.strictObject({ type: v.literal('invalidate-source'), sourceId: identifier, sourceRevision: positiveInteger, lifecycle: v.picklist(['changed', 'deleted']) }),
  v.strictObject({
    type: v.literal('derive-fact'),
    dependsOnFactIds: v.pipe(v.array(identifier), v.minLength(1)),
    label: v.pipe(v.string(), v.minLength(1), v.maxLength(120)),
    text,
    keywords,
  }),
])
const mutationSchema = v.strictObject({
  mutationId: identifier,
  payloadDigest: identifier,
  expectedRevision: integer,
  lease: leaseRefSchema,
  now: timestamp,
  command: commandSchema,
})
const readEntries = { expectedScope: v.optional(v.strictObject(scopeEntries)) }
const operationId = v.pipe(identifier, v.maxLength(128))
const writeOptionsSchema = v.strictObject({ ...readEntries, operationId, expectedRevision: integer })
const readRequestSchema = v.strictObject(readEntries)
const listRequestSchema = v.strictObject({ ...readEntries, stateFilter: v.picklist(['current', 'history']), cursor: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(8192))) })
const cursorSchema = v.strictObject({ version: v.literal(1), scope: v.strictObject(scopeEntries), stateFilter: v.picklist(['current', 'history']), snapshotRevision: integer, offset: integer })
const sourceRequestSchema = v.union([
  v.strictObject({ ...readEntries, factId: identifier, factRevision: v.optional(positiveInteger) }),
  v.strictObject({ ...readEntries, sourceId: identifier, sourceRevision: v.optional(positiveInteger) }),
])
const profileInputSchema = v.strictObject({
  ...readEntries,
  submissionId: identifier,
  preferredName: v.pipe(v.string(), v.maxLength(80)),
  chatPreference: v.picklist(['', 'listen-first', 'talk-it-through', 'lighthearted']),
  recentMatter: v.pipe(v.string(), v.maxLength(1200)),
  skipped: v.boolean(),
  operationId: v.optional(operationId),
  expectedRevision: v.optional(integer),
})

/** Error codes cross local API boundaries without model output or private source text. */
export class MemoryOperationError extends Error {
  constructor(readonly code: MemoryErrorCode) {
    super(code)
    this.name = 'MemoryOperationError'
  }
}

function parse<T>(schema: v.GenericSchema<unknown, T>, input: unknown, code: MemoryErrorCode): T {
  const result = v.safeParse(schema, input)
  if (!result.success)
    throw new MemoryOperationError(code)
  return result.output
}

/** Validates the complete model result before any candidate can change stored facts. */
export function parseCandidates(input: unknown): MemoryCandidate[] {
  return parse(candidatesSchema, input, 'INVALID_INPUT')
}

/** Rejects unsupported or damaged data without replacing the existing record. */
export function parseEnvelope(input: unknown): MemoryEnvelope {
  const version = v.safeParse(v.object({ schemaVersion: v.number() }), input)
  if (version.success && version.output.schemaVersion !== 1)
    throw new MemoryOperationError('SCHEMA_UNSUPPORTED')
  return parse(envelopeSchema, input, 'STORAGE_CORRUPT')
}

/** Parses caller data before it enters the atomic storage updater. */
export function parseMutation(input: unknown): MemoryMutationRequest {
  return parse(mutationSchema, input, 'INVALID_INPUT')
}

/** Scope validation does not replace the host's auth and character authorization. */
export function parseScope(input: unknown): MemoryScope {
  return parse(v.strictObject(scopeEntries), input, 'INVALID_INPUT')
}

/** Preserves the exact request route captured when an extraction job starts. */
export function parseModelRoute(input: unknown): MemoryModelRoute {
  return parse(modelRouteSchema, input, 'INVALID_INPUT')
}

/** Rejects fabricated or incomplete completion envelopes before committing results. */
export function parseJobSnapshot(input: unknown): MemoryJobSnapshot {
  return parse(snapshotSchema, input, 'INVALID_INPUT')
}

/** Read preconditions never select an unauthorized scope. */
export function parseMemoryReadRequest(input: unknown): MemoryReadRequest {
  return parse(readRequestSchema, input, 'INVALID_INPUT')
}

/** Validates the public page selector before cursor decoding. */
export function parseMemoryListRequest(input: unknown): MemoryListRequest {
  return parse(listRequestSchema, input, 'INVALID_INPUT')
}

/** Cursor contents remain untrusted after decoding. Scope and revision checks belong to the projection. */
export function parseMemoryCursor(input: unknown): MemoryListCursor {
  return parse(cursorSchema, input, 'INVALID_INPUT')
}

/** A source query identifies exactly one target, with an optional stored revision. */
export function parseMemorySourceRequest(input: unknown): MemorySourceRequest {
  return parse(sourceRequestSchema, input, 'INVALID_INPUT')
}

/** UI retries preserve both the command identity and its observed revision. */
export function parseMemoryWriteOptions(input: unknown): MemoryWriteOptions {
  return parse(writeOptionsSchema, input, 'INVALID_INPUT')
}

/** Memory routes accept only non-secret provider and model selection fields. */
export function parseMemoryModelPolicy(input: unknown): MemoryModelPolicy {
  return parse(modelPolicySchema, input, 'INVALID_INPUT')
}

/** Validates first-use answers before they become durable source evidence. */
export function parseInitialMemoryProfile(input: unknown): InitialMemoryProfile {
  return parse(profileInputSchema, input, 'INVALID_INPUT')
}
