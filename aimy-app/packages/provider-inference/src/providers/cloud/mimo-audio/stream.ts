import * as v from 'valibot'

const eventSchema = v.object({
  error: v.optional(v.unknown()),
  choices: v.optional(v.array(v.object({
    finish_reason: v.optional(v.nullable(v.string())),
    delta: v.optional(v.object({ audio: v.optional(v.nullable(v.object({ data: v.optional(v.string()) }))) })),
  }))),
})

/** Decodes one MiMo SSE response into mono 24 kHz PCM. Cancellation releases the network reader. */
export function readMimoPcm(body: ReadableStream<Uint8Array>, signal: AbortSignal): ReadableStream<Float32Array> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let data: string[] = []
  let dataSize = 0
  let oddByte: number | undefined
  let completed = false
  let terminal = false
  let heardAudio = false
  let closed = false
  let output: ReadableStreamDefaultController<Float32Array>

  function stop(error?: unknown) {
    if (closed)
      return
    closed = true
    signal.removeEventListener('abort', abort)
    void reader.cancel(error).catch(() => {}).finally(() => reader.releaseLock())
    if (error)
      output.error(error)
  }
  function abort() {
    stop(signal.reason ?? new DOMException('Speech cancelled', 'AbortError'))
  }
  function dispatch(): Float32Array | undefined {
    if (!data.length)
      return
    const payload = data.join('\n')
    data = []
    dataSize = 0
    if (payload === '[DONE]') {
      completed = true
      terminal = true
      return
    }
    const parsed = v.safeParse(eventSchema, JSON.parse(payload))
    if (!parsed.success || parsed.output.error !== undefined)
      throw new Error('MiMo speech stream returned an invalid event.')
    const choice = parsed.output.choices?.[0]
    if (choice?.finish_reason && choice.finish_reason !== 'stop')
      throw new Error('MiMo speech stream did not complete normally.')
    if (choice?.finish_reason === 'stop')
      completed = true
    const encoded = choice?.delta?.audio?.data
    if (!encoded)
      return
    const bytes = atob(encoded)
    const count = bytes.length + (oddByte === undefined ? 0 : 1)
    const samples = new Float32Array(Math.floor(count / 2))
    let index = 0
    let offset = 0
    if (oddByte !== undefined && bytes.length) {
      const value = oddByte | (bytes.charCodeAt(offset++) << 8)
      samples[index++] = (value >= 32768 ? value - 65536 : value) / 32768
      oddByte = undefined
    }
    while (offset + 1 < bytes.length) {
      const value = bytes.charCodeAt(offset) | (bytes.charCodeAt(offset + 1) << 8)
      samples[index++] = (value >= 32768 ? value - 65536 : value) / 32768
      offset += 2
    }
    if (offset < bytes.length)
      oddByte = bytes.charCodeAt(offset)
    if (samples.length) {
      heardAudio = true
      return samples
    }
  }

  return new ReadableStream<Float32Array>({
    start(controller) {
      output = controller
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted)
        abort()
    },
    async pull(controller) {
      try {
        while (!closed) {
          const lineEnd = pending.search(/[\r\n]/)
          if (lineEnd !== -1 && (pending[lineEnd] !== '\r' || lineEnd !== pending.length - 1)) {
            const line = pending.slice(0, lineEnd)
            const separator = pending.slice(lineEnd, lineEnd + 2) === '\r\n' ? 2 : 1
            pending = pending.slice(lineEnd + separator)
            if (line === '') {
              const samples = dispatch()
              if (samples) {
                signal.throwIfAborted()
                controller.enqueue(samples)
                return
              }
              if (terminal) {
                if (oddByte !== undefined || !heardAudio)
                  throw new Error('MiMo speech stream ended before complete audio.')
                stop()
                controller.close()
                return
              }
            }
            else if (line.startsWith('data:')) {
              const part = line.slice(5).replace(/^ /, '')
              data.push(part)
              dataSize += part.length + 1
              if (dataSize > 4_000_000)
                throw new Error('MiMo speech event exceeds the size limit.')
            }
            else if (line === 'event: error') {
              throw new Error('MiMo speech stream returned an error.')
            }
            continue
          }
          const next = await reader.read()
          if (closed)
            return
          signal.throwIfAborted()
          if (next.done) {
            if (pending.trim() || data.length || !completed || oddByte !== undefined || !heardAudio)
              throw new Error('MiMo speech stream ended before complete audio.')
            stop()
            controller.close()
            return
          }
          pending += decoder.decode(next.value, { stream: true })
          if (pending.length > 4_000_000)
            throw new Error('MiMo speech event exceeds the size limit.')
        }
      }
      catch (error) {
        stop(error instanceof SyntaxError ? new Error('MiMo speech stream returned invalid JSON.') : error)
      }
    },
    cancel() { stop() },
  }, { highWaterMark: 0 })
}
