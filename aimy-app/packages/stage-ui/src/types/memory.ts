/** A memory belongs to one person and character, across their chat sessions. */
export interface MemoryScope {
  principalId: string
  characterId: string
}

export interface MemorySourceVersion {
  sourceId: string
  sourceRevision: number
  contentHash: string
}

interface SourceBase extends MemorySourceVersion, MemoryScope {
  authoredAt: number
  committedAt: number
  author: 'user'
}

/** The host creates these references after the corresponding user input persists. */
export type MemorySourceRef = SourceBase & (
  | { kind: 'chat-message', sessionId: string, messageId: string, activationId: string, channel: 'text' | 'voice-final' }
  | { kind: 'onboarding-answer', submissionId: string, fieldId: string, initializationRevision: number }
  | { kind: 'profile-correction', correctionId: string, factId: string }
)

/** A replay or extraction block never changes whether the original source exists. */
export interface MemorySource {
  ref: MemorySourceRef
  lifecycle: 'current' | 'changed' | 'deleted'
  text?: string
}

export type MemoryCategory = 'identity' | 'preference' | 'boundary' | 'event' | 'plan' | 'experience'

/** Model candidates contain suggestions, never authoritative fact IDs or dependencies. */
export interface MemoryCandidate {
  category: MemoryCategory
  subject: 'user' | 'user-associated'
  label: string
  text: string
  keywords: string[]
  sourceRefIds: string[]
  targetFactId?: string
  slot?: 'preferred-name'
  qualifier?: string
  dueAt?: number
  expiresAt?: number
  planStatus?: 'planned' | 'unknown' | 'done' | 'cancelled'
}

/** Revisions retain exact source versions. Only the current revision can be recalled. */
export interface MemoryFact {
  factId: string
  factKey: string
  revision: number
  category: MemoryCategory
  subject: 'user' | 'user-associated'
  label: string
  text: string
  keywords: string[]
  qualifier?: string
  dueAt?: number
  expiresAt?: number
  planStatus?: 'planned' | 'unknown' | 'done' | 'cancelled'
  status: 'current' | 'superseded' | 'removed' | 'invalidated'
  kind: 'direct' | 'derived'
  sourceVersions: MemorySourceVersion[]
  dependsOnFactIds: string[]
  confirmationAt: number
  committedAt: number
}

export type MemoryModelPolicy
  = | { mode: 'follow-chat' }
    | { mode: 'override', providerId: string, modelId: string, reasoningMode?: string, temperature?: number }

export interface MemoryOwnerLease {
  ownerId: string
  token: number
  expiresAt: number
}

export type MemoryLeaseRef = Pick<MemoryOwnerLease, 'ownerId' | 'token'>

/** This non-secret route snapshot fences provider changes made while a job waits. */
export interface MemoryModelRoute {
  providerId: string
  modelId: string
  providerConfigRevision: number
  promptHash: string
  reasoningMode?: string
}

/** The worker must check its external route and cancellation guard after every await. */
export interface MemoryJobSnapshot {
  jobId: string
  attempt: number
  scope: MemoryScope
  memoryEpoch: number
  routePolicyRevision: number
  lease: MemoryLeaseRef
  activationId?: string
  sourceVersions: MemorySourceVersion[]
  route: MemoryModelRoute
}

export interface MemoryJob {
  jobId: string
  sourceVersions: MemorySourceVersion[]
  activationId?: string
  status: 'pending' | 'running' | 'succeeded' | 'cancelled' | 'failed'
  failureCode?: 'MODEL_UNAVAILABLE' | 'INVALID_INPUT' | 'BUDGET_PAUSED' | 'STALE_RESULT' | 'CANCELLED'
  attempt: number
  snapshot?: MemoryJobSnapshot
}

/** Blocks apply to a known source version, not unrelated facts supported by that source. */
export interface MemorySourceBlock extends MemorySourceVersion {
  operationId: string
  createdAt: number
}

/** A reversible source edit intent. The host resolves it against the actual persisted chat record. */
export interface MemorySourceChange {
  changeId: string
  source: MemorySourceRef
  nextContentHash?: string
  status: 'pending' | 'committed' | 'aborted'
  barrierOperationId: string
  createdAt: number
  finalizedAt?: number
}

export interface MemoryFactTombstone {
  factId: string
  operationId: string
  createdAt: number
}

export type MemoryErrorCode
  = | 'INVALID_INPUT' | 'NOT_READY' | 'SCOPE_MISMATCH' | 'REVISION_CONFLICT'
    | 'STALE_OWNER' | 'STALE_RESULT' | 'SOURCE_MISSING' | 'SOURCE_CHANGED'
    | 'SOURCE_SUPPRESSED' | 'IDEMPOTENCY_MISMATCH' | 'STORAGE_FAILED'
    | 'SCHEMA_UNSUPPORTED' | 'STORAGE_CORRUPT' | 'FACT_MISSING' | 'CURSOR_EXPIRED'

/** Transaction results contain references and state, never copied evidence or credentials. */
export type MemoryMutationResult
  = | { kind: 'profile.submit', submissionId: string, typedSources: MemorySourceRef[], savedFields: string[], pendingExtraction: boolean }
    | { kind: 'memory.setPolicy', enabled: boolean, activationId: string }
    | { kind: 'memory.setModelPolicy', policy: MemoryModelPolicy, routePolicyRevision: number }
    | { kind: 'memory.correct', factId: string, newFactRevision: number }
    | { kind: 'memory.remove', factId: string, barrierRevision: number, cleanupStatus: 'complete' }

/** A receipt becomes visible only after its enclosing storage transaction completes. */
export interface MemoryReceipt {
  operationId: string
  payloadDigest: string
  commandDigest: string
  status: 'succeeded'
  revision: number
  memoryEpoch: number
  persistedAt: number
  factIds: string[]
  jobIds: string[]
  /** Older receipts omit result metadata. Readers must not reconstruct it from current state. */
  result?: MemoryMutationResult
}

/** Public actions keep the persisted receipt fields and explicitly identify absent result metadata. */
export interface MemoryActionReceipt extends MemoryReceipt {
  resultStatus: 'recorded' | 'not-recorded'
}

/** A caller scope is a precondition, never authority to select another account or character. */
export interface MemoryReadRequest {
  expectedScope?: MemoryScope
}

/** Strict UI writes retain this identity and revision across transport retries. */
export interface MemoryWriteOptions extends MemoryReadRequest {
  operationId: string
  expectedRevision: number
}

/** Existing profile callers can keep their submission identity without a separate command envelope. */
export interface InitialMemoryProfile extends MemoryReadRequest {
  submissionId: string
  preferredName: string
  chatPreference: string
  recentMatter: string
  skipped: boolean
  operationId?: string
  expectedRevision?: number
}

/** Initial values are stored source text, not the latest inferred or corrected profile. */
export interface MemoryProfileSnapshot {
  scope: MemoryScope
  snapshotRevision: number
  completionState: MemoryEnvelope['profile']['state']
  initialProfile: { submissionId: string, fields: Array<{ fieldId: string, value: string | null, source: MemorySourceRef }> } | null
}

/** Current lists use effective facts. History lists contain superseded, removed and invalidated revisions. */
export interface MemoryListRequest extends MemoryReadRequest {
  stateFilter: 'current' | 'history'
  cursor?: string
}

/** A cursor describes one immutable list revision. It does not grant scope access. */
export interface MemoryListCursor {
  version: 1
  scope: MemoryScope
  stateFilter: MemoryListRequest['stateFilter']
  snapshotRevision: number
  offset: number
}

/** Pages contain at most 50 fact revisions and never mix storage snapshots. */
export interface MemoryListSnapshot {
  scope: MemoryScope
  facts: MemoryFact[]
  snapshotRevision: number
  nextCursor?: string
}

/** An omitted fact revision selects an effective fact. An omitted source revision selects its latest stored version. */
export type MemorySourceRequest = MemoryReadRequest & (
  | { factId: string, factRevision?: number }
  | { sourceId: string, sourceRevision?: number }
)

/** Source text is returned only when its stored version still matches the actual evidence. */
export type MemorySourceEntry = { ref: MemorySourceRef, lifecycle: MemorySource['lifecycle'] } & (
  | { status: 'available', text: string }
  | { status: 'missing' | 'changed' | 'deleted', text?: never }
)

/** Lineage exposes only relationships actually stored with a fact revision. */
export interface MemorySourceSnapshot {
  scope: MemoryScope
  snapshotRevision: number
  sources: MemorySourceEntry[]
  lineage: Array<{ factId: string, factRevision: number, status: MemoryFact['status'], sourceVersions: MemorySourceVersion[], dependsOnFactIds: string[] }>
}

/** Diagnostic counts contain no evidence or request content. */
export interface MemoryDiagnosticCounts {
  facts: { current: number, history: number }
  sources: Record<MemorySource['lifecycle'], number>
  jobs: Record<MemoryJob['status'], number>
  pendingSourceChanges: number
  extractionBlocks: number
  replayBlocks: number
  persistenceFailures: number
}

/** This owner-only summary excludes facts, source text, model prompts and provider configuration. */
export interface MemoryDiagnosticsSummary {
  scope: MemoryScope | null
  snapshotRevision: number | null
  memoryEpoch: number | null
  state: 'ready' | 'not-ready' | 'recovering' | 'unavailable'
  busy: boolean
  enabled: boolean | null
  recoveryUntil: number | null
  errorCode: MemoryErrorCode | 'MEMORY_UNAVAILABLE' | 'MEMORY_PERSISTENCE_UNRESOLVED' | null
  counts: MemoryDiagnosticCounts | null
  operations: Array<Pick<MemoryReceipt, 'operationId' | 'status' | 'revision' | 'persistedAt'>>
  sources: Array<{ sourceId: string, sourceRevision: number, kind: MemorySourceRef['kind'], lifecycle: MemorySource['lifecycle'] }>
  truncated: { operations: boolean, sources: boolean }
}

/** One atomic key owns memory state. Chat text and acceptance costs have other owners. */
export interface MemoryEnvelope {
  schemaVersion: 1
  scope: MemoryScope
  revision: number
  memoryEpoch: number
  policy: { enabled: boolean, activationId: string }
  modelPolicy: MemoryModelPolicy
  routePolicyRevision: number
  sources: MemorySource[]
  sourceChanges: MemorySourceChange[]
  facts: MemoryFact[]
  jobs: MemoryJob[]
  extractionBlocks: MemorySourceBlock[]
  replayBlocks: MemorySourceBlock[]
  factTombstones: MemoryFactTombstone[]
  receipts: MemoryReceipt[]
  profile: { state: 'unanswered' | 'submitted' | 'skipped', submissionId?: string }
  lease: MemoryOwnerLease | null
  leaseCounter: number
}

/** Host-only commands. The public UI adapter authorizes scope before invoking them. */
export type MemoryMutation
  = | { type: 'set-policy', enabled: boolean, activationId: string }
    | { type: 'set-model-policy', policy: MemoryModelPolicy }
    | { type: 'enqueue-source', source: MemorySourceRef, jobId: string, text?: string }
    | { type: 'submit-profile', submissionId: string, skipped: boolean, sources: { ref: MemorySourceRef, text: string }[], candidates: MemoryCandidate[], jobId?: string }
    | { type: 'correct', factId: string, source: MemorySourceRef, candidate: MemoryCandidate }
    | { type: 'remove', factId: string }
    | { type: 'prepare-source-change', changeId: string, sourceId: string, sourceRevision: number, nextContentHash?: string }
    | { type: 'finalize-source-change', changeId: string, outcome: 'committed' | 'aborted' }
    | { type: 'invalidate-source', sourceId: string, sourceRevision: number, lifecycle: 'changed' | 'deleted' }
    | { type: 'derive-fact', dependsOnFactIds: string[], label: string, text: string, keywords: string[] }

export interface MemoryMutationRequest {
  mutationId: string
  payloadDigest: string
  expectedRevision: number
  lease: MemoryLeaseRef
  now: number
  command: MemoryMutation
}

export interface MemoryRecallItem {
  fact: MemoryFact
  score: number
  reasons: string[]
  viewStatus: 'current' | 'expired' | 'outcome-unknown'
}

export interface MemoryEvidencePack {
  text: string
  includedFactIds: string[]
  excludedFactIds: string[]
  estimatedTokens: number
}
