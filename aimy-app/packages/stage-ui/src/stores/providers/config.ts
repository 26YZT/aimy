import type {} from 'pinia-plugin-synced'
import type { $ZodObject } from 'zod/v4/core'

import type { InferenceServiceProvider, ProviderValidationStatus } from '../../libs/providers/types'
import type { ProviderReplicaRow } from '../../services/inference-service-providers'
import type { ProviderSecretReference } from '../../services/provider-secret-storage'
import type { ProviderSyncRow, ProviderSyncSnapshot } from './merge'

import { useDebounceFn, useIntervalFn, useLocalStorage } from '@vueuse/core'
import { cloneDeep, isEqual } from 'es-toolkit'
import { nanoid } from 'nanoid'
import { defineStore, getActivePinia } from 'pinia'
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { globalRegistry } from 'zod'

import * as v from 'valibot'

import { client } from '../../composables/api'
import { getDefinedProvider } from '../../libs/providers'
import { inferenceServiceProvidersService as service } from '../../services/inference-service-providers'
import { isCloudReplicaEnabled } from '../../services/local-data-policy'
import { getProviderSecretStorage } from '../../services/provider-secret-storage'
import { useAuthStore } from '../auth'
import { mergeProviderSync } from './merge'

const providerStorageOptions = {
  // pinia-plugin-synced is the only cross-window propagation channel for this
  // store. Listening to storage events would feed replicated state back into
  // the leader as a new state proposal.
  listenToStorageChanges: false,
} as const

const PUSH_DEBOUNCE_MS = 1000
/** Same idle interval as VS Code Settings Sync. */
const PULL_INTERVAL_MS = 5 * 60 * 1000

export type ProviderReplicaSyncState = 'synced' | 'pending' | 'not-uploaded'

const emptyReplicaSyncState: Record<string, ProviderReplicaSyncState> = Object.freeze({})

type StoredProvider = InferenceServiceProvider & {
  replicaUpdatedAt?: string
  secretReference?: ProviderSecretReference
  configurationRevision?: number
}

interface PreparedConfiguration {
  providerId: string
  definitionId: string
  config: Record<string, unknown>
  secretReference?: ProviderSecretReference
  expectedRevision: number | undefined
  status?: ProviderValidationStatus
  added?: boolean
}

const localProviderStorageKey = 'settings/providers/local-configured-v1'
const storedProviderSchema = v.object({
  id: v.string(),
  definitionId: v.string(),
  config: v.record(v.string(), v.unknown()),
  status: v.picklist(['unconfigured', 'validating', 'configured', 'invalid', 'bypassed']),
  configuredBy: v.picklist(['user', 'authentication']),
  replicaUpdatedAt: v.optional(v.string()),
  configurationRevision: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  secretReference: v.optional(v.object({ secretRef: v.string(), revision: v.pipe(v.number(), v.integer(), v.minValue(1)) })),
})
const localProviderEnvelopeSchema = v.strictObject({
  schemaVersion: v.literal(1),
  providers: v.record(v.string(), storedProviderSchema),
  revisions: v.record(v.string(), v.pipe(v.number(), v.integer(), v.minValue(1))),
  added: v.record(v.string(), v.boolean()),
})

function loadLocalProviderEnvelope() {
  const raw = localStorage.getItem(localProviderStorageKey)
  if (raw === null)
    return { schemaVersion: 1 as const, providers: {}, revisions: {}, added: {} }
  try {
    const envelope = v.parse(localProviderEnvelopeSchema, JSON.parse(raw))
    for (const provider of Object.values(envelope.providers)) {
      if (Object.entries(provider.config).some(([key, value]) => hasSensitiveValue(key, value)))
        throw new Error('Unprotected provider configuration')
    }
    return envelope
  }
  catch {
    throw new Error('Stored provider configuration needs recovery and was not overwritten')
  }
}

const sensitiveFieldName = /api.?key|access.?key|app.?key|token|secret|password|credential|authorization|headers/i

function hasSensitiveValue(key: string, value: unknown): boolean {
  if (sensitiveFieldName.test(key))
    return value !== undefined && value !== ''
  if (typeof value === 'string' && /(?:url|endpoint)$/i.test(key)) {
    try {
      const url = new URL(value)
      return Boolean(url.username || url.password) || [...url.searchParams.keys()].some(name => sensitiveFieldName.test(name))
    }
    catch {}
  }
  return value !== null && typeof value === 'object' && Object.entries(value).some(([child, entry]) => hasSensitiveValue(child, entry))
}

async function partitionConfiguration(definitionId: string, config: Record<string, unknown>) {
  const definition = getDefinedProvider(definitionId)
  if (!definition)
    throw new Error('Provider definition is unavailable')
  const schema = await definition.createProviderConfig({ t: key => key })
  const shape = schema._zod.def.type === 'object' ? (schema as $ZodObject)._zod.def.shape : undefined
  const publicConfig: Record<string, unknown> = {}
  const secrets: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string' && value.trim() && /(?:url|endpoint)$/i.test(key)) {
      let endpoint: URL
      try {
        endpoint = new URL(value)
      }
      catch { throw new Error('Provider endpoint is invalid') }
      if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
        throw new Error('Use a provider endpoint without credentials, query parameters or fragments')
    }
    const field = shape?.[key]
    const sensitive = hasSensitiveValue(key, value) || (field && globalRegistry.get(field)?.type === 'password')
    if (sensitive)
      secrets[key] = value
    else
      publicConfig[key] = value
  }
  return { publicConfig, secrets }
}

function isUserProvider(provider: InferenceServiceProvider) {
  return provider.configuredBy !== 'authentication'
}

/**
 * Local providers are the primary copy. Cloud is a replica: pull on login
 * and every five minutes while signed in, push after a debounce. Upsert only
 * configured rows. Do not upload status. Merge prefers a config that works
 * on this device, then replica time.
 */
export const useProviderConfigStore = defineStore('provider-config', () => {
  const pinia = getActivePinia()
  let disposed = false
  onScopeDispose(() => {
    disposed = true
  })
  const authStore = useAuthStore()
  const localOnly = !isCloudReplicaEnabled()
  const localEnvelope = localOnly ? loadLocalProviderEnvelope() : undefined
  const providers = localOnly
    ? ref<Record<string, StoredProvider>>(localEnvelope!.providers)
    : useLocalStorage<Record<string, StoredProvider>>('settings/providers/configured', {}, providerStorageOptions)
  const configurationRevisions = localOnly
    ? ref<Record<string, number>>(localEnvelope!.revisions)
    : useLocalStorage<Record<string, number>>('settings/providers/configuration-revisions', {}, providerStorageOptions)
  const addedProviders = localOnly
    ? ref<Record<string, boolean>>(localEnvelope!.added)
    : useLocalStorage<Record<string, boolean>>('settings/providers/added', {}, providerStorageOptions)
  const pendingDeletes = localOnly
    ? ref<Record<string, string | null>>({})
    : useLocalStorage<Record<string, string | null>>('settings/providers/pending-deletes', {}, providerStorageOptions)

  function commitLocalSnapshot(nextProviders: Record<string, StoredProvider>, nextRevisions = configurationRevisions.value, nextAdded = addedProviders.value) {
    if (localOnly) {
      const envelope = v.parse(localProviderEnvelopeSchema, { schemaVersion: 1, providers: nextProviders, revisions: nextRevisions, added: nextAdded })
      try {
        localStorage.setItem(localProviderStorageKey, JSON.stringify(envelope))
      }
      catch {
        throw new Error('Provider configuration was not committed: persistence')
      }
    }
    providers.value = nextProviders
    configurationRevisions.value = nextRevisions
    addedProviders.value = nextAdded
  }

  // Local profiles never inspect or migrate the old plaintext credential store.
  const legacyConfigs = localOnly
    ? ref<Record<string, Record<string, unknown>>>({})
    : useLocalStorage<Record<string, Record<string, unknown>>>('settings/credentials/providers', {}, providerStorageOptions)

  const lastLiveRemote = shallowRef<Record<string, ProviderReplicaRow>>({})
  let replicaMerged = false
  let syncInFlight: Promise<void> | undefined
  const afterSyncHooks: Array<() => void | Promise<void>> = []
  let remoteWorkingCheck: ((row: ProviderReplicaRow) => Promise<boolean>) | undefined

  function onAfterSync(hook: () => void | Promise<void>) {
    afterSyncHooks.push(hook)
    return () => {
      const index = afterSyncHooks.indexOf(hook)
      if (index >= 0)
        afterSyncHooks.splice(index, 1)
    }
  }

  function onRemoteWorking(check: (row: ProviderReplicaRow) => Promise<boolean>) {
    remoteWorkingCheck = check
  }

  // Import the previous provider configuration shape once. Provider ids remain
  // stable, so existing model selections keep pointing at the same provider.
  for (const [providerId, config] of Object.entries(legacyConfigs.value)) {
    if (providers.value[providerId])
      continue

    const definitionId = providerId.startsWith('vision-')
      ? providerId.slice('vision-'.length)
      : providerId
    const definition = getDefinedProvider(definitionId)
    if (!definition)
      continue

    providers.value[providerId] = {
      id: providerId,
      definitionId,
      config,
      status: 'unconfigured',
      configuredBy: definition.configuredBy ?? 'user',
    }
  }

  // Provider definitions own configuration lifecycle policy. Apply that
  // policy to persisted snapshots before module pages consume them. Providers
  // without an owner declaration remain user-configured.
  for (const provider of Object.values(providers.value)) {
    const configuredByDefinition = getDefinedProvider(provider.definitionId)?.configuredBy
    if (configuredByDefinition) {
      provider.configuredBy = configuredByDefinition
    }
    else if (!provider.configuredBy) {
      provider.configuredBy = 'user'
    }
  }

  // Uploaded fields only. status and replicaUpdatedAt stay local; a successful
  // push writes replicaUpdatedAt and must not look like a new local edit.
  function replicaBody(row: { definitionId: string, config: Record<string, unknown> }) {
    return { definitionId: row.definitionId, config: row.config }
  }

  function snapshotLocal(): ProviderSyncSnapshot {
    const live: Record<string, ProviderSyncRow> = {}
    for (const provider of Object.values(providers.value)) {
      if (!isUserProvider(provider))
        continue
      live[provider.id] = {
        id: provider.id,
        ...replicaBody(provider),
        replicaUpdatedAt: provider.replicaUpdatedAt,
      }
    }
    return {
      live,
      pendingDeletes: { ...pendingDeletes.value },
    }
  }

  function indexAcceptedReplica(merged: ProviderSyncSnapshot, remote: ProviderReplicaRow[]) {
    const remoteLiveIds = new Set(remote.filter(row => !row.deletedAt).map(row => row.id))
    const next: Record<string, ProviderReplicaRow> = {}
    for (const row of Object.values(merged.live)) {
      if (!remoteLiveIds.has(row.id))
        continue
      next[row.id] = {
        id: row.id,
        definitionId: row.definitionId,
        config: { ...row.config },
        updatedAt: row.replicaUpdatedAt ?? '',
        deletedAt: null,
      }
    }
    lastLiveRemote.value = next
  }

  function isDirty(provider: StoredProvider) {
    const remote = lastLiveRemote.value[provider.id]
    if (!remote)
      return true
    return !isEqual(replicaBody(provider), replicaBody(remote))
  }

  const schedulePush = useDebounceFn(() => {
    if (isCloudReplicaEnabled())
      void pushProviders()
  }, PUSH_DEBOUNCE_MS)

  // Nested config writes skip actions, so the replica payload is watched.
  const replicaSignature = computed(() => {
    const snapshot = snapshotLocal()
    const live = Object.fromEntries(
      Object.entries(snapshot.live).map(([id, row]) => [id, replicaBody(row)]),
    )
    return JSON.stringify({
      live,
      pendingDeletes: snapshot.pendingDeletes,
    })
  })

  watch(replicaSignature, () => {
    void schedulePush()
  })

  // Existing forms edit this private window draft. Only prepared references enter the replicated store.
  const editableConfigs = ref<Record<string, Record<string, unknown>>>({})
  const draftSnapshots = new Map<string, Record<string, unknown>>()
  const draftJobs = new Map<string, Promise<void>>()
  const draftFailures = new Map<string, Error>()
  const pendingDraftPatches = new Map<string, Record<string, unknown>>()
  const draftSchedulers = new Map<string, ReturnType<typeof useDebounceFn>>()
  let hydratingDrafts = false

  function hydrateDrafts() {
    if (!localOnly)
      return
    hydratingDrafts = true
    try {
      for (const [providerId, provider] of Object.entries(providers.value)) {
        if (draftJobs.has(providerId) || pendingDraftPatches.has(providerId))
          continue
        const currentDraft = editableConfigs.value[providerId]
        const next = { ...currentDraft, ...cloneDeep(provider.config) }
        editableConfigs.value[providerId] = next
        draftSnapshots.set(providerId, cloneDeep(next))
      }
      for (const providerId of Object.keys(editableConfigs.value)) {
        if (!providers.value[providerId]) {
          delete editableConfigs.value[providerId]
          draftSnapshots.delete(providerId)
        }
      }
    }
    finally {
      hydratingDrafts = false
    }
  }

  watch(providers, hydrateDrafts, { deep: true, immediate: true, flush: 'sync' })
  watch(editableConfigs, () => {
    if (!localOnly || hydratingDrafts)
      return
    for (const [providerId, draft] of Object.entries(editableConfigs.value)) {
      const provider = providers.value[providerId]
      if (!provider)
        continue
      const previous = draftSnapshots.get(providerId)
      const patch = Object.fromEntries(Object.entries(draft).filter(([key, value]) => !isEqual(value, previous?.[key])))
      if (!Object.keys(patch).length)
        continue
      draftSnapshots.set(providerId, cloneDeep(draft))
      pendingDraftPatches.set(providerId, { ...pendingDraftPatches.get(providerId), ...cloneDeep(patch) })
      let schedule = draftSchedulers.get(providerId)
      if (!schedule) {
        schedule = useDebounceFn(() => enqueueDraft(providerId), 300)
        draftSchedulers.set(providerId, schedule)
      }
      void schedule()
    }
  }, { deep: true, flush: 'sync' })

  function enqueueDraft(providerId: string) {
    if (disposed)
      return
    const patch = pendingDraftPatches.get(providerId)
    if (!patch)
      return
    pendingDraftPatches.delete(providerId)
    const pending = draftJobs.get(providerId) ?? Promise.resolve()
    const job = pending.catch(() => undefined).then(async () => {
      if (!await patchProviderConfig(providerId, patch))
        throw new Error('Provider configuration is unavailable')
      draftFailures.delete(providerId)
    })
    draftJobs.set(providerId, job)
    void job.catch(() => {
      draftFailures.set(providerId, new Error('Could not securely save provider configuration'))
    }).finally(() => {
      if (draftJobs.get(providerId) === job) {
        draftJobs.delete(providerId)
        hydrateDrafts()
      }
    })
  }

  const configs = computed(() => localOnly
    ? editableConfigs.value
    : Object.fromEntries(
        Object.entries(providers.value).map(([providerId, provider]) => [providerId, provider.config]),
      ))

  /** Waits for this window's form edits before validation or a provider preview. */
  async function flushProviderConfig(providerId: string): Promise<void> {
    enqueueDraft(providerId)
    const job = draftJobs.get(providerId)
    if (job)
      await job
    const failure = draftFailures.get(providerId)
    if (failure)
      throw failure
  }

  /** Shutdown calls this in each renderer before acknowledging that its settings have settled. */
  async function flushProviderConfigurations(): Promise<void> {
    const ids = new Set([...pendingDraftPatches.keys(), ...draftJobs.keys(), ...draftFailures.keys()])
    await Promise.all([...ids].map(providerId => flushProviderConfig(providerId)))
  }

  const listedProviders = computed(() => Object.fromEntries(
    Object.entries(providers.value).filter(([providerId]) => addedProviders.value[providerId]),
  ))
  const configuredProviders = computed(() => Object.fromEntries(
    Object.entries(providers.value).map(([providerId, provider]) => [providerId, provider.status === 'configured']),
  ))

  const replicaSyncState = computed(() => {
    if (!isCloudReplicaEnabled() || !authStore.isAuthenticated)
      return emptyReplicaSyncState

    const states: Record<string, ProviderReplicaSyncState> = {}
    for (const provider of Object.values(providers.value)) {
      if (!isUserProvider(provider))
        continue
      if (!isDirty(provider))
        states[provider.id] = 'synced'
      else if (provider.status === 'configured')
        states[provider.id] = 'pending'
      else
        states[provider.id] = 'not-uploaded'
    }
    return Object.keys(states).length === 0 ? emptyReplicaSyncState : states
  })

  function getProvider(providerId: string) {
    return providers.value[providerId]
  }

  function getProviderConfig(providerId: string) {
    return providers.value[providerId]?.config
  }

  /** A committed version identifies public settings and the opaque secret reference together. */
  function getProviderConfigRevision(providerId: string): number {
    return configurationRevisions.value[providerId] ?? providers.value[providerId]?.configurationRevision ?? 0
  }

  function nextConfigurationRevision(providerId: string): number {
    return getProviderConfigRevision(providerId) + 1
  }

  /** Resolves credentials only in the calling renderer, outside synchronized state and action results. */
  async function resolveProviderConfig(providerId: string, overrides?: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    const provider = providers.value[providerId]
    if (!provider)
      return overrides
    const revision = getProviderConfigRevision(providerId)
    let secretValues: Record<string, unknown> = {}
    if (localOnly && provider.secretReference) {
      const values = await getProviderSecretStorage().read({ providerId, reference: { ...provider.secretReference } })
      const decoded: unknown = JSON.parse(values.config)
      if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded))
        throw new Error('Provider secret configuration is invalid')
      secretValues = decoded as Record<string, unknown>
    }
    if (!providers.value[providerId] || getProviderConfigRevision(providerId) !== revision)
      throw new Error('Provider configuration changed while resolving credentials')
    return { ...provider.config, ...secretValues, ...overrides }
  }

  /** Receives only public configuration and opaque references through the leader action channel. */
  async function commitPreparedConfiguration(prepared: PreparedConfiguration): Promise<StoredProvider> {
    let current = providers.value[prepared.providerId]
    if (disposed || current?.configurationRevision !== prepared.expectedRevision)
      throw new Error('Provider configuration was not committed: revision conflict')
    if (localOnly) {
      const checked = await partitionConfiguration(prepared.definitionId, prepared.config)
      if (Object.keys(checked.secrets).length)
        throw new Error('Unprotected provider credentials cannot enter shared state')
      current = providers.value[prepared.providerId]
      if (current?.configurationRevision !== prepared.expectedRevision)
        throw new Error('Provider configuration was not committed: revision conflict')
    }
    const definition = getDefinedProvider(prepared.definitionId)
    if (!definition)
      throw new Error('Provider definition is unavailable')
    const next: StoredProvider = {
      ...current,
      id: prepared.providerId,
      definitionId: prepared.definitionId,
      configuredBy: current?.configuredBy ?? definition.configuredBy ?? 'user',
      config: cloneDeep(prepared.config),
      secretReference: prepared.secretReference,
      configurationRevision: nextConfigurationRevision(prepared.providerId),
      status: prepared.status ?? current?.status ?? 'unconfigured',
    }
    commitLocalSnapshot(
      { ...providers.value, [prepared.providerId]: next },
      { ...configurationRevisions.value, [prepared.providerId]: next.configurationRevision! },
      prepared.added ? { ...addedProviders.value, [prepared.providerId]: true } : addedProviders.value,
    )
    delete pendingDeletes.value[prepared.providerId]
    schedulePush()
    // Nested settings can come from Vue state. RPC results must be plain data.
    return cloneDeep(next)
  }

  async function prepareAndCommitConfiguration(providerId: string, definitionId: string, config: Record<string, unknown>, status?: ProviderValidationStatus, added?: boolean) {
    const current = providers.value[providerId]
    const expectedRevision = current?.configurationRevision
    let secretReference = current?.secretReference ? { ...current.secretReference } : undefined
    let publicConfig = config
    let createdReference: ProviderSecretReference | undefined
    if (localOnly) {
      const split = await partitionConfiguration(definitionId, config)
      publicConfig = split.publicConfig
      if (Object.keys(split.secrets).length) {
        let previousValues: Record<string, unknown> = {}
        if (secretReference) {
          const stored = await getProviderSecretStorage().read({ providerId, reference: secretReference })
          previousValues = JSON.parse(stored.config) as Record<string, unknown>
        }
        createdReference = await getProviderSecretStorage().write({
          providerId,
          secrets: { config: JSON.stringify({ ...previousValues, ...split.secrets }) },
          previous: secretReference,
        })
        secretReference = createdReference
      }
    }
    try {
      if (disposed)
        throw new Error('Provider configuration owner was closed')
      const committed = await useProviderConfigStore(pinia).commitPreparedConfiguration({ providerId, definitionId, config: publicConfig, secretReference, expectedRevision, status, added })
      if (localOnly && createdReference && current?.secretReference) {
        await getProviderSecretStorage().remove({ providerId, reference: { ...current.secretReference } }).catch(() => {
          console.warn('Replaced provider credential cleanup is pending')
        })
      }
      return committed
    }
    catch (error) {
      const definitelyNotCommitted = error instanceof Error && (error.message === 'Provider configuration was not committed: persistence' || error.message === 'Provider configuration was not committed: revision conflict' || error.message === 'Provider configuration owner was closed')
      if (createdReference && definitelyNotCommitted)
        await getProviderSecretStorage().remove({ providerId, reference: createdReference }).catch(() => undefined)
      throw error
    }
  }

  async function ensureProvider(providerId: string, definitionId: string, config: Record<string, unknown> = {}) {
    if (localOnly) {
      const split = await partitionConfiguration(definitionId, config)
      if (Object.keys(split.secrets).some(key => split.secrets[key] !== undefined && split.secrets[key] !== ''))
        throw new Error('Save provider credentials through the secure configuration action')
      config = split.publicConfig
    }
    return useProviderConfigStore(pinia).ensurePreparedProvider(providerId, definitionId, config)
  }

  /** Only non-sensitive defaults cross the leader channel to create a provider. */
  async function ensurePreparedProvider(providerId: string, definitionId: string, config: Record<string, unknown>) {
    const current = providers.value[providerId]
    if (current)
      return cloneDeep(current)

    if (localOnly && Object.entries(config).some(([key, value]) => hasSensitiveValue(key, value)))
      throw new Error('Save provider credentials through the secure configuration action')

    const definition = getDefinedProvider(definitionId)
    if (!definition)
      throw new Error(`Provider definition with id "${definitionId}" not found.`)

    const provider: StoredProvider = {
      id: providerId,
      definitionId,
      config,
      status: 'unconfigured',
      configuredBy: definition.configuredBy ?? 'user',
      configurationRevision: nextConfigurationRevision(providerId),
    }
    commitLocalSnapshot({ ...providers.value, [providerId]: provider }, { ...configurationRevisions.value, [providerId]: provider.configurationRevision! })
    delete pendingDeletes.value[providerId]
    return provider
  }

  function markProviderAdded(providerId: string) {
    commitLocalSnapshot(providers.value, configurationRevisions.value, { ...addedProviders.value, [providerId]: true })
  }

  function unmarkProviderAdded(providerId: string) {
    const nextAdded = { ...addedProviders.value }
    delete nextAdded[providerId]
    commitLocalSnapshot(providers.value, configurationRevisions.value, nextAdded)
  }

  function setProviderStatus(providerId: string, status: ProviderValidationStatus) {
    const provider = providers.value[providerId]
    if (!provider)
      return

    commitLocalSnapshot({ ...providers.value, [providerId]: { ...provider, status } })
    // Config often changes first; validation marks configured later.
    // Push then, or a finished key never uploads.
    if (status === 'configured')
      schedulePush()
  }

  /**
   * Applies configuration fields through the leader-owned provider snapshot.
   *
   * The caller must initialize the provider before this action runs. The leader
   * merges the patch with its current configuration to keep unrelated changes.
   * Returns false if the provider no longer exists.
   */
  async function patchProviderConfig(providerId: string, patch: Record<string, unknown>) {
    const provider = providers.value[providerId]
    if (!provider)
      return false
    await prepareAndCommitConfiguration(providerId, provider.definitionId, { ...provider.config, ...patch })
    return true
  }

  /**
   * Updates the selected model in the leader-owned provider snapshot.
   *
   * Follower renderers must await this action instead of mutating replicated
   * configuration directly, because `state: true` proposals contain the full
   * store and can overwrite newer leader state.
   */
  async function setProviderModel(providerId: string, model: string) {
    const provider = providers.value[providerId]
    if (!provider)
      return

    const next = { ...provider, config: { ...provider.config, model }, configurationRevision: nextConfigurationRevision(providerId) }
    commitLocalSnapshot({ ...providers.value, [providerId]: next }, { ...configurationRevisions.value, [providerId]: next.configurationRevision })
    schedulePush()
  }

  /**
   * Seeds a discovered default without replacing a model selected by the user.
   */
  async function setProviderModelIfUnset(providerId: string, model: string) {
    const provider = providers.value[providerId]
    if (!provider)
      return

    const currentModel = provider.config.model
    if (typeof currentModel === 'string' && currentModel.length > 0)
      return

    const next = { ...provider, config: { ...provider.config, model }, configurationRevision: nextConfigurationRevision(providerId) }
    commitLocalSnapshot({ ...providers.value, [providerId]: next }, { ...configurationRevisions.value, [providerId]: next.configurationRevision })
    schedulePush()
  }

  function applyMerged(merged: ProviderSyncSnapshot) {
    const previousIds = new Set(Object.keys(providers.value))
    const next: Record<string, StoredProvider> = {}
    for (const [id, provider] of Object.entries(providers.value)) {
      if (!isUserProvider(provider))
        next[id] = provider
    }

    for (const [id, provider] of Object.entries(providers.value)) {
      if (isUserProvider(provider) && !merged.live[id])
        unmarkProviderAdded(id)
    }

    for (const [id, row] of Object.entries(merged.live)) {
      const current = providers.value[id]
      next[id] = {
        id: row.id,
        definitionId: row.definitionId,
        config: row.config,
        replicaUpdatedAt: row.replicaUpdatedAt,
        status: current?.status ?? 'unconfigured',
        configuredBy: 'user',
      }
      if (!previousIds.has(id))
        markProviderAdded(id)
    }

    providers.value = next
    pendingDeletes.value = merged.pendingDeletes
  }

  function localWorkingIds() {
    const ids = new Set<string>()
    for (const provider of Object.values(providers.value)) {
      if (isUserProvider(provider) && provider.status === 'configured')
        ids.add(provider.id)
    }
    return ids
  }

  async function remoteWorkingIds(remote: ProviderReplicaRow[]) {
    const ids = new Set<string>()
    for (const row of remote) {
      if (row.deletedAt)
        continue
      if (!remoteWorkingCheck) {
        ids.add(row.id)
        continue
      }
      try {
        if (await remoteWorkingCheck(row))
          ids.add(row.id)
      }
      catch {}
    }
    return ids
  }

  async function syncProviders() {
    if (!isCloudReplicaEnabled() || !authStore.isAuthenticated)
      return

    if (syncInFlight) {
      await syncInFlight
      return syncProviders()
    }

    syncInFlight = (async () => {
      try {
        const remote = await service.listRemote(client)
        if (!isCloudReplicaEnabled())
          return
        const merged = mergeProviderSync(snapshotLocal(), remote, {
          local: localWorkingIds(),
          remote: await remoteWorkingIds(remote),
        })
        if (!isCloudReplicaEnabled())
          return
        applyMerged(merged)
        indexAcceptedReplica(merged, remote)
        replicaMerged = true
      }
      catch {
        return
      }
      await pushProviders()
      for (const hook of afterSyncHooks)
        await hook()
    })()

    try {
      await syncInFlight
    }
    finally {
      syncInFlight = undefined
    }
  }

  async function pushProviders() {
    if (!isCloudReplicaEnabled() || !authStore.isAuthenticated)
      return

    const toUpsert = Object.values(providers.value).filter(provider =>
      isUserProvider(provider) && isDirty(provider) && provider.status === 'configured',
    )

    if (!replicaMerged) {
      if (toUpsert.length === 0 && Object.keys(pendingDeletes.value).length === 0)
        return
      return syncProviders()
    }

    for (const provider of toUpsert) {
      try {
        if (!isCloudReplicaEnabled())
          return
        const remote = await service.upsertRemote(client, {
          id: provider.id,
          definitionId: provider.definitionId,
          config: provider.config,
        })
        if (!isCloudReplicaEnabled())
          return
        const current = providers.value[provider.id]
        if (current)
          current.replicaUpdatedAt = remote.updatedAt
        lastLiveRemote.value = {
          ...lastLiveRemote.value,
          [provider.id]: remote,
        }
      }
      catch {
        return
      }
    }

    for (const id of Object.keys(pendingDeletes.value)) {
      try {
        if (!isCloudReplicaEnabled())
          return
        await service.deleteRemote(client, id)
        if (!isCloudReplicaEnabled())
          return
        delete pendingDeletes.value[id]
        const nextRemote = { ...lastLiveRemote.value }
        delete nextRemote[id]
        lastLiveRemote.value = nextRemote
      }
      catch {
        return
      }
    }
  }

  const periodicSync = useIntervalFn(
    () => {
      void syncProviders()
    },
    PULL_INTERVAL_MS,
    { immediate: false },
  )

  authStore.onAuthenticated(() => {
    if (!isCloudReplicaEnabled())
      return
    void syncProviders()
    periodicSync.resume()
  })

  authStore.onLogout(() => {
    periodicSync.pause()
  })

  async function addProvider(definitionId: string, initialConfig: Record<string, unknown> = {}) {
    return prepareAndCommitConfiguration(nanoid(), definitionId, initialConfig, undefined, true)
  }

  async function removeProvider(providerId: string) {
    const provider = providers.value[providerId]
    if (!provider)
      return

    if (isCloudReplicaEnabled() && isUserProvider(provider))
      pendingDeletes.value[providerId] = new Date().toISOString()

    const nextProviders = { ...providers.value }
    delete nextProviders[providerId]
    const nextAdded = { ...addedProviders.value }
    delete nextAdded[providerId]
    commitLocalSnapshot(nextProviders, { ...configurationRevisions.value, [providerId]: nextConfigurationRevision(providerId) }, nextAdded)
    const nextRemote = { ...lastLiveRemote.value }
    delete nextRemote[providerId]
    lastLiveRemote.value = nextRemote
    schedulePush()
    if (localOnly && provider.secretReference)
      await getProviderSecretStorage().remove({ providerId, reference: { ...provider.secretReference } })
  }

  async function updateProviderConfig(providerId: string, config: Record<string, unknown>, status: ProviderValidationStatus) {
    const provider = providers.value[providerId]
    if (!provider)
      return
    return prepareAndCommitConfiguration(providerId, provider.definitionId, config, status)
  }

  async function resetProviders() {
    const previous = Object.values(providers.value)
    const nextRevisions = { ...configurationRevisions.value }
    for (const providerId of Object.keys(providers.value))
      nextRevisions[providerId] = nextConfigurationRevision(providerId)
    commitLocalSnapshot({}, nextRevisions, {})
    pendingDeletes.value = {}
    lastLiveRemote.value = {}
    replicaMerged = false
    if (localOnly) {
      await Promise.all(previous.map(provider => provider.secretReference
        ? getProviderSecretStorage().remove({ providerId: provider.id, reference: { ...provider.secretReference } })
        : undefined))
    }
  }

  return {
    providers,
    configurationRevisions,
    configs,
    addedProviders,
    pendingDeletes,
    listedProviders,
    configuredProviders,
    replicaSyncState,

    getProvider,
    getProviderConfig,
    getProviderConfigRevision,
    flushProviderConfig,
    flushProviderConfigurations,
    resolveProviderConfig,
    commitPreparedConfiguration,
    ensureProvider,
    ensurePreparedProvider,
    markProviderAdded,
    unmarkProviderAdded,
    setProviderStatus,
    patchProviderConfig,
    setProviderModel,
    setProviderModelIfUnset,
    syncProviders,
    pushProviders,
    addProvider,
    removeProvider,
    updateProviderConfig,
    resetProviders,
    onAfterSync,
    onRemoteWorking,
  }
}, {
  synced: {
    actions: [
      'ensurePreparedProvider',
      'commitPreparedConfiguration',
      'markProviderAdded',
      'unmarkProviderAdded',
      'setProviderStatus',
      'setProviderModel',
      'setProviderModelIfUnset',
      'syncProviders',
      'pushProviders',
      'removeProvider',
      'resetProviders',
    ],
    state: true,
  },
})
