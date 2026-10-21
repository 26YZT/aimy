import type { AcceptanceBudgetPort, AcceptanceBudgetStatus, AcceptanceCampaign } from '../stores/memory/budget'

import { createHash } from 'node:crypto'

import { getDefinedProvider, getGenerationProvider } from '@proj-airi/provider-inference'
import { describe, expect, it, vi } from 'vitest'

import { assertAcceptanceEndpoint, readAcceptanceUsage } from './acceptance-generation'

const campaign: AcceptanceCampaign = {
  campaignId: 'synthetic-unit-campaign',
  maxCostMicroYuan: 10_000_000,
  price: { id: 'synthetic-unit-price', currency: 'CNY', providerId: 'deepseek', modelId: 'deepseek-flash', mode: 'non-thinking', inputMicroYuanPerMillion: 100, outputMicroYuanPerMillion: 200, verifiedAt: 'synthetic-fixture', sourceUrl: 'https://example.invalid/synthetic-price' },
}
const status: AcceptanceBudgetStatus = { campaignId: campaign.campaignId, maxCostMicroYuan: 10_000_000, accountedMicroYuan: 0, reservedMicroYuan: 0, remainingMicroYuan: 10_000_000, paused: false, attempts: 1 }
const request = { url: new URL('https://api.deepseek.com/chat/completions'), protocol: 'chat-completions' as const, body: JSON.stringify({ model: 'deepseek-flash', thinking: { type: 'disabled' }, max_tokens: 128, messages: [{ role: 'user', content: '合成测试' }] }) }

async function fixture() {
  vi.resetModules()
  const budget = await import('../stores/memory/budget')
  const generation = await import('./acceptance-generation')
  const port: AcceptanceBudgetPort = {
    reserve: vi.fn(async attempt => ({ campaignId: campaign.campaignId, attemptId: attempt.attemptId, reservationId: crypto.randomUUID(), reservedMicroYuan: 1 })),
    started: vi.fn(async () => {}),
    releaseNotSent: vi.fn(async () => {}),
    settle: vi.fn(async () => status),
    status: vi.fn(async () => status),
  }
  budget.configureAcceptanceBudget(port)
  generation.configureAcceptanceGeneration(campaign, { arm: 'aimy', caseId: 'synthetic-case', runId: 'synthetic-run' })
  return { generation, port }
}

describe('acceptance transport accounting', () => {
  it('binds an official price to its actual approved endpoint and mode', () => {
    expect(() => assertAcceptanceEndpoint(campaign.price, request.url, request.protocol)).not.toThrow()
    expect(() => assertAcceptanceEndpoint(campaign.price, new URL('https://unapproved.invalid/chat/completions'), request.protocol)).toThrow()
    expect(() => assertAcceptanceEndpoint(campaign.price, new URL('https://api.deepseek.com/chat/completions?api_key=synthetic'), request.protocol)).toThrow()
    expect(() => assertAcceptanceEndpoint({ ...campaign.price, mode: 'thinking' }, request.url, request.protocol)).toThrow()
    expect(() => assertAcceptanceEndpoint({ ...campaign.price, mode: 'synthetic' }, new URL('http://127.0.0.1:1234/v1/chat/completions'), request.protocol)).not.toThrow()
  })

  it('reads actual Chat and Responses usage without treating missing usage as zero', async () => {
    const chat = new Response('data: {"usage":{"prompt_tokens":11,"completion_tokens":7,"prompt_cache_hit_tokens":3}}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
    expect(await readAcceptanceUsage(chat)).toEqual({ inputTokens: 11, outputTokens: 7, cachedInputTokens: 3 })
    const responses = new Response('data: {"type":"response.completed","response":{"usage":{"input_tokens":12,"output_tokens":8}}}\n\n', { headers: { 'content-type': 'text/event-stream' } })
    expect(await readAcceptanceUsage(responses)).toEqual({ inputTokens: 12, outputTokens: 8 })
    expect(await readAcceptanceUsage(new Response('{}'))).toBeNull()
  })

  it('reserves and starts a distinct attempt from final bytes and the transmitted output bound', async () => {
    const { generation, port } = await fixture()
    const gate = generation.acceptanceAttemptGate(getDefinedProvider('deepseek'), 'chat', 'synthetic-turn')!
    await gate.begin(request)
    await gate.begin(request)
    expect(port.reserve).toHaveBeenCalledTimes(2)
    const first = vi.mocked(port.reserve).mock.calls[0][0]
    expect(first.maxOutputTokens).toBe(128)
    expect(first.inputTokensUpperBound).toBeGreaterThanOrEqual(new TextEncoder().encode(request.body).length)
    expect(first.arm).toBe('aimy')
    expect(first).toHaveProperty('requestBodySha256', createHash('sha256').update(request.body).digest('hex'))
    expect(first.attemptId).not.toBe(vi.mocked(port.reserve).mock.calls[1][0].attemptId)
    expect(port.started).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(first)).not.toContain('合成测试')
  })

  it('eval-gate binds a random instance to its registered DeepSeek definition and factory mode', async () => {
    const { generation, port } = await fixture()
    const configured = { id: 'synthetic-random-instance', definitionId: 'deepseek' as const }
    const definition = getDefinedProvider(configured.definitionId)!
    const provider = getGenerationProvider(await definition.createProvider({ apiKey: 'synthetic-placeholder', thinkingMode: 'disable' }))!
    const actual = provider.generation('deepseek-flash')
    expect(actual.protocol).toBe('chat-completions')
    const gate = generation.acceptanceAttemptGate(definition, 'chat', 'synthetic-turn')!
    await gate.begin({ ...request, body: JSON.stringify({ ...JSON.parse(request.body), thinking: 'thinking' in actual.config ? actual.config.thinking : undefined }) })
    expect(vi.mocked(port.reserve).mock.calls[0][0].providerId).toBe('deepseek')
    expect(JSON.stringify(vi.mocked(port.reserve).mock.calls[0][0])).not.toContain(configured.id)
    await expect(gate.begin({ ...request, body: JSON.stringify({ ...JSON.parse(request.body), thinking: { type: 'enabled' } }) })).rejects.toThrow('invalid-input')
    expect(port.reserve).toHaveBeenCalledTimes(1)
  })

  it('rejects an unresolved definition without trusting an instance name or reserving money', async () => {
    const { generation, port } = await fixture()
    const gate = generation.acceptanceAttemptGate(undefined, 'chat')!
    await expect(gate.begin(request)).rejects.toMatchObject({ code: 'campaign-mismatch' })
    expect(port.reserve).not.toHaveBeenCalled()
  })

  it('rejects conflicting limits and invalid JSON without exposing request bytes', async () => {
    const { generation, port } = await fixture()
    const gate = generation.acceptanceAttemptGate(getDefinedProvider('deepseek'), 'chat')!
    await expect(gate.begin({ ...request, body: JSON.stringify({ ...JSON.parse(request.body), max_completion_tokens: 99999 }) })).rejects.toMatchObject({ code: 'invalid-input' })
    const error = await gate.begin({ ...request, body: 'synthetic-private-canary:invalid-json' }).catch(error => error)
    expect(error).toMatchObject({ code: 'invalid-input' })
    expect(String(error)).not.toContain('synthetic-private-canary')
    expect(port.reserve).not.toHaveBeenCalled()
  })

  it('retains a failed settlement in the flush result and stops the next request', async () => {
    const { generation, port } = await fixture()
    vi.mocked(port.settle).mockRejectedValue(new Error('Synthetic disk failure'))
    const gate = generation.acceptanceAttemptGate(getDefinedProvider('deepseek'), 'memory')!
    const attempt = await gate.begin(request)
    attempt.observeResponse(new Response('{"usage":{"prompt_tokens":11,"completion_tokens":7}}'))
    await expect(generation.flushAcceptanceGeneration()).rejects.toThrow('paused')
    await expect(gate.begin(request)).rejects.toThrow('paused')
    expect(port.reserve).toHaveBeenCalledTimes(1)
  })

  it('preserves an unknown charge and reports the paused accounting at shutdown', async () => {
    const { generation, port } = await fixture()
    vi.mocked(port.settle).mockResolvedValue({ ...status, paused: true, pauseReason: 'usage-unknown' })
    const gate = generation.acceptanceAttemptGate(getDefinedProvider('deepseek'), 'chat')!
    const attempt = await gate.begin(request)
    attempt.observeResponse(new Response('{}'))
    await expect(generation.flushAcceptanceGeneration()).rejects.toThrow('paused')
    expect(port.settle).toHaveBeenCalledWith(expect.objectContaining({ usage: null }))
    expect(port.releaseNotSent).not.toHaveBeenCalled()
  })
})
