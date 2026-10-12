<script setup lang="ts">
import type { ScreenSource } from '../../shared/contracts'

import { nextTick, onMounted, ref, watch } from 'vue'

import AppIcon from './AppIcon.vue'

const props = defineProps<{ open: boolean, sources: ScreenSource[], loading: boolean, error: string }>()
const emit = defineEmits<{ close: [], select: [sourceId: string] }>()
const dialog = ref<HTMLDialogElement>()
async function sync() {
  await nextTick()
  if (props.open && !dialog.value?.open)
    dialog.value?.showModal()
  else if (!props.open)
    dialog.value?.close()
}
watch(() => props.open, () => { void sync() })
onMounted(() => { void sync() })
</script>

<template>
  <dialog ref="dialog" class="screen-picker" aria-labelledby="screen-picker-title" data-testid="screen-picker" @cancel.prevent="emit('close')">
    <header class="drawer-header"><div><span class="eyebrow">共享画面</span><h2 id="screen-picker-title">想一起看什么？</h2></div><button class="icon-button" aria-label="关闭共享选择" @click="emit('close')"><AppIcon name="close" /></button></header>
    <p class="drawer-intro">选定画面会发送给你配置的识图服务，约每 5 秒观察一次；对话、说话或识别语音时会等待。原画面不保存，可随时停止共享。</p>
    <p v-if="loading" class="notice-message" role="status">正在列出可共享的来源…</p>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <div class="screen-sources">
      <button v-for="source in sources" :key="source.id" class="screen-source" type="button" data-testid="screen-source" :data-source-id="source.id" @click="emit('select', source.id)"><AppIcon name="screen" :size="20" /><span><strong>{{ source.name }}</strong><small>{{ source.kind === 'window' ? '应用窗口' : '整个屏幕' }}</small></span><AppIcon name="chevron" :size="16" /></button>
    </div>
  </dialog>
</template>
