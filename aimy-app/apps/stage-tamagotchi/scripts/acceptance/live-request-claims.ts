import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

import { describeAcceptanceRequest } from '@proj-airi/stage-ui/services/acceptance-generation'

import * as v from 'valibot'

const identifier = v.pipe(v.string(), v.minLength(1), v.maxLength(160), v.regex(/^[\w.:-]+$/))
const amount = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(Number.MAX_SAFE_INTEGER))
const digest = v.pipe(v.string(), v.regex(/^[a-f\d]{64}$/))
const optionsSchema = v.strictObject({
  ledgerPath: v.pipe(v.string(), v.check(isAbsolute)),
  campaignId: identifier,
  runId: identifier,
  caseId: identifier,
  arm: v.literal('aimy'),
  ownerPid: v.pipe(v.number(), v.integer(), v.minValue(1)),
})
const ledgerSchema = v.object({
  schemaVersion: v.literal(1),
  campaign: v.object({
    campaignId: identifier,
    maxCostMicroYuan: v.pipe(amount, v.minValue(1), v.maxValue(10_000_000)),
    price: v.object({
      id: identifier,
      currency: v.literal('CNY'),
      providerId: v.literal('deepseek'),
      modelId: v.literal('deepseek-flash'),
      mode: v.literal('non-thinking'),
      inputMicroYuanPerMillion: amount,
      cachedInputMicroYuanPerMillion: v.optional(amount),
      outputMicroYuanPerMillion: amount,
      verifiedAt: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
      sourceUrl: v.pipe(v.string(), v.url(), v.maxLength(2048)),
    }),
  }),
  paused: v.boolean(),
  records: v.record(identifier, v.object({
    attempt: v.object({
      attemptId: identifier,
      requestId: identifier,
      runId: identifier,
      caseId: identifier,
      arm: v.picklist(['aimy', 'airi', 'human-trial']),
      purpose: v.picklist(['chat', 'memory', 'repair']),
      providerId: identifier,
      modelId: identifier,
      mode: identifier,
      protocol: v.picklist(['chat-completions', 'responses']),
      priceVersion: identifier,
      inputTokensUpperBound: amount,
      maxOutputTokens: amount,
      requestBodySha256: v.optional(digest),
    }),
    reservation: v.object({ campaignId: identifier, attemptId: identifier }),
    ownerPid: v.pipe(v.number(), v.integer(), v.minValue(1)),
    state: v.picklist(['reserved', 'started', 'settled', 'released', 'unknown']),
  })),
})
const messageSchema = v.object({
  messages: v.pipe(v.array(v.object({
    role: v.picklist(['system', 'developer', 'user', 'assistant']),
    content: v.union([
      v.string(),
      v.array(v.strictObject({ type: v.literal('text'), text: v.string() })),
    ]),
    tool_calls: v.optional(v.never()),
    function_call: v.optional(v.never()),
  })), v.minLength(1)),
})

type Options = v.InferOutput<typeof optionsSchema>
type Ledger = v.InferOutput<typeof ledgerSchema>

/** Matches the existing ledger's file limit without allowing an unbounded read after stat. */
const MAX_LEDGER_BYTES = 8 * 1024 * 1024

async function readLedger(path: string): Promise<Ledger> {
  try {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.size <= 0 || info.size > MAX_LEDGER_BYTES)
        throw new Error('Invalid ledger size')
      const buffer = Buffer.alloc(info.size + 1)
      let length = 0
      while (length < buffer.length) {
        const result = await handle.read(buffer, length, buffer.length - length, length)
        if (!result.bytesRead)
          break
        length += result.bytesRead
      }
      if (length !== info.size)
        throw new Error('Ledger changed during read')
      return v.parse(ledgerSchema, JSON.parse(buffer.subarray(0, length).toString('utf8')))
    }
    finally {
      await handle.close()
    }
  }
  catch {
    throw new Error('LIVE_REQUEST_LEDGER_INVALID')
  }
}

/**
 * Admits each started attempt once within one owned live host. Keep one instance for the host's lifetime.
 * The existing ledger remains the only budget owner. This reader never writes or repairs its file.
 *
 * Call stack:
 * Chromium onBeforeRequest -> LiveRequestClaims.claim -> read ledger -> match final-body proof
 */
export class LiveRequestClaims {
  private readonly options: Options
  private readonly consumed = new Set<string>()
  private queue: Promise<void> = Promise.resolve()

  constructor(options: Options) {
    const parsed = v.safeParse(optionsSchema, options)
    if (!parsed.success)
      throw new Error('LIVE_REQUEST_OPTIONS_INVALID')
    this.options = parsed.output
  }

  /** A successful claim consumes its attempt even if the browser cancels before sending. */
  claim(body: string): Promise<{ attemptId: string }> {
    const operation = this.queue.then(async () => {
      if (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > 64_000)
        throw new Error('LIVE_REQUEST_BODY_INVALID')
      let parsedBody: unknown
      try {
        parsedBody = JSON.parse(body)
        v.parse(messageSchema, parsedBody)
      }
      catch {
        throw new Error('LIVE_REQUEST_BODY_INVALID')
      }
      const ledger = await readLedger(this.options.ledgerPath)
      if (ledger.campaign.campaignId !== this.options.campaignId || ledger.paused)
        throw new Error('LIVE_REQUEST_NOT_AUTHORIZED')
      let measured
      try {
        measured = describeAcceptanceRequest(ledger.campaign, { id: 'deepseek' }, {
          url: new URL('https://api.deepseek.com/chat/completions'),
          protocol: 'chat-completions',
          body,
        })
        if (measured.maxOutputTokens > 2048 || !parsedBody || typeof parsedBody !== 'object'
          || !('max_tokens' in parsedBody) || 'max_completion_tokens' in parsedBody || 'max_output_tokens' in parsedBody) {
          throw new Error('Invalid live output bound')
        }
      }
      catch {
        throw new Error('LIVE_REQUEST_BODY_INVALID')
      }
      const hash = createHash('sha256').update(body, 'utf8').digest('hex')
      for (const [attemptId, record] of Object.entries(ledger.records)) {
        const attempt = record.attempt
        if (this.consumed.has(attemptId) || record.state !== 'started' || record.ownerPid !== this.options.ownerPid
          || record.reservation.campaignId !== this.options.campaignId || record.reservation.attemptId !== attemptId
          || attempt.attemptId !== attemptId || attempt.runId !== this.options.runId || attempt.caseId !== this.options.caseId
          || attempt.arm !== this.options.arm || attempt.requestBodySha256 !== hash
          || attempt.providerId !== measured.providerId || attempt.modelId !== measured.modelId
          || attempt.mode !== measured.mode || attempt.protocol !== measured.protocol
          || attempt.priceVersion !== measured.priceVersion || attempt.maxOutputTokens !== measured.maxOutputTokens
          || attempt.inputTokensUpperBound !== measured.inputTokensUpperBound) {
          continue
        }
        this.consumed.add(attemptId)
        return { attemptId }
      }
      throw new Error('LIVE_REQUEST_NOT_AUTHORIZED')
    })
    this.queue = operation.then(() => {}, () => {})
    return operation
  }
}
