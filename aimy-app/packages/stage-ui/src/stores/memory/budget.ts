/** A verified price table uses integer micro-yuan per one million billed tokens. */
export interface AcceptancePrice {
  id: string
  currency: 'CNY'
  providerId: string
  modelId: string
  mode: string
  inputMicroYuanPerMillion: number
  cachedInputMicroYuanPerMillion?: number
  outputMicroYuanPerMillion: number
  verifiedAt: string
  sourceUrl: string
}

/** One campaign is shared by every baseline, candidate, retry and human trial profile. */
export interface AcceptanceCampaign {
  campaignId: string
  maxCostMicroYuan: number
  price: AcceptancePrice
}

/** Contains request accounting metadata only. Never pass prompts, payloads or credentials. */
export interface AcceptanceAttempt {
  attemptId: string
  requestId: string
  runId: string
  caseId: string
  arm: 'airi' | 'aimy' | 'human-trial'
  purpose: 'chat' | 'memory' | 'repair'
  providerId: string
  modelId: string
  mode: string
  protocol: 'chat-completions' | 'responses'
  priceVersion: string
  /** Live network admission requires this digest of the final serialized body. Non-live attempts can omit it. */
  requestBodySha256?: string
  /** A conservative bound measured from the final transmitted input. */
  inputTokensUpperBound: number
  /** Must equal a finite server-enforced output limit, including billed reasoning. */
  maxOutputTokens: number
}

/** The host returns this receipt only after reserving funds durably. */
export interface BudgetReservation {
  campaignId: string
  attemptId: string
  reservationId: string
  reservedMicroYuan: number
}

/** Output includes reasoning tokens when the provider bills them as output. */
export interface BudgetUsage {
  inputTokens: number
  outputTokens: number
  cachedInputTokens?: number
}

export interface AcceptanceBudgetStatus {
  campaignId: string
  maxCostMicroYuan: number
  accountedMicroYuan: number
  reservedMicroYuan: number
  remainingMicroYuan: number
  paused: boolean
  pauseReason?: 'usage-unknown' | 'reservation-exceeded' | 'cost-limit'
  attempts: number
}

export interface ReleaseUnsentAttempt {
  reservation: BudgetReservation
  /** The transport wrapper sets this only when it has not invoked the actual fetch function. */
  transportInvoked: false
}

export interface SettleAcceptanceAttempt {
  reservation: BudgetReservation
  /** Missing or incomplete usage retains the reservation and pauses the campaign. */
  usage: BudgetUsage | null
}

/** The host owns persistence and the shared limit. Renderers do not mint or reset budgets. */
export interface AcceptanceBudgetPort {
  reserve: (attempt: AcceptanceAttempt) => Promise<BudgetReservation>
  started: (reservation: BudgetReservation) => Promise<void>
  releaseNotSent: (input: ReleaseUnsentAttempt) => Promise<void>
  settle: (input: SettleAcceptanceAttempt) => Promise<AcceptanceBudgetStatus>
  status: () => Promise<AcceptanceBudgetStatus>
}

export type AcceptanceBudgetFailure = 'unavailable' | 'invalid-input' | 'locked' | 'corrupt' | 'campaign-mismatch' | 'paused' | 'cost-limit' | 'attempt-conflict' | 'storage-failed' | 'permission-denied' | 'paid-validation-disabled'

/** A bounded error reason contains no model input or native filesystem details. */
export class AcceptanceBudgetError extends Error {
  readonly code: AcceptanceBudgetFailure

  constructor(code: AcceptanceBudgetFailure) {
    super(`Acceptance budget: ${code}`)
    this.name = 'AcceptanceBudgetError'
    this.code = code
  }
}

let port: AcceptanceBudgetPort | undefined

/** Installs the campaign boundary. Ordinary product calls do not automatically use this budget. */
export function configureAcceptanceBudget(value: AcceptanceBudgetPort): void {
  if (port && port !== value)
    throw new AcceptanceBudgetError('campaign-mismatch')
  port = value
}

/** Used by explicit acceptance runners, never as a generic daily product limit. */
export function getAcceptanceBudget(): AcceptanceBudgetPort | undefined {
  return port
}

/** A paid acceptance attempt cannot silently continue without its host ledger. */
export function requireAcceptanceBudget(): AcceptanceBudgetPort {
  if (!port)
    throw new AcceptanceBudgetError('unavailable')
  return port
}

/** After this resolves, synchronously recheck cancellation and immediately invoke the real transport. */
export async function beforeAcceptanceAttempt(attempt: AcceptanceAttempt): Promise<BudgetReservation> {
  const budget = requireAcceptanceBudget()
  const reservation = await budget.reserve(attempt)
  try {
    await budget.started(reservation)
    return reservation
  }
  catch (error) {
    await budget.releaseNotSent({ reservation, transportInvoked: false }).catch(() => undefined)
    throw error
  }
}
