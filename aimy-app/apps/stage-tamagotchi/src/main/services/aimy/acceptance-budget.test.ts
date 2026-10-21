import type { AcceptanceAttempt, AcceptanceCampaign } from '@proj-airi/stage-ui/stores/memory/budget'
import type { IpcMain, IpcMainEvent, WebContents, WebFrameMain } from 'electron'

import process from 'node:process'

import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { defineInvoke } from '@moeru/eventa'
import { createContext as createMainContext } from '@moeru/eventa/adapters/electron/main'
import { createContext as createRendererContext } from '@moeru/eventa/adapters/electron/renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { acceptanceBudgetInfo, acceptanceBudgetReserve, acceptanceBudgetSettle, acceptanceBudgetStarted, acceptanceBudgetStatus } from '../../../shared/eventa/aimy-acceptance'
import { AcceptanceBudgetLedger, registerAcceptanceBudget } from './acceptance-budget'

const campaign: AcceptanceCampaign = {
  campaignId: 'synthetic-campaign',
  maxCostMicroYuan: 1000,
  price: {
    id: 'synthetic-price',
    currency: 'CNY',
    providerId: 'synthetic-provider',
    modelId: 'synthetic-model',
    mode: 'non-thinking',
    inputMicroYuanPerMillion: 1_000_000,
    cachedInputMicroYuanPerMillion: 500_000,
    outputMicroYuanPerMillion: 2_000_000,
    verifiedAt: 'synthetic-test-only',
    sourceUrl: 'https://example.invalid/synthetic-price',
  },
}
const directories: string[] = []
const cleanups: Array<() => void> = []

/** Native IPC is the only fake boundary. Both Eventa adapters perform real request serialization. */
function ipcFixture() {
  const emitter = new EventEmitter()
  const received = new EventEmitter()
  const main = createMainContext(emitter as IpcMain)
  const mainFrame = {} as WebFrameMain
  let senderFrame = mainFrame
  const sender = Object.assign(new EventEmitter(), {
    mainFrame,
    isDestroyed: () => false,
    send(channel: string, message: unknown) {
      const cloned = structuredClone(message)
      queueMicrotask(() => received.emit(channel, {}, cloned))
    },
  }) as WebContents
  const renderer = createRendererContext({
    on(channel, listener) {
      received.on(channel, listener)
      return () => {
        received.off(channel, listener)
      }
    },
    once(channel, listener) {
      received.once(channel, listener)
      return () => {
        received.off(channel, listener)
      }
    },
    removeListener(channel, listener) {
      received.off(channel, listener)
      return this
    },
    removeAllListeners(channel) { received.removeAllListeners(channel) },
    invoke: async () => { throw new Error('Unused native invoke') },
    postMessage() { throw new Error('Unused native postMessage') },
    sendSync() { throw new Error('Unused native sendSync') },
    sendTo() { throw new Error('Unused native sendTo') },
    sendToHost() { throw new Error('Unused native sendToHost') },
    send(channel: string, message: unknown) {
      const cloned = structuredClone(message)
      const event = { sender, senderFrame } as IpcMainEvent
      queueMicrotask(() => emitter.emit(channel, event, cloned))
    },
  })
  cleanups.push(renderer.dispose, main.dispose)
  return { main: main.context, renderer: renderer.context, sender, useSubframe() {
    senderFrame = {} as WebFrameMain
  } }
}

function attempt(attemptId: string, arm: AcceptanceAttempt['arm'] = 'aimy'): AcceptanceAttempt {
  return {
    attemptId,
    requestId: `request:${attemptId}`,
    runId: 'synthetic-run',
    caseId: 'synthetic-case',
    arm,
    purpose: 'chat',
    providerId: campaign.price.providerId,
    modelId: campaign.price.modelId,
    mode: campaign.price.mode,
    protocol: 'chat-completions',
    priceVersion: campaign.price.id,
    inputTokensUpperBound: 100,
    maxOutputTokens: 100,
  }
}

async function fixture(value = campaign) {
  const directory = await mkdtemp(join(tmpdir(), 'aimy-budget-test-'))
  directories.push(directory)
  const filePath = join(directory, 'campaign.json')
  return { filePath, ledger: new AcceptanceBudgetLedger({ filePath, campaign: value }) }
}

afterEach(async () => {
  cleanups.splice(0).forEach(dispose => dispose())
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('shared acceptance budget', () => {
  it('refuses configuration-only reserves over Eventa before any ledger mutation', async () => {
    const { ledger, filePath } = await fixture()
    await ledger.status()
    const original = await readFile(filePath, 'utf8')
    const reserve = vi.spyOn(ledger, 'reserve')
    const ipc = ipcFixture()
    cleanups.push(registerAcceptanceBudget({ context: ipc.main, ledger, configurationOnly: true, authorizeSender: sender => sender === ipc.sender }))
    expect(await defineInvoke(ipc.renderer, acceptanceBudgetInfo)()).toEqual(campaign)
    expect((await defineInvoke(ipc.renderer, acceptanceBudgetStatus)()).attempts).toBe(0)
    await expect(defineInvoke(ipc.renderer, acceptanceBudgetReserve)(attempt('setup-chat'))).rejects.toMatchObject({ message: 'Acceptance budget: paid-validation-disabled' })
    expect(reserve).not.toHaveBeenCalled()
    expect(await readFile(filePath, 'utf8')).toBe(original)
  })

  it('checks sender and ledger availability before reporting configuration-only policy', async () => {
    const { ledger, filePath } = await fixture()
    const ipc = ipcFixture()
    const unregister = registerAcceptanceBudget({ context: ipc.main, ledger, configurationOnly: true, authorizeSender: () => false })
    cleanups.push(unregister)
    await expect(defineInvoke(ipc.renderer, acceptanceBudgetReserve)(attempt('untrusted'))).rejects.toMatchObject({ message: 'Acceptance budget: permission-denied' })
    unregister()
    const removeUnavailable = registerAcceptanceBudget({ context: ipc.main, configurationOnly: true, authorizeSender: () => true })
    cleanups.push(removeUnavailable)
    await expect(defineInvoke(ipc.renderer, acceptanceBudgetReserve)(attempt('no-ledger'))).rejects.toMatchObject({ message: 'Acceptance budget: unavailable' })
    removeUnavailable()
    cleanups.push(registerAcceptanceBudget({ context: ipc.main, ledger, configurationOnly: true, authorizeSender: () => true }))
    ipc.useSubframe()
    await expect(defineInvoke(ipc.renderer, acceptanceBudgetReserve)(attempt('subframe'))).rejects.toMatchObject({ message: 'Acceptance budget: permission-denied' })
    await expect(readFile(filePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('retains normal run accounting when configuration-only mode is absent', async () => {
    const { ledger } = await fixture()
    const ipc = ipcFixture()
    cleanups.push(registerAcceptanceBudget({ context: ipc.main, ledger, authorizeSender: sender => sender === ipc.sender }))
    const reservation = await defineInvoke(ipc.renderer, acceptanceBudgetReserve)(attempt('run'))
    await defineInvoke(ipc.renderer, acceptanceBudgetStarted)(reservation)
    const status = await defineInvoke(ipc.renderer, acceptanceBudgetSettle)({ reservation, usage: { inputTokens: 10, outputTokens: 5 } })
    expect(status.accountedMicroYuan).toBe(20)
    expect(status.paused).toBe(false)
    expect((await ledger.status()).attempts).toBe(1)
  })

  it('persists optional final-body proof while preserving non-live attempts without proof', async () => {
    const { ledger, filePath } = await fixture()
    await ledger.reserve({ ...attempt('proof'), requestBodySha256: 'a'.repeat(64) })
    await ledger.reserve(attempt('non-live'))
    const persisted = JSON.parse(await readFile(filePath, 'utf8'))
    expect(persisted.records.proof.attempt.requestBodySha256).toBe('a'.repeat(64))
    expect(persisted.records['non-live'].attempt).not.toHaveProperty('requestBodySha256')
    await expect(ledger.reserve({ ...attempt('bad-proof'), requestBodySha256: 'invalid-digest' })).rejects.toMatchObject({ code: 'invalid-input' })
    expect((await ledger.status()).attempts).toBe(2)
  })

  it('accounts both arms through the same durable file and applies cached-input pricing', async () => {
    const { ledger, filePath } = await fixture()
    const airi = await ledger.reserve(attempt('airi-one', 'airi'))
    expect(airi.reservedMicroYuan).toBe(300)
    await ledger.started(airi)
    const first = await ledger.settle({ reservation: airi, usage: { inputTokens: 20, cachedInputTokens: 10, outputTokens: 10 } })
    expect(first.accountedMicroYuan).toBe(35)
    const reopened = new AcceptanceBudgetLedger({ filePath, campaign })
    const aimy = await reopened.reserve(attempt('aimy-one'))
    expect((await ledger.status()).reservedMicroYuan).toBe(300)
    await reopened.started(aimy)
    await reopened.settle({ reservation: aimy, usage: { inputTokens: 10, outputTokens: 10 } })
    const final = await ledger.status()
    expect(final.accountedMicroYuan).toBe(65)
    expect(final.remainingMicroYuan).toBe(935)
    expect(final.attempts).toBe(2)
    expect((await stat(filePath)).mode & 0o777).toBe(0o600)
    expect(await readFile(filePath, 'utf8')).not.toContain('apiKey')
  })

  it('reserves conservatively, pauses near the cap, and does not reset after reopening', async () => {
    const value = { ...campaign, maxCostMicroYuan: 400 }
    const { ledger, filePath } = await fixture(value)
    await ledger.reserve(attempt('one'))
    await expect(ledger.reserve(attempt('two', 'airi'))).rejects.toMatchObject({ code: 'cost-limit' })
    const reopened = new AcceptanceBudgetLedger({ filePath, campaign: value })
    const state = await reopened.status()
    expect(state.paused).toBe(true)
    expect(state.reservedMicroYuan).toBe(300)
    expect(state.remainingMicroYuan).toBe(100)
    await expect(reopened.reserve({ ...attempt('tiny'), inputTokensUpperBound: 0, maxOutputTokens: 1 })).rejects.toMatchObject({ code: 'paused' })
  })

  it('retains unknown usage and rejects a later refund claim', async () => {
    const { ledger } = await fixture()
    const reservation = await ledger.reserve(attempt('unknown'))
    await ledger.started(reservation)
    const state = await ledger.settle({ reservation, usage: null })
    expect(state.paused).toBe(true)
    expect(state.pauseReason).toBe('usage-unknown')
    expect(state.reservedMicroYuan).toBe(300)
    await expect(ledger.releaseNotSent({ reservation, transportInvoked: false })).rejects.toMatchObject({ code: 'attempt-conflict' })
    await expect(ledger.reserve(attempt('retry'))).rejects.toMatchObject({ code: 'paused' })
  })

  it('releases a reservation only when the transport was definitely not invoked', async () => {
    const { ledger } = await fixture()
    const reservation = await ledger.reserve(attempt('cancelled-before-fetch'))
    await ledger.started(reservation)
    await ledger.releaseNotSent({ reservation, transportInvoked: false })
    await ledger.releaseNotSent({ reservation, transportInvoked: false })
    expect((await ledger.status()).remainingMicroYuan).toBe(1000)
    await expect(ledger.reserve(attempt('next'))).resolves.toMatchObject({ reservedMicroYuan: 300 })
  })

  it('deduplicates unsent reservations and completed usage without allowing an attempt to be sent twice', async () => {
    const { ledger } = await fixture()
    const reservation = await ledger.reserve(attempt('same'))
    expect(await ledger.reserve(attempt('same'))).toEqual(reservation)
    await expect(ledger.reserve({ ...attempt('same'), maxOutputTokens: 50 })).rejects.toMatchObject({ code: 'attempt-conflict' })
    await ledger.started(reservation)
    await expect(ledger.reserve(attempt('same'))).rejects.toMatchObject({ code: 'attempt-conflict' })
    const usage = { inputTokens: 1, outputTokens: 1 }
    await ledger.settle({ reservation, usage })
    expect((await ledger.settle({ reservation, usage })).accountedMicroYuan).toBe(3)
    await expect(ledger.settle({ reservation, usage: { inputTokens: 2, outputTokens: 1 } })).rejects.toMatchObject({ code: 'attempt-conflict' })
  })

  it('keeps a changed campaign, price table or corrupt file from resetting the budget', async () => {
    const { ledger, filePath } = await fixture()
    await ledger.reserve(attempt('one'))
    const original = await readFile(filePath, 'utf8')
    const changed = new AcceptanceBudgetLedger({ filePath, campaign: { ...campaign, maxCostMicroYuan: 2000 } })
    await expect(changed.status()).rejects.toMatchObject({ code: 'campaign-mismatch' })
    expect(await readFile(filePath, 'utf8')).toBe(original)
    await writeFile(filePath, '{broken')
    await expect(ledger.status()).rejects.toMatchObject({ code: 'corrupt' })
    expect(await readFile(filePath, 'utf8')).toBe('{broken')
  })

  it('serializes shared-instance requests and excludes another file owner without overspending', async () => {
    const value = { ...campaign, maxCostMicroYuan: 400 }
    const { ledger, filePath } = await fixture(value)
    const other = new AcceptanceBudgetLedger({ filePath, campaign: value })
    const results = await Promise.allSettled([ledger.reserve(attempt('one')), other.reserve(attempt('two', 'airi'))])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const status = await ledger.status()
    expect(status.reservedMicroYuan).toBe(300)
    expect(status.accountedMicroYuan + status.reservedMicroYuan).toBeLessThanOrEqual(value.maxCostMicroYuan)
  })

  it('does not steal or delete a leftover lock', async () => {
    const { ledger, filePath } = await fixture()
    await writeFile(`${filePath}.lock`, 'synthetic-leftover-lock', { mode: 0o600 })
    await expect(ledger.reserve(attempt('locked'))).rejects.toMatchObject({ code: 'locked' })
    expect(await readFile(`${filePath}.lock`, 'utf8')).toBe('synthetic-leftover-lock')
    await expect(stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves overrun evidence and pauses if actual usage exceeds the transmitted bound', async () => {
    const { ledger } = await fixture()
    const reservation = await ledger.reserve(attempt('overrun'))
    await ledger.started(reservation)
    const state = await ledger.settle({ reservation, usage: { inputTokens: 101, outputTokens: 100 } })
    expect(state.accountedMicroYuan).toBe(301)
    expect(state.paused).toBe(true)
    expect(state.pauseReason).toBe('reservation-exceeded')
  })

  it('rounds micro-yuan upward without floating point arithmetic', async () => {
    const value = { ...campaign, price: { ...campaign.price, inputMicroYuanPerMillion: 1, cachedInputMicroYuanPerMillion: 1, outputMicroYuanPerMillion: 1 } }
    const { ledger } = await fixture(value)
    const reservation = await ledger.reserve({ ...attempt('small'), inputTokensUpperBound: 1, maxOutputTokens: 1 })
    expect(reservation.reservedMicroYuan).toBe(1)
  })

  it('restores an exited process attempt as unknown without returning its reservation', async () => {
    const { ledger, filePath } = await fixture()
    const require = createRequire(import.meta.url)
    const loader = require.resolve('tsx')
    const source = fileURLToPath(new URL('./acceptance-budget.ts', import.meta.url))
    const code = `import { AcceptanceBudgetLedger } from ${JSON.stringify(source)};
      const ledger = new AcceptanceBudgetLedger(${JSON.stringify({ filePath, campaign })});
      const reservation = await ledger.reserve(${JSON.stringify(attempt('child'))});
      await ledger.started(reservation);`
    await promisify(execFile)(process.execPath, ['--import', loader, '--input-type=module', '-e', code], {
      timeout: 10_000,
      env: { PATH: process.env.PATH, TMPDIR: tmpdir() },
    })
    const state = await ledger.status()
    expect(state.reservedMicroYuan).toBe(300)
    expect(state.paused).toBe(true)
    expect(state.pauseReason).toBe('usage-unknown')
  })
})
