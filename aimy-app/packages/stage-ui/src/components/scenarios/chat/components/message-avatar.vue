<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = defineProps<{ source?: string, label: string }>()
const failed = ref(false)
const initial = computed(() => Array.from(props.label.trim())[0] || '?')
watch(() => props.source, () => {
  failed.value = false
})
</script>

<template>
  <span
    role="img"
    :aria-label="label"
    :class="[
      'flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full',
      'text-sm bg-[var(--messenger-soft,#f0e3e8)] text-[var(--messenger-accent,#98546c)]',
    ]"
  >
    <img v-if="source && !failed" :src="source" alt="" referrerpolicy="no-referrer" :class="['size-full object-cover']" @error="failed = true">
    <span v-else aria-hidden="true">{{ initial }}</span>
  </span>
</template>
