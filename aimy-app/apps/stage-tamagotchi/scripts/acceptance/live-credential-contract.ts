import * as v from 'valibot'

const revision = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(Number.MAX_SAFE_INTEGER))

/** Public committed metadata only. Form drafts and resolved credentials never enter this contract. */
export const liveCredentialCandidateSchema = v.strictObject({
  providerId: v.literal('acceptance-deepseek'),
  definitionId: v.literal('deepseek'),
  baseUrl: v.literal('https://api.deepseek.com/'),
  modelId: v.literal('deepseek-flash'),
  thinkingMode: v.literal('disable'),
  configurationRevision: revision,
  secretReference: v.strictObject({ secretRef: v.pipe(v.string(), v.uuid()), revision }),
})

export type LiveCredentialCandidate = v.InferOutput<typeof liveCredentialCandidateSchema>

export const liveCredentialBindingSchema = v.strictObject({
  ...liveCredentialCandidateSchema.entries,
  schemaVersion: v.literal(1),
  campaignId: v.pipe(v.string(), v.minLength(1), v.maxLength(128), v.regex(/^[\w.-]+$/)),
  setupProfile: v.pipe(v.string(), v.minLength(1)),
  ciphertextSha256: v.pipe(v.string(), v.regex(/^[a-f\d]{64}$/)),
})

/** Binds an opaque reference to one dedicated profile and one encrypted record. */
export type LiveCredentialBinding = v.InferOutput<typeof liveCredentialBindingSchema>

export type LiveCredentialErrorCode
  = | 'LIVE_CREDENTIAL_INVALID_INPUT'
    | 'LIVE_CREDENTIAL_PATH_DENIED'
    | 'LIVE_CREDENTIAL_PROFILE_MISMATCH'
    | 'LIVE_CREDENTIAL_NOT_CONFIGURED'
    | 'LIVE_CREDENTIAL_STALE_REVISION'
    | 'LIVE_CREDENTIAL_CHANGED'
    | 'LIVE_CREDENTIAL_UNAVAILABLE'
    | 'LIVE_CREDENTIAL_BUSY'
    | 'LIVE_CREDENTIAL_STORAGE_FAILED'
    | 'LIVE_CREDENTIAL_TARGET_CONFLICT'

export interface LiveCredentialStatus {
  configured: boolean
  configurationRevision: number
  errorCode?: LiveCredentialErrorCode
}
