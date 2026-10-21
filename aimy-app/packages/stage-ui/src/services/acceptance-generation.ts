import type { StreamOptions } from '@proj-airi/core-agent'
import type { ProviderDefinition } from '@proj-airi/provider-inference'

import type { AcceptanceAttempt, AcceptanceCampaign, BudgetUsage } from '../stores/memory/budget'

import { nanoid } from 'nanoid'

import { AcceptanceBudgetError, beforeAcceptanceAttempt, requireAcceptanceBudget } from '../stores/memory/budget'

type RunContext = Pick<AcceptanceAttempt, 'runId' | 'caseId' | 'arm'>

/** Callers resolve this definition from the registry, never from a user-supplied instance name. */
export type AcceptanceProviderDefinition = Pick<ProviderDefinition, 'id'>

/** Both application and baseline adapters inspect the final serialized request at this boundary. */
export type AcceptanceRequest = Parameters<NonNullable<StreamOptions['attemptGate']>['begin']>[0]
let campaign: AcceptanceCampaign | undefined
let context: RunContext = { runId: 'interactive-trial', caseId: 'manual-trial', arm: 'human-trial' }
const pending = new Set<Promise<unknown>>()
let accountingFailure: AcceptanceBudgetError | undefined

/** This first campaign approves the official DeepSeek endpoint, or an explicitly synthetic loopback run. */
export function assertAcceptanceEndpoint(price: AcceptanceCampaign['price'], url: URL, protocol: 'chat-completions' | 'responses') {
  if (url.username || url.password || url.search || url.hash)
    throw new AcceptanceBudgetError('invalid-input')
  if (price.mode === 'synthetic' && url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname))
    return
  if (price.providerId !== 'deepseek' || price.mode !== 'non-thinking' || url.origin !== 'https://api.deepseek.com' || protocol !== 'chat-completions'
    || !['/chat/completions', '/v1/chat/completions'].includes(url.pathname)) {
    throw new AcceptanceBudgetError('campaign-mismatch')
  }
}

/** Returns accounting metadata without retaining headers, prompts, or the parsed request. */
export function describeAcceptanceRequest(campaign: AcceptanceCampaign, definition: AcceptanceProviderDefinition | undefined, request: AcceptanceRequest) {
  assertAcceptanceEndpoint(campaign.price, request.url, request.protocol)
  if (!definition || definition.id !== campaign.price.providerId)
    throw new AcceptanceBudgetError('campaign-mismatch')
  let payload: unknown
  try {
    payload = JSON.parse(request.body)
  }
  catch {
    throw new AcceptanceBudgetError('invalid-input')
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !('model' in payload) || typeof payload.model !== 'string')
    throw new AcceptanceBudgetError('invalid-input')
  const body = payload as Record<string, unknown>
  if (body.model !== campaign.price.modelId)
    throw new AcceptanceBudgetError('campaign-mismatch')
  const fields = ['max_tokens', 'max_completion_tokens', 'max_output_tokens'].filter(field => Object.hasOwn(body, field))
  if (fields.length !== 1 || (request.protocol === 'responses') !== (fields[0] === 'max_output_tokens'))
    throw new AcceptanceBudgetError('invalid-input')
  const maxOutputTokens = body[fields[0]]
  if (typeof maxOutputTokens !== 'number' || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0)
    throw new AcceptanceBudgetError('invalid-input')
  // A byte estimate cannot bound media billing. The campaign also excludes tool calls.
  if (/"(?:image_url|input_audio|input_image|input_file|audio|file)"\s*:/.test(request.body)
    || (body.modalities !== undefined && (!Array.isArray(body.modalities) || body.modalities.some(value => value !== 'text')))
    || (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.length > 0))
    || body.functions !== undefined
    || (body.tool_choice !== undefined && body.tool_choice !== 'none')
    || body.function_call !== undefined) {
    throw new AcceptanceBudgetError('invalid-input')
  }
  if (definition.id === 'deepseek') {
    const thinking = body.thinking
    if (!thinking || typeof thinking !== 'object' || !('type' in thinking) || thinking.type !== 'disabled')
      throw new AcceptanceBudgetError('invalid-input')
  }
  return {
    providerId: definition.id,
    modelId: payload.model,
    protocol: request.protocol,
    mode: campaign.price.mode,
    priceVersion: campaign.price.id,
    // UTF-8 bytes include every input field. Framing adds a conservative allowance.
    inputTokensUpperBound: new TextEncoder().encode(request.body).length + 1024,
    maxOutputTokens,
  }
}

async function accounting<T>(task: () => Promise<T>) {
  try {
    return await task()
  }
  catch (error) {
    accountingFailure = new AcceptanceBudgetError('paused')
    throw error
  }
}

/** Only the explicit host campaign bootstrap or a bounded acceptance runner installs this context. */
export function configureAcceptanceGeneration(value: AcceptanceCampaign, run?: RunContext) {
  campaign = structuredClone(value)
  if (run)
    context = { ...run }
}

/** Counts reported totals, including billed reasoning. Missing totals remain unknown. */
function reportedUsage(value: unknown): BudgetUsage | null {
  if (!value || typeof value !== 'object')
    return null
  const usage = value as Record<string, unknown>
  const inputTokens = usage.prompt_tokens ?? usage.input_tokens
  const outputTokens = usage.completion_tokens ?? usage.output_tokens
  if (!Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens)
    || typeof inputTokens !== 'number' || typeof outputTokens !== 'number' || inputTokens < 0 || outputTokens < 0) {
    return null
  }
  const details = usage.input_tokens_details
  const cached = usage.prompt_cache_hit_tokens ?? (details && typeof details === 'object' && 'cached_tokens' in details ? details.cached_tokens : undefined)
  if (cached !== undefined && (typeof cached !== 'number' || !Number.isSafeInteger(cached) || cached < 0 || cached > inputTokens))
    return null
  return { inputTokens, outputTokens, ...(typeof cached === 'number' && Number.isSafeInteger(cached) && cached >= 0 ? { cachedInputTokens: cached } : {}) }
}

/** Reads an independent response branch so budget settlement does not hold back streamed user text. */
export async function readAcceptanceUsage(response: Response): Promise<BudgetUsage | null> {
  if (!response.ok || !response.body)
    return null
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done)
        break
      text += decoder.decode(chunk.value, { stream: true })
      if (text.length > 8 * 1024 * 1024)
        return null
    }
    text += decoder.decode()
    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      const value = JSON.parse(text)
      return reportedUsage(value.usage ?? value.response?.usage)
    }
    let usage: BudgetUsage | null = null
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('data:') || line.slice(5).trim() === '[DONE]')
        continue
      const value = JSON.parse(line.slice(5))
      const reported = reportedUsage(value.usage ?? value.response?.usage)
      if (reported)
        usage = reported
    }
    return usage
  }
  catch {
    return null
  }
  finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

/** All requests in both arms resolve to one host ledger, independent of the profile or memory scope. */
export function acceptanceAttemptGate(definition: AcceptanceProviderDefinition | undefined, purpose: AcceptanceAttempt['purpose'], requestId = nanoid()): StreamOptions['attemptGate'] {
  if (!campaign)
    return
  const fixedCampaign = campaign
  const run = { ...context }
  return {
    maxOutputTokens: 2048,
    async begin(request) {
      if (accountingFailure)
        throw accountingFailure
      const measured = describeAcceptanceRequest(fixedCampaign, definition, request)
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(request.body))
      const requestBodySha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
      const budget = requireAcceptanceBudget()
      const reservation = await accounting(() => beforeAcceptanceAttempt({
        ...run,
        attemptId: nanoid(),
        requestId,
        purpose,
        requestBodySha256,
        ...measured,
      }))
      const settle = async (usage: BudgetUsage | null) => {
        const status = await accounting(() => budget.settle({ reservation, usage }))
        if (status.pauseReason === 'usage-unknown' || status.pauseReason === 'reservation-exceeded')
          accountingFailure = new AcceptanceBudgetError('paused')
        return status
      }
      return {
        releaseNotSent: () => accounting(() => budget.releaseNotSent({ reservation, transportInvoked: false })),
        transportFailed: async () => { await settle(null) },
        observeResponse(response) {
          const settlement = readAcceptanceUsage(response).then(settle)
          pending.add(settlement)
          void settlement.catch(() => {}).finally(() => pending.delete(settlement))
        },
      }
    },
  }
}

/** The desktop's existing finite shutdown handshake waits for outstanding accounting, too. */
export async function flushAcceptanceGeneration() {
  await Promise.allSettled(pending)
  if (accountingFailure)
    throw accountingFailure
}
