<script setup lang="ts">
import ScreenShareControl from '../../components/screen-share-control.vue'

// The diagnostic route uses the same user-operated source picker as chat. Opening it never starts capture.
</script>

<template>
  <ScreenShareControl />
</template>

<route lang="yaml">
meta:
  layout: settings
</route>
