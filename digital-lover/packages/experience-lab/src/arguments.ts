export type Capability = 'llm' | 'vision' | 'asr' | 'tts'
export type ProbeStatus = 'not-run' | 'ok' | 'invalid-arguments' | 'configuration-required' | 'input-required' | 'invalid-input' | 'failed' | 'timeout'

export interface ProbeArguments {
  live: boolean
  capability: Capability | null
  image?: string
  audio?: string
}

export interface ProbeResult {
  capability: Capability | null
  status: ProbeStatus
  durationMs: number
  firstTokenMs?: number
  textLength?: number
  audioBytes?: number
}

export function parseArguments(argv: string[]): ProbeArguments | undefined {
  if (argv[0] === '--')
    argv = argv.slice(1)
  const parsed: ProbeArguments = { live: false, capability: null }
  const seen = new Set<string>()
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]
    if (seen.has(flag))
      return
    seen.add(flag)
    if (flag === '--live') {
      parsed.live = true
      continue
    }
    if (flag !== '--capability' && flag !== '--image' && flag !== '--audio')
      return
    const value = argv[++index]
    if (!value || value.startsWith('--'))
      return
    if (flag === '--capability') {
      if (value !== 'llm' && value !== 'vision' && value !== 'asr' && value !== 'tts')
        return
      parsed.capability = value
    }
    else if (flag === '--image') {
      parsed.image = value
    }
    else {
      parsed.audio = value
    }
  }
  if ((parsed.image && parsed.capability !== 'vision') || (parsed.audio && parsed.capability !== 'asr'))
    return
  if (parsed.live && !parsed.capability)
    return
  return parsed
}
