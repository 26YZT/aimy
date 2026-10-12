<script setup lang="ts">
import type { ChatHistoryItem } from '@proj-airi/core-agent'
import type { PublicSettings } from '../shared/contracts'
import type { SharedImage } from './composables/use-local-conversation'

import { computed, nextTick, onMounted, onScopeDispose, ref, watch } from 'vue'

import AppIcon from './components/AppIcon.vue'
import AvatarStage from './components/AvatarStage.vue'
import SettingsDrawer from './components/SettingsDrawer.vue'
import ScreenPicker from './components/ScreenPicker.vue'
import { useLocalConversation } from './composables/use-local-conversation'
import { useVoiceInteraction } from './composables/use-voice-interaction'
import { useScreenInteraction } from './composables/use-screen-interaction'

const conversation = useLocalConversation(window.aimy)
const voice = useVoiceInteraction(window.aimy, conversation)
const { state: mediaState, initialized: mediaInitialized, preparingMic, listening, transcribing, speaking, error: voiceError, audioContext, audioSource } = voice
const screen = useScreenInteraction(window.aimy, conversation, {
  configured: () => !!settings.value?.configured,
  openSettings: () => { settingsOpen.value = true },
  isBusy: () => conversation.busy.value || voice.inputBusy.value || voice.speaking.value,
  isPreempted: () => !!conversation.activeRequestId.value || conversation.shuttingDown.value || voice.inputBusy.value || voice.speaking.value,
  stopTurn: voice.stopTurn,
})
const { enabled: screenEnabled, error: screenError, observing: screenObserving, starting: screenStarting } = screen
async function suspendAll() {
  const stoppedScreen = screen.suspend()
  const stoppedVoice = voice.suspend()
  const results = await Promise.all([stoppedScreen, stoppedVoice])
  return results.every(Boolean)
}
async function disableAll() {
  const stoppedScreen = screen.disable()
  const stoppedVoice = voice.disableAll()
  const results = await Promise.all([stoppedScreen, stoppedVoice])
  return results.every(Boolean)
}
const unsubscribeSuspend = window.aimy.onPrepareSuspend(suspendAll)
const unsubscribeShutdown = window.aimy.onPrepareShutdown(async () => {
  if (!await suspendAll())
    return false
  return conversation.shutdown()
})
onScopeDispose(unsubscribeShutdown)
onScopeDispose(unsubscribeSuspend)
const { messages, ready, restoring, writing, activeRequestId, streamText, error, notice, unsaved, busy } = conversation
const settings = ref<PublicSettings>()
const settingsOpen = ref(false)
const draft = ref('')
const image = ref<SharedImage>()
const readingImage = ref(false)
const imageError = ref('')
const scrollArea = ref<HTMLElement>()
const composer = ref<HTMLTextAreaElement>()
const fileInput = ref<HTMLInputElement>()
const clearDialog = ref<HTMLDialogElement>()
const configurationLoading = ref(true)
const configurationError = ref('')
const controlError = ref('')
const canSend = computed(() => ready.value && !busy.value && !readingImage.value && !configurationLoading.value && (!!draft.value.trim() || !!image.value))
watch(settingsOpen, (open) => { if (open) void disableAll() }, { flush: 'sync' })

function messageText(message: ChatHistoryItem) {
  if (typeof message.content === 'string')
    return message.content
  if (!Array.isArray(message.content))
    return ''
  return message.content.filter(part => part.type === 'text').map(part => 'text' in part ? part.text : '').join('\n')
}

function messageImages(message: ChatHistoryItem) {
  if (!Array.isArray(message.content))
    return []
  return message.content.flatMap((part) => {
    if (part.type !== 'image_url' || !('image_url' in part))
      return []
    const url = part.image_url.url
    // Uploaded local images only: the transcript cannot fetch arbitrary remote resources.
    return /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Z0-9+/=]+$/i.test(url) ? [url] : []
  })
}

function label(message: ChatHistoryItem) {
  return message.role === 'user' ? '你' : message.role === 'assistant' ? message.id?.startsWith('screen-') ? '画面观察' : 'Aimy' : '提示'
}

async function scrollToLatest() {
  await nextTick()
  if (scrollArea.value)
    scrollArea.value.scrollTop = scrollArea.value.scrollHeight
}

watch([messages, streamText], () => { void scrollToLatest() }, { deep: true })

onMounted(async () => {
  await Promise.allSettled([
    conversation.restore(),
    (async () => {
      try {
        settings.value = await window.aimy.getSettings()
      }
      catch {
        configurationError.value = '无法读取模型配置。请打开设置重新保存。'
      }
      finally {
        configurationLoading.value = false
      }
    })(),
  ])
  await scrollToLatest()
})

function settingsSaved(value: PublicSettings) {
  settings.value = value
  configurationError.value = ''
}

async function submit() {
  if (!canSend.value)
    return
  if (!settings.value?.configured) {
    settingsOpen.value = true
    return
  }
  const currentDraft = draft.value
  const currentImage = image.value
  await conversation.send(currentDraft, currentImage, () => {
    draft.value = ''
    image.value = undefined
    imageError.value = ''
    if (fileInput.value)
      fileInput.value.value = ''
  })
  await nextTick()
  composer.value?.focus()
}

function onComposerKey(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    void submit()
  }
}

async function selectImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || busy.value)
    return
  imageError.value = ''
  const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
  if (!allowed.includes(file.type)) {
    imageError.value = '请选择 PNG、JPEG、WebP 或 GIF 图片。'
    return
  }
  if (file.size > 4 * 1024 * 1024 || file.size === 0) {
    imageError.value = '图片需大于 0 且不超过 4 MB，请换一张较小的图片。'
    return
  }
  readingImage.value = true
  try {
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = reject
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Invalid image'))
      reader.readAsDataURL(file)
    })
    // Reject corrupt image files before they enter the transcript or model request.
    await new Promise<void>((resolve, reject) => {
      const preview = new Image()
      preview.onload = () => resolve()
      preview.onerror = reject
      preview.src = url
    })
    image.value = { name: file.name, mimeType: file.type, data: url.slice(url.indexOf(',') + 1), url }
  }
  catch {
    imageError.value = '无法读取这张图片，请选择有效的图片文件。'
  }
  finally {
    readingImage.value = false
  }
}

async function clearConversation() {
  clearDialog.value?.close()
  await disableAll()
  await conversation.clear()
  if (ready.value) {
    draft.value = ''
    image.value = undefined
    imageError.value = ''
  }
}

async function windowAction(action: 'hide' | 'quit') {
  controlError.value = ''
  try {
    await suspendAll()
    await conversation.cancel()
    await window.aimy[action]()
  }
  catch {
    controlError.value = '窗口操作未完成，请重试。'
  }
}
</script>

<template>
  <div class="app-shell" data-testid="aimy-app">
    <header class="titlebar">
      <div class="brand"><AppIcon name="sparkle" :size="19" /><span>aimy</span><span class="prototype-label">桌面交互样机</span></div>
      <div class="window-controls">
        <button class="icon-button" aria-label="模型服务设置" title="模型服务设置" :disabled="!!activeRequestId" data-testid="open-settings" @click="settingsOpen = true"><AppIcon name="settings" :size="18" /></button>
        <span class="control-separator" />
        <button class="icon-button" aria-label="隐藏窗口" title="隐藏窗口" data-testid="hide-window" @click="windowAction('hide')"><AppIcon name="hide" :size="18" /></button>
        <button class="icon-button quit-button" aria-label="退出 Aimy" title="退出 Aimy" data-testid="quit-window" @click="windowAction('quit')"><AppIcon name="close" :size="18" /></button>
      </div>
    </header>

    <main class="workspace">
      <AvatarStage :audio-context="audioContext" :audio-source="audioSource" />
      <section class="conversation" aria-label="与 Aimy 的对话" data-testid="conversation" :data-ready="ready" :data-listening="listening" :data-speaking="speaking" :data-vad="preparingMic ? 'loading' : listening ? 'ready' : 'off'">
        <header class="conversation-header">
          <div><h2>今天想聊些什么？</h2><span class="local-status"><span class="status-dot" />{{ restoring ? '正在恢复本地对话' : '本地会话' }}</span></div>
          <button class="icon-button" aria-label="清空本地对话" title="清空本地对话" :disabled="restoring || writing" data-testid="clear-conversation" @click="clearDialog?.showModal()"><AppIcon name="trash" :size="18" /></button>
        </header>

        <div ref="scrollArea" class="message-list" role="log" aria-label="聊天记录" aria-live="polite" aria-relevant="additions text" :aria-busy="!!activeRequestId" data-testid="message-list">
          <div v-if="restoring" class="empty-state"><span class="spinner" /><p>正在接回上次的对话…</p></div>
          <div v-else-if="messages.length === 0" class="empty-state">
            <span class="empty-symbol"><AppIcon name="sparkle" :size="28" /></span>
            <h3>我在这儿。</h3>
            <p>聊聊今天，或者分享一张图片。<br>我们慢慢认识彼此。</p>
            <button v-if="!configurationLoading && !settings?.configured" class="secondary-button setup-prompt" data-testid="configure-prompt" @click="settingsOpen = true">配置模型服务<AppIcon name="chevron" :size="16" /></button>
          </div>
          <article v-for="(message, index) in messages" :key="message.id || `${index}-${message.role}`" class="message" :class="`message-${message.role}`" :data-testid="`message-${message.role}`" :data-role="message.role">
            <span class="message-label">{{ label(message) }}</span>
            <div class="message-content">
              <img v-for="(url, imageIndex) in messageImages(message)" :key="imageIndex" :src="url" alt="你分享的图片" class="message-image" width="260" height="180" loading="lazy">
              <p v-if="messageText(message)">{{ messageText(message) }}</p>
            </div>
          </article>
          <article v-if="activeRequestId" class="message message-assistant streaming-message" data-testid="streaming-message">
            <span class="message-label">Aimy</span>
            <div class="message-content"><p v-if="streamText" data-testid="stream-text">{{ streamText }}<span class="stream-caret" /></p><span v-else class="thinking-dots" aria-label="正在准备回复"><i /><i /><i /></span></div>
          </article>
        </div>

        <div class="conversation-feedback" aria-live="polite">
          <p v-if="error || configurationError || controlError || voiceError || screenError" class="error-message" role="alert" data-testid="chat-error">{{ error || configurationError || controlError || voiceError || screenError }}<button v-if="!ready && !restoring && !writing" class="text-button" data-testid="retry-storage" @click="conversation.recover">{{ unsaved ? '重试保存' : '重试读取' }}</button></p>
          <p v-else-if="notice" class="notice-message" data-testid="chat-notice">{{ notice }}</p>
          <p v-else-if="preparingMic || transcribing || listening" class="notice-message" data-testid="voice-notice">{{ preparingMic ? '正在准备本地语音检测…' : transcribing ? '正在识别你说的话…' : '正在听 · 开口可打断朗读。回声表现仍需实际设备验证。' }}</p>
          <p v-else-if="screenStarting || screenObserving" class="notice-message" data-testid="screen-notice">{{ screenStarting ? '正在开启共享画面…' : '正在理解你共享的画面…' }}</p>
        </div>

        <form class="composer" :class="{ 'composer-disabled': !ready }" @submit.prevent="submit">
          <div v-if="image" class="attachment-preview" data-testid="attachment-preview">
            <img :src="image.url" alt="待发送的图片" width="48" height="48">
            <div><strong>{{ image.name }}</strong><span>仅在发送后分享给模型</span></div>
            <button type="button" class="icon-button" aria-label="移除待发送图片" :disabled="busy" data-testid="remove-image" @click="image = undefined"><AppIcon name="close" :size="16" /></button>
          </div>
          <label class="sr-only" for="chat-input">发消息给 Aimy</label>
          <textarea id="chat-input" ref="composer" v-model="draft" placeholder="发消息给 Aimy…" rows="2" maxlength="8000" :disabled="busy" data-testid="chat-input" @keydown="onComposerKey" />
          <div class="composer-toolbar">
            <div class="composer-tools">
              <input ref="fileInput" class="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="选择分享图片" tabindex="-1" data-testid="image-input" @change="selectImage">
              <button type="button" class="icon-button" aria-label="分享一张图片" title="分享图片 · 最大 4 MB" :disabled="busy || readingImage" data-testid="attach-image" @click="fileInput?.click()"><AppIcon name="image" /></button>
              <span class="input-hint">{{ readingImage ? '正在读取图片…' : 'Enter 发送 · Shift + Enter 换行' }}</span>
            </div>
            <button v-if="activeRequestId" type="button" class="stop-button" data-testid="stop-generation" @click="conversation.cancel"><AppIcon name="stop" :size="15" />停止</button>
            <button v-else type="submit" class="send-button" aria-label="发送消息" :disabled="!canSend" data-testid="send-message"><AppIcon name="send" :size="20" /></button>
          </div>
          <p v-if="imageError" class="image-error" role="alert" data-testid="image-error">{{ imageError }}</p>
        </form>
        <footer class="privacy-status" aria-label="隐私状态">
          <button type="button" class="privacy-toggle" :class="{ enabled: screenEnabled }" :disabled="!mediaInitialized || !ready" :aria-pressed="screenEnabled" :title="screenEnabled ? screen.state.value.screen.sourceName || '停止共享画面' : '选择共享窗口或屏幕'" data-testid="screen-status" @click="screenEnabled ? screen.disable() : screen.openPicker()"><AppIcon name="screen" :size="13" />{{ screenEnabled ? '屏幕共享中' : '屏幕关闭' }}</button>
          <button type="button" class="privacy-toggle" :class="{ enabled: mediaState.mic.enabled }" :disabled="!mediaInitialized || !ready" :aria-pressed="mediaState.mic.enabled" data-testid="microphone-status" @click="voice.toggleMic(!mediaState.mic.enabled)"><AppIcon :name="mediaState.mic.enabled ? 'microphone-on' : 'microphone'" :size="13" />{{ mediaState.mic.enabled ? '麦克风开启' : '麦克风关闭' }}</button>
          <button type="button" class="privacy-toggle" :class="{ enabled: mediaState.speech.enabled }" :disabled="!mediaInitialized" :aria-pressed="mediaState.speech.enabled" data-testid="speech-status" @click="voice.toggleSpeech(!mediaState.speech.enabled)"><AppIcon name="speaker" :size="13" />{{ mediaState.speech.enabled ? '朗读开启' : '朗读关闭' }}</button>
          <span data-testid="local-record-status" title="会话保存在本机；发送内容由你配置的模型服务处理"><AppIcon name="shield" :size="13" />记录留在本机</span>
        </footer>
      </section>
    </main>

    <SettingsDrawer :open="settingsOpen" :settings="settings" @close="settingsOpen = false" @saved="settingsSaved" />
    <ScreenPicker :open="screen.pickerOpen.value" :sources="screen.sources.value" :loading="screen.loadingSources.value" :error="screenError" @close="screen.pickerOpen.value = false" @select="screen.selectSource" />
    <dialog ref="clearDialog" class="confirm-dialog" aria-labelledby="clear-title" data-testid="clear-dialog">
      <span class="confirm-icon"><AppIcon name="trash" :size="22" /></span>
      <h2 id="clear-title">清空这段对话？</h2>
      <p>本机保存的消息和分享图片会被删除，随后开始新的会话。这一步无法撤销。</p>
      <div class="confirm-actions"><button class="secondary-button" autofocus @click="clearDialog?.close()">保留对话</button><button class="danger-button" data-testid="confirm-clear" @click="clearConversation">清空对话</button></div>
    </dialog>
  </div>
</template>
