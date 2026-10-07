import { describe, expect, it, vi } from 'vitest'

import { categorizeResponse } from './response-categoriser'

vi.mock('unified', async (importOriginal) => {
  const actual = await importOriginal<typeof import('unified')>()
  return {
    ...actual,
    unified: () => {
      const processor = actual.unified()
      // Keep the real module and processor shape; fail only the parser boundary.
      vi.spyOn(processor, 'parse').mockImplementation(() => {
        throw new Error('AUDIT_FAKE_CREDENTIAL private-parser-debug')
      })
      return processor
    },
  }
})

describe('response parsing error boundary', () => {
  // Regression for the stage-A audit: parser errors may retain the model response.
  it('keeps parser failure details private while preserving the existing fallback', () => {
    const diagnostics = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const result = categorizeResponse('hello')
      expect(result.speech).toBe('hello')
      expect(result.segments).toEqual([])
      expect(diagnostics.mock.calls).toEqual([['Failed to parse response for tag extraction:']])
    }
    finally {
      diagnostics.mockRestore()
    }
  })
})
