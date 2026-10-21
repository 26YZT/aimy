<script setup lang="ts">
import type { OnboardingStepNextHandler, OnboardingStepPrevHandler } from './types'

import { Button, FieldInput, FieldSelect, FieldTextArea } from '@proj-airi/ui'
import { nanoid } from 'nanoid'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useMemoryStore } from '../../../../stores/memory'

const props = withDefaults(defineProps<{
  onNext: OnboardingStepNextHandler
  onPrevious?: OnboardingStepPrevHandler
  compact?: boolean
}>(), { compact: false })

const { t } = useI18n()
const memory = useMemoryStore()
const { ready, scope } = storeToRefs(memory)
const preferredName = ref('')
const chatPreference = ref('unanswered')
const recentMatter = ref('')
const submissionId = ref(nanoid())
const saving = ref(false)
const failed = ref(false)
const saved = ref(false)
const scopeKey = computed(() => scope.value ? JSON.stringify(scope.value) : '')
const preferenceOptions = computed(() => [
  { label: t('settings.pages.memory.profile.preferenceNone'), value: 'unanswered' },
  { label: t('settings.pages.memory.profile.listenFirst'), value: 'listen-first' },
  { label: t('settings.pages.memory.profile.talkItThrough'), value: 'talk-it-through' },
  { label: t('settings.pages.memory.profile.lighthearted'), value: 'lighthearted' },
])

watch([preferredName, chatPreference, recentMatter], () => {
  submissionId.value = nanoid()
  saved.value = false
  failed.value = false
})
watch(scopeKey, (next, previous) => {
  // Readiness can arrive after the user starts typing. Only a real scope change clears the draft.
  if (!previous || next === previous)
    return
  preferredName.value = ''
  chatPreference.value = 'unanswered'
  recentMatter.value = ''
  failed.value = false
  saved.value = false
})

async function submit(skipped: boolean) {
  if (saving.value)
    return
  if (!ready.value) {
    if (skipped)
      await props.onNext()
    return
  }
  if (skipped && failed.value) {
    await props.onNext()
    return
  }
  const activeScope = scopeKey.value
  saving.value = true
  failed.value = false
  try {
    await memory.submitProfile({
      submissionId: submissionId.value,
      preferredName: skipped ? '' : preferredName.value.trim(),
      chatPreference: skipped || chatPreference.value === 'unanswered' ? '' : chatPreference.value,
      recentMatter: skipped ? '' : recentMatter.value.trim(),
      skipped,
    })
    if (scopeKey.value !== activeScope)
      return
    saved.value = !skipped
    await props.onNext()
  }
  catch {
    if (scopeKey.value === activeScope)
      failed.value = true
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <section :class="['min-h-0 min-w-0 flex flex-1 flex-col gap-4']" :aria-busy="saving">
    <div v-if="!props.compact" :class="['flex flex-shrink-0 items-center gap-3']">
      <Button
        v-if="props.onPrevious"
        size="sm"
        :label="t('settings.pages.memory.actions.previous')"
        :disabled="saving"
        @click="props.onPrevious?.()"
      />
      <h2 :class="['text-xl font-semibold', 'text-neutral-800 dark:text-neutral-100']">
        {{ t('settings.pages.memory.profile.title') }}
      </h2>
    </div>
    <fieldset :disabled="saving" :class="['min-h-0 min-w-0 flex flex-1 flex-col gap-5 overflow-y-auto', 'px-1 py-2']">
      <p :class="['text-sm leading-relaxed', 'text-neutral-600 dark:text-neutral-400']">
        {{ t('settings.pages.memory.profile.intro') }}
      </p>
      <FieldInput
        v-model="preferredName"
        :label="t('settings.pages.memory.profile.preferredName')"
        :description="t('settings.pages.memory.profile.optional')"
        :disabled="saving"
        autocomplete="nickname"
        :required="false"
      />
      <FieldSelect
        v-model="chatPreference"
        :label="t('settings.pages.memory.profile.chatPreference')"
        :options="preferenceOptions"
        :disabled="saving"
      />
      <FieldTextArea
        v-model="recentMatter"
        :label="t('settings.pages.memory.profile.recentMatter')"
        :description="t('settings.pages.memory.profile.recentHint')"
        :rows="3"
        :required="false"
      />
      <p :class="['text-xs leading-relaxed', 'text-neutral-500 dark:text-neutral-400']">
        {{ t('settings.pages.memory.profile.privacy') }}
      </p>
      <p :class="['text-xs leading-relaxed', 'text-neutral-500 dark:text-neutral-400']">
        {{ t('settings.pages.memory.profile.autoNotice') }}
      </p>
      <p v-if="!ready" role="status" :class="['text-sm', 'text-neutral-600 dark:text-neutral-400']">
        {{ t('settings.pages.memory.notReady') }}
      </p>
      <p v-if="failed" role="alert" :class="['text-sm', 'text-red-600 dark:text-red-400']">
        {{ t('settings.pages.memory.saveError') }}
      </p>
      <p v-if="saved" role="status" :class="['text-sm', 'text-primary-600 dark:text-primary-400']">
        {{ t('settings.pages.memory.profile.saved') }}
      </p>
    </fieldset>
    <div :class="['flex flex-shrink-0 flex-wrap gap-3', 'py-1']">
      <Button
        color="primary"
        variant="primary"
        :label="t(props.compact ? 'settings.pages.memory.actions.save' : 'settings.pages.memory.profile.saveAndChat')"
        :loading="saving"
        :disabled="!ready"
        @click="submit(false)"
      />
      <Button
        v-if="!props.compact"
        :label="t(failed ? 'settings.pages.memory.profile.continueAfterError' : 'settings.pages.memory.profile.skip')"
        :disabled="saving"
        @click="submit(true)"
      />
    </div>
  </section>
</template>
