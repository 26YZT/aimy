import type { ProviderSecretReference } from '@proj-airi/stage-ui/services/provider-secret-storage'
import type { AcceptanceBudgetStatus, AcceptanceCampaign } from '@proj-airi/stage-ui/stores/memory/budget'

import type { LiveCredentialCandidate, LiveCredentialStatus } from './live-credential-contract'

import { defineInvokeEventa } from '@moeru/eventa'

/** This metadata never contains a key. The host selects the mode before loading the application. */
interface HostMetadata {
  mode: 'offline-fixture' | 'official-model' | 'qualification'
  arm: 'airi' | 'aimy'
  caseId: string
  runId: string
  epoch: number
  campaign: AcceptanceCampaign
  providerInstanceId: string
  baseURL: string
  modelId: 'deepseek-flash'
}

export type AcceptanceRunInfo = HostMetadata & { phase: 'run', reference: ProviderSecretReference }
export type AcceptanceHostInfo = AcceptanceRunInfo | (HostMetadata & { phase: 'setup' })

export type AcceptanceReply<T> = { ok: true, value: T } | { ok: false, code: string }
export const acceptanceInfo = defineInvokeEventa<AcceptanceReply<AcceptanceHostInfo>>('eventa:invoke:aimy:acceptance-entry:info')
export const acceptanceFlush = defineInvokeEventa<AcceptanceReply<{ budget: AcceptanceBudgetStatus, requests: number }>>('eventa:invoke:aimy:acceptance-entry:flush')
export const acceptanceSetupRecord = defineInvokeEventa<AcceptanceReply<LiveCredentialStatus>, LiveCredentialCandidate>('eventa:invoke:aimy:acceptance-entry:setup-record')
export const acceptanceSetupInvalidate = defineInvokeEventa<AcceptanceReply<LiveCredentialStatus>, { configurationRevision: number }>('eventa:invoke:aimy:acceptance-entry:setup-invalidate')
export const acceptanceSetupStatus = defineInvokeEventa<AcceptanceReply<LiveCredentialStatus>>('eventa:invoke:aimy:acceptance-entry:setup-status')
export type SetupStage = 'startup' | 'host-info' | 'memory-pause' | 'onboarding' | 'provider-defaults' | 'provider-observer' | 'open-settings' | 'ready'
export const acceptanceSetupUi = defineInvokeEventa<AcceptanceReply<{ recorded: true }>, { state: 'page-opened' | 'failed', stage: SetupStage }>('eventa:invoke:aimy:acceptance-entry:setup-ui')
