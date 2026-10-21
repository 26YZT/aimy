import type { AcceptanceBudgetPort } from '../../stores/memory/budget'

import { defineInvokeHandler } from '@moeru/eventa'
import { expect, it, vi } from 'vitest'

import { configureAcceptanceBudget } from '../../stores/memory/budget'
import { getSpeechBusContext, voiceSpeechCommand } from './bus'
import { SpeechClient } from './speech-client'

it('keeps ordinary speech dispatch and makes all campaign speech operations settle without dispatch', async () => {
  const host = vi.fn(async () => ({ status: 'accepted' as const }))
  const off = defineInvokeHandler(getSpeechBusContext(), voiceSpeechCommand, host)
  try {
    const ordinary = new SpeechClient({ sessionId: 'synthetic', turnId: 'ordinary' }, 'answer')
    await ordinary.write('Ordinary response')
    await ordinary.end()
    await ordinary.finish()
    expect(host.mock.calls.length).toBe(4)
    const admission = Promise.withResolvers<{ status: 'accepted' }>()
    host.mockReturnValueOnce(admission.promise)
    const waiting = new SpeechClient({ sessionId: 'synthetic', turnId: 'pending-admission' }, 'answer')
    const queuedText = waiting.write('Do not dispatch this queued text after campaign activation')
    await expect.poll(() => host.mock.calls.length).toBe(5)

    const budget: AcceptanceBudgetPort = {
      reserve: vi.fn(),
      started: vi.fn(),
      releaseNotSent: vi.fn(),
      settle: vi.fn(),
      status: vi.fn(),
    }
    configureAcceptanceBudget(budget)
    host.mockClear()
    await expect(waiting.finish()).resolves.toEqual({ status: 'closed' })
    await expect(queuedText).resolves.toEqual({ status: 'closed' })
    admission.resolve({ status: 'accepted' })
    const silent = new SpeechClient({ sessionId: 'synthetic', turnId: 'acceptance' }, 'answer')
    await expect(silent.write('The normal text answer remains usable')).resolves.toEqual({ status: 'closed' })
    await expect(silent.special('smile')).resolves.toEqual({ status: 'closed' })
    await expect(silent.flush()).resolves.toEqual({ status: 'closed' })
    await expect(silent.end()).resolves.toEqual({ status: 'closed' })
    await expect(silent.finish()).resolves.toEqual({ status: 'closed' })
    await expect(silent.cancel('done')).resolves.toEqual({ status: 'closed' })
    expect(host).not.toHaveBeenCalled()
    expect(budget.reserve).not.toHaveBeenCalled()
  }
  finally {
    off()
  }
})
