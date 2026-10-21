import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type {
  AcceptanceAttempt,
  AcceptanceBudgetPort,
  AcceptanceBudgetStatus,
  AcceptanceCampaign,
  BudgetReservation,
  BudgetUsage,
  ReleaseUnsentAttempt,
  SettleAcceptanceAttempt,
} from '@proj-airi/stage-ui/stores/memory/budget'
import type { IpcMainInvokeEvent, WebContents } from 'electron'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, rename, unlink } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { AcceptanceBudgetError } from '@proj-airi/stage-ui/stores/memory/budget'

import * as v from 'valibot'

import {
  acceptanceBudgetInfo,
  acceptanceBudgetReleaseNotSent,
  acceptanceBudgetReserve,
  acceptanceBudgetSettle,
  acceptanceBudgetStarted,
  acceptanceBudgetStatus,
} from '../../../shared/eventa/aimy-acceptance'

const idSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(160), v.regex(/^[\w.:-]+$/))
const amountSchema = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(Number.MAX_SAFE_INTEGER))
const tokenSchema = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1_000_000_000))
const priceSchema = v.strictObject({
  id: idSchema,
  currency: v.literal('CNY'),
  providerId: idSchema,
  modelId: idSchema,
  mode: idSchema,
  inputMicroYuanPerMillion: amountSchema,
  cachedInputMicroYuanPerMillion: v.optional(amountSchema),
  outputMicroYuanPerMillion: amountSchema,
  verifiedAt: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
  sourceUrl: v.pipe(v.string(), v.url(), v.maxLength(2048)),
})
const campaignSchema = v.strictObject({
  campaignId: idSchema,
  maxCostMicroYuan: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10_000_000)),
  price: priceSchema,
})
const attemptSchema = v.strictObject({
  attemptId: idSchema,
  requestId: idSchema,
  runId: idSchema,
  caseId: idSchema,
  arm: v.picklist(['airi', 'aimy', 'human-trial']),
  purpose: v.picklist(['chat', 'memory', 'repair']),
  providerId: idSchema,
  modelId: idSchema,
  mode: idSchema,
  protocol: v.picklist(['chat-completions', 'responses']),
  priceVersion: idSchema,
  requestBodySha256: v.optional(v.pipe(v.string(), v.regex(/^[a-f\d]{64}$/))),
  inputTokensUpperBound: tokenSchema,
  maxOutputTokens: v.pipe(tokenSchema, v.minValue(1)),
})
const reservationSchema = v.strictObject({
  campaignId: idSchema,
  attemptId: idSchema,
  reservationId: v.pipe(v.string(), v.uuid()),
  reservedMicroYuan: amountSchema,
})
const usageSchema = v.strictObject({ inputTokens: tokenSchema, outputTokens: tokenSchema, cachedInputTokens: v.optional(tokenSchema) })
const recordSchema = v.strictObject({
  attempt: attemptSchema,
  reservation: reservationSchema,
  ownerPid: v.pipe(v.number(), v.integer(), v.minValue(1)),
  state: v.picklist(['reserved', 'started', 'settled', 'released', 'unknown']),
  usage: v.optional(usageSchema),
  accountedMicroYuan: amountSchema,
  updatedAt: amountSchema,
})
const ledgerSchema = v.strictObject({
  schemaVersion: v.literal(1),
  campaign: campaignSchema,
  paused: v.boolean(),
  pauseReason: v.optional(v.picklist(['usage-unknown', 'reservation-exceeded', 'cost-limit'])),
  records: v.record(idSchema, recordSchema),
})

type Ledger = v.InferOutput<typeof ledgerSchema>
type AttemptRecord = v.InferOutput<typeof recordSchema>

/** Bounds parsing independently of the monetary limit. The ledger contains no request bodies. */
const MAX_LEDGER_BYTES = 8 * 1024 * 1024

function fileErrorCode(error: unknown): unknown {
  return error instanceof Error && 'code' in error ? error.code : undefined
}

function ownerExited(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return false
  }
  catch (error) {
    return fileErrorCode(error) === 'ESRCH'
  }
}

/** Uses integer arithmetic and rounds up once. Unknown cache usage uses the uncached price. */
function cost(campaign: AcceptanceCampaign, usage: BudgetUsage): number {
  const cached = usage.cachedInputTokens ?? 0
  if (cached > usage.inputTokens)
    throw new AcceptanceBudgetError('invalid-input')
  const price = campaign.price
  const numerator = BigInt(usage.inputTokens - cached) * BigInt(price.inputMicroYuanPerMillion)
    + BigInt(cached) * BigInt(price.cachedInputMicroYuanPerMillion ?? price.inputMicroYuanPerMillion)
    + BigInt(usage.outputTokens) * BigInt(price.outputMicroYuanPerMillion)
  const result = (numerator + 999_999n) / 1_000_000n
  if (result > BigInt(Number.MAX_SAFE_INTEGER))
    throw new AcceptanceBudgetError('invalid-input')
  return Number(result)
}

function snapshot(ledger: Ledger): AcceptanceBudgetStatus {
  let accountedMicroYuan = 0
  let reservedMicroYuan = 0
  for (const record of Object.values(ledger.records)) {
    accountedMicroYuan += record.accountedMicroYuan
    if (record.state === 'reserved' || record.state === 'started' || record.state === 'unknown')
      reservedMicroYuan += record.reservation.reservedMicroYuan
  }
  return {
    campaignId: ledger.campaign.campaignId,
    maxCostMicroYuan: ledger.campaign.maxCostMicroYuan,
    accountedMicroYuan,
    reservedMicroYuan,
    remainingMicroYuan: Math.max(0, ledger.campaign.maxCostMicroYuan - accountedMicroYuan - reservedMicroYuan),
    paused: ledger.paused,
    pauseReason: ledger.pauseReason,
    attempts: Object.keys(ledger.records).length,
  }
}

function requireRecord(ledger: Ledger, reservation: BudgetReservation): AttemptRecord {
  const record = ledger.records[reservation.attemptId]
  if (!record || JSON.stringify(record.reservation) !== JSON.stringify(reservation))
    throw new AcceptanceBudgetError('attempt-conflict')
  return record
}

/**
 * Owns one campaign file outside userData. Every arm supplies the same absolute path and campaign.
 * A lock is never stolen. A crash or unknown usage preserves money and blocks further paid attempts.
 */
export class AcceptanceBudgetLedger implements AcceptanceBudgetPort {
  private readonly filePath: string
  private readonly campaign: AcceptanceCampaign
  private queue: Promise<void> = Promise.resolve()

  constructor(options: { filePath: string, campaign: AcceptanceCampaign }) {
    const parsed = v.safeParse(campaignSchema, options.campaign)
    if (!isAbsolute(options.filePath) || !parsed.success)
      throw new AcceptanceBudgetError('invalid-input')
    if ((parsed.output.price.cachedInputMicroYuanPerMillion ?? 0) > parsed.output.price.inputMicroYuanPerMillion)
      throw new AcceptanceBudgetError('invalid-input')
    this.filePath = options.filePath
    this.campaign = parsed.output
  }

  /** Returns validated public campaign metadata without exposing its filesystem location. */
  info(): AcceptanceCampaign {
    return structuredClone(this.campaign)
  }

  private async load(): Promise<Ledger> {
    let handle
    try {
      handle = await open(this.filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
    }
    catch (error) {
      if (fileErrorCode(error) === 'ENOENT')
        return { schemaVersion: 1, campaign: this.campaign, paused: false, records: {} }
      throw new AcceptanceBudgetError('storage-failed')
    }
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.size > MAX_LEDGER_BYTES)
        throw new AcceptanceBudgetError('corrupt')
      const parsed = v.safeParse(ledgerSchema, JSON.parse(await handle.readFile('utf8')))
      if (!parsed.success)
        throw new AcceptanceBudgetError('corrupt')
      if (JSON.stringify(parsed.output.campaign) !== JSON.stringify(this.campaign))
        throw new AcceptanceBudgetError('campaign-mismatch')
      for (const [attemptId, record] of Object.entries(parsed.output.records)) {
        const price = this.campaign.price
        if (attemptId !== record.attempt.attemptId
          || record.reservation.attemptId !== attemptId
          || record.reservation.campaignId !== this.campaign.campaignId
          || record.attempt.providerId !== price.providerId
          || record.attempt.modelId !== price.modelId
          || record.attempt.mode !== price.mode
          || record.attempt.priceVersion !== price.id
          || record.reservation.reservedMicroYuan !== cost(this.campaign, { inputTokens: record.attempt.inputTokensUpperBound, outputTokens: record.attempt.maxOutputTokens })
          || (record.state === 'settled' ? !record.usage || record.accountedMicroYuan !== cost(this.campaign, record.usage) : record.accountedMicroYuan !== 0)) {
          throw new AcceptanceBudgetError('corrupt')
        }
        if ((record.state === 'started' || record.state === 'reserved') && ownerExited(record.ownerPid)) {
          record.state = 'unknown'
          parsed.output.paused = true
          parsed.output.pauseReason = 'usage-unknown'
        }
      }
      return parsed.output
    }
    catch (error) {
      if (error instanceof AcceptanceBudgetError)
        throw error
      throw new AcceptanceBudgetError('corrupt')
    }
    finally {
      await handle.close()
    }
  }

  private async persist(ledger: Ledger): Promise<void> {
    const content = JSON.stringify(ledger)
    if (Buffer.byteLength(content) > MAX_LEDGER_BYTES)
      throw new AcceptanceBudgetError('storage-failed')
    const temporary = `${this.filePath}.${randomUUID()}.tmp`
    try {
      const handle = await open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(content, 'utf8')
        await handle.sync()
      }
      finally {
        await handle.close()
      }
      await rename(temporary, this.filePath)
      const directory = await open(dirname(this.filePath), constants.O_RDONLY)
      try {
        await directory.sync()
      }
      finally {
        await directory.close()
      }
    }
    finally {
      await unlink(temporary).catch(() => undefined)
    }
  }

  private transact<T>(operation: (ledger: Ledger) => T): Promise<T> {
    const next = this.queue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 })
      const lockPath = `${this.filePath}.lock`
      let lock
      try {
        lock = await open(lockPath, 'wx', 0o600)
      }
      catch (error) {
        throw new AcceptanceBudgetError(fileErrorCode(error) === 'EEXIST' ? 'locked' : 'storage-failed')
      }
      try {
        await lock.writeFile(JSON.stringify({ pid: process.pid, ownerId: randomUUID(), acquiredAt: Date.now() }))
        await lock.sync()
        const ledger = await this.load()
        let result: T | undefined
        let failure: unknown
        try {
          result = operation(ledger)
        }
        catch (error) {
          failure = error
        }
        // Pausing is durable even when the attempted reservation is rejected.
        await this.persist(ledger)
        if (failure)
          throw failure
        return result as T
      }
      catch (error) {
        if (error instanceof AcceptanceBudgetError)
          throw error
        throw new AcceptanceBudgetError('storage-failed')
      }
      finally {
        await lock.close()
        await unlink(lockPath)
      }
    }).catch((error) => {
      if (error instanceof AcceptanceBudgetError)
        throw error
      throw new AcceptanceBudgetError('storage-failed')
    })
    this.queue = next.then(() => undefined, () => undefined)
    return next
  }

  async reserve(input: AcceptanceAttempt): Promise<BudgetReservation> {
    const parsed = v.safeParse(attemptSchema, input)
    if (!parsed.success)
      throw new AcceptanceBudgetError('invalid-input')
    const attempt = parsed.output
    const price = this.campaign.price
    if (attempt.priceVersion !== price.id || attempt.providerId !== price.providerId || attempt.modelId !== price.modelId || attempt.mode !== price.mode)
      throw new AcceptanceBudgetError('campaign-mismatch')
    return this.transact((ledger) => {
      if (ledger.paused)
        throw new AcceptanceBudgetError('paused')
      const existing = ledger.records[attempt.attemptId]
      if (existing) {
        if (existing.state === 'reserved' && JSON.stringify(existing.attempt) === JSON.stringify(attempt))
          return existing.reservation
        throw new AcceptanceBudgetError('attempt-conflict')
      }
      const reservedMicroYuan = cost(this.campaign, { inputTokens: attempt.inputTokensUpperBound, outputTokens: attempt.maxOutputTokens })
      if (snapshot(ledger).remainingMicroYuan < reservedMicroYuan) {
        ledger.paused = true
        ledger.pauseReason = 'cost-limit'
        throw new AcceptanceBudgetError('cost-limit')
      }
      const reservation = { campaignId: this.campaign.campaignId, attemptId: attempt.attemptId, reservationId: randomUUID(), reservedMicroYuan }
      ledger.records[attempt.attemptId] = { attempt, reservation, ownerPid: process.pid, state: 'reserved', accountedMicroYuan: 0, updatedAt: Date.now() }
      return reservation
    })
  }

  async started(input: BudgetReservation): Promise<void> {
    const parsed = v.safeParse(reservationSchema, input)
    if (!parsed.success)
      throw new AcceptanceBudgetError('invalid-input')
    await this.transact((ledger) => {
      if (ledger.paused)
        throw new AcceptanceBudgetError('paused')
      const record = requireRecord(ledger, parsed.output)
      if (record.state !== 'reserved' && record.state !== 'started')
        throw new AcceptanceBudgetError('attempt-conflict')
      record.state = 'started'
      record.updatedAt = Date.now()
    })
  }

  async releaseNotSent(input: ReleaseUnsentAttempt): Promise<void> {
    const parsed = v.safeParse(v.strictObject({ reservation: reservationSchema, transportInvoked: v.literal(false) }), input)
    if (!parsed.success)
      throw new AcceptanceBudgetError('invalid-input')
    await this.transact((ledger) => {
      const record = requireRecord(ledger, parsed.output.reservation)
      if (record.state === 'released')
        return
      if (record.state !== 'reserved' && record.state !== 'started')
        throw new AcceptanceBudgetError('attempt-conflict')
      record.state = 'released'
      record.updatedAt = Date.now()
    })
  }

  async settle(input: SettleAcceptanceAttempt): Promise<AcceptanceBudgetStatus> {
    const parsed = v.safeParse(v.strictObject({ reservation: reservationSchema, usage: v.nullable(usageSchema) }), input)
    if (!parsed.success)
      throw new AcceptanceBudgetError('invalid-input')
    if (parsed.output.usage && (parsed.output.usage.cachedInputTokens ?? 0) > parsed.output.usage.inputTokens)
      throw new AcceptanceBudgetError('invalid-input')
    return this.transact((ledger) => {
      const { reservation, usage } = parsed.output
      const record = requireRecord(ledger, reservation)
      if (record.state === 'settled') {
        if (JSON.stringify(record.usage) !== JSON.stringify(usage))
          throw new AcceptanceBudgetError('attempt-conflict')
        return snapshot(ledger)
      }
      if (record.state !== 'started' && record.state !== 'unknown')
        throw new AcceptanceBudgetError('attempt-conflict')
      if (usage === null) {
        record.state = 'unknown'
        ledger.paused = true
        ledger.pauseReason = 'usage-unknown'
      }
      else {
        const accountedMicroYuan = cost(this.campaign, usage)
        record.state = 'settled'
        record.usage = usage
        record.accountedMicroYuan = accountedMicroYuan
        if (record.accountedMicroYuan > record.reservation.reservedMicroYuan
          || usage.inputTokens > record.attempt.inputTokensUpperBound
          || usage.outputTokens > record.attempt.maxOutputTokens) {
          ledger.paused = true
          ledger.pauseReason = 'reservation-exceeded'
        }
      }
      record.updatedAt = Date.now()
      return snapshot(ledger)
    })
  }

  async status(): Promise<AcceptanceBudgetStatus> {
    return this.transact(ledger => snapshot(ledger))
  }

  /** Waits for pending durable operations. Each caller still owns its operation failure. */
  async flush(): Promise<void> {
    await this.queue
  }
}

/** An unconfigured host refuses paid acceptance without creating a campaign or opening a file. */
export function registerAcceptanceBudget(options: {
  context: ReturnType<typeof createContext>['context']
  ledger?: AcceptanceBudgetLedger
  /** Setup can inspect the campaign but cannot reserve money or start paid generation. */
  configurationOnly?: boolean
  authorizeSender: (sender: WebContents) => boolean
}): () => void {
  function authorize(event: IpcMainInvokeEvent | undefined): void {
    if (!event || event.sender.isDestroyed() || !event.senderFrame || event.senderFrame !== event.sender.mainFrame || !options.authorizeSender(event.sender))
      throw new AcceptanceBudgetError('permission-denied')
  }
  function ledgerFor(event: IpcMainInvokeEvent | undefined): AcceptanceBudgetLedger {
    authorize(event)
    if (!options.ledger)
      throw new AcceptanceBudgetError('unavailable')
    return options.ledger
  }
  const disposers = [
    defineInvokeHandler(options.context, acceptanceBudgetInfo, (_, metadata) => {
      authorize(metadata?.raw.ipcMainEvent)
      return options.ledger?.info() ?? null
    }),
    defineInvokeHandler(options.context, acceptanceBudgetReserve, (input, metadata) => {
      const ledger = ledgerFor(metadata?.raw.ipcMainEvent)
      if (options.configurationOnly)
        throw new AcceptanceBudgetError('paid-validation-disabled')
      return ledger.reserve(input)
    }),
    defineInvokeHandler(options.context, acceptanceBudgetStarted, (input, metadata) => ledgerFor(metadata?.raw.ipcMainEvent).started(input)),
    defineInvokeHandler(options.context, acceptanceBudgetReleaseNotSent, (input, metadata) => ledgerFor(metadata?.raw.ipcMainEvent).releaseNotSent(input)),
    defineInvokeHandler(options.context, acceptanceBudgetSettle, (input, metadata) => ledgerFor(metadata?.raw.ipcMainEvent).settle(input)),
    defineInvokeHandler(options.context, acceptanceBudgetStatus, (_, metadata) => ledgerFor(metadata?.raw.ipcMainEvent).status()),
  ]
  return () => disposers.forEach(dispose => dispose())
}
