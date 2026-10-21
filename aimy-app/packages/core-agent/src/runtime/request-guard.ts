import type { StreamOptions } from '../types/llm'

type RequestFetch = (input: URL, init: RequestInit) => Promise<Response>

/** Cancellation is not a transient provider failure. */
export function assertRequestCurrent(options?: StreamOptions) {
  options?.abortSignal?.throwIfAborted()
  options?.assertCurrent?.()
}

/** Every SDK step and retry reaches this last synchronous check immediately before fetch. */
export function guardedRequestFetch(fetcher: RequestFetch | undefined, options: StreamOptions | undefined, protocol: 'chat-completions' | 'responses'): RequestFetch | undefined {
  if (!options?.assertCurrent && !options?.abortSignal && options?.maxOutputTokens === undefined && options?.maxInputTokens === undefined && !options?.attemptGate)
    return fetcher
  const send = fetcher ?? globalThis.fetch
  return (input, init) => {
    let request = init
    const maxOutputTokens = options?.maxOutputTokens ?? options?.attemptGate?.maxOutputTokens
    if (maxOutputTokens !== undefined) {
      if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0)
        throw new TypeError('The output limit must be a positive integer.')
      if (typeof init.body !== 'string')
        throw new TypeError('A bounded generation requires a JSON request body.')
      const body: Record<string, unknown> = JSON.parse(init.body)
      const outputField = protocol === 'responses'
        ? 'max_output_tokens'
        : options?.outputTokenLimitField ?? (Object.hasOwn(body, 'max_completion_tokens') ? 'max_completion_tokens' : 'max_tokens')
      delete body.max_tokens
      delete body.max_completion_tokens
      delete body.max_output_tokens
      body[outputField] = maxOutputTokens
      request = { ...init, body: JSON.stringify(body) }
    }
    assertRequestCurrent(options)
    if (options?.maxInputTokens !== undefined) {
      if (!Number.isSafeInteger(options.maxInputTokens) || options.maxInputTokens <= 0 || typeof request.body !== 'string'
        || new TextEncoder().encode(request.body).length + 1024 > options.maxInputTokens) {
        throw new RangeError('Generation input exceeds the configured context budget')
      }
    }
    if (options?.attemptGate) {
      const gate = options.attemptGate
      if (typeof request.body !== 'string')
        throw new TypeError('Acceptance requests require a final JSON body.')
      const body = request.body
      return (async () => {
        const attempt = await gate.begin({ protocol, url: input, body })
        let transportInvoked = false
        let accountingHandled = false
        try {
          // Budget persistence is asynchronous. The same payload must still be eligible afterward.
          assertRequestCurrent(options)
          transportInvoked = true
          const response = await send(input, { ...request, redirect: 'error' })
          if (!response.ok) {
            // Provider failures can reflect authorization in their body, headers, or status text.
            // Unknown usage pauses the campaign before the SDK receives a bounded error response.
            void response.body?.cancel().catch(() => {})
            accountingHandled = true
            await attempt.transportFailed()
            return new Response(JSON.stringify({ error: { code: 'ACCEPTANCE_HTTP_ERROR', status: response.status } }), {
              status: response.status,
              headers: { 'content-type': 'application/json' },
            })
          }
          // The observer owns settlement from this point, including its own failures.
          accountingHandled = true
          attempt.observeResponse(response.clone())
          return response
        }
        catch (error) {
          if (!accountingHandled) {
            try {
              if (transportInvoked)
                await attempt.transportFailed()
              else
                await attempt.releaseNotSent()
            }
            catch {
              throw new Error('Acceptance request failed')
            }
          }
          // Keep cancellation distinct from retryable failures without forwarding a secret-bearing reason or cause.
          if (options.abortSignal?.aborted || (error instanceof Error && error.name === 'AbortError'))
            throw new DOMException('Acceptance request cancelled', 'AbortError')
          throw new Error('Acceptance request failed')
        }
      })()
    }
    return send(input, request)
  }
}
