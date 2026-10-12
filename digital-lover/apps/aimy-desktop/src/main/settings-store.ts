import type { PublicSettings, SettingsInput, SettingsResult, AudioSettingsInput, AudioServiceKind, PrivateAudioSettings } from '../shared/contracts'
import { readFile, mkdir, rename, writeFile, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { safeParse, object, string, picklist, optional, number } from 'valibot'

const inputSchema = object({ model: string(), visionModel: string(), baseUrl: string(), api: picklist(['chat-completions', 'responses']), apiKey: optional(string()) })
const audioDiskSchema = object({ model: string(), baseUrl: string(), voice: string(), keyCiphertext: optional(string()) })
const audioInputSchema = object({ kind: picklist(['asr', 'tts']), model: string(), baseUrl: string(), voice: optional(string()), apiKey: optional(string()) })
const diskSchema = object({ version: picklist([1]), model: string(), visionModel: string(), baseUrl: string(), api: picklist(['chat-completions', 'responses']), keyCiphertext: optional(string()), asr: optional(audioDiskSchema), tts: optional(audioDiskSchema), bounds: optional(object({ x: number(), y: number(), width: number(), height: number() })) })
type AudioDiskState = { model: string; baseUrl: string; voice: string; keyCiphertext?: string }
type DiskState = { version: 1; model: string; visionModel: string; baseUrl: string; api: 'chat-completions' | 'responses'; keyCiphertext?: string; asr?: AudioDiskState; tts?: AudioDiskState; bounds?: { x: number; y: number; width: number; height: number } }
export interface SecretStorage { isEncryptionAvailable: () => boolean; encryptString: (value: string) => Buffer; decryptString: (value: Buffer) => string }

/** Owns the private config file. Atomic awaited writes follow AIRI's persistence pattern. */
export async function createSettingsStore(directory: string, secrets: SecretStorage) {
  const path = join(directory, 'settings-v1.json')
  let state: DiskState = { version: 1, model: '', visionModel: '', baseUrl: '', api: 'chat-completions' }
  let unreadable = false
  try {
    const parsed = safeParse(diskSchema, JSON.parse(await readFile(path, 'utf8')))
    if (parsed.success) state = parsed.output
    else unreadable = true
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) unreadable = true
  }
  let queue = Promise.resolve()
  function write(update: (current: DiskState) => DiskState) {
    const work = queue.then(async () => {
      const next = update(state)
      await mkdir(directory, { recursive: true, mode: 0o700 })
      if (unreadable) await copyFile(path, `${path}.bak`)
      const tmp = `${path}.${randomUUID()}.tmp`
      await writeFile(tmp, JSON.stringify(next), { mode: 0o600 })
      await rename(tmp, path)
      state = next; unreadable = false
    })
    queue = work.catch(() => {})
    return work
  }
  function key(ciphertext: string | undefined) {
    if (!ciphertext || !secrets.isEncryptionAvailable()) return ''
    try { return secrets.decryptString(Buffer.from(ciphertext, 'base64')) } catch { return '' }
  }
  function audioConfiguration(kind: AudioServiceKind): PrivateAudioSettings {
    const stored = state[kind]
    return { baseUrl: stored?.baseUrl ?? '', model: stored?.model ?? '', voice: stored?.voice ?? '', apiKey: stored ? key(stored.keyCiphertext) : '' }
  }
  function audioPublic(kind: AudioServiceKind) {
    const { apiKey, ...publicValue } = audioConfiguration(kind)
    return { ...publicValue, configured: Boolean(apiKey && publicValue.model && (kind === 'asr' || publicValue.voice)) }
  }
  function validAddress(value: string) {
    if (!value.trim()) return true
    try { const url = new URL(value.trim()); return value.length <= 2000 && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash } catch { return false }
  }
  function publicSettings(): PublicSettings {
    return { model: state.model, visionModel: state.visionModel, baseUrl: state.baseUrl, api: state.api, configured: Boolean(key(state.keyCiphertext) && state.model), protectedStorage: secrets.isEncryptionAvailable(), asr: audioPublic('asr'), tts: audioPublic('tts'), ...(unreadable ? { notice: '本地设置无法读取，原文件已保留。请重新保存设置。' } : {}) }
  }
  return {
    publicSettings,
    privateSettings: () => ({ ...state, apiKey: key(state.keyCiphertext) }),
    privateMediaSettings: audioConfiguration,
    bounds: () => state.bounds,
    async setBounds(bounds: NonNullable<DiskState['bounds']>) {
      // Automatic window movement must not replace a damaged config before the
      // user explicitly repairs it. Keep those bounds in memory until save().
      if (unreadable) { state = { ...state, bounds }; return }
      await write(current => ({ ...current, bounds }))
    },
    async save(input: SettingsInput): Promise<SettingsResult> {
      const parsed = safeParse(inputSchema, input)
      if (!parsed.success || !parsed.output.model.trim() || parsed.output.model.length > 200 || parsed.output.visionModel.length > 200 || (parsed.output.apiKey?.length ?? 0) > 1000)
        return { ok: false, settings: publicSettings(), message: '请填写有效的模型与服务配置。' }
      const next = parsed.output
      if (!validAddress(next.baseUrl)) return { ok: false, settings: publicSettings(), message: '服务地址需为不含凭证或查询参数的 HTTP／HTTPS 地址。' }
      if (!secrets.isEncryptionAvailable()) return { ok: false, settings: publicSettings(), message: '系统安全存储不可用，无法保存密钥。' }
      const apiKey = next.apiKey?.trim()
      try {
        const encrypted = apiKey ? secrets.encryptString(apiKey).toString('base64') : undefined
        await write(current => ({ ...current, model: next.model.trim(), visionModel: next.visionModel.trim(), baseUrl: next.baseUrl.trim(), api: next.api, ...(encrypted ? { keyCiphertext: encrypted } : {}) }))
        return { ok: true, settings: publicSettings() }
      } catch { return { ok: false, settings: publicSettings(), message: '设置未保存，请稍后重试。' } }
    },
    async saveAudio(input: AudioSettingsInput): Promise<SettingsResult> {
      const parsed = safeParse(audioInputSchema, input)
      if (!parsed.success || !parsed.output.model.trim() || parsed.output.model.length > 200 || (parsed.output.voice?.length ?? 0) > 200 || (parsed.output.apiKey?.length ?? 0) > 1000 || (parsed.output.kind === 'tts' && !parsed.output.voice?.trim()))
        return { ok: false, settings: publicSettings(), message: '请填写有效的语音模型和音色配置。' }
      const next = parsed.output
      if (!validAddress(next.baseUrl)) return { ok: false, settings: publicSettings(), message: '服务地址需为不含凭证或查询参数的 HTTP／HTTPS 地址。' }
      if (!secrets.isEncryptionAvailable()) return { ok: false, settings: publicSettings(), message: '系统安全存储不可用，无法保存密钥。' }
      try {
        const apiKey = next.apiKey?.trim()
        const encrypted = apiKey ? secrets.encryptString(apiKey).toString('base64') : undefined
        await write(current => ({ ...current, [next.kind]: { ...current[next.kind], baseUrl: next.baseUrl.trim(), model: next.model.trim(), voice: next.voice?.trim() ?? '', ...(encrypted ? { keyCiphertext: encrypted } : {}) } }))
        return { ok: true, settings: publicSettings() }
      } catch { return { ok: false, settings: publicSettings(), message: '语音配置未保存，请稍后重试。' } }
    },
  }
}
