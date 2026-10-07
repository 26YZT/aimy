<script setup lang="ts">
import type { PublicSettings } from '../../shared/contracts'

import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'

import AppIcon from './AppIcon.vue'

const props = defineProps<{ open: boolean, settings?: PublicSettings }>()
const emit = defineEmits<{ close: [], saved: [settings: PublicSettings] }>()
const dialog = ref<HTMLDialogElement>()
const saving = ref(false)
const message = ref('')
const saved = ref(false)
const password = ref('')
const kind = ref<'chat' | 'asr' | 'tts'>('chat')
const form = reactive({ model: '', visionModel: '', baseUrl: '', voice: '', api: 'chat-completions' as PublicSettings['api'] })
const activeSettings = computed(() => kind.value === 'chat' ? props.settings : props.settings?.[kind.value])
const heading = computed(() => kind.value === 'chat' ? '让对话开始' : kind.value === 'asr' ? '听见你的声音' : '让回复有声音')

function fillForm() {
  const current = activeSettings.value
  Object.assign(form, {
    model: current?.model || '', baseUrl: current?.baseUrl || '',
    visionModel: kind.value === 'chat' ? props.settings?.visionModel || '' : '',
    voice: kind.value === 'tts' ? props.settings?.tts?.voice || '' : '',
    api: props.settings?.api || 'chat-completions',
  })
  password.value = ''
  message.value = ''
  saved.value = false
}
watch(kind, fillForm)

async function syncOpen() {
  await nextTick()
  if (props.open) {
    kind.value = 'chat'
    fillForm()
    if (!dialog.value?.open)
      dialog.value?.showModal()
  }
  else {
    password.value = ''
    dialog.value?.close()
  }
}

watch(() => props.open, () => { void syncOpen() })
onMounted(() => { void syncOpen() })

function close() {
  if (!saving.value) {
    password.value = ''
    emit('close')
  }
}

async function submit() {
  if (saving.value)
    return
  saving.value = true
  message.value = ''
  saved.value = false
  try {
    const result = kind.value === 'chat' ? await window.aimy.saveSettings({
      model: form.model.trim(), visionModel: form.visionModel.trim(), baseUrl: form.baseUrl.trim(), api: form.api,
      apiKey: password.value.trim() || undefined,
    }) : await window.aimy.saveAudioSettings({
      kind: kind.value, model: form.model.trim(), baseUrl: form.baseUrl.trim(),
      voice: kind.value === 'tts' ? form.voice.trim() : undefined, apiKey: password.value.trim() || undefined,
    })
    if (result.ok) {
      saved.value = true
      emit('saved', result.settings)
      message.value = result.message || '配置已保存。回到对话后可显式开启语音。'
    }
    else {
      message.value = result.message || '配置未能保存，请检查服务地址和模型名称。'
    }
  }
  catch {
    message.value = '配置未能保存。请检查本地安全存储后重试。'
  }
  finally {
    // The secret is neither persisted nor echoed; clear even when the invoke fails.
    password.value = ''
    saving.value = false
  }
}
</script>

<template>
  <dialog ref="dialog" class="settings-drawer" aria-labelledby="settings-title" data-testid="settings-drawer" @cancel.prevent="close">
    <header class="drawer-header">
      <div><span class="eyebrow">模型服务</span><h2 id="settings-title">{{ heading }}</h2></div>
      <button class="icon-button" aria-label="关闭设置" :disabled="saving" @click="close"><AppIcon name="close" /></button>
    </header>
    <div class="settings-tabs" aria-label="服务类型">
      <button v-for="tab in [{ id: 'chat', text: '对话与识图' }, { id: 'asr', text: '语音识别' }, { id: 'tts', text: '语音合成' }]" :key="tab.id" type="button" :class="{ selected: kind === tab.id }" :aria-pressed="kind === tab.id" :disabled="saving" :data-testid="`settings-tab-${tab.id}`" @click="kind = tab.id as 'chat' | 'asr' | 'tts'">{{ tab.text }}</button>
    </div>
    <p class="drawer-intro">{{ kind === 'chat' ? '使用你自己的兼容服务。发送消息时，文字和主动分享的图片会交给该服务处理。' : kind === 'asr' ? '麦克风明确开启后，语音片段会发送给你配置的识别服务。原音频不长期保存；识别文字作为本地对话保存。' : '朗读明确开启后，实际生成的回复分句会发送给你配置的合成服务。它与麦克风开关独立。' }}</p>
    <form class="settings-form" @submit.prevent="submit">
      <label for="service-url">服务地址</label>
      <input id="service-url" v-model="form.baseUrl" type="url" name="service-url" placeholder="https://api.example.com/v1/" autocomplete="off" spellcheck="false" required :disabled="saving" data-testid="settings-endpoint">
      <label v-if="kind === 'chat'" for="service-api">接口协议</label>
      <select v-if="kind === 'chat'" id="service-api" v-model="form.api" :disabled="saving" data-testid="settings-api">
        <option value="chat-completions">Chat Completions</option>
        <option value="responses">Responses</option>
      </select>
      <label for="chat-model">{{ kind === 'chat' ? '对话模型' : kind === 'asr' ? '识别模型' : '合成模型' }}</label>
      <input id="chat-model" v-model="form.model" name="chat-model" placeholder="填写服务中的模型名称" autocomplete="off" spellcheck="false" required :disabled="saving" data-testid="settings-model">
      <label v-if="kind === 'chat'" for="vision-model">识图模型 <span class="optional">可选</span></label>
      <input v-if="kind === 'chat'" id="vision-model" v-model="form.visionModel" name="vision-model" placeholder="留空时使用对话模型" autocomplete="off" spellcheck="false" :disabled="saving" data-testid="settings-vision-model">
      <p v-if="kind === 'chat'" class="field-note">分享图片需要所选模型支持视觉理解。</p>
      <label v-if="kind === 'tts'" for="speech-voice">音色名称</label>
      <input v-if="kind === 'tts'" id="speech-voice" v-model="form.voice" name="speech-voice" placeholder="填写服务中的音色 ID" autocomplete="off" spellcheck="false" :disabled="saving" required data-testid="settings-voice">
      <label for="service-key">API 密钥</label>
      <input id="service-key" v-model="password" type="password" name="service-key" :placeholder="activeSettings?.configured ? '已保存；留空保留当前密钥' : '粘贴服务密钥'" autocomplete="off" spellcheck="false" :required="!activeSettings?.configured" :disabled="saving" data-testid="settings-key">
      <p class="field-note">保存后立即清空输入。密钥不会写入聊天记录。</p>
      <div class="storage-note">
        <AppIcon name="shield" :size="18" />
        <p>{{ settings?.protectedStorage ? '凭证由本机系统安全存储保护。' : '保存时会检查系统安全存储是否可用。' }}<span v-if="settings?.notice"> {{ settings.notice }}</span></p>
      </div>
      <p v-if="message" class="form-message" :class="{ success: saved }" role="status" data-testid="settings-message">{{ message }}</p>
      <button class="primary-button settings-submit" type="submit" :disabled="saving" data-testid="settings-save">
        <span v-if="saving" class="spinner small" />{{ saving ? '正在保存…' : '保存配置' }}
      </button>
      <button v-if="saved" class="secondary-button settings-return" type="button" @click="close">回到对话<AppIcon name="chevron" :size="16" /></button>
    </form>
  </dialog>
</template>
