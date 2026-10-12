/** Offline public audio + localhost HTTP fixtures. No environment/config loading. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

export function pcmWav(samples, sampleRate = 16000) {
  const bytes = Buffer.alloc(44 + samples.length * 2)
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28)
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36)
  bytes.writeUInt32LE(samples.length * 2, 40)
  for (let index = 0; index < samples.length; index += 1) bytes.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[index] * 32767))), 44 + index * 2)
  return bytes
}
export function wavSamples(bytes) {
  assert.equal(bytes.subarray(0, 4).toString(), 'RIFF')
  assert.equal(bytes.subarray(8, 12).toString(), 'WAVE')
  let sampleRate; let channels; let bits; let format; let payload
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const length = bytes.readUInt32LE(offset + 4)
    const tag = bytes.subarray(offset, offset + 4).toString()
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    if (tag === 'fmt ') { format = data.readUInt16LE(0); channels = data.readUInt16LE(2); sampleRate = data.readUInt32LE(4); bits = data.readUInt16LE(14) }
    if (tag === 'data') payload = data
    offset += 8 + length + length % 2
  }
  assert.equal(format, 1); assert.equal(channels, 1); assert.equal(bits, 16); assert(payload?.length)
  const samples = new Float32Array(payload.length / 2)
  for (let index = 0; index < samples.length; index += 1) samples[index] = payload.readInt16LE(index * 2) / 32768
  return { sampleRate, samples }
}
export function toneWav(durationSeconds = 0.65, frequency = 660) {
  const rate = 16000
  const samples = Float32Array.from({ length: Math.floor(rate * durationSeconds) }, (_unused, index) => {
    const envelope = Math.min(1, index / 160, (rate * durationSeconds - index) / 160)
    return Math.sin(2 * Math.PI * frequency * index / rate) * 0.15 * Math.max(0, envelope)
  })
  return pcmWav(samples, rate)
}
function concatenate(chunks) {
  const samples = new Float32Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length }
  return samples
}
export async function createOfflineAudioFixtures(directory) {
  assert.equal(process.platform, 'darwin', 'This public fixture generator uses offline macOS say/afconvert')
  await mkdir(directory, { recursive: true })
  const spoken = []
  const publicText = ['Hello Aimy please tell me about your day.', 'Hello again Aimy I would like to talk with you.']
  for (let index = 0; index < publicText.length; index += 1) {
    const aiff = join(directory, `public-utterance-${index}.aiff`)
    const wav = join(directory, `public-utterance-${index}.wav`)
    const speech = spawnSync('/usr/bin/say', ['-r', '185', '-o', aiff, publicText[index]], { timeout: 20_000, stdio: 'pipe' })
    assert.equal(speech.status, 0, 'Offline macOS speech fixture generation failed')
    const conversion = spawnSync('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', aiff, wav], { timeout: 20_000, stdio: 'pipe' })
    assert.equal(conversion.status, 0, 'Offline public speech WAV conversion failed')
    const parsed = wavSamples(await readFile(wav))
    assert.equal(parsed.sampleRate, 16000)
    spoken.push(parsed.samples)
  }
  const silence = seconds => new Float32Array(Math.floor(16000 * seconds))
  const shortSpeech = spoken[0].slice(9600, 9600 + 960)
  const files = {
    conversation: pcmWav(concatenate([silence(3), spoken[0], silence(6), spoken[1], silence(3)])),
    barge: pcmWav(concatenate([silence(3), spoken[0], silence(1.4), spoken[1], silence(4)])),
    single: pcmWav(concatenate([silence(3), spoken[0], silence(8)])),
    silence: pcmWav(silence(12)),
    pulse: pcmWav(concatenate([silence(3), wavSamples(toneWav(0.06, 660)).samples, silence(5)])),
    shortBarge: pcmWav(concatenate([silence(3), spoken[0], silence(1.4), shortSpeech, silence(8)])),
  }
  const output = {}
  for (const [name, bytes] of Object.entries(files)) {
    const path = join(directory, `${name}.wav`)
    await writeFile(path, bytes)
    output[name] = { path, bytes: bytes.length, durationMs: (bytes.length - 44) / 32, sha256: createHash('sha256').update(bytes).digest('hex') }
  }
  return { files: output, source: 'offline macOS say public English text; file-backed fake microphone', vad: 'real bundled Silero; no fake VAD', playbackFixture: 'synthetic PCM tone; muted WebAudio; not natural TTS quality' }
}

export async function createMediaFixtureServer(keys) {
  let mode = 'normal'
  let caseName = 'initial'
  const counters = { asr: 0, llm: 0, tts: 0 }
  const records = []
  const timers = new Set()
  const textFirst = '你好，我已经听到你的声音了。今天也很高兴能够陪着你。'
  const textSecond = '接下来我们慢慢聊一聊今天的事情吧。'
  const schedule = (callback, milliseconds) => {
    const timer = setTimeout(() => { timers.delete(timer); callback() }, milliseconds)
    timers.add(timer)
  }
  const server = createServer(async (request, response) => {
    const kind = request.url === '/v1/audio/transcriptions' ? 'asr' : request.url === '/v1/audio/speech' ? 'tts' : request.url === '/v1/chat/completions' ? 'llm' : undefined
    if (request.method !== 'POST' || !kind) { response.writeHead(404).end(); return }
    const selectedMode = mode
    const ordinal = ++counters[kind]
    const record = { case: caseName, kind, mode: selectedMode, ordinal, startedAt: Date.now(), bytes: 0, authenticated: request.headers.authorization === `Bearer ${keys[kind]}`, aborted: false, finished: false, lateResponseAttempted: false }
    records.push(record)
    response.on('close', () => { if (!response.writableEnded) record.aborted = true })
    const finish = (status, headers, body) => { record.lateResponseAttempted = response.destroyed; if (!response.destroyed) { response.writeHead(status, headers); response.end(body); record.finished = true; record.finishedAt = Date.now() } }
    try {
      const chunks = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const bytes = Buffer.concat(chunks)
      record.bytes = bytes.length
      assert(record.authenticated, 'Fixture received wrong capability-specific fake key')
      if (kind === 'asr') {
        const parsed = await new Request(`http://fixture.invalid${request.url}`, { method: 'POST', headers: { 'Content-Type': request.headers['content-type'] }, body: bytes }).formData()
        const file = parsed.get('file')
        assert(file instanceof Blob)
        const audio = Buffer.from(await file.arrayBuffer())
        const decoded = wavSamples(audio)
        assert.equal(decoded.sampleRate, 16000)
        record.audioBytes = audio.length; record.sampleCount = decoded.samples.length; record.model = parsed.get('model')
        record.nonzeroAudio = decoded.samples.some(value => value !== 0)
        if (selectedMode === 'asr-error') { finish(500, { 'Content-Type': 'application/json' }, JSON.stringify({ error: { message: `${keys.asr} FAKE_INTERNAL_ASR_ERROR` } })); return }
        if (selectedMode === 'asr-redirect') { finish(307, { Location: '/redirect-target' }, ''); return }
        const text = ordinal % 2 === 1 ? '你好，我想聊聊今天的事情。' : '我又回来了，继续刚才的话题吧。'
        schedule(() => finish(200, { 'Content-Type': 'application/json' }, JSON.stringify({ text })), selectedMode === 'slow-asr' ? 5_000 : 90)
      }
      else if (kind === 'tts') {
        const body = JSON.parse(bytes.toString())
        record.model = body.model; record.voice = body.voice; record.text = body.input; record.textLength = body.input?.length
        assert.equal(body.response_format, 'wav')
        if (selectedMode === 'tts-error') { finish(500, { 'Content-Type': 'application/json' }, JSON.stringify({ error: { message: `${keys.tts} FAKE_INTERNAL_TTS_ERROR` } })); return }
        if (selectedMode === 'tts-invalid') { finish(200, { 'Content-Type': 'audio/wav' }, Buffer.from('invalid-wave-fixture')); return }
        const duration = selectedMode === 'barge' && ordinal === 1 ? 5 : 0.65
        record.audioDurationMs = duration * 1000
        const audio = toneWav(duration, 550 + ordinal * 55)
        const wait = selectedMode === 'slow-tts' || selectedMode === 'barge' && ordinal > 1 ? 6_000 : ordinal % 2 ? 180 : 60
        schedule(() => finish(200, { 'Content-Type': 'audio/wav' }, audio), wait)
      }
      else {
        const body = JSON.parse(bytes.toString())
        const parts = body.messages.flatMap(message => Array.isArray(message.content) ? message.content : [])
        const images = parts.filter(part => part.type === 'image_url').map(part => part.image_url?.url)
        if (images.length) {
          record.kind = 'vision'; record.imageCount = images.length; record.model = body.model
          const match = images[0].match(/^data:image\/jpeg;base64,(.+)$/u)
          assert(match, 'Own-window capture must reach the real Vision SDK as JPEG')
          const image = Buffer.from(match[1], 'base64')
          record.imageBytes = image.length; record.imageSha256 = createHash('sha256').update(image).digest('hex')
          record.jpegValid = image[0] === 0xff && image[1] === 0xd8 && image[image.length - 2] === 0xff && image[image.length - 1] === 0xd9
          assert(record.jpegValid && image.length > 1000)
          if (selectedMode === 'vision-error') { finish(500, { 'Content-Type': 'application/json' }, JSON.stringify({ error: { message: `${keys.llm} FAKE_INTERNAL_VISION_ERROR` } })); return }
        }
        record.model = body.model; record.userCount = body.messages.filter(message => message.role === 'user').length; record.assistantCount = body.messages.filter(message => message.role === 'assistant').length
        record.toolsDisabled = (!body.tools || body.tools.length === 0) && (!body.tool_choice || body.tool_choice === 'none')
        assert(record.toolsDisabled)
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
        const chunk = (text, end = false) => {
          if (response.destroyed) { record.lateResponseAttempted = true; return }
          response.write(`data: ${JSON.stringify({ id: `media-fixture-${ordinal}`, object: 'chat.completion.chunk', created: 0, model: body.model, choices: [{ index: 0, delta: end ? {} : { role: 'assistant', content: text }, finish_reason: end ? 'stop' : null }] })}\n\n`)
          if (end) { response.end('data: [DONE]\n\n'); record.finished = true; record.finishedAt = Date.now() }
        }
        const isVision = record.kind === 'vision'
        const wait = isVision && selectedMode === 'slow-vision' ? 5000 : selectedMode === 'barge' && ordinal === 1 ? 8_000 : 400
        if (!isVision) chunk(textFirst)
        schedule(() => chunk(isVision ? '画面里是 Aimy 的测试窗口和聊天区域。' : textSecond), wait)
        schedule(() => chunk('', true), wait + 100)
      }
    }
    catch { finish(500, { 'Content-Type': 'application/json' }, JSON.stringify({ error: { message: 'Local fake service fixture rejected request' } })) }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1/`, records,
    setMode(value, name = value) { mode = value; caseName = name; counters.asr = 0; counters.llm = 0; counters.tts = 0 },
    safeRecords: () => records.map(({ case: testCase, kind, mode, ordinal, startedAt, finishedAt, bytes, authenticated, aborted, finished, lateResponseAttempted, model, voice, textLength, audioBytes, sampleCount, nonzeroAudio, audioDurationMs, userCount, assistantCount, toolsDisabled, imageCount, imageBytes, imageSha256, jpegValid }) => ({ case: testCase, kind, mode, ordinal, startedAt, finishedAt, bytes, authenticated, aborted, finished, lateResponseAttempted, model, voice, textLength, audioBytes, sampleCount, nonzeroAudio, audioDurationMs, userCount, assistantCount, toolsDisabled, imageCount, imageBytes, imageSha256, jpegValid })),
    async close() { for (const timer of timers) clearTimeout(timer); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) },
  }
}
