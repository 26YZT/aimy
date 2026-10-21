<script setup lang="ts">
import type { MemoryFact, MemoryModelPolicy, MemoryWriteOptions } from '../../../types/memory'

import { Button, FieldCheckbox, FieldSelect, FieldTextArea, SettingsCard } from '@proj-airi/ui'
import { nanoid } from 'nanoid'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import StepUserProfile from '../dialogs/onboarding/step-user-profile.vue'

import { useMemoryStore } from '../../../stores/memory'
import { useConsciousnessStore } from '../../../stores/modules/consciousness'
import { useProviderStore } from '../../../stores/providers/provider'
import { RadioCardManySelect } from '../../menu'

const { t, locale } = useI18n()
const memory = useMemoryStore()
const providers = useProviderStore()
const consciousness = useConsciousnessStore()
const { ready, busy, error, scope, facts, enabled, modelPolicy, profileState, failedJobCount, pendingJobCount, revision: memoryRevision } = storeToRefs(memory)
const { configuredChatProvidersMetadata } = storeToRefs(providers)
const scopeKey = computed(() => scope.value ? JSON.stringify(scope.value) : '')
const localBusy = ref(false)
const localError = ref(false)
const notice = ref('')
const maintenanceOpen = ref(false)
const editingId = ref<string | null>(null)
const editingRevision = ref<number | null>(null)
const editText = ref('')
const editOperation = ref(nanoid())
const removeOperations = new Map<string, { operationId: string, revision: number }>()
const sourceFactId = ref<string | null>(null)
const sourceRevision = ref<number | null>(null)
const sourceLoading = ref(false)
const sources = ref<Array<{ sourceId: string, kind: string, text: string, authoredAt: number }>>([])
const sourceFailed = ref(false)
const sourceGeneration = ref(0)
const modelMode = ref<'follow-chat' | 'override'>('follow-chat')
const modelProvider = ref('')
const modelId = ref('')
const modelSearch = ref('')
const modelListBusy = ref(false)
const modelListFailed = ref(false)
const modelDraftDirty = ref(false)
let enabledCommand: { value: boolean, options: MemoryWriteOptions } | undefined
let modelCommand: { policy: MemoryModelPolicy, options: MemoryWriteOptions } | undefined
let modelDraftRevision: number | undefined
const currentFacts = computed(() => facts.value.filter(fact => fact.status === 'current'))
const personalFacts = computed(() => currentFacts.value.filter(fact => ['identity', 'preference', 'boundary'].includes(fact.category)))
const sharedFacts = computed(() => currentFacts.value.filter(fact => ['event', 'plan', 'experience'].includes(fact.category)))
const groups = computed(() => [
  { id: 'personal', title: t('settings.pages.memory.personalTitle'), facts: personalFacts.value },
  { id: 'shared', title: t('settings.pages.memory.sharedTitle'), facts: sharedFacts.value },
])
const modeOptions = computed(() => [
  { label: t('settings.pages.memory.model.follow'), value: 'follow-chat' },
  { label: t('settings.pages.memory.model.override'), value: 'override' },
])
const providerOptions = computed(() => configuredChatProvidersMetadata.value.map(provider => ({ value: provider.id, label: provider.localizedName || provider.id })))
const providerModels = computed(() => providers.getModelsForProvider(modelProvider.value))
const chatModel = computed(() => [consciousness.activeProvider, consciousness.activeModel].filter(Boolean).join(' / '))

function loadModelDraft(policy: MemoryModelPolicy) {
  modelMode.value = policy.mode
  modelProvider.value = policy.mode === 'override' ? policy.providerId : ''
  modelId.value = policy.mode === 'override' ? policy.modelId : ''
  modelDraftDirty.value = false
  modelDraftRevision = memoryRevision.value
  modelCommand = undefined
}

function editModelDraft() {
  if (!modelDraftDirty.value)
    modelDraftRevision = memoryRevision.value
  modelDraftDirty.value = true
  modelCommand = undefined
}

watch(modelPolicy, (policy) => {
  if (!modelDraftDirty.value && !modelCommand)
    loadModelDraft(policy)
}, { immediate: true })
watch(editText, () => editOperation.value = nanoid())
watch(scopeKey, (next, previous) => {
  if (next === previous)
    return
  sourceGeneration.value++
  sourceFactId.value = null
  sources.value = []
  editingId.value = null
  editingRevision.value = null
  editText.value = ''
  removeOperations.clear()
  localError.value = false
  notice.value = ''
  enabledCommand = undefined
  modelDraftDirty.value = false
  loadModelDraft(modelPolicy.value)
})

async function act(operation: () => Promise<unknown>, successKey?: string) {
  if (localBusy.value || !ready.value)
    return false
  const activeScope = scopeKey.value
  localBusy.value = true
  localError.value = false
  notice.value = ''
  try {
    await operation()
    if (scopeKey.value !== activeScope)
      return false
    if (successKey)
      notice.value = t(successKey)
    return true
  }
  catch {
    if (scopeKey.value === activeScope)
      localError.value = true
    return false
  }
  finally {
    localBusy.value = false
  }
}

async function refresh() {
  localError.value = false
  try {
    await memory.refresh()
    enabledCommand = undefined
    modelCommand = undefined
    modelDraftRevision = memoryRevision.value
    if (!modelDraftDirty.value)
      loadModelDraft(modelPolicy.value)
  }
  catch {
    localError.value = true
  }
}

async function setAutoEnabled(value: boolean) {
  if (!scope.value || !ready.value || localBusy.value)
    return
  if (!enabledCommand || enabledCommand.value !== value) {
    enabledCommand = { value, options: { operationId: nanoid(), expectedRevision: memoryRevision.value, expectedScope: { ...scope.value } } }
  }
  const command = enabledCommand
  if (await act(() => memory.setEnabled(command.value, command.options)))
    enabledCommand = undefined
}

function edit(fact: MemoryFact) {
  editingId.value = fact.factId
  editingRevision.value = fact.revision
  editText.value = fact.text
  editOperation.value = nanoid()
  notice.value = ''
}

async function saveCorrection() {
  const factId = editingId.value
  const expectedFactRevision = editingRevision.value
  if (!factId || expectedFactRevision === null || !editText.value.trim())
    return
  const done = await act(() => memory.correctFact({ operationId: editOperation.value, factId, expectedFactRevision, text: editText.value.trim() }), 'settings.pages.memory.saved')
  if (done)
    editingId.value = null
}

async function remove(fact: MemoryFact) {
  let operation = removeOperations.get(fact.factId)
  if (!operation || operation.revision !== fact.revision) {
    operation = { operationId: nanoid(), revision: fact.revision }
    removeOperations.set(fact.factId, operation)
  }
  const command = { operationId: operation.operationId, factId: fact.factId, expectedFactRevision: operation.revision }
  await act(() => memory.removeFact(command), 'settings.pages.memory.removed')
}

async function readSource(fact: MemoryFact) {
  sourceGeneration.value++
  if (sourceFactId.value === fact.factId) {
    sourceFactId.value = null
    sources.value = []
    return
  }
  const generation = sourceGeneration.value
  const activeScope = scopeKey.value
  sourceFactId.value = fact.factId
  sourceRevision.value = fact.revision
  sources.value = []
  sourceFailed.value = false
  sourceLoading.value = true
  try {
    const result = await memory.readSource(fact.factId)
    if (scopeKey.value === activeScope && sourceGeneration.value === generation)
      sources.value = result
  }
  catch {
    if (sourceGeneration.value === generation)
      sourceFailed.value = true
  }
  finally {
    if (sourceGeneration.value === generation)
      sourceLoading.value = false
  }
}

watch(() => facts.value.find(fact => fact.factId === sourceFactId.value)?.revision, (revision) => {
  if (sourceFactId.value && revision !== sourceRevision.value) {
    sourceGeneration.value++
    sourceFactId.value = null
    sourceRevision.value = null
    sources.value = []
  }
})

const dateFormatter = computed(() => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }))

function status(fact: MemoryFact) {
  if (fact.category === 'plan') {
    if (fact.planStatus === 'done' || fact.planStatus === 'cancelled')
      return t(`settings.pages.memory.plan.${fact.planStatus}`)
    return t('settings.pages.memory.plan.unknown')
  }
  return fact.qualifier ?? ''
}

async function loadModels() {
  if (!modelProvider.value || modelListBusy.value)
    return
  const selected = modelProvider.value
  modelListBusy.value = true
  modelListFailed.value = false
  try {
    const result = await providers.fetchModelsForProvider(selected)
    if (modelProvider.value === selected)
      modelListFailed.value = result.models.length === 0
  }
  catch {
    if (modelProvider.value === selected)
      modelListFailed.value = true
  }
  finally {
    modelListBusy.value = false
  }
}

function changeProvider(value: string | undefined) {
  modelProvider.value = value ?? ''
  modelId.value = ''
  editModelDraft()
}

async function saveModel() {
  const policy: MemoryModelPolicy = modelMode.value === 'follow-chat'
    ? { mode: 'follow-chat' }
    : { mode: 'override', providerId: modelProvider.value, modelId: modelId.value.trim() }
  if (policy.mode === 'override' && (!policy.providerId || !policy.modelId))
    return
  if (!scope.value)
    return
  if (!modelCommand) {
    modelCommand = { policy, options: { operationId: nanoid(), expectedRevision: modelDraftRevision ?? memoryRevision.value, expectedScope: { ...scope.value } } }
  }
  const command = modelCommand
  const done = await act(() => memory.setModelPolicy(command.policy, command.options), 'settings.pages.memory.saved')
  if (done) {
    loadModelDraft(modelPolicy.value)
  }
}

onMounted(refresh)
</script>

<template>
  <SettingsCard>
    <div :class="['flex flex-col gap-3']">
      <p :class="['text-sm leading-relaxed', 'text-neutral-600 dark:text-neutral-400']">
        {{ t('settings.pages.memory.intro') }}
      </p>
      <FieldCheckbox
        :model-value="enabled"
        :disabled="!ready || localBusy || busy"
        :label="t('settings.pages.memory.autoLabel')"
        :description="t('settings.pages.memory.autoDescription')"
        @update:model-value="setAutoEnabled"
      />
      <p :class="['text-xs', 'text-neutral-500 dark:text-neutral-400']">
        {{ t(enabled ? 'settings.pages.memory.activeNotice' : 'settings.pages.memory.pausedNotice') }}
      </p>
      <div v-if="!ready || localError" :class="['flex flex-wrap items-center gap-3']" role="status">
        <p v-if="!ready" :class="['text-sm', 'text-neutral-600 dark:text-neutral-400']">
          {{ t('settings.pages.memory.notReady') }}
        </p>
        <Button size="sm" :label="t('settings.pages.memory.actions.retry')" :loading="busy" @click="refresh" />
      </div>
      <p v-if="localError || error" role="alert" :class="['text-sm', 'text-red-600 dark:text-red-400']">
        {{ t('settings.pages.memory.saveError') }}
      </p>
      <p v-if="notice" role="status" :class="['text-sm', 'text-primary-600 dark:text-primary-400']">
        {{ notice }}
      </p>
      <div v-if="pendingJobCount > 0" role="status" :class="['flex flex-col gap-2']">
        <p :class="['text-sm', 'text-neutral-600 dark:text-neutral-400']">
          {{ t('settings.pages.memory.organizingNotice', { count: pendingJobCount }) }}
        </p>
        <RouterLink v-if="!chatModel && modelPolicy.mode === 'follow-chat'" to="/settings/modules/consciousness" :class="['text-sm underline', 'text-primary-600 dark:text-primary-400']">
          {{ t('settings.pages.memory.configureToOrganize') }}
        </RouterLink>
      </div>
      <div v-if="failedJobCount > 0" :class="['flex flex-wrap items-center gap-3']">
        <p :class="['text-sm', 'text-neutral-600 dark:text-neutral-400']">
          {{ t('settings.pages.memory.pendingNotice', { count: failedJobCount }) }}
        </p>
        <Button size="sm" :disabled="!ready || localBusy" :label="t('settings.pages.memory.actions.retryOrganizing')" @click="act(() => memory.retryFailedJobs())" />
      </div>
    </div>

    <details v-if="profileState !== 'submitted'" :class="['rounded-lg', 'border border-neutral-200 p-4 dark:border-neutral-800']">
      <summary :class="['cursor-pointer text-sm font-medium']">
        {{ t('settings.pages.memory.profile.add') }}
      </summary>
      <div :class="['mt-4']">
        <StepUserProfile compact :on-next="refresh" />
      </div>
    </details>

    <section v-for="group in groups" :key="group.id" :class="['flex flex-col gap-3']">
      <h2 :class="['text-base font-semibold', 'text-neutral-800 dark:text-neutral-100']">
        {{ group.title }}
      </h2>
      <p v-if="group.facts.length === 0" :class="['text-sm leading-relaxed', 'text-neutral-500 dark:text-neutral-400']">
        {{ t('settings.pages.memory.empty') }}
      </p>
      <ul v-else :class="['flex flex-col gap-3']">
        <li v-for="fact in group.facts" :key="`${fact.factId}:${fact.revision}`" :class="['rounded-lg p-4', 'bg-neutral-50 dark:bg-neutral-900']">
          <p :class="['whitespace-pre-wrap break-words text-sm leading-relaxed']">
            {{ fact.text }}
          </p>
          <p v-if="status(fact)" :class="['mt-2 text-xs', 'text-neutral-500 dark:text-neutral-400']">
            {{ status(fact) }}
          </p>
          <div :class="['mt-3 flex flex-wrap items-center gap-3']">
            <span :class="['text-xs', 'text-neutral-500 dark:text-neutral-400']">{{ dateFormatter.format(fact.confirmationAt) }}</span>
            <Button size="sm" :aria-expanded="sourceFactId === fact.factId" :label="t('settings.pages.memory.actions.source')" @click="readSource(fact)" />
          </div>
          <div v-if="sourceFactId === fact.factId" :class="['mt-3 flex flex-col gap-3', 'border-l-2 border-primary-300 pl-3 dark:border-primary-600']">
            <p v-if="sourceLoading" role="status" :class="['text-sm']">
              {{ t('settings.pages.memory.sourceLoading') }}
            </p>
            <p v-else-if="sourceFailed || sources.length === 0" role="status" :class="['text-sm']">
              {{ t('settings.pages.memory.sourceMissing') }}
            </p>
            <blockquote v-for="source in sources" :key="source.sourceId" :class="['text-sm']">
              <p :class="['whitespace-pre-wrap break-words leading-relaxed']">
                {{ source.text }}
              </p>
              <footer :class="['mt-2 text-xs', 'text-neutral-500 dark:text-neutral-400']">
                {{ dateFormatter.format(source.authoredAt) }}
              </footer>
            </blockquote>
          </div>
        </li>
      </ul>
    </section>

    <details :open="maintenanceOpen" :class="['rounded-lg', 'border border-neutral-200 p-4 dark:border-neutral-800']" @toggle="maintenanceOpen = ($event.target as HTMLDetailsElement).open">
      <summary :class="['cursor-pointer text-sm font-medium']">
        {{ t('settings.pages.memory.maintenance.title') }}
      </summary>
      <div :class="['mt-4 flex flex-col gap-4']">
        <p :class="['text-xs leading-relaxed', 'text-neutral-500 dark:text-neutral-400']">
          {{ t('settings.pages.memory.maintenance.description') }}
        </p>
        <div v-for="fact in currentFacts" :key="fact.factId" :class="['flex flex-col gap-3', 'border-b border-neutral-200 pb-4 last:border-b-0 dark:border-neutral-800']">
          <p :class="['whitespace-pre-wrap break-words text-sm']">
            {{ fact.text }}
          </p>
          <fieldset v-if="editingId === fact.factId" :disabled="localBusy" :class="['min-w-0 flex flex-col gap-3']">
            <FieldTextArea v-model="editText" :label="t('settings.pages.memory.maintenance.correction')" :rows="3" :required="false" />
            <div :class="['flex flex-wrap gap-3']">
              <Button color="primary" :loading="localBusy" :disabled="!editText.trim()" :label="t('settings.pages.memory.actions.save')" @click="saveCorrection" />
              <Button :disabled="localBusy" :label="t('settings.pages.memory.actions.cancel')" @click="editingId = null" />
            </div>
          </fieldset>
          <div v-else :class="['flex flex-wrap gap-3']">
            <Button size="sm" :disabled="!ready || localBusy" :label="t('settings.pages.memory.actions.correct')" @click="edit(fact)" />
            <Button size="sm" color="red" :disabled="!ready || localBusy" :label="t('settings.pages.memory.actions.remove')" @click="remove(fact)" />
          </div>
        </div>
      </div>
    </details>

    <details :class="['rounded-lg', 'border border-neutral-200 p-4 dark:border-neutral-800']">
      <summary :class="['cursor-pointer text-sm font-medium']">
        {{ t('settings.pages.memory.model.title') }}
      </summary>
      <div :class="['mt-4 flex flex-col gap-4']">
        <p :class="['text-sm', 'text-neutral-600 dark:text-neutral-400']">
          {{ t('settings.pages.memory.model.currentChat', { model: chatModel || t('settings.pages.memory.model.unconfigured') }) }}
        </p>
        <FieldSelect v-model="modelMode" :label="t('settings.pages.memory.model.mode')" :options="modeOptions" :disabled="localBusy" @update:model-value="editModelDraft" />
        <template v-if="modelMode === 'override'">
          <FieldSelect :model-value="modelProvider" :label="t('settings.pages.memory.model.provider')" :options="providerOptions" :disabled="localBusy" @update:model-value="changeProvider" />
          <RouterLink v-if="providerOptions.length === 0" to="/settings/providers" :class="['text-sm underline', 'text-primary-600 dark:text-primary-400']">
            {{ t('settings.pages.memory.model.configureProvider') }}
          </RouterLink>
          <Button size="sm" :disabled="!modelProvider" :loading="modelListBusy" :label="t('settings.pages.memory.model.refreshModels')" @click="loadModels" />
          <RadioCardManySelect
            v-model="modelId"
            v-model:search-query="modelSearch"
            :items="providerModels"
            searchable
            allow-custom
            :custom-input-placeholder="t('settings.pages.memory.model.customPlaceholder')"
            :search-placeholder="t('settings.pages.memory.model.searchPlaceholder')"
            :search-no-results-title="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.no_search_results')"
            :search-no-results-description="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.no_search_results_description', { query: modelSearch })"
            :search-results-text="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.search_results', { count: '{count}', total: '{total}' })"
            :expand-button-text="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.expand')"
            :collapse-button-text="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.collapse')"
            @update:model-value="editModelDraft"
          />
          <p v-if="modelListFailed" role="status" :class="['text-xs', 'text-neutral-500 dark:text-neutral-400']">
            {{ t('settings.pages.memory.model.noModels') }}
          </p>
        </template>
        <p :class="['text-xs leading-relaxed', 'text-neutral-500 dark:text-neutral-400']">
          {{ t('settings.pages.memory.model.cost') }}
        </p>
        <Button :disabled="!ready || localBusy || (modelMode === 'override' && (!modelProvider || !modelId.trim()))" :label="t('settings.pages.memory.actions.saveModel')" @click="saveModel" />
      </div>
    </details>
  </SettingsCard>
</template>
