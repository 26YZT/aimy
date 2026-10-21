<script setup lang="ts">
import type { WorkflowRule } from '../../../services/companion/workflow'
import type { CompanionPreferences } from '../../../types/companion'

import { Button, FieldCheckbox, FieldInput, FieldSelect, SettingsCard } from '@proj-airi/ui'
import { cloneDeep } from 'es-toolkit'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useCompanionStore } from '../../../stores/companion'
import { useCompanionSettingsStore } from '../../../stores/companion-settings'
import { useDisplayModelsStore } from '../../../stores/display-models'
import { DEFAULT_COMPANION_PREFERENCES } from '../../../types/companion'

const { t } = useI18n()
const settings = useCompanionSettingsStore()
const companion = useCompanionStore()
const displayModels = useDisplayModelsStore()
const draft = ref<CompanionPreferences>(structuredClone(DEFAULT_COMPANION_PREFERENCES))
const rules = ref<WorkflowRule[]>([])
const revision = ref(0)
const busy = ref(false)
const dirty = ref(false)
const notice = ref('')
const motionCatalog = computed(() => companion.motionCatalog)
const speechStatus = computed(() => companion.speechStatus)
const modelId = ref('')
const area = ref('')
const group = ref('')
const weight = ref(1)
const selectedModel = computed(() => motionCatalog.value.find(item => item.modelId === modelId.value))
function modelLabel(id: string) {
  return displayModels.displayModels.find(model => model.id === id)?.name ?? t('settings.pages.companion.loadedModel')
}
const modelOptions = computed(() => motionCatalog.value.map(item => ({ label: modelLabel(item.modelId), value: item.modelId })))
const areaOptions = computed(() => selectedModel.value?.areas.map(value => ({ label: value, value })) ?? [])
const groupOptions = computed(() => selectedModel.value?.groups.map(value => ({ label: value, value })) ?? [])
const languageOptions = computed(() => ['zh', 'en', 'ja', 'ko'].map(value => ({ value, label: t(`settings.pages.companion.languages.${value}`) })))
const styleOptions = computed(() => ['gentle', 'calm', 'lively'].map(value => ({ value, label: t(`settings.pages.companion.styles.${value}`) })))
const cadenceOptions = computed(() => ['day', 'week', 'month'].map(value => ({ value, label: t(`settings.pages.companion.cadences.${value}`) })))
const actionOptions = computed(() => ['followup', 'review', 'none'].map(value => ({ value, label: t(`settings.pages.companion.actions.${value}`) })))
const modeOptions = computed(() => ['all', 'any'].map(value => ({ value, label: t(`settings.pages.companion.modes.${value}`) })))
const eventOptions = computed(() => ['chat-complete', 'idle', 'manual'].map(value => ({ value, label: t(`settings.pages.companion.events.${value}`) })))

function loadDraft() {
  draft.value = cloneDeep(settings.snapshot.preferences)
  rules.value = cloneDeep(settings.snapshot.rules)
  revision.value = settings.snapshot.revision
  dirty.value = false
}
watch(() => settings.snapshot.revision, () => {
  if (!dirty.value)
    loadDraft()
})
function change() {
  dirty.value = true
  notice.value = ''
}
function number(key: keyof CompanionPreferences['followup'], value: unknown) {
  if (key === 'enabled' || !Number.isFinite(Number(value)))
    return
  draft.value.followup[key] = Number(value)
  change()
}
async function save() {
  busy.value = true
  try {
    await settings.save(cloneDeep(draft.value), cloneDeep(rules.value), revision.value)
    loadDraft()
    notice.value = t('settings.pages.companion.saved')
  }
  catch { notice.value = t('settings.pages.companion.saveFailed') }
  finally { busy.value = false }
}
async function reload() {
  try {
    await settings.reload()
    loadDraft()
    notice.value = ''
  }
  catch { notice.value = t('settings.pages.companion.loadFailed') }
}
async function perform(action: 'review' | 'cancel' | 'rules') {
  busy.value = true
  try {
    if (action === 'review')
      await companion.createReview()
    if (action === 'cancel')
      await companion.cancel()
    if (action === 'rules')
      await companion.runRules()
    await companion.refresh()
    notice.value = t('settings.pages.companion.done')
  }
  catch { notice.value = t('settings.pages.companion.operationFailed') }
  finally { busy.value = false }
}
function addRule() {
  rules.value.push({ id: crypto.randomUUID(), name: t('settings.pages.companion.newRule'), enabled: true, priority: 0, mode: 'all', conditions: [{ field: 'source', operator: 'equals', value: 'chat-complete' }, { field: 'text', operator: 'contains', value: '' }], action: { type: 'none' } })
  change()
}
function setEvent(rule: WorkflowRule, value: unknown) {
  if (value !== 'chat-complete' && value !== 'idle' && value !== 'manual')
    return
  const condition = rule.conditions.find(item => item.field === 'source')
  if (condition?.field === 'source')
    condition.value = value
  else rule.conditions.push({ field: 'source', operator: 'equals', value })
  change()
}
function setKeyword(rule: WorkflowRule, value: unknown) {
  const condition = rule.conditions.find(item => item.field === 'text')
  if (condition?.field === 'text')
    condition.value = String(value ?? '')
  else rule.conditions.push({ field: 'text', operator: 'contains', value: String(value ?? '') })
  change()
}
function addMotion() {
  if (!modelId.value || !area.value || !group.value || !selectedModel.value?.areas.includes(area.value) || !selectedModel.value.groups.includes(group.value))
    return
  const model = draft.value.interaction.models[modelId.value] ??= {}
  const list = model[area.value] ??= []
  const entry = list.find(item => item.group === group.value)
  if (entry)
    entry.weight = weight.value
  else list.push({ group: group.value, weight: weight.value })
  change()
}
onMounted(async () => {
  try {
    await settings.load()
    loadDraft()
    await companion.refresh()
  }
  catch { notice.value = t('settings.pages.companion.loadFailed') }
})
</script>

<template>
  <div :class="['flex flex-col gap-6']" @input="change">
    <p :class="['text-sm text-neutral-600 dark:text-neutral-300']">
      {{ t('settings.pages.companion.description') }}
    </p>
    <p role="status" aria-live="polite">
      {{ notice || (settings.error ? t('settings.pages.companion.loadFailed') : '') }}
    </p>
    <SettingsCard>
      <h2 :class="['text-lg font-semibold']">
        {{ t('settings.pages.companion.followupTitle') }}
      </h2>
      <FieldCheckbox v-model="draft.followup.enabled" :label="t('settings.pages.companion.followupEnabled')" @update:model-value="change" />
      <p :class="['text-sm text-neutral-500']">
        {{ t('settings.pages.companion.costNotice') }}
      </p>
      <FieldInput type="number" :model-value="draft.followup.delayMinutes" :label="t('settings.pages.companion.delay')" @update:model-value="number('delayMinutes', $event)" />
      <FieldInput type="number" :model-value="draft.followup.maxPerDay" :label="t('settings.pages.companion.dailyLimit')" @update:model-value="number('maxPerDay', $event)" />
      <div :class="['grid grid-cols-1 gap-4 sm:grid-cols-2']">
        <FieldInput type="number" :model-value="draft.followup.quietStartHour" :label="t('settings.pages.companion.quietStart')" @update:model-value="number('quietStartHour', $event)" />
        <FieldInput type="number" :model-value="draft.followup.quietEndHour" :label="t('settings.pages.companion.quietEnd')" @update:model-value="number('quietEndHour', $event)" />
      </div>
      <p v-if="!companion.plans.length">
        {{ t('settings.pages.companion.noPlans') }}
      </p>
      <ul v-else :class="['space-y-2 text-sm']">
        <li v-for="plan in companion.plans" :key="plan.id">
          {{ new Date(plan.dueAt).toLocaleString() }} · {{ t(`settings.pages.companion.planStates.${plan.state}`) }}
        </li>
      </ul>
      <Button :disabled="busy" @click="perform('cancel')">
        {{ t('settings.pages.companion.cancelPlans') }}
      </Button>
    </SettingsCard>
    <SettingsCard>
      <h2 :class="['text-lg font-semibold']">
        {{ t('settings.pages.companion.reviewTitle') }}
      </h2>
      <p :class="['text-sm text-neutral-500']">
        {{ t('settings.pages.companion.reviewDescription') }}
      </p>
      <FieldCheckbox v-model="draft.review.idleEnabled" :label="t('settings.pages.companion.idleReview')" @update:model-value="change" />
      <FieldSelect v-model="draft.review.cadence" :options="cadenceOptions" :label="t('settings.pages.companion.cadence')" @update:model-value="change" />
      <Button :disabled="busy || dirty" @click="perform('review')">
        {{ t('settings.pages.companion.reviewNow') }}
      </Button>
      <p v-if="!companion.reviews.length">
        {{ t('settings.pages.companion.noReviews') }}
      </p>
      <details v-for="review in companion.reviews" :key="review.id">
        <summary>{{ review.period }} · {{ t(`settings.pages.companion.reviewStates.${review.status}`) }}</summary>
        <ul v-if="review.status === 'current'" :class="['mt-3 space-y-2 text-sm']">
          <li v-for="entry in review.entries" :key="entry.factId">
            {{ entry.text }}
          </li>
        </ul>
      </details>
    </SettingsCard>
    <SettingsCard>
      <h2 :class="['text-lg font-semibold']">
        {{ t('settings.pages.companion.voiceTitle') }}
      </h2>
      <FieldCheckbox v-model="draft.speech.translationEnabled" :label="t('settings.pages.companion.translationEnabled')" @update:model-value="change" />
      <FieldSelect v-model="draft.speech.targetLanguage" :label="t('settings.pages.companion.targetLanguage')" :options="languageOptions" @update:model-value="change" />
      <p :class="['text-sm text-neutral-500']">
        {{ t('settings.pages.companion.translationDescription') }}
      </p>
      <p role="status">
        {{ t(`settings.pages.companion.speechStates.${speechStatus.translation}`) }}
      </p>
      <FieldCheckbox v-model="draft.speech.directorEnabled" :label="t('settings.pages.companion.directorEnabled')" @update:model-value="change" />
      <FieldSelect v-model="draft.speech.style" :label="t('settings.pages.companion.style')" :options="styleOptions" @update:model-value="change" />
      <p :class="['text-sm text-neutral-500']">
        {{ t('settings.pages.companion.directorDescription') }}
      </p>
      <p role="status">
        {{ t(`settings.pages.companion.speechStates.${speechStatus.director}`) }}
      </p>
      <FieldCheckbox v-model="draft.speech.echoFilterEnabled" :label="t('settings.pages.companion.echoEnabled')" @update:model-value="change" />
      <p :class="['text-sm text-neutral-500']">
        {{ t('settings.pages.companion.echoDescription') }}
      </p>
      <FieldCheckbox v-model="draft.speech.adaptiveSilenceEnabled" :label="t('settings.pages.companion.endpointEnabled')" @update:model-value="change" />
    </SettingsCard>
    <SettingsCard>
      <h2 :class="['text-lg font-semibold']">
        {{ t('settings.pages.companion.interactionTitle') }}
      </h2>
      <FieldCheckbox v-model="draft.interaction.enabled" :label="t('settings.pages.companion.interactionEnabled')" @update:model-value="change" />
      <p :class="['text-sm text-neutral-500']">
        {{ t('settings.pages.companion.interactionDescription') }}
      </p>
      <p v-if="!motionCatalog.length">
        {{ t('settings.pages.companion.noMotionModel') }}
      </p>
      <template v-else>
        <FieldSelect v-model="modelId" :label="t('settings.pages.companion.model')" :options="modelOptions" />
        <FieldSelect v-model="area" :label="t('settings.pages.companion.area')" :options="areaOptions" />
        <FieldSelect v-model="group" :label="t('settings.pages.companion.motionGroup')" :options="groupOptions" />
        <FieldInput v-model="weight" type="number" :label="t('settings.pages.companion.weight')" />
        <Button :disabled="!area || !group" @click="addMotion">
          {{ t('settings.pages.companion.addMotion') }}
        </Button>
      </template>
      <div v-for="(areas, id) in draft.interaction.models" :key="id" :class="['text-sm']">
        <p :class="['break-all']">
          {{ modelLabel(String(id)) }}
        </p>
        <div v-for="(motions, hitArea) in areas" :key="hitArea">
          {{ hitArea }}: {{ motions.map(item => `${item.group} (${item.weight})`).join(', ') }}
          <Button size="sm" @click="delete areas[hitArea]; change()">
            {{ t('settings.pages.companion.remove') }}
          </Button>
        </div>
      </div>
      <p :class="['text-sm text-neutral-500']">
        {{ t('settings.pages.companion.assetHint') }}
      </p>
    </SettingsCard>
    <SettingsCard>
      <h2 :class="['text-lg font-semibold']">
        {{ t('settings.pages.companion.rulesTitle') }}
      </h2>
      <p :class="['text-sm text-neutral-500']">
        {{ t('settings.pages.companion.rulesDescription') }}
      </p>
      <fieldset v-for="(rule, index) in rules" :key="rule.id" :class="['flex flex-col gap-4 border border-neutral-300 rounded-lg p-4 dark:border-neutral-700']">
        <legend>{{ rule.name }}</legend>
        <FieldInput v-model="rule.name" :label="t('settings.pages.companion.ruleName')" />
        <FieldCheckbox v-model="rule.enabled" :label="t('settings.pages.companion.ruleEnabled')" @update:model-value="change" />
        <FieldSelect :model-value="String(rule.conditions.find(item => item.field === 'source')?.value ?? 'chat-complete')" :options="eventOptions" :label="t('settings.pages.companion.event')" @update:model-value="setEvent(rule, $event)" />
        <FieldInput :model-value="String(rule.conditions.find(item => item.field === 'text')?.value ?? '')" :label="t('settings.pages.companion.keyword')" @update:model-value="setKeyword(rule, $event)" />
        <FieldSelect v-model="rule.mode" :options="modeOptions" :label="t('settings.pages.companion.mode')" @update:model-value="change" />
        <FieldInput v-model="rule.priority" type="number" :label="t('settings.pages.companion.priority')" />
        <FieldSelect v-model="rule.action.type" :options="actionOptions" :label="t('settings.pages.companion.action')" @update:model-value="change" />
        <p v-if="rule.action.type === 'followup'" :class="['text-sm']">
          {{ t('settings.pages.companion.ruleDelay') }}
        </p>
        <Button @click="rules.splice(index, 1); change()">
          {{ t('settings.pages.companion.remove') }}
        </Button>
      </fieldset>
      <div :class="['flex flex-wrap gap-3']">
        <Button :disabled="rules.length >= 20" @click="addRule">
          {{ t('settings.pages.companion.addRule') }}
        </Button>
        <Button :disabled="busy || dirty" @click="perform('rules')">
          {{ t('settings.pages.companion.runRules') }}
        </Button>
      </div>
    </SettingsCard>
    <div :class="['flex flex-wrap gap-3']">
      <Button :disabled="busy || !settings.ready" @click="save">
        {{ t('settings.pages.companion.save') }}
      </Button>
      <Button :disabled="busy" @click="reload">
        {{ t('settings.pages.companion.reload') }}
      </Button>
    </div>
    <p v-if="companion.error" role="alert">
      {{ t('settings.pages.companion.operationFailed') }}
    </p>
  </div>
</template>
