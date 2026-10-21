import type { AcceptanceAttempt, AcceptanceCampaign } from '@proj-airi/stage-ui/stores/memory/budget'

import process from 'node:process'

import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describeAcceptanceRequest } from '@proj-airi/stage-ui/services/acceptance-generation'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AcceptanceBudgetLedger } from '../../src/main/services/aimy/acceptance-budget'
import { LiveRequestClaims } from './live-request-claims'

const directories: string[] = []
const campaign: AcceptanceCampaign = {
  campaignId: 'live-claims-synthetic-campaign',
  maxCostMicroYuan: 10_000_000,
  price: { id: 'synthetic-proof-price', currency: 'CNY', providerId: 'deepseek', modelId: 'deepseek-flash', mode: 'non-thinking', inputMicroYuanPerMillion: 1_000_000, outputMicroYuanPerMillion: 2_000_000, verifiedAt: 'synthetic-test-only', sourceUrl: 'https://example.invalid/synthetic-proof-price' },
}
const body = JSON.stringify({ model: 'deepseek-flash', thinking: { type: 'disabled' }, messages: [{ role: 'user', content: '虚构验收资料' }], max_tokens: 128, stream: true })

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'aimy-request-claims-'))
  directories.push(directory)
  const ledgerPath = join(directory, 'ledger.json')
  const ledger = new AcceptanceBudgetLedger({ filePath: ledgerPath, campaign })
  const options = { ledgerPath, campaignId: campaign.campaignId, runId: 'synthetic-run', caseId: 'USER-V2-01', arm: 'aimy' as const, ownerPid: process.pid }
  const claims = new LiveRequestClaims(options)
  function attempt(id: string, payload = body): AcceptanceAttempt {
    return {
      ...describeAcceptanceRequest(campaign, { id: 'deepseek' }, { body: payload, url: new URL('https://api.deepseek.com/chat/completions'), protocol: 'chat-completions' }),
      attemptId: id,
      requestId: `request-${id}`,
      runId: options.runId,
      caseId: options.caseId,
      arm: 'aimy',
      purpose: 'chat',
      requestBodySha256: createHash('sha256').update(payload).digest('hex'),
    }
  }
  return { directory, ledgerPath, ledger, claims, options, attempt }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('live final-body request claims', () => {
  it('admits only a started reservation once without mutating the shared ledger', async () => {
    const { ledger, ledgerPath, claims, attempt } = await fixture()
    const reservation = await ledger.reserve(attempt('one'))
    const transport = vi.fn(async () => new Response('synthetic reply'))
    async function send() {
      await claims.claim(body)
      return transport()
    }
    await expect(send()).rejects.toThrow('LIVE_REQUEST_NOT_AUTHORIZED')
    expect(transport).not.toHaveBeenCalled()
    await ledger.started(reservation)
    const before = await readFile(ledgerPath, 'utf8')
    expect(await (await send()).text()).toBe('synthetic reply')
    await expect(send()).rejects.toThrow('LIVE_REQUEST_NOT_AUTHORIZED')
    expect(transport).toHaveBeenCalledTimes(1)
    expect(await readFile(ledgerPath, 'utf8')).toBe(before)
  })

  it('serializes concurrent claims and permits exactly one HTTP boundary invocation', async () => {
    const { ledger, claims, attempt } = await fixture()
    await ledger.started(await ledger.reserve(attempt('concurrent')))
    const transport = vi.fn(async () => new Response('synthetic reply'))
    const send = async () => {
      await claims.claim(body)
      return transport()
    }
    const results = await Promise.allSettled([send(), send()])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('rejects changed PID, run, case, campaign, or request bytes', async () => {
    const { ledger, claims, options, attempt } = await fixture()
    await ledger.started(await ledger.reserve(attempt('bound')))
    for (const changed of [{ ownerPid: process.pid + 1 }, { runId: 'other-run' }, { caseId: 'USER-V2-02' }, { campaignId: 'other-campaign' }])
      await expect(new LiveRequestClaims({ ...options, ...changed }).claim(body)).rejects.toThrow('LIVE_REQUEST_NOT_AUTHORIZED')
    await expect(claims.claim(`${body}\n`)).rejects.toThrow('LIVE_REQUEST_NOT_AUTHORIZED')
    await expect(claims.claim(body)).resolves.toEqual({ attemptId: 'bound' })
  })

  it('refuses old non-live records without proof and records for the other arm', async () => {
    const { ledger, claims, attempt } = await fixture()
    const withoutProof = attempt('no-proof')
    delete withoutProof.requestBodySha256
    await ledger.started(await ledger.reserve(withoutProof))
    await ledger.started(await ledger.reserve({ ...attempt('other-arm'), arm: 'airi' }))
    await expect(claims.claim(body)).rejects.toThrow('LIVE_REQUEST_NOT_AUTHORIZED')
    expect((await ledger.status()).attempts).toBe(2)
  })

  it('matches transmitted token bounds and protocol instead of trusting a digest alone', async () => {
    const { ledger, claims, attempt } = await fixture()
    await ledger.started(await ledger.reserve({ ...attempt('output'), maxOutputTokens: 127 }))
    await ledger.started(await ledger.reserve({ ...attempt('input'), inputTokensUpperBound: 128 }))
    await ledger.started(await ledger.reserve({ ...attempt('protocol'), protocol: 'responses' }))
    await expect(claims.claim(body)).rejects.toThrow('LIVE_REQUEST_NOT_AUTHORIZED')
  })

  it('does not admit settled, released, or globally paused attempts', async () => {
    const { ledger, claims, attempt } = await fixture()
    const settled = await ledger.reserve(attempt('settled'))
    await ledger.started(settled)
    await ledger.settle({ reservation: settled, usage: { inputTokens: 1, outputTokens: 1 } })
    const released = await ledger.reserve(attempt('released'))
    await ledger.started(released)
    await ledger.releaseNotSent({ reservation: released, transportInvoked: false })
    await expect(claims.claim(body)).rejects.toThrow('LIVE_REQUEST_NOT_AUTHORIZED')
    const current = await ledger.reserve(attempt('current'))
    await ledger.started(current)
    const unknown = await ledger.reserve(attempt('unknown'))
    await ledger.started(unknown)
    await ledger.settle({ reservation: unknown, usage: null })
    await expect(claims.claim(body)).rejects.toThrow('LIVE_REQUEST_NOT_AUTHORIZED')
  })

  it('rejects tool histories, media, wrong models, thinking, oversized inputs and output limits', async () => {
    const { ledger, claims } = await fixture()
    await ledger.status()
    const parsed = JSON.parse(body)
    const invalid = [
      '{invalid',
      'x'.repeat(64_001),
      JSON.stringify({ ...parsed, model: 'other-model' }),
      JSON.stringify({ ...parsed, thinking: { type: 'enabled' } }),
      JSON.stringify({ ...parsed, max_tokens: 2049 }),
      JSON.stringify({ ...parsed, tools: [{ type: 'function' }] }),
      JSON.stringify({ ...parsed, messages: [{ role: 'tool', content: 'tool result' }] }),
      JSON.stringify({ ...parsed, messages: [{ role: 'assistant', content: '', tool_calls: [] }] }),
      JSON.stringify({ ...parsed, messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.invalid/image' } }] }] }),
    ]
    for (const payload of invalid)
      await expect(claims.claim(payload)).rejects.toThrow('LIVE_REQUEST_BODY_INVALID')
  })

  it('accepts native text parts and a finite output limit at the ceiling', async () => {
    const { ledger, claims, attempt } = await fixture()
    const payload = JSON.stringify({ ...JSON.parse(body), messages: [{ role: 'user', content: [{ type: 'text', text: '虚构文字' }] }], max_tokens: 2048 })
    await ledger.started(await ledger.reserve(attempt('text-parts', payload)))
    await expect(claims.claim(payload)).resolves.toEqual({ attemptId: 'text-parts' })
  })

  it('rejects symlink, non-regular, corrupt, and oversized ledgers with stable errors', async () => {
    const { ledger, ledgerPath, directory, options, claims } = await fixture()
    await ledger.status()
    const link = join(directory, 'linked.json')
    await symlink(ledgerPath, link)
    await expect(new LiveRequestClaims({ ...options, ledgerPath: link }).claim(body)).rejects.toThrow('LIVE_REQUEST_LEDGER_INVALID')
    await expect(new LiveRequestClaims({ ...options, ledgerPath: directory }).claim(body)).rejects.toThrow('LIVE_REQUEST_LEDGER_INVALID')
    await writeFile(ledgerPath, '{fixture-private-invalid-json')
    await expect(claims.claim(body)).rejects.toThrow('LIVE_REQUEST_LEDGER_INVALID')
    await writeFile(ledgerPath, 'x'.repeat(8 * 1024 * 1024 + 1))
    await expect(claims.claim(body)).rejects.toThrow('LIVE_REQUEST_LEDGER_INVALID')
  })
})
