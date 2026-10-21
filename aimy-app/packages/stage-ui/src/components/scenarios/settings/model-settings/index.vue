<script setup lang="ts">
import type { VrmGesture } from '@proj-airi/stage-ui-three/composables/vrm'

import type { ModelSettingsRuntimeSnapshot } from './runtime'

import { ref } from 'vue'

import ModelSettingsPanel from './panel.vue'
import ModelSettingsPreviewStage from './preview-stage.vue'

import { createEmptyModelSettingsRuntimeSnapshot } from './runtime'

withDefaults(defineProps<{
  palette: string[]
  settingsClass?: string | string[]
  allowExtractColors?: boolean
  live2dSceneClass?: string | string[]
  vrmSceneClass?: string | string[]
  spineSceneClass?: string | string[]
  tachieSceneClass?: string | string[]
  mmdSceneClass?: string | string[]
}>(), {
  allowExtractColors: true,
})

defineEmits<{
  (e: 'extractColorsFromModel'): void
}>()

const previewStageRef = ref<InstanceType<typeof ModelSettingsPreviewStage>>()
const runtimeSnapshot = ref<ModelSettingsRuntimeSnapshot>(createEmptyModelSettingsRuntimeSnapshot())

async function capturePreviewFrame() {
  return previewStageRef.value?.capturePreviewFrame()
}

function handleRuntimeSnapshotChanged(nextSnapshot: ModelSettingsRuntimeSnapshot) {
  runtimeSnapshot.value = nextSnapshot
}

function playVrmGesture(gesture: VrmGesture) {
  return previewStageRef.value?.playVrmGesture(gesture) ?? false
}

defineExpose({
  capturePreviewFrame,
})
</script>

<template>
  <ModelSettingsPanel
    :play-vrm-gesture="playVrmGesture"
    :allow-extract-colors="allowExtractColors"
    :palette="palette"
    :runtime-snapshot="runtimeSnapshot"
    :settings-class="settingsClass"
    @extract-colors-from-model="$emit('extractColorsFromModel')"
  />
  <ModelSettingsPreviewStage
    ref="previewStageRef"
    :live2d-scene-class="live2dSceneClass"
    :vrm-scene-class="vrmSceneClass"
    :spine-scene-class="spineSceneClass"
    :tachie-scene-class="tachieSceneClass"
    :mmd-scene-class="mmdSceneClass"
    @runtime-snapshot-changed="handleRuntimeSnapshotChanged"
  />
</template>
