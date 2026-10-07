<script setup lang="ts">
withDefaults(defineProps<{ name: string, size?: number }>(), { size: 20 })

const paths: Record<string, string> = {
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM19.4 15a7.9 7.9 0 0 0 0-6l1.1-1.9-2-2-1.9 1.1a7.9 7.9 0 0 0-6 0L8.7 5.1l-2 2L7.8 9a7.9 7.9 0 0 0 0 6l-1.1 1.9 2 2 1.9-1.1a7.9 7.9 0 0 0 6 0l1.9 1.1 2-2-1.1-1.9Z',
  hide: 'M5 12h14',
  close: 'm6 6 12 12M18 6 6 18',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  image: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm-2 13 5-5 5 5 3-3 5 5M16 7h.01',
  send: 'm5 12 7-7 7 7M12 5v15',
  stop: 'M7 7h10v10H7Z',
  shield: 'm12 3 8 3v6c0 4-3 7-8 9-5-2-8-5-8-9V6l8-3Zm-3 9 2 2 4-4',
  microphone: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 5.5 1.7M15 9V6a3 3 0 0 0-.3-1.3M5 10v2a7 7 0 0 0 12 5M19 10v2c0 .8-.1 1.5-.4 2.2M12 19v3M8 22h8M3 3l18 18',
  'microphone-on': 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8',
  speaker: 'm4 9 5 0 5-5v16l-5-5H4V9Zm13-1a6 6 0 0 1 0 8M20 5a10 10 0 0 1 0 14',
  screen: 'M8 4h11a2 2 0 0 1 2 2v10M3 6v10a2 2 0 0 0 2 2h12M8 22h8M12 18v4M3 3l18 18',
  chevron: 'm9 5 7 7-7 7',
  check: 'm5 12 4 4L19 6',
  sparkle: 'm12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z',
}
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path :d="paths[name] || paths.sparkle" />
  </svg>
</template>
