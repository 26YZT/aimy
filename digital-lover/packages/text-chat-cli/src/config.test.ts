import { describe, expect, it } from 'vitest'
import { loadChatConfig } from './config'

describe('loadChatConfig', () => {
  it('requires an API key without exposing it', () => {
    expect(() => loadChatConfig({ AIMY_MODEL: 'gpt-4.1' })).toThrow(/AIMY_API_KEY/)
  })

  it('requires a model name', () => {
    expect(() => loadChatConfig({ AIMY_API_KEY: 'secret' })).toThrow(/AIMY_MODEL/)
  })

  it('returns normalized configuration', () => {
    expect(loadChatConfig({
      AIMY_API_KEY: 'secret',
      AIMY_MODEL: 'gpt-4.1',
      AIMY_BASE_URL: 'https://example.test/v1',
      AIMY_API: 'chat-completions',
    })).toEqual({ apiKey: 'secret', model: 'gpt-4.1', baseUrl: 'https://example.test/v1', api: 'chat-completions' })
  })

  it('does not include the key in validation errors', () => {
    expect(() => loadChatConfig({ AIMY_API_KEY: 'secret', AIMY_MODEL: ' ' })).toThrow(/AIMY_MODEL/)
    try { loadChatConfig({ AIMY_API_KEY: 'secret', AIMY_MODEL: ' ' }) } catch (error) { expect(String(error)).not.toContain('secret') }
  })
})
