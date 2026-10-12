import { describe, expect, it } from 'vitest'
import { createAiriProvider } from './airi-adapter'

describe('createAiriProvider', () => {
  it('selects AIRI OpenAI provider and its default Responses protocol', async () => {
    const provider = await createAiriProvider({ apiKey: 'test-only', model: 'gpt-4.1' })
    expect(provider.generation('gpt-4.1').protocol).toBe('responses')
  })

  it('selects AIRI OpenAI-compatible provider for a custom endpoint', async () => {
    const provider = await createAiriProvider({ apiKey: 'test-only', model: 'custom', baseUrl: 'https://example.test/v1' })
    expect(provider.generation('custom')).toMatchObject({ protocol: 'chat-completions', config: { baseURL: 'https://example.test/v1' } })
  })
})
