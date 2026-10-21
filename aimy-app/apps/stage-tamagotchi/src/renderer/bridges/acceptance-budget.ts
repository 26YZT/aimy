import type { AcceptanceBudgetPort } from '@proj-airi/stage-ui/stores/memory/budget'

import { defineInvoke } from '@moeru/eventa'
import { getElectronEventaContext } from '@proj-airi/electron-vueuse'

import {
  acceptanceBudgetInfo,
  acceptanceBudgetReleaseNotSent,
  acceptanceBudgetReserve,
  acceptanceBudgetSettle,
  acceptanceBudgetStarted,
  acceptanceBudgetStatus,
} from '../../shared/eventa/aimy-acceptance'

/** A missing campaign is distinct from a failed host handshake. Errors propagate to startup. */
export async function readAcceptanceCampaign(context = getElectronEventaContext()) {
  return defineInvoke(context, acceptanceBudgetInfo)()
}

/** Uses one host campaign ledger regardless of the current renderer or user profile. */
export function createAcceptanceBudgetBridge(context = getElectronEventaContext()): AcceptanceBudgetPort {
  return {
    reserve: defineInvoke(context, acceptanceBudgetReserve),
    started: defineInvoke(context, acceptanceBudgetStarted),
    releaseNotSent: defineInvoke(context, acceptanceBudgetReleaseNotSent),
    settle: defineInvoke(context, acceptanceBudgetSettle),
    status: defineInvoke(context, acceptanceBudgetStatus),
  }
}
