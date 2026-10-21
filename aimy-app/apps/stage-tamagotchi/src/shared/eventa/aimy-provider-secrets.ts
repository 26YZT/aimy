import type {
  ProviderSecretAccessStatus,
  ProviderSecretReference,
  ProviderSecretValues,
  ReadProviderSecrets,
  WriteProviderSecrets,
} from '@proj-airi/stage-ui/services/provider-secret-storage'

import { defineInvokeEventa } from '@moeru/eventa'

export const providerSecretsWrite = defineInvokeEventa<ProviderSecretReference, WriteProviderSecrets>('eventa:invoke:aimy:provider-secrets:write')
export const providerSecretsRead = defineInvokeEventa<ProviderSecretValues, ReadProviderSecrets>('eventa:invoke:aimy:provider-secrets:read')
export const providerSecretsRemove = defineInvokeEventa<void, ReadProviderSecrets>('eventa:invoke:aimy:provider-secrets:remove')

export const providerSecretsAccessStatus = defineInvokeEventa<ProviderSecretAccessStatus>('eventa:invoke:aimy:provider-secrets:access-status')
export const providerSecretsRetryAccess = defineInvokeEventa<ProviderSecretAccessStatus, number>('eventa:invoke:aimy:provider-secrets:retry-access')
