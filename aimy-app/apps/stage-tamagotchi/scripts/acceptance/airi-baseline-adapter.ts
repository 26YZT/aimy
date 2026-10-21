import type {
  AcceptanceProviderDefinition,
  AcceptanceRequest,
} from '@proj-airi/stage-ui/services/acceptance-generation'
import type {
  AcceptanceAttempt,
  AcceptanceBudgetPort,
  AcceptanceCampaign,
  BudgetReservation,
  BudgetUsage,
} from '@proj-airi/stage-ui/stores/memory/budget'

import { describeAcceptanceRequest, readAcceptanceUsage } from '@proj-airi/stage-ui/services/acceptance-generation'
import { AcceptanceBudgetError } from '@proj-airi/stage-ui/stores/memory/budget'
import { nanoid } from 'nanoid'

import * as v from 'valibot'

/** The host resolves credentials before returning this closure. Calling it must immediately invoke the original transport. */
export type AuthorizedFetch = (url: URL, request: RequestInit) => Promise<Response>

/** One adapter owns a fixed baseline run. It never installs a server, reads a profile, or obtains credentials. */
export interface AiriBaselineAdapterOptions {
  budget: AcceptanceBudgetPort
  campaign: AcceptanceCampaign
  run: Pick<AcceptanceAttempt, 'runId' | 'caseId'> & { arm: 'airi' }
  providerDefinition: AcceptanceProviderDefinition
  protocol: AcceptanceRequest['protocol']
  maxInputTokens: number
  maxOutputTokens: number
  /** @default run.runId */
  requestId?: string
  signal?: AbortSignal
  assertCurrent: () => void
  prepareTransport: () => Promise<AuthorizedFetch>
}

type FailureCode = 'invalid-input' | 'transport-unavailable' | 'transport-failed' | 'redirect-blocked' | 'accounting-failed'

/** Errors expose a stable code and optional HTTP status, never transport payloads or credentials. */
export class BaselineAcceptanceError extends Error {
  readonly code: FailureCode
  readonly status?: number

  constructor(code: FailureCode, status?: number) {
    super(`Acceptance baseline: ${code}`)
    this.name = 'BaselineAcceptanceError'
    this.code = code
    this.status = status
  }
}

const id = v.pipe(v.string(), v.minLength(1), v.maxLength(160), v.regex(/^[\w.:-]+$/))
const runSchema = v.strictObject({ arm: v.literal('airi'), caseId: id, runId: id })
const positiveBound = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1_000_000_000))

function publicFailure(error: unknown, fallback: FailureCode): Error {
  if (error instanceof Error && error.name === 'AbortError')
    return new DOMException('Acceptance request cancelled', 'AbortError')
  if (error instanceof AcceptanceBudgetError)
    return new AcceptanceBudgetError(error.code)
  if (error instanceof BaselineAcceptanceError)
    return new BaselineAcceptanceError(error.code, error.status)
  const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined
  return new BaselineAcceptanceError(fallback, typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599 ? status : undefined)
}

/**
 * Wraps the original SDK fetch boundary without changing baseline memory or buffering successful responses.
 * Preparation precedes accounting. Each invocation owns one durable attempt, including SDK retries.
 *
 * Call stack:
 *
 * baseline SDK
 *   -> {@link AiriBaselineAdapter.fetch}
 *     -> prepareTransport -> reserve -> started -> assertCurrent -> AuthorizedFetch
 *       -> original response stream + separate usage settlement
 */
export class AiriBaselineAdapter {
  private readonly options: AiriBaselineAdapterOptions
  private readonly active = new Set<Promise<Response>>()
  private readonly settlements = new Set<Promise<unknown>>()
  private accountingFailure: AcceptanceBudgetError | undefined

  constructor(options: AiriBaselineAdapterOptions) {
    const run = v.safeParse(runSchema, options.run)
    if (!run.success || !v.safeParse(positiveBound, options.maxInputTokens).success
      || !v.safeParse(positiveBound, options.maxOutputTokens).success
      || !v.safeParse(id, options.requestId ?? options.run.runId).success) {
      throw new BaselineAcceptanceError('invalid-input')
    }
    this.options = {
      ...options,
      campaign: structuredClone(options.campaign),
      run: run.output,
      providerDefinition: { id: options.providerDefinition.id },
    }
  }

  private assertCurrent(signal: AbortSignal | undefined) {
    if (this.accountingFailure)
      throw this.accountingFailure
    if (signal?.aborted)
      throw new DOMException('Acceptance request cancelled', 'AbortError')
    this.options.assertCurrent()
  }

  private request(input: URL, init: RequestInit): { url: URL, request: RequestInit, body: string } {
    if (init.method?.toUpperCase() !== 'POST' || typeof init.body !== 'string'
      || new TextEncoder().encode(init.body).length > this.options.maxInputTokens) {
      throw new BaselineAcceptanceError('invalid-input')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(init.body)
    }
    catch {
      throw new BaselineAcceptanceError('invalid-input')
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new BaselineAcceptanceError('invalid-input')
    const body = parsed as Record<string, unknown>
    // Both arms exclude tools. Baseline conversation text and history remain unchanged.
    for (const field of ['tools', 'tool_choice', 'parallel_tool_calls', 'functions', 'function_call'])
      delete body[field]
    const messages = this.options.protocol === 'responses' ? body.input : body.messages
    if (Array.isArray(messages) && messages.some(message => message && typeof message === 'object'
      && (('role' in message && (message.role === 'tool' || message.role === 'function')) || 'tool_calls' in message || 'function_call' in message))) {
      throw new BaselineAcceptanceError('invalid-input')
    }
    const outputField = this.options.protocol === 'responses' ? 'max_output_tokens' : 'max_tokens'
    for (const field of ['max_tokens', 'max_completion_tokens', 'max_output_tokens'])
      delete body[field]
    body[outputField] = this.options.maxOutputTokens
    if (this.options.providerDefinition.id === 'deepseek' && body.thinking === undefined)
      body.thinking = { type: 'disabled' }
    if (this.options.protocol === 'chat-completions' && body.stream === true) {
      if (body.stream_options !== undefined && (!body.stream_options || typeof body.stream_options !== 'object' || Array.isArray(body.stream_options)))
        throw new BaselineAcceptanceError('invalid-input')
      body.stream_options = { ...body.stream_options as Record<string, unknown> | undefined, include_usage: true }
    }
    const serialized = JSON.stringify(body)
    if (new TextEncoder().encode(serialized).length + 1024 > this.options.maxInputTokens)
      throw new BaselineAcceptanceError('invalid-input')
    return { url: new URL(input.href), request: { ...init, headers: new Headers(init.headers), body: serialized, redirect: 'error' }, body: serialized }
  }

  private async account<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    }
    catch (error) {
      this.accountingFailure = new AcceptanceBudgetError('paused')
      throw publicFailure(error, 'accounting-failed')
    }
  }

  private async settle(reservation: BudgetReservation, usage: BudgetUsage | null) {
    const status = await this.account(() => this.options.budget.settle({ reservation, usage }))
    if (status.paused)
      this.accountingFailure = new AcceptanceBudgetError('paused')
  }

  private observe(response: Response, reservation: BudgetReservation) {
    const settlement = readAcceptanceUsage(response).then(usage => this.settle(reservation, usage))
    this.settlements.add(settlement)
    void settlement.catch(() => {}).finally(() => this.settlements.delete(settlement))
  }

  private async run(input: URL, init: RequestInit): Promise<Response> {
    const signals = [this.options.signal, init.signal].filter((signal): signal is AbortSignal => !!signal)
    const signal = signals.length ? AbortSignal.any(signals) : undefined
    let reservation: BudgetReservation | undefined
    let invoked = false
    try {
      this.assertCurrent(signal)
      const final = this.request(input, init)
      const measured = describeAcceptanceRequest(this.options.campaign, this.options.providerDefinition, { url: final.url, protocol: this.options.protocol, body: final.body })
      let send: AuthorizedFetch
      try {
        send = await this.options.prepareTransport()
      }
      catch (error) {
        throw publicFailure(error, 'transport-unavailable')
      }
      this.assertCurrent(signal)
      if (typeof send !== 'function')
        throw new BaselineAcceptanceError('transport-unavailable')
      reservation = await this.account(() => this.options.budget.reserve({
        ...this.options.run,
        ...measured,
        purpose: 'chat',
        requestId: this.options.requestId ?? this.options.run.runId,
        attemptId: nanoid(),
      }))
      await this.account(() => this.options.budget.started(reservation!))
      // No asynchronous work can separate this check from the original transport call.
      this.assertCurrent(signal)
      invoked = true
      const response = await send(final.url, { ...final.request, signal })
      if (response.redirected || (response.status >= 300 && response.status < 400)) {
        void response.body?.cancel().catch(() => {})
        throw new BaselineAcceptanceError('redirect-blocked')
      }
      if (!response.ok) {
        await this.settle(reservation, null)
        void response.body?.cancel().catch(() => {})
        // Provider error bodies can echo authorization. Retain status without returning those bytes.
        return new Response(JSON.stringify({ error: { code: 'ACCEPTANCE_HTTP_ERROR', status: response.status } }), {
          status: response.status,
          headers: { 'content-type': 'application/json' },
        })
      }
      this.observe(response.clone(), reservation)
      return response
    }
    catch (error) {
      if (reservation) {
        if (invoked)
          await this.settle(reservation, null).catch(() => {})
        else
          await this.account(() => this.options.budget.releaseNotSent({ reservation: reservation!, transportInvoked: false })).catch(() => {})
      }
      throw publicFailure(error, 'transport-failed')
    }
  }

  /** Returns the original response stream. Usage parsing reads only its independent clone. */
  fetch: AuthorizedFetch = (input, init) => {
    const result = this.run(input, init)
    this.active.add(result)
    void result.catch(() => {}).finally(() => this.active.delete(result))
    return result
  }

  /** Stops advancement to another case until accepted requests and accounting finish. */
  async flush(): Promise<void> {
    while (this.active.size || this.settlements.size)
      await Promise.allSettled([...this.active, ...this.settlements])
    if (this.accountingFailure)
      throw this.accountingFailure
  }
}
