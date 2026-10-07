import type { ChatHistoryItem } from '@proj-airi/core-agent'
import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

export interface PublicSettings {
  model: string
  visionModel: string
  baseUrl: string
  api: 'chat-completions' | 'responses'
  configured: boolean
  protectedStorage: boolean
  notice?: string
  asr?: PublicAudioSettings
  tts?: PublicAudioSettings
}
export type AudioServiceKind = 'asr' | 'tts'
export interface PublicAudioSettings { baseUrl: string; model: string; voice: string; configured: boolean }
export interface AudioSettingsInput { kind: AudioServiceKind; baseUrl: string; model: string; voice?: string; apiKey?: string }
export interface PrivateAudioSettings { baseUrl: string; model: string; voice: string; apiKey: string }
export type MediaKind = 'mic' | 'screen' | 'speech'
export interface MediaGrant { enabled: boolean; token?: string; sourceName?: string }
/** Main-owned monotonic snapshot version; never persisted as an authorization. */
export interface MediaState { revision: number; mic: MediaGrant; screen: MediaGrant; speech: MediaGrant }
export interface MediaControl { kind: MediaKind; enabled: boolean; sourceId?: string }
export interface MediaControlResult { ok: boolean; state: MediaState; message?: string }
export interface ScreenSource { id: string; name: string; kind: 'screen' | 'window' }
export interface TranscriptionRequest { requestId: string; token: string; audioBase64: string }
export interface SynthesisRequest { requestId: string; token: string; turnId: string; text: string }
export interface ScreenInterpretationRequest { requestId: string; token: string; imageBase64: string }
export interface ObservationPublishRequest { requestId: string; token: string; receiptId: string; text: string }
export interface MediaReply { requestId: string; status: 'complete' | 'cancelled' | 'failed' | 'configuration-required'; message?: string; text?: string; audioBase64?: string; receiptId?: string }
export interface SettingsInput {
  model: string
  visionModel: string
  baseUrl: string
  api: 'chat-completions' | 'responses'
  apiKey?: string
}
export interface SettingsResult { ok: boolean; settings: PublicSettings; message?: string }
export interface ChatRequest {
  requestId: string
  sessionId: string
  messages: ChatHistoryItem[]
  text: string
  attachments?: { type: 'image'; data: string; mimeType: string }[]
  source?: 'text' | 'voice' | 'screen'
  captureToken?: string
  receiptId?: string
}
export interface ChatReply {
  requestId: string
  status: 'complete' | 'cancelled' | 'failed' | 'configuration-required' | 'busy'
  messages: ChatHistoryItem[]
  message?: string
  preserveHistory?: boolean
}
export interface ChatUpdate { requestId: string; text: string }
export const settingsGet = defineInvokeEventa<PublicSettings>('aimy:settings:get')
export const settingsSave = defineInvokeEventa<SettingsResult, SettingsInput>('aimy:settings:save')
export const audioSettingsSave = defineInvokeEventa<SettingsResult, AudioSettingsInput>('aimy:settings:audio-save')
export const chatSend = defineInvokeEventa<ChatReply, ChatRequest>('aimy:chat:send')
export const chatCancel = defineInvokeEventa<void>('aimy:chat:cancel')
export const windowHide = defineInvokeEventa<void>('aimy:window:hide')
export const windowQuit = defineInvokeEventa<void>('aimy:window:quit')
export const prepareShutdown = defineInvokeEventa<boolean>('aimy:window:prepare-shutdown')
export const prepareSuspend = defineInvokeEventa<boolean>('aimy:window:prepare-suspend')
export const chatUpdate = defineEventa<ChatUpdate>('aimy:chat:update')
export const mediaGet = defineInvokeEventa<MediaState>('aimy:media:get')
export const mediaSet = defineInvokeEventa<MediaControlResult, MediaControl>('aimy:media:set')
export const mediaChanged = defineEventa<MediaState>('aimy:media:changed')
export const transcribeAudio = defineInvokeEventa<MediaReply, TranscriptionRequest>('aimy:media:transcribe')
export const synthesizeAudio = defineInvokeEventa<MediaReply, SynthesisRequest>('aimy:media:synthesize')
export const interpretScreen = defineInvokeEventa<MediaReply, ScreenInterpretationRequest>('aimy:media:interpret-screen')
export const publishScreenObservation = defineInvokeEventa<MediaReply, ObservationPublishRequest>('aimy:media:publish-screen')
export const cancelMedia = defineInvokeEventa<void, { requestId: string }>('aimy:media:cancel')
export const screenSources = defineInvokeEventa<ScreenSource[]>('aimy:media:screen-sources')
export interface AimyBridge {
  getSettings: () => Promise<PublicSettings>
  saveSettings: (input: SettingsInput) => Promise<SettingsResult>
  saveAudioSettings: (input: AudioSettingsInput) => Promise<SettingsResult>
  send: (request: ChatRequest) => Promise<ChatReply>
  cancel: () => Promise<void>
  hide: () => Promise<void>
  quit: () => Promise<void>
  onChatUpdate: (listener: (update: ChatUpdate) => void) => () => void
  onPrepareShutdown: (handler: () => Promise<boolean>) => () => void
  onPrepareSuspend: (handler: () => Promise<boolean>) => () => void
  getMediaState: () => Promise<MediaState>
  setMediaState: (input: MediaControl) => Promise<MediaControlResult>
  onMediaState: (listener: (state: MediaState) => void) => () => void
  transcribe: (input: TranscriptionRequest) => Promise<MediaReply>
  synthesize: (input: SynthesisRequest) => Promise<MediaReply>
  interpretScreen: (input: ScreenInterpretationRequest) => Promise<MediaReply>
  publishObservation: (input: ObservationPublishRequest) => Promise<MediaReply>
  cancelMedia: (input: { requestId: string }) => Promise<void>
  listScreenSources: () => Promise<ScreenSource[]>
}
