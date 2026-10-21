<script setup lang="ts">
import type { ProviderMode } from '../../../../composables/use-analytics'
import type { ProviderMetadata } from '../../../../libs/providers/metadata'
import type {
  OnboardingStep,
  OnboardingStepGuard,
  OnboardingStepNextHandler,
  OnboardingStepPrevHandler,
  ProviderConfigData,
} from './types'

import { isCustomProvidersDisabled } from '@proj-airi/stage-shared'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import StepModelSelection from './step-model-selection.vue'
import StepProviderConfiguration from './step-provider-configuration.vue'
import StepProviderSelection from './step-provider-selection.vue'
import StepWelcome from './step-welcome.vue'

import { useAnalytics } from '../../../../composables/use-analytics'
import { useAiriCardStore } from '../../../../stores/modules/airi-card'
import { useConsciousnessStore } from '../../../../stores/modules/consciousness'
import { useProviderConfigStore } from '../../../../stores/providers/config'
import { useProviderStore } from '../../../../stores/providers/provider'

interface Emits {
  (e: 'configured'): void
  (e: 'skipped'): void
}

const props = withDefaults(defineProps<{
  extraSteps?: OnboardingStep[]
  afterModelSteps?: OnboardingStep[]
  localOnly?: boolean
}>(), {
  extraSteps: () => [],
  afterModelSteps: () => [],
  localOnly: false,
})
const emit = defineEmits<Emits>()
const step = ref(0)
const direction = ref<'next' | 'previous'>('next')
const navigationPending = ref(false)
let navigationEpoch = 0
let disposed = false
const pendingProviderConfig = ref<ProviderConfigData | null>(null)
const { trackOnboardingCompleted, trackOnboardingStarted, trackOnboardingStepCompleted } = useAnalytics()

const providersStore = useProviderStore()

const providerStore = useProviderConfigStore()
const { allChatProvidersMetadata } = storeToRefs(providersStore)
const airiCardStore = useAiriCardStore()
const consciousnessStore = useConsciousnessStore()
const {
  activeProvider,
  activeModel,
} = storeToRefs(consciousnessStore)

// Popular providers for first-time setup
const popularProviders = computed(() => {
  const popular = ['openai', 'azure-openai', 'anthropic', 'amazon-bedrock', 'google-generative-ai', 'groq', 'nvidia', 'openrouter-ai', 'ollama', 'deepseek', 'player2', 'openai-compatible']
  return allChatProvidersMetadata.value
    .filter(provider => popular.includes(provider.id))
    .sort((a, b) => popular.indexOf(a.id) - popular.indexOf(b.id))
})

// Selected provider and form data
const selectedProviderId = ref('')

// Computed selected provider
const selectedProvider = computed(() => {
  return allChatProvidersMetadata.value.find(p => p.id === selectedProviderId.value) || null
})

const selectedProviderType = computed<ProviderMode>(() => {
  if (!selectedProviderId.value)
    return 'unknown'
  return selectedProviderId.value.startsWith('official-provider') ? 'official' : 'custom'
})

// Reset validation state when provider changes
function selectProvider(provider: ProviderMetadata) {
  selectedProviderId.value = provider.id
}

async function saveProviderConfiguration(data: ProviderConfigData) {
  const provider = selectedProvider.value
  if (!provider)
    return

  const config: Record<string, unknown> = {}

  if (data.apiKey)
    config.apiKey = data.apiKey.trim()
  if (data.baseUrl)
    config.baseUrl = data.baseUrl.trim()
  if (data.accountId)
    config.accountId = data.accountId.trim()
  if (data.customFields) {
    for (const [key, value] of Object.entries(data.customFields)) {
      if (value)
        config[key] = value.trim()
    }
  }

  // Provider configuration is leader-owned synchronized state. Route the save
  // through synced actions so the leader persists it and replicates it back;
  // the `configs` computed projection discards direct writes on recompute.
  await providersStore.initializeProvider(provider.id)
  await providerStore.patchProviderConfig(provider.id, config)
  await providersStore.forceProviderConfigured(provider.id)

  activeProvider.value = provider.id

  try {
    await consciousnessStore.loadModelsForProvider(provider.id)
  }
  catch {
    console.error('[onboarding] Could not load the provider model list.')
  }
}

const allSteps = computed<OnboardingStep[]>(() => {
  const coreSteps: OnboardingStep[] = [
    {
      id: 'welcome',
      component: StepWelcome,
      props: () => ({
        customProviderSetupEnabled: props.localOnly || !isCustomProvidersDisabled(),
        localOnly: props.localOnly,
      }),
    },
    {
      id: 'provider-selection',
      component: StepProviderSelection,
      props: () => ({
        selectedProviderId: selectedProviderId.value,
        popularProviders: popularProviders.value,
        onSelectProvider: selectProvider,
      }),
    },
    {
      id: 'provider-configuration',
      component: StepProviderConfiguration,
      props: () => ({
        selectedProviderId: selectedProviderId.value,
        selectedProvider: selectedProvider.value,
      }),
      beforeNext: async () => {
        if (!pendingProviderConfig.value)
          return false

        await saveProviderConfiguration(pendingProviderConfig.value)
        pendingProviderConfig.value = null
        return true
      },
    },
    ...props.extraSteps.map(step => ({
      ...step,
      props: () => ({
        ...step.props?.(),
      }),
    })),
    {
      id: 'model-selection',
      component: StepModelSelection,
      beforeNext: async () => {
        if (!activeProvider.value || !activeModel.value)
          return false
        // The card owns this choice across card application and process restarts.
        return await airiCardStore.updateActiveCardConsciousness({ provider: activeProvider.value, model: activeModel.value })
      },
    },
    ...props.afterModelSteps,
  ]

  return coreSteps
})

const currentStep = computed(() => allSteps.value[step.value] ?? null)
const currentStepProps = computed(() => currentStep.value?.props?.() ?? {})

// A callback belongs to its rendered step. Late work from an old step cannot advance a newer one.
const requestNextStep = computed<OnboardingStepNextHandler>(() => {
  const index = step.value
  const id = currentStep.value?.id
  const providerId = selectedProviderId.value
  return async (configData) => {
    if (disposed || navigationPending.value || step.value !== index || currentStep.value?.id !== id
      || selectedProviderId.value !== providerId) {
      return
    }
    pendingProviderConfig.value = configData ?? null
    await navigateNext(index, id)
  }
})
const requestPreviousStep = computed<OnboardingStepPrevHandler>(() => {
  const index = step.value
  const id = currentStep.value?.id
  return () => navigatePrevious(index, id)
})

async function handleSave() {
  trackOnboardingStepCompleted(currentStep.value?.id ?? 'unknown')
  trackOnboardingCompleted({
    selected_provider_type: selectedProviderType.value,
    selected_provider_id: selectedProviderId.value || undefined,
    selected_use_case: 'unknown',
  })
  emit('configured')
}

async function canPassGuard(guard?: OnboardingStepGuard) {
  if (!guard)
    return true

  return await guard()
}

async function navigateNext(index: number, id: string | undefined) {
  const current = currentStep.value
  if (disposed || navigationPending.value || !current || step.value !== index || current.id !== id)
    return
  const epoch = ++navigationEpoch
  navigationPending.value = true
  try {
    if (!(await canPassGuard(current.beforeNext)))
      return
    if (disposed || epoch !== navigationEpoch || step.value !== index || currentStep.value?.id !== id)
      return
    if (index === allSteps.value.length - 1) {
      await handleSave()
      return
    }
    trackOnboardingStepCompleted(current.id)
    direction.value = 'next'
    step.value = index + 1
  }
  finally {
    if (epoch === navigationEpoch)
      navigationPending.value = false
  }
}

async function navigatePrevious(index: number, id: string | undefined) {
  const current = currentStep.value
  if (disposed || navigationPending.value || !current || index <= 0 || step.value !== index || current.id !== id)
    return
  const epoch = ++navigationEpoch
  navigationPending.value = true
  try {
    if (!(await canPassGuard(current.beforePrev)))
      return
    if (disposed || epoch !== navigationEpoch || step.value !== index || currentStep.value?.id !== id)
      return
    direction.value = 'previous'
    step.value = index - 1
  }
  finally {
    if (epoch === navigationEpoch)
      navigationPending.value = false
  }
}

onBeforeUnmount(() => {
  disposed = true
  navigationEpoch++
})

onMounted(() => {
  trackOnboardingStarted({ entry: 'app_start' })
})
</script>

<template>
  <fieldset :disabled="navigationPending" :aria-busy="navigationPending" :class="['onboarding-step-container', 'min-h-0 min-w-0 flex flex-1 flex-col']">
    <Transition :name="direction === 'next' ? 'slide-next' : 'slide-prev'" mode="out-in">
      <component
        :is="currentStep.component"
        v-if="currentStep"
        :key="currentStep.id"
        :class="['flex flex-1 flex-col']"
        v-bind="currentStepProps"
        :on-next="requestNextStep"
        :on-previous="requestPreviousStep"
      />
    </Transition>
  </fieldset>
</template>

<style scoped>
.slide-next-enter-active,
.slide-next-leave-active,
.slide-prev-enter-active,
.slide-prev-leave-active {
  will-change: transform, opacity;
}

.slide-next-enter-active {
  animation: onboarding-slide-next-in 0.2s ease-in-out both;
}

.slide-next-leave-active {
  animation: onboarding-slide-next-out 0.2s ease-in-out both;
}

.slide-prev-enter-active {
  animation: onboarding-slide-prev-in 0.2s ease-in-out both;
}

.slide-prev-leave-active {
  animation: onboarding-slide-prev-out 0.2s ease-in-out both;
}

@keyframes onboarding-slide-next-in {
  from {
    transform: translateX(2rem);
    opacity: 0;
  }

  to {
    transform: translateX(0);
    opacity: 1;
  }
}

@keyframes onboarding-slide-next-out {
  from {
    transform: translateX(0);
    opacity: 1;
  }

  to {
    transform: translateX(-2rem);
    opacity: 0;
  }
}

@keyframes onboarding-slide-prev-in {
  from {
    transform: translateX(-2rem);
    opacity: 0;
  }

  to {
    transform: translateX(0);
    opacity: 1;
  }
}

@keyframes onboarding-slide-prev-out {
  from {
    transform: translateX(0);
    opacity: 1;
  }

  to {
    transform: translateX(2rem);
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .slide-next-enter-active,
  .slide-next-leave-active,
  .slide-prev-enter-active,
  .slide-prev-leave-active {
    animation-duration: 1ms;
  }
}
</style>
