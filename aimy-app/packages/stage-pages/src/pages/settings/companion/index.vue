<script setup lang="ts">
import { CompanionSettings } from '@proj-airi/stage-ui/components'
</script>

<template>
  <CompanionSettings />
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.companion.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.companion.description
  icon: i-solar:chat-round-heart-bold-duotone
  settingsEntry: true
  order: 6
  stageTransition:
    name: slide
</route>
