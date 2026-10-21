/** An opaque reference is safe to persist and replicate between app windows. */
export interface ProviderSecretReference {
  secretRef: string
  revision: number
}

/** Values exist only while saving configuration or constructing a provider. */
export type ProviderSecretValues = Record<string, string>

export interface WriteProviderSecrets {
  providerId: string
  secrets: ProviderSecretValues
  /** An update must name the version that the caller observed. */
  previous?: ProviderSecretReference
}

export interface ReadProviderSecrets {
  providerId: string
  reference: ProviderSecretReference
}

/** Public native-access state. Ready permits an attempt. It does not prove OS authorization. */
export interface ProviderSecretAccessStatus {
  state: 'ready' | 'paused'
  generation: number
}

/** The desktop installs an encrypted platform store before creating Pinia. */
export interface ProviderSecretStorage {
  write: (input: WriteProviderSecrets) => Promise<ProviderSecretReference>
  read: (input: ReadProviderSecrets) => Promise<ProviderSecretValues>
  remove: (input: ReadProviderSecrets) => Promise<void>
  /** Desktop-only status. This never resolves or decrypts a credential. */
  getAccessStatus?: () => Promise<ProviderSecretAccessStatus>
  /** An explicit user action resets only the observed failure generation. */
  retryAccess?: (generation: number) => Promise<ProviderSecretAccessStatus>
}

export type ProviderSecretFailure
  = | 'access-paused'
    | 'unavailable'
    | 'invalid-input'
    | 'not-found'
    | 'conflict'
    | 'storage-failed'
    | 'permission-denied'

/** Errors expose a stable reason, without configuration values or filesystem contents. */
export class ProviderSecretStorageError extends Error {
  readonly code: ProviderSecretFailure

  constructor(code: ProviderSecretFailure) {
    super(`Provider secret storage: ${code}`)
    this.name = 'ProviderSecretStorageError'
    this.code = code
  }
}

const unavailableStorage: ProviderSecretStorage = Object.freeze({
  async write() {
    throw new ProviderSecretStorageError('unavailable')
  },
  async read() {
    throw new ProviderSecretStorageError('unavailable')
  },
  async remove() {
    throw new ProviderSecretStorageError('unavailable')
  },
})

let storage: ProviderSecretStorage = unavailableStorage

/** Installs the host boundary once. Missing secure storage never falls back to plaintext. */
export function configureProviderSecretStorage(platformStorage: ProviderSecretStorage): void {
  if (storage !== unavailableStorage && storage !== platformStorage)
    throw new Error('Provider secret storage is already configured')
  storage = platformStorage
}

/** Returned secrets must stay outside persisted and synchronized store state. */
export function getProviderSecretStorage(): ProviderSecretStorage {
  return storage
}
