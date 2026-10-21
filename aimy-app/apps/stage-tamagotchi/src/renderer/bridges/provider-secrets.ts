import type { ProviderSecretStorage } from '@proj-airi/stage-ui/services/provider-secret-storage'

import { defineInvoke } from '@moeru/eventa'
import { getElectronEventaContext } from '@proj-airi/electron-vueuse'

import {
  providerSecretsAccessStatus,
  providerSecretsRead,
  providerSecretsRemove,
  providerSecretsRetryAccess,
  providerSecretsWrite,
} from '../../shared/eventa/aimy-provider-secrets'

/** Uses the existing Electron bridge. It neither caches nor publishes resolved secrets. */
export function createProviderSecretStorageBridge(context = getElectronEventaContext()): ProviderSecretStorage {
  return {
    write: defineInvoke(context, providerSecretsWrite),
    read: defineInvoke(context, providerSecretsRead),
    remove: defineInvoke(context, providerSecretsRemove),
    getAccessStatus: defineInvoke(context, providerSecretsAccessStatus),
    retryAccess: defineInvoke(context, providerSecretsRetryAccess),
  }
}
