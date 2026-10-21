import type { AcceptanceAttempt, AcceptanceBudgetPort } from './budget'

import { describe, expect, it, vi } from 'vitest'

import { beforeAcceptanceAttempt, configureAcceptanceBudget, getAcceptanceBudget, requireAcceptanceBudget } from './budget'

describe('acceptance budget boundary', () => {
  it('requires explicit setup and does not treat a failed start as a sent request', async () => {
    expect(getAcceptanceBudget()).toBeUndefined()
    expect(() => requireAcceptanceBudget()).toThrow('unavailable')
    const reservation = { campaignId: 'synthetic', attemptId: 'one', reservationId: 'synthetic-reference', reservedMicroYuan: 100 }
    const port: AcceptanceBudgetPort = {
      reserve: vi.fn(async () => reservation),
      started: vi.fn(async () => { throw new Error('Synthetic startup failure') }),
      releaseNotSent: vi.fn(async () => undefined),
      settle: vi.fn(),
      status: vi.fn(),
    }
    configureAcceptanceBudget(port)
    const attempt: AcceptanceAttempt = {
      attemptId: 'one',
      requestId: 'one',
      runId: 'run',
      caseId: 'case',
      arm: 'aimy',
      purpose: 'memory',
      providerId: 'synthetic',
      modelId: 'synthetic',
      mode: 'synthetic',
      protocol: 'responses',
      priceVersion: 'synthetic',
      inputTokensUpperBound: 100,
      maxOutputTokens: 100,
    }
    await expect(beforeAcceptanceAttempt(attempt)).rejects.toThrow('Synthetic startup failure')
    expect(port.releaseNotSent).toHaveBeenCalledWith({ reservation, transportInvoked: false })
    expect(port.settle).not.toHaveBeenCalled()
  })
})
