import type { ProviderValidationPlan } from '@proj-airi/provider-inference'

import type { AcceptanceBudgetPort } from '../../../stores/memory/budget'

import { getDefinedProvider } from '@proj-airi/provider-inference'
import { describe, expect, it, vi } from 'vitest'

import { configureAcceptanceBudget } from '../../../stores/memory/budget'
import { validateProvider } from './run'

describe('acceptance validation probes', () => {
  it('preserves ordinary validation but rejects unmetered paid and unknown probes during a campaign', async () => {
    const definition = getDefinedProvider('deepseek')
    if (!definition)
      throw new Error('The existing DeepSeek definition is unavailable')
    const validate = vi.fn(async () => ({ valid: true, reason: '', reasonKey: '', errors: [] }))
    function plan(id: string): ProviderValidationPlan {
      return {
        definition: definition!,
        config: { apiKey: 'synthetic-test-key', baseUrl: 'https://example.invalid/' },
        configValidators: [],
        providerValidators: [{ id, name: id, validator: validate }],
        providerExtra: undefined,
        shouldValidate: true,
        steps: [{ id, label: id, kind: 'provider', status: 'idle', reason: '' }],
      }
    }
    await validateProvider(plan('openai-compatible:check-chat-completions'), { t: key => key })
    expect(validate).toHaveBeenCalledTimes(1)
    validate.mockClear()

    const port: AcceptanceBudgetPort = { reserve: vi.fn(), started: vi.fn(), releaseNotSent: vi.fn(), settle: vi.fn(), status: vi.fn() }
    configureAcceptanceBudget(port)
    await expect(validateProvider(plan('openai-compatible:check-chat-completions'), { t: key => key })).rejects.toMatchObject({ code: 'paid-validation-disabled' })
    await expect(validateProvider(plan('unknown-provider:probe'), { t: key => key })).rejects.toMatchObject({ code: 'paid-validation-disabled' })
    expect(validate).not.toHaveBeenCalled()
    await validateProvider(plan('openai-compatible:check-model-list'), { t: key => key })
    expect(validate).toHaveBeenCalledTimes(1)
    expect(port.reserve).not.toHaveBeenCalled()
  })
})
