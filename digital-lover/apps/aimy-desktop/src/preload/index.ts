import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import { defineInvoke, defineInvokeHandler } from '@moeru/eventa'
import { settingsGet, settingsSave, chatSend, chatCancel, windowHide, windowQuit, chatUpdate, prepareShutdown, prepareSuspend, audioSettingsSave, mediaGet, mediaSet, mediaChanged, transcribeAudio, synthesizeAudio, interpretScreen, publishScreenObservation, cancelMedia, screenSources } from '../shared/contracts'
import type { AimyBridge } from '../shared/contracts'

const { context } = createContext(electronAPI.ipcRenderer)
const bridge: AimyBridge = {
  getSettings: defineInvoke(context, settingsGet), saveSettings: defineInvoke(context, settingsSave),
  saveAudioSettings: defineInvoke(context, audioSettingsSave),
  send: defineInvoke(context, chatSend), cancel: defineInvoke(context, chatCancel),
  hide: defineInvoke(context, windowHide), quit: defineInvoke(context, windowQuit),
  onChatUpdate: listener => context.on(chatUpdate, event => { if (event.body) listener(event.body) }),
  onPrepareShutdown: handler => defineInvokeHandler(context, prepareShutdown, handler),
  onPrepareSuspend: handler => defineInvokeHandler(context, prepareSuspend, handler),
  getMediaState: defineInvoke(context, mediaGet), setMediaState: defineInvoke(context, mediaSet),
  onMediaState: listener => context.on(mediaChanged, event => { if (event.body) listener(event.body) }),
  transcribe: defineInvoke(context, transcribeAudio), synthesize: defineInvoke(context, synthesizeAudio),
  interpretScreen: defineInvoke(context, interpretScreen), cancelMedia: defineInvoke(context, cancelMedia),
  publishObservation: defineInvoke(context, publishScreenObservation),
  listScreenSources: defineInvoke(context, screenSources),
}
contextBridge.exposeInMainWorld('aimy', bridge)
