import type {
  AcceptanceAttempt,
  AcceptanceBudgetStatus,
  AcceptanceCampaign,
  BudgetReservation,
  ReleaseUnsentAttempt,
  SettleAcceptanceAttempt,
} from '@proj-airi/stage-ui/stores/memory/budget'

import { defineInvokeEventa } from '@moeru/eventa'

export const acceptanceBudgetReserve = defineInvokeEventa<BudgetReservation, AcceptanceAttempt>('eventa:invoke:aimy:acceptance-budget:reserve')
export const acceptanceBudgetStarted = defineInvokeEventa<void, BudgetReservation>('eventa:invoke:aimy:acceptance-budget:started')
export const acceptanceBudgetReleaseNotSent = defineInvokeEventa<void, ReleaseUnsentAttempt>('eventa:invoke:aimy:acceptance-budget:release-not-sent')
export const acceptanceBudgetSettle = defineInvokeEventa<AcceptanceBudgetStatus, SettleAcceptanceAttempt>('eventa:invoke:aimy:acceptance-budget:settle')
export const acceptanceBudgetStatus = defineInvokeEventa<AcceptanceBudgetStatus>('eventa:invoke:aimy:acceptance-budget:status')
export const acceptanceBudgetInfo = defineInvokeEventa<AcceptanceCampaign | null>('eventa:invoke:aimy:acceptance-budget:info')
