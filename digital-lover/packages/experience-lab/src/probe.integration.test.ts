import type { Capability, ProbeResult } from './arguments'

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const loader = pathToFileURL(require.resolve('tsx')).href
const cliPath = fileURLToPath(new URL('./index.ts', import.meta.url))
const modelContent = 'PRIVATE_MODEL_CONTENT'
const transcriptContent = 'PRIVATE_TRANSCRIPT_CONTENT'
const fakeCredential = 'PROBE_FAKE_CREDENTIAL'

function wavFixture() {
  const bytes = Buffer.alloc(46)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(38, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(16_000, 24)
  bytes.writeUInt32LE(32_000, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(2, 40)
  bytes.writeInt16LE(1, 44)
  return bytes
}

function runProbe(args: string[], mode = 'success', overrides: NodeJS.ProcessEnv = {}, workerMessage?: unknown) {
  const directory = mkdtempSync(join(tmpdir(), 'aimy-experience-probe-'))
  const eventsPath = join(directory, 'safe-test-events.jsonl')
  const envPath = join(directory, 'fixture.env')
  const imagePath = join(directory, 'authorized.png')
  const audioPath = join(directory, 'authorized.wav')
  const preloadPath = join(directory, 'fetch-boundary.mjs')
  let entryPath = cliPath
  if (workerMessage !== undefined) {
    entryPath = join(directory, 'worker-harness.mjs')
    writeFileSync(entryPath, `
      import { fork } from 'node:child_process';
      const startedAt = performance.now();
      const child = fork(${JSON.stringify(fileURLToPath(new URL('./worker.ts', import.meta.url)))}, [], { silent: true });
      child.stdout.resume();
      child.stderr.resume();
      child.on('message', result => {
        process.stdout.write(JSON.stringify({ capability: result.capability, status: result.status, durationMs: Math.round(performance.now() - startedAt) }) + '\\n');
        child.kill('SIGKILL');
        process.exitCode = result.status === 'not-run' ? 0 : 2;
      });
      child.send(${JSON.stringify(workerMessage)});
    `)
  }
  const audio = wavFixture()
  writeFileSync(envPath, `AIMY_API_KEY=${fakeCredential}\nAIMY_MODEL=fixture-model\n`)
  writeFileSync(imagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3S0AAAAASUVORK5CYII=', 'base64'))
  writeFileSync(audioPath, audio)
  writeFileSync(preloadPath, `
    import fs from 'node:fs';
    import fsp from 'node:fs/promises';
    import { createServer } from 'node:http';
    import { syncBuiltinESMExports } from 'node:module';
    const mode = ${JSON.stringify(mode)};
    const record = value => fs.appendFileSync(${JSON.stringify(eventsPath)}, JSON.stringify(value) + '\\n');
    if (mode.startsWith('local-redirect-') && !process.send) {
      const server = createServer((request, response) => {
        request.resume();
        if (request.url === '/v1/audio/speech') {
          record('redirect-source:' + request.method);
          response.writeHead(Number(mode.split('-').at(-1)), { Location: '/redirect-target' });
          response.end();
        }
        else {
          record('redirect-target:' + request.method);
          response.writeHead(200, { 'Content-Type': 'audio/wav' });
          response.end(Buffer.from(${JSON.stringify([...audio])}));
        }
      });
      server.on('connection', socket => socket.unref());
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      process.env.AIMY_TTS_BASE_URL = 'http://127.0.0.1:' + server.address().port + '/v1/';
      server.unref();
    }
    const read = fs.readFileSync;
    fs.readFileSync = (path, ...options) => {
      if (String(path) === ${JSON.stringify(envPath)}) record('config-read');
      return read(path, ...options);
    };
    const readInput = fsp.readFile;
    fsp.readFile = (path, ...options) => {
      if (String(path) === ${JSON.stringify(imagePath)} || String(path) === ${JSON.stringify(audioPath)}) {
        record('input-read');
        if (mode === 'grown-input') fs.writeFileSync(path, Buffer.alloc(25 * 1024 * 1024 + 1));
        if (mode === 'empty-input') fs.writeFileSync(path, new Uint8Array());
      }
      return readInput(path, ...options);
    };
    syncBuiltinESMExports();
    // The altered clocks are confined to this CLI reproduction. Production
    // retains both 30s limits, with no test flag or configurable timeout.
    const realTimeout = globalThis.setTimeout;
    if (mode === 'abort-timeout' && process.send) {
      globalThis.setTimeout = (callback, ms, ...args) => realTimeout(callback, ms === 30000 ? 50 : ms, ...args);
    }
    if (mode === 'parent-timeout' && !process.send) {
      globalThis.setTimeout = (callback, ms, ...args) => realTimeout(callback, ms === 30000 ? 2000 : ms, ...args);
    }
    if (mode === 'parent-timeout' && process.send)
      process.on('SIGTERM', () => {});
    let requests = 0;
    const sse = events => new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\\n\\n').join(''), { headers: { 'Content-Type': 'text/event-stream' } });
    if (!mode.startsWith('local-redirect-')) globalThis.fetch = async (url, init) => {
      requests++;
      record('fetch');
      const endpoint = new URL(url);
      const headers = new Headers(init.headers);
      if (headers.get('authorization') !== 'Bearer ${fakeCredential}' || !init.signal)
        throw new Error('Invalid fixture request');
      if (mode === 'failure')
        throw new Error('${fakeCredential} PRIVATE_PROVIDER_DETAIL https://private-endpoint.test/ ${directory}');
      if (mode === 'abort-timeout') {
        return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => { record('abort'); reject(new Error('${fakeCredential} PRIVATE_PROVIDER_DETAIL')); }, { once: true }));
      }
      if (mode === 'parent-timeout')
        return new Promise(() => {});
      if (endpoint.pathname.endsWith('/audio/transcriptions')) {
        if (!(init.body instanceof FormData) || init.body.get('file').name !== 'probe-audio.wav')
          throw new Error('Invalid transcription fixture');
        return new Response(JSON.stringify({ text: '${transcriptContent}' }), { headers: { 'Content-Type': 'application/json' } });
      }
      const body = JSON.parse(init.body);
      if (body.tools !== undefined)
        throw new Error('Probe must disable tools');
      if (endpoint.pathname.endsWith('/audio/speech')) {
        if (body.response_format !== 'wav' || body.input !== '你好，我是 Aimy。' || body.voice !== 'fixture-voice')
          throw new Error('Invalid speech fixture');
        const audio = mode === 'empty-audio' ? new Uint8Array() : mode === 'invalid-audio' ? new Uint8Array([1, 2, 3]) : new Uint8Array(${JSON.stringify([...audio])});
        return new Response(audio, { headers: { 'Content-Type': 'audio/wav' } });
      }
      if (endpoint.pathname.endsWith('/responses')) {
        if (mode === 'continue' && requests === 1) {
          const call = { type: 'function_call', call_id: 'unexpected', name: 'unavailable_tool', arguments: '{}' };
          return sse([{ type: 'response.output_item.done', item: call }, { type: 'response.completed', response: { output: [call] } }]);
        }
        if (body.model === 'vision-model' && !body.input[0].content.some(part => part.type === 'input_image' && part.image_url.startsWith('data:image/png;base64,')))
          throw new Error('Authorized image was not passed through AIRI');
        const message = { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '${modelContent}', annotations: [] }] };
        return sse([{ type: 'response.output_text.delta', delta: '${modelContent}' }, { type: 'response.output_item.done', item: message }, { type: 'response.completed', response: { output: [message] } }]);
      }
      const events = [
        { id: 'fixture', object: 'chat.completion.chunk', created: 0, model: body.model, choices: [{ index: 0, delta: { role: 'assistant', content: '${modelContent}' }, finish_reason: null }] },
        { id: 'fixture', object: 'chat.completion.chunk', created: 0, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
      ];
      return sse(events);
    };
  `)
  const env: NodeJS.ProcessEnv = {
    AIMY_ENV_FILE: envPath,
    AIMY_API_KEY: fakeCredential,
    AIMY_MODEL: 'fixture-model',
    AIMY_API: 'chat-completions',
    AIMY_VISION_API_KEY: fakeCredential,
    AIMY_VISION_MODEL: 'vision-model',
    AIMY_VISION_BASE_URL: 'https://probe.test/v1/',
    AIMY_VISION_API: 'responses',
    AIMY_ASR_API_KEY: fakeCredential,
    AIMY_ASR_MODEL: 'asr-model',
    AIMY_TTS_API_KEY: fakeCredential,
    AIMY_TTS_MODEL: 'tts-model',
    AIMY_TTS_BASE_URL: 'https://probe.test/v1/',
    AIMY_TTS_VOICE: 'fixture-voice',
    ...overrides,
  }
  const actualArgs = args.map(value => value === '@image' ? imagePath : value === '@audio' ? audioPath : value === '@missing' ? join(directory, 'PRIVATE_SOURCE_PATH.png') : value)
  try {
    const execution = spawnSync(process.execPath, ['--import', loader, '--import', preloadPath, entryPath, ...actualArgs], {
      cwd: directory,
      env,
      encoding: 'utf8',
      timeout: 7000,
      maxBuffer: 1024 * 1024,
    })
    const events: string[] = existsSync(eventsPath) ? readFileSync(eventsPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : []
    return { execution, events, sourcePath: directory }
  }
  finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function safeResult(run: ReturnType<typeof runProbe>): ProbeResult {
  expect(run.execution.error).toBeUndefined()
  expect(run.execution.stderr).toBe('')
  expect(run.execution.stdout).not.toContain(fakeCredential)
  expect(run.execution.stdout).not.toContain(modelContent)
  expect(run.execution.stdout).not.toContain(transcriptContent)
  expect(run.execution.stdout).not.toContain('PRIVATE_PROVIDER_DETAIL')
  expect(run.execution.stdout).not.toContain('private-endpoint.test')
  expect(run.execution.stdout).not.toContain(run.sourcePath)
  expect(run.execution.stdout.trim().split('\n')).toHaveLength(1)
  const result = JSON.parse(run.execution.stdout) as ProbeResult
  expect(Object.keys(result).every(key => ['capability', 'status', 'durationMs', 'firstTokenMs', 'textLength', 'audioBytes'].includes(key))).toBe(true)
  expect(result.durationMs).toBeGreaterThanOrEqual(0)
  return result
}

function capabilityArgs(capability: Capability) {
  return ['--live', '--capability', capability, ...(capability === 'vision' ? ['--image', '@image'] : capability === 'asr' ? ['--audio', '@audio'] : [])]
}

describe('experience probes through real AIRI and xsAI imports', () => {
  it('does not load configuration, read authorized files, or request services without --live', () => {
    const run = runProbe(['--capability', 'vision', '--image', '@image'])
    expect(safeResult(run).status).toBe('not-run')
    expect(run.execution.status).toBe(0)
    expect(run.events).toEqual([])
  })

  it('accepts the leading separator forwarded by workspace scripts', () => {
    const run = runProbe(['--', ...capabilityArgs('llm')])
    expect(safeResult(run).status).toBe('ok')
    expect(run.execution.status).toBe(0)
    expect(run.events.filter(event => event === 'fetch')).toHaveLength(1)
  })

  it('keeps a non-live worker IPC request inactive', () => {
    const run = runProbe([], 'success', {}, { live: false, capability: 'llm' })
    expect(safeResult(run).status).toBe('not-run')
    expect(run.events).toEqual([])
  })

  it('rejects invalid worker IPC before any configuration or service access', () => {
    const run = runProbe([], 'success', {}, { live: true, capability: 'unknown' })
    expect(safeResult(run).status).toBe('invalid-arguments')
    expect(run.events).toEqual([])
  })

  it.each<Capability>(['llm', 'vision', 'asr', 'tts'])('performs exactly one %s request using the actual SDK transport', (capability) => {
    const run = runProbe(capabilityArgs(capability))
    const result = safeResult(run)
    expect(result.capability).toBe(capability)
    expect(result.status, run.execution.stdout).toBe('ok')
    expect(run.execution.status).toBe(0)
    expect(run.events.filter(event => event === 'fetch')).toHaveLength(1)
    if (capability === 'tts') {
      expect(result.audioBytes).toBe(46)
      expect(result.textLength).toBeUndefined()
    }
    else {
      expect(result.textLength).toBe(capability === 'asr' ? transcriptContent.length : modelContent.length)
    }
    if (capability === 'llm' || capability === 'vision')
      expect(result.firstTokenMs).toBeGreaterThanOrEqual(0)
  })

  it.each<Capability>(['llm', 'vision', 'asr', 'tts'])('reports %s failures without raw diagnostics or retries', (capability) => {
    const run = runProbe(capabilityArgs(capability), 'failure')
    expect(safeResult(run).status).toBe('failed')
    expect(run.execution.status).toBe(1)
    expect(run.events.filter(event => event === 'fetch')).toHaveLength(1)
  })

  it.each<Capability>(['vision', 'asr'])('requires explicit user file authorization for %s before any request', (capability) => {
    const run = runProbe(['--live', '--capability', capability])
    expect(safeResult(run).status).toBe('input-required')
    expect(run.execution.status).toBe(2)
    expect(run.events).toEqual([])
  })

  it('reports missing files without exposing paths or calling services', () => {
    const run = runProbe(['--live', '--capability', 'vision', '--image', '@missing'])
    expect(safeResult(run).status).toBe('invalid-input')
    expect(run.execution.stdout).not.toContain('PRIVATE_SOURCE_PATH')
    expect(run.events.filter(event => event === 'fetch')).toHaveLength(0)
  })

  it.each(['grown-input', 'empty-input'])('rejects %s changed between stat and read without a request', (mode) => {
    const run = runProbe(capabilityArgs('asr'), mode)
    expect(safeResult(run).status).toBe('invalid-input')
    expect(run.events).toEqual(['input-read'])
  })

  it('requires configuration without calling a discovery endpoint', () => {
    const run = runProbe(capabilityArgs('tts'), 'success', { AIMY_TTS_VOICE: undefined })
    expect(safeResult(run).status).toBe('configuration-required')
    expect(run.execution.status).toBe(2)
    expect(run.events.filter(event => event === 'fetch')).toHaveLength(0)
  })

  it('denies an SDK continuation before a second transport request', () => {
    const run = runProbe(capabilityArgs('llm'), 'continue', { AIMY_API: 'responses' })
    expect(safeResult(run).status).toBe('failed')
    expect(run.execution.status).toBe(1)
    expect(run.events.filter(event => event === 'fetch')).toHaveLength(1)
  })

  // Regression for the stage-B audit: fetch follows 307/308 with a second POST
  // unless the AIRI transport boundary explicitly rejects redirects.
  it.each([307, 308])('does not follow a real local HTTP %s redirect to a second inference endpoint', (status) => {
    const run = runProbe(capabilityArgs('tts'), `local-redirect-${status}`)
    const result = safeResult(run)
    expect(run.events.filter(event => event === 'redirect-source:POST')).toHaveLength(1)
    expect(run.events.filter(event => event.startsWith('redirect-target:'))).toHaveLength(0)
    expect(result.status).toBe('failed')
    expect(run.execution.status).toBe(1)
  })

  it('aborts a timed-out request and reports a safe timeout', () => {
    const run = runProbe(capabilityArgs('llm'), 'abort-timeout')
    expect(safeResult(run).status).toBe('timeout')
    expect(run.execution.status).toBe(1)
    expect(run.events.filter(event => event === 'fetch')).toHaveLength(1)
    expect(run.events).toContain('abort')
  })

  it('terminates a child whose SDK never acknowledges cancellation', () => {
    const run = runProbe(capabilityArgs('llm'), 'parent-timeout')
    expect(safeResult(run).status).toBe('timeout')
    expect(run.execution.status).toBe(1)
    expect(run.events.filter(event => event === 'fetch')).toHaveLength(1)
  }, 6000)

  it.each(['empty-audio', 'invalid-audio'])('rejects %s TTS output instead of reporting a WAV success', (mode) => {
    const run = runProbe(capabilityArgs('tts'), mode)
    expect(safeResult(run).status).toBe('failed')
    expect(run.execution.status).toBe(1)
    expect(run.events.filter(event => event === 'fetch')).toHaveLength(1)
  })

  it('rejects invalid live arguments before reading configuration', () => {
    const run = runProbe(['--live', '--capability', 'unknown'])
    expect(safeResult(run).status).toBe('invalid-arguments')
    expect(run.execution.status).toBe(2)
    expect(run.events).toEqual([])
  })
})
