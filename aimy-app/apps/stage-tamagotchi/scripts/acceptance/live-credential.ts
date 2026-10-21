import type { ProviderSecretStorage } from '@proj-airi/stage-ui/services/provider-secret-storage'

import type { LiveCredentialBinding, LiveCredentialCandidate, LiveCredentialErrorCode, LiveCredentialStatus } from './live-credential-contract'

import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, open, realpath, rename, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import * as v from 'valibot'

import { liveCredentialBindingSchema, liveCredentialCandidateSchema } from './live-credential-contract'

interface BindingLocation {
  campaignId: string
  setupProfile: string
  bindingPath: string
}

const revision = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(Number.MAX_SAFE_INTEGER))
const stateSchema = v.variant('configured', [
  v.strictObject({ schemaVersion: v.literal(1), configured: v.literal(true), binding: liveCredentialBindingSchema }),
  v.strictObject({ schemaVersion: v.literal(1), configured: v.literal(false), campaignId: v.string(), setupProfile: v.string(), configurationRevision: revision }),
])
type BindingState = v.InferOutput<typeof stateSchema>
const markerSchema = v.object({ schemaVersion: v.literal(1), campaignId: v.string(), kind: v.picklist(['setup', 'case', 'trial']) })
const recordSchema = v.strictObject({
  providerId: v.string(),
  revision: v.pipe(v.number(), v.integer(), v.minValue(1)),
  encrypted: v.pipe(v.string(), v.minLength(4), v.maxLength(1_048_576), v.regex(/^(?:[A-Z\d+/]{4})*(?:[A-Z\d+/]{2}==|[A-Z\d+/]{3}=)?$/i)),
})
const envelopeSchema = v.strictObject({ schemaVersion: v.literal(1), records: v.record(v.pipe(v.string(), v.uuid()), recordSchema) })
type EncryptedRecord = v.InferOutput<typeof recordSchema>

/** Stable errors never contain credential values, parsed payloads, or native error causes. */
export class LiveCredentialError extends Error {
  constructor(readonly code: LiveCredentialErrorCode) {
    super(code)
    this.name = 'LiveCredentialError'
  }
}

function requireCondition(value: unknown, code: LiveCredentialErrorCode): asserts value {
  if (!value)
    throw new LiveCredentialError(code)
}

function missing(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function canonicalOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  }
  catch (error) {
    if (error instanceof LiveCredentialError)
      throw error
    throw new LiveCredentialError('LIVE_CREDENTIAL_STORAGE_FAILED')
  }
}

async function readJson(filePath: string, maximumBytes: number) {
  const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await handle.stat()
    requireCondition(stat.isFile() && stat.nlink === 1 && stat.size <= maximumBytes, 'LIVE_CREDENTIAL_PATH_DENIED')
    return JSON.parse(await handle.readFile('utf8')) as unknown
  }
  finally { await handle.close() }
}

async function ownedDirectory(root: string, directory: string) {
  const path = resolve(directory)
  const subpath = relative(root, path)
  requireCondition(subpath && subpath !== '..' && !subpath.startsWith(`..${sep}`) && !isAbsolute(subpath), 'LIVE_CREDENTIAL_PATH_DENIED')
  let current = root
  for (const component of subpath.split(sep)) {
    current = join(current, component)
    const stat = await lstat(current)
    requireCondition(stat.isDirectory() && !stat.isSymbolicLink(), 'LIVE_CREDENTIAL_PATH_DENIED')
  }
  return path
}

async function location(input: BindingLocation) {
  requireCondition(isAbsolute(input.bindingPath) && isAbsolute(input.setupProfile)
    && basename(input.bindingPath) === 'credential-binding.json'
    && /^[\w.-]{1,128}$/.test(input.campaignId), 'LIVE_CREDENTIAL_INVALID_INPUT')
  const suppliedRoot = dirname(input.bindingPath)
  const root = await realpath(suppliedRoot)
  // Only the dedicated persistent acceptance campaign may live in the user's Library.
  // Existing application profiles remain excluded; their names alone never grant ownership.
  const persistentRoot = resolve(await realpath(homedir()), 'Library', 'Application Support', 'Aimy-Acceptance', 'first-memory-v1')
  requireCondition(!root.split(sep).includes('Library') || root === persistentRoot, 'LIVE_CREDENTIAL_PATH_DENIED')
  const suppliedSubpath = relative(suppliedRoot, input.setupProfile)
  const setupProfile = await ownedDirectory(root, resolve(root, suppliedSubpath))
  const marker = v.safeParse(markerSchema, await readJson(join(setupProfile, '.aimy-acceptance-profile.json'), 32_768))
  requireCondition(marker.success && marker.output.campaignId === input.campaignId && marker.output.kind === 'setup', 'LIVE_CREDENTIAL_PROFILE_MISMATCH')
  return { root, setupProfile, bindingPath: join(root, 'credential-binding.json'), campaignId: input.campaignId }
}

/** One process writes setup state. A filesystem lock rejects competing processes instead of racing them. */
async function locked<T>(input: BindingLocation, operation: (paths: Awaited<ReturnType<typeof location>>) => Promise<T>) {
  const paths = await location(input)
  const lockPath = `${paths.bindingPath}.lock`
  let handle
  try {
    handle = await open(lockPath, 'wx', 0o600)
  }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST')
      throw new LiveCredentialError('LIVE_CREDENTIAL_BUSY')
    throw error
  }
  try {
    return await operation(paths)
  }
  finally {
    await handle.close()
    await unlink(lockPath)
  }
}

async function readState(paths: Awaited<ReturnType<typeof location>>): Promise<BindingState | undefined> {
  let raw: unknown
  try {
    raw = await readJson(paths.bindingPath, 32_768)
  }
  catch (error) {
    if (missing(error))
      return undefined
    throw error
  }
  const parsed = v.safeParse(stateSchema, raw)
  requireCondition(parsed.success, 'LIVE_CREDENTIAL_CHANGED')
  const identity = parsed.output.configured ? parsed.output.binding : parsed.output
  requireCondition(identity.campaignId === paths.campaignId && identity.setupProfile === paths.setupProfile, 'LIVE_CREDENTIAL_CHANGED')
  return parsed.output
}

function stateRevision(state: BindingState | undefined) {
  return state?.configured ? state.binding.configurationRevision : state?.configurationRevision ?? 0
}

async function atomicWrite(filePath: string, value: unknown, exclusive = false) {
  const temporary = `${filePath}.${randomUUID()}.tmp`
  try {
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(JSON.stringify(value), 'utf8')
      await handle.sync()
    }
    finally { await handle.close() }
    if (exclusive) {
      // Publish without overwriting a file created after our initial existence check.
      await link(temporary, filePath)
      await unlink(temporary)
    }
    else {
      await rename(temporary, filePath)
    }
    const directoryHandle = await open(dirname(filePath), constants.O_RDONLY)
    try {
      await directoryHandle.sync()
    }
    finally { await directoryHandle.close() }
  }
  finally { await unlink(temporary).catch(() => undefined) }
}

async function encryptedRecord(setupProfile: string, candidate: LiveCredentialCandidate) {
  const parsed = v.safeParse(envelopeSchema, await readJson(join(setupProfile, 'provider-secrets.json'), 8 * 1024 * 1024))
  requireCondition(parsed.success && Object.keys(parsed.output.records).length <= 256, 'LIVE_CREDENTIAL_CHANGED')
  const record = parsed.output.records[candidate.secretReference.secretRef]
  requireCondition(record && record.providerId === candidate.providerId && record.revision === candidate.secretReference.revision, 'LIVE_CREDENTIAL_CHANGED')
  return record
}

function recordHash(record: EncryptedRecord) {
  return createHash('sha256').update(Buffer.from(record.encrypted, 'base64')).digest('hex')
}

async function checkedBinding(paths: Awaited<ReturnType<typeof location>>) {
  const state = await readState(paths)
  requireCondition(state?.configured, 'LIVE_CREDENTIAL_NOT_CONFIGURED')
  const record = await encryptedRecord(paths.setupProfile, state.binding)
  requireCondition(recordHash(record) === state.binding.ciphertextSha256, 'LIVE_CREDENTIAL_CHANGED')
  return { binding: state.binding, record }
}

/**
 * Owns the persisted setup approval. Revisions are monotonic across restarts.
 * Serialized invalidation cannot erase a later saved revision. Only the native vault sees plaintext.
 */
export class LiveCredentialBindingStore {
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly options: BindingLocation & { vault: Pick<ProviderSecretStorage, 'read'> }) {}

  private enqueue<T>(operation: () => Promise<T>) {
    const task = this.queue.then(() => canonicalOperation(operation))
    this.queue = task.then(() => undefined, () => undefined)
    return task
  }

  /** Validates one committed provider and records only its public metadata and ciphertext digest. */
  record(input: LiveCredentialCandidate): Promise<LiveCredentialStatus> {
    const parsed = v.safeParse(liveCredentialCandidateSchema, input)
    if (!parsed.success)
      return Promise.reject(new LiveCredentialError('LIVE_CREDENTIAL_INVALID_INPUT'))
    const candidate = parsed.output
    return this.enqueue<LiveCredentialStatus>(() => locked(this.options, async (paths) => {
      const previous = await readState(paths)
      const repeated = previous?.configured
        && candidate.configurationRevision === previous.binding.configurationRevision
        && candidate.secretReference.secretRef === previous.binding.secretReference.secretRef
        && candidate.secretReference.revision === previous.binding.secretReference.revision
      requireCondition(candidate.configurationRevision > stateRevision(previous) || repeated, 'LIVE_CREDENTIAL_STALE_REVISION')
      await atomicWrite(paths.bindingPath, { schemaVersion: 1, configured: false, campaignId: paths.campaignId, setupProfile: paths.setupProfile, configurationRevision: candidate.configurationRevision })
      const record = await encryptedRecord(paths.setupProfile, candidate)
      if (repeated && previous?.configured)
        requireCondition(recordHash(record) === previous.binding.ciphertextSha256, 'LIVE_CREDENTIAL_CHANGED')
      try {
        const values = await this.options.vault.read({ providerId: candidate.providerId, reference: candidate.secretReference })
        const secrets = v.safeParse(v.strictObject({ apiKey: v.pipe(v.string(), v.minLength(1), v.maxLength(16_384), v.check(value => value.trim().length > 0 && !/[\r\n]/.test(value))) }), JSON.parse(values.config))
        requireCondition(secrets.success && Object.keys(values).length === 1, 'LIVE_CREDENTIAL_UNAVAILABLE')
      }
      catch { throw new LiveCredentialError('LIVE_CREDENTIAL_UNAVAILABLE') }
      const latest = await encryptedRecord(paths.setupProfile, candidate)
      requireCondition(recordHash(latest) === recordHash(record), 'LIVE_CREDENTIAL_CHANGED')
      const binding: LiveCredentialBinding = { ...candidate, schemaVersion: 1, campaignId: paths.campaignId, setupProfile: paths.setupProfile, ciphertextSha256: recordHash(record) }
      await atomicWrite(paths.bindingPath, { schemaVersion: 1, configured: true, binding })
      return { configured: true, configurationRevision: candidate.configurationRevision }
    }))
  }

  /** Tombstones survive restart. Equal or newer edits invalidate a saved reference before replacement. */
  invalidate(configurationRevision: number): Promise<LiveCredentialStatus> {
    if (!v.safeParse(revision, configurationRevision).success)
      return Promise.reject(new LiveCredentialError('LIVE_CREDENTIAL_INVALID_INPUT'))
    return this.enqueue<LiveCredentialStatus>(() => locked(this.options, async (paths) => {
      const previous = await readState(paths)
      requireCondition(configurationRevision >= stateRevision(previous), 'LIVE_CREDENTIAL_STALE_REVISION')
      await atomicWrite(paths.bindingPath, { schemaVersion: 1, configured: false, campaignId: paths.campaignId, setupProfile: paths.setupProfile, configurationRevision })
      return { configured: false, configurationRevision, errorCode: 'LIVE_CREDENTIAL_NOT_CONFIGURED' }
    }))
  }

  /** No decrypted value or complete provider object is returned by this inspection. */
  status(): Promise<LiveCredentialStatus> {
    return this.enqueue<LiveCredentialStatus>(() => locked(this.options, async (paths) => {
      const previous = await readState(paths)
      if (!previous?.configured)
        return { configured: false, configurationRevision: stateRevision(previous), errorCode: 'LIVE_CREDENTIAL_NOT_CONFIGURED' }
      await checkedBinding(paths)
      return { configured: true, configurationRevision: previous.binding.configurationRevision }
    })).catch(error => ({ configured: false, configurationRevision: 0, errorCode: error instanceof LiveCredentialError ? error.code : 'LIVE_CREDENTIAL_STORAGE_FAILED' }))
  }
}

/** Reads only a bound public reference after checking its dedicated profile and ciphertext integrity. */
export function readLiveCredentialBinding(options: BindingLocation): Promise<LiveCredentialBinding> {
  return canonicalOperation(() => locked(options, async paths => (await checkedBinding(paths)).binding))
}

/** Copies exactly one encrypted record into a fresh case or trial. Existing mismatched files remain untouched. */
export function copyBoundCredential(options: BindingLocation & { targetProfile: string }): Promise<LiveCredentialBinding> {
  return canonicalOperation(() => locked(options, async (paths) => {
    requireCondition(isAbsolute(options.targetProfile), 'LIVE_CREDENTIAL_PATH_DENIED')
    const targetProfile = await ownedDirectory(paths.root, resolve(paths.root, relative(dirname(options.bindingPath), options.targetProfile)))
    requireCondition(targetProfile !== paths.setupProfile, 'LIVE_CREDENTIAL_PATH_DENIED')
    const marker = v.safeParse(markerSchema, await readJson(join(targetProfile, '.aimy-acceptance-profile.json'), 32_768))
    requireCondition(marker.success && marker.output.campaignId === paths.campaignId && marker.output.kind !== 'setup', 'LIVE_CREDENTIAL_PROFILE_MISMATCH')
    const { binding, record } = await checkedBinding(paths)
    const envelope = { schemaVersion: 1, records: { [binding.secretReference.secretRef]: record } }
    const target = join(targetProfile, 'provider-secrets.json')
    try {
      const existing = v.safeParse(envelopeSchema, await readJson(target, 8 * 1024 * 1024))
      requireCondition(existing.success && JSON.stringify(existing.output) === JSON.stringify(envelope), 'LIVE_CREDENTIAL_TARGET_CONFLICT')
    }
    catch (error) {
      if (!missing(error))
        throw error
      await atomicWrite(target, envelope, true)
    }
    return binding
  }))
}
