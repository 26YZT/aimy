import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type {
  ProviderSecretAccessStatus,
  ProviderSecretReference,
  ProviderSecretStorage,
  ProviderSecretValues,
  ReadProviderSecrets,
  WriteProviderSecrets,
} from '@proj-airi/stage-ui/services/provider-secret-storage'
import type { IpcMainInvokeEvent, WebContents } from 'electron'

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, rename, unlink } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import { platform } from 'node:process'

import { defineInvokeHandler } from '@moeru/eventa'
import { ProviderSecretStorageError } from '@proj-airi/stage-ui/services/provider-secret-storage'
import { safeStorage } from 'electron'

import * as v from 'valibot'

import {
  providerSecretsAccessStatus,
  providerSecretsRead,
  providerSecretsRemove,
  providerSecretsRetryAccess,
  providerSecretsWrite,
} from '../../../shared/eventa/aimy-provider-secrets'

const identifierSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(128), v.regex(/^[\w.:-]+$/))
const revisionSchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(Number.MAX_SAFE_INTEGER))
const referenceSchema = v.strictObject({ secretRef: v.pipe(v.string(), v.uuid()), revision: revisionSchema })
const valuesSchema = v.record(
  identifierSchema,
  v.pipe(v.string(), v.maxLength(16_384)),
)
const readSchema = v.strictObject({ providerId: identifierSchema, reference: referenceSchema })
const writeSchema = v.strictObject({
  providerId: identifierSchema,
  secrets: valuesSchema,
  previous: v.optional(referenceSchema),
})
const entrySchema = v.strictObject({
  providerId: identifierSchema,
  revision: revisionSchema,
  encrypted: v.pipe(v.string(), v.minLength(1), v.maxLength(1_048_576), v.regex(/^[A-Z\d+/]+={0,2}$/i)),
})
const envelopeSchema = v.strictObject({
  schemaVersion: v.literal(1),
  records: v.record(v.pipe(v.string(), v.uuid()), entrySchema),
})

type SecretEnvelope = v.InferOutput<typeof envelopeSchema>
type SecretEncryption = Pick<typeof safeStorage, 'isEncryptionAvailable' | 'encryptString' | 'decryptString' | 'getSelectedStorageBackend'>

/** Fixed limits bound parsing and IPC work. They do not contain user preferences. */
const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_SECRET_FIELDS = 32
const MAX_REFERENCES = 256

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function checkValues(input: unknown): ProviderSecretValues {
  const parsed = v.safeParse(valuesSchema, input)
  if (!parsed.success || Object.keys(parsed.output).length > MAX_SECRET_FIELDS)
    throw new ProviderSecretStorageError('invalid-input')
  return parsed.output
}

/**
 * Owns one encrypted file inside the current Electron profile.
 * Create one instance per app and share it across authorized windows.
 * References are immutable. The provider configuration owner decides which prepared version becomes current.
 * Operations are serialized. An acknowledged write follows file and directory sync.
 * Loading failures preserve the existing file. This class never imports old credentials.
 */
export class ProviderSecretVault implements ProviderSecretStorage {
  private readonly filePath: string
  private readonly encryption: SecretEncryption
  private queue: Promise<void> = Promise.resolve()
  // Native failure pauses the whole owner, including already queued calls from other windows.
  // An explicit retry advances the generation. A stale retry cannot release a newer failure.
  private accessPaused = false
  private accessGeneration = 0

  constructor(options: { filePath: string, encryption?: SecretEncryption }) {
    if (!isAbsolute(options.filePath))
      throw new ProviderSecretStorageError('invalid-input')
    this.filePath = options.filePath
    this.encryption = options.encryption ?? safeStorage
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      try {
        return await operation()
      }
      catch (error) {
        if (error instanceof ProviderSecretStorageError)
          throw error
        // Native errors can contain paths or implementation details. Never forward their payloads over IPC.
        throw new ProviderSecretStorageError('storage-failed')
      }
    })
    this.queue = next.then(() => undefined, () => undefined)
    return next
  }

  private useEncryption<T>(operation: () => T): T {
    if (this.accessPaused)
      throw new ProviderSecretStorageError('access-paused')
    try {
      if (!this.encryption.isEncryptionAvailable())
        throw new ProviderSecretStorageError('unavailable')
      if (platform === 'linux' && this.encryption.getSelectedStorageBackend() === 'basic_text')
        throw new ProviderSecretStorageError('unavailable')
      return operation()
    }
    catch (error) {
      this.accessPaused = true
      this.accessGeneration++
      throw error
    }
  }

  /** Reads only the process-local failure latch. It never accesses the OS key store. */
  async getAccessStatus(): Promise<ProviderSecretAccessStatus> {
    return { state: this.accessPaused ? 'paused' : 'ready', generation: this.accessGeneration }
  }

  /** Resumes future native attempts after an explicit user action for this generation. */
  async retryAccess(generation: number, authorize: () => void = () => {}): Promise<ProviderSecretAccessStatus> {
    if (!Number.isSafeInteger(generation) || generation < 0)
      throw new ProviderSecretStorageError('invalid-input')
    return this.enqueue(async () => {
      authorize()
      if (generation !== this.accessGeneration)
        throw new ProviderSecretStorageError('conflict')
      this.accessPaused = false
      this.accessGeneration++
      return this.getAccessStatus()
    })
  }

  private async load(): Promise<SecretEnvelope> {
    let handle
    try {
      handle = await open(this.filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
    }
    catch (error) {
      if (isMissingFile(error))
        return { schemaVersion: 1, records: {} }
      throw error
    }

    try {
      const info = await handle.stat()
      if (!info.isFile() || info.size > MAX_FILE_BYTES)
        throw new ProviderSecretStorageError('storage-failed')
      const parsed = v.safeParse(envelopeSchema, JSON.parse(await handle.readFile('utf8')))
      if (!parsed.success || Object.keys(parsed.output.records).length > MAX_REFERENCES)
        throw new ProviderSecretStorageError('storage-failed')
      return parsed.output
    }
    finally {
      await handle.close()
    }
  }

  private async persist(envelope: SecretEnvelope): Promise<void> {
    const content = JSON.stringify(envelope)
    if (Buffer.byteLength(content) > MAX_FILE_BYTES)
      throw new ProviderSecretStorageError('storage-failed')

    const directory = dirname(this.filePath)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const temporary = `${this.filePath}.${randomUUID()}.tmp`
    try {
      const handle = await open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(content, 'utf8')
        await handle.sync()
      }
      finally {
        await handle.close()
      }
      await rename(temporary, this.filePath)
      const directoryHandle = await open(directory, constants.O_RDONLY)
      try {
        await directoryHandle.sync()
      }
      finally {
        await directoryHandle.close()
      }
    }
    finally {
      await unlink(temporary).catch(() => undefined)
    }
  }

  async write(input: WriteProviderSecrets): Promise<ProviderSecretReference> {
    const parsed = v.safeParse(writeSchema, input)
    if (!parsed.success)
      throw new ProviderSecretStorageError('invalid-input')
    const { providerId, previous } = parsed.output
    const secrets = checkValues(parsed.output.secrets)

    return this.enqueue(async () => {
      const envelope = await this.load()
      const existing = previous ? envelope.records[previous.secretRef] : undefined
      if (previous && (!existing || existing.providerId !== providerId || existing.revision !== previous.revision))
        throw new ProviderSecretStorageError('conflict')
      if (Object.keys(envelope.records).length >= MAX_REFERENCES)
        throw new ProviderSecretStorageError('storage-failed')

      // A new reference keeps the old configuration usable if its separate store commit fails.
      const secretRef = randomUUID()
      const revision = (existing?.revision ?? 0) + 1
      if (!Number.isSafeInteger(revision))
        throw new ProviderSecretStorageError('conflict')
      envelope.records[secretRef] = {
        providerId,
        revision,
        encrypted: this.useEncryption(() => this.encryption.encryptString(JSON.stringify(secrets))).toString('base64'),
      }
      await this.persist(envelope)
      return { secretRef, revision }
    })
  }

  async read(input: ReadProviderSecrets): Promise<ProviderSecretValues> {
    const parsed = v.safeParse(readSchema, input)
    if (!parsed.success)
      throw new ProviderSecretStorageError('invalid-input')
    return this.enqueue(async () => {
      const envelope = await this.load()
      const { providerId, reference } = parsed.output
      const entry = envelope.records[reference.secretRef]
      if (!entry || entry.providerId !== providerId)
        throw new ProviderSecretStorageError('not-found')
      if (entry.revision !== reference.revision)
        throw new ProviderSecretStorageError('conflict')
      const values: unknown = JSON.parse(this.useEncryption(() => this.encryption.decryptString(Buffer.from(entry.encrypted, 'base64'))))
      return checkValues(values)
    })
  }

  async remove(input: ReadProviderSecrets): Promise<void> {
    const parsed = v.safeParse(readSchema, input)
    if (!parsed.success)
      throw new ProviderSecretStorageError('invalid-input')
    return this.enqueue(async () => {
      const envelope = await this.load()
      const { providerId, reference } = parsed.output
      const entry = envelope.records[reference.secretRef]
      if (!entry)
        return
      if (entry.providerId !== providerId)
        throw new ProviderSecretStorageError('not-found')
      if (entry.revision !== reference.revision)
        throw new ProviderSecretStorageError('conflict')
      delete envelope.records[reference.secretRef]
      await this.persist(envelope)
    })
  }

  /** Waits for queued work. Rejected operations remain rejected for their original callers. */
  async flush(): Promise<void> {
    await this.queue
  }
}

/**
 * Registers a capability-checked bridge on the existing Electron context.
 * The host supplies a registry check for live app windows. Subframes are always rejected.
 */
export function registerProviderSecrets(options: {
  context: ReturnType<typeof createContext>['context']
  vault: ProviderSecretVault
  authorizeSender: (sender: WebContents) => boolean
}): () => void {
  function authorize(event: IpcMainInvokeEvent | undefined): void {
    if (!event
      || event.sender.isDestroyed()
      || !event.senderFrame
      || event.senderFrame !== event.sender.mainFrame
      || !options.authorizeSender(event.sender)) {
      throw new ProviderSecretStorageError('permission-denied')
    }
  }

  const disposers = [
    defineInvokeHandler(options.context, providerSecretsAccessStatus, (_input, metadata) => {
      authorize(metadata?.raw.ipcMainEvent)
      return options.vault.getAccessStatus()
    }),
    defineInvokeHandler(options.context, providerSecretsRetryAccess, async (generation, metadata) => {
      authorize(metadata?.raw.ipcMainEvent)
      // Retry mutates authorization state. Recheck at queue execution, not only at enqueue time.
      return options.vault.retryAccess(generation, () => authorize(metadata?.raw.ipcMainEvent))
    }),
    defineInvokeHandler(options.context, providerSecretsWrite, (input, metadata) => {
      authorize(metadata?.raw.ipcMainEvent)
      return options.vault.write(input)
    }),
    defineInvokeHandler(options.context, providerSecretsRead, async (input, metadata) => {
      authorize(metadata?.raw.ipcMainEvent)
      const secrets = await options.vault.read(input)
      authorize(metadata?.raw.ipcMainEvent)
      return secrets
    }),
    defineInvokeHandler(options.context, providerSecretsRemove, (input, metadata) => {
      authorize(metadata?.raw.ipcMainEvent)
      return options.vault.remove(input)
    }),
  ]
  return () => disposers.forEach(dispose => dispose())
}
