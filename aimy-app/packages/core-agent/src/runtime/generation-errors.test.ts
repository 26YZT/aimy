import type { GenerationProvider } from '@proj-airi/provider-inference'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { projectGenerationFailure, publicGenerationError, streamFrom } from './llm-service'

afterEach(() => vi.restoreAllMocks())

describe('generation error output boundary', () => {
  it('keeps SDK details available internally while projecting only safe status and code into logs and UI errors', async () => {
    const secret = 'synthetic-secret-canary'
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const request = vi.fn(async () => Response.json({ error: { message: `Rejected header ${secret}` } }, { status: 401 }))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://synthetic.invalid/v1/', apiKey: secret, fetch: request } }) }
    let caught: unknown
    try {
      await streamFrom({ model: 'synthetic-model', chatProvider: provider, conversation: { turns: [] } })
    }
    catch (error) {
      caught = error
    }
    expect(caught).toMatchObject({ statusCode: 401 })
    expect(caught instanceof Error && caught.message).toContain(secret)
    expect(projectGenerationFailure(caught)).toMatchObject({ code: 'GENERATION_AUTH_FAILED', status: 401 })
    const exposed = publicGenerationError(caught)
    expect(exposed).toMatchObject({ name: 'GenerationRequestError', code: 'GENERATION_AUTH_FAILED', status: 401 })
    expect(exposed.message).not.toContain(secret)
    expect(exposed).not.toHaveProperty('cause')
    expect(JSON.stringify(errors.mock.calls)).not.toContain(secret)
    expect(JSON.stringify(warnings.mock.calls)).not.toContain(secret)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('keeps cancellation out of error prompts and preserves bounded rate-limit diagnostics', () => {
    const cancelled = new DOMException('private cancellation detail', 'AbortError')
    expect(projectGenerationFailure(cancelled).code).toBe('GENERATION_ABORTED')
    expect(publicGenerationError(cancelled)).toMatchObject({ name: 'AbortError' })
    const failed = Object.assign(new Error('private URL and response'), { statusCode: 429 })
    expect(projectGenerationFailure(failed)).toMatchObject({ code: 'GENERATION_RATE_LIMITED', status: 429 })
    expect(publicGenerationError(failed).message).not.toContain('private URL')
    expect(projectGenerationFailure({ message: 'private body', statusCode: 'private-status' }).status).toBeUndefined()
  })
})
