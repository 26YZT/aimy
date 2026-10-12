<script setup lang="ts">
import type { Component } from 'vue'

import { computed, defineAsyncComponent, defineComponent, h, ref, shallowRef } from 'vue'

defineProps<{ audioContext?: AudioContext, audioSource?: AudioBufferSourceNode }>()

const state = ref<'pending' | 'loading' | 'mounted'>('pending')
const progress = ref(0)
const failed = ref(false)
const attempt = ref(0)
const status = computed(() => failed.value ? 'error' : state.value)
const modelSrc = new URL('assets/AvatarSample_A.vrm', document.baseURI).href

const unavailableStage = defineComponent({
  name: 'UnavailableAvatarEngine',
  inheritAttrs: false,
  setup: () => () => h('div', { class: 'avatar-unavailable-surface', 'aria-hidden': 'true' }),
})

function createScene() {
  return defineAsyncComponent({
    loader: async (): Promise<Component> => {
      try {
        return (await import('@proj-airi/stage-ui-three')).ThreeScene
      }
      catch {
        // An engine/WASM import failure stays inside the avatar boundary. Return
        // a real unavailable component instead of rejecting App's initial mount.
        failed.value = true
        return unavailableStage
      }
    },
  })
}

const ThreeScene = shallowRef(createScene())

function retry() {
  failed.value = false
  progress.value = 0
  state.value = 'pending'
  attempt.value += 1
  // Recreate the async wrapper so a cached unavailable fallback can be retried.
  ThreeScene.value = createScene()
}
</script>

<template>
  <section class="avatar-stage" aria-label="示例角色" data-testid="avatar-stage" :data-state="status">
    <div class="character-heading">
      <span class="eyebrow">和你一起</span>
      <h1>Aimy<span class="character-dot" /></h1>
      <p>先从今天的一件小事聊起。</p>
    </div>
    <div class="avatar-canvas">
      <ThreeScene
        :key="attempt"
        v-model:state="state"
        model-id="prototype-vroid-sample-a"
        :model-src="modelSrc"
        :enable-orbit-controls="true"
        :audio-context="audioContext"
        :current-audio-source="audioSource"
        @load-model-progress="progress = $event"
        @error="failed = true"
      />
      <div v-if="failed" class="avatar-load avatar-load-error" role="alert" data-testid="avatar-error">
        <strong>角色还没加载出来</strong>
        <span>检查示例资源后重试。文字对话仍可使用。</span>
        <button class="secondary-button" @click="retry">重新加载</button>
      </div>
      <div v-else-if="state !== 'mounted'" class="avatar-load" role="status" data-testid="avatar-loading">
        <span class="spinner" />
        <span>正在加载示例角色{{ progress > 0 ? ` · ${Math.min(100, Math.round(progress))}%` : '' }}</span>
      </div>
    </div>
    <div class="character-caption">
      <span class="sample-tag">交互样机</span>
      <span>VRoid Sample A · 示例角色</span>
    </div>
  </section>
</template>
