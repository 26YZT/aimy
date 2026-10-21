<script setup lang="ts">
import type { ProviderMetadata } from '../../../../libs/providers/metadata'
import type { OnboardingStepNextHandler, OnboardingStepPrevHandler } from './types'

import { Button, Callout, FieldCheckbox, FieldInput, ScrollableArea } from '@proj-airi/ui'
import { computedAsync } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { getAcceptanceBudget } from '../../../../stores/memory/budget'
import { useProviderConfigStore } from '../../../../stores/providers/config'
import { useProviderStore } from '../../../../stores/providers/provider'
import { Alert } from '../../../misc'
import { ProviderAccountIdInput } from '../../../scenarios/providers'

interface Props {
  selectedProviderId: string
  selectedProvider: ProviderMetadata | null
  onNext: OnboardingStepNextHandler
  onPrevious: OnboardingStepPrevHandler
}

const props = defineProps<Props>()
const { t } = useI18n()
const providersStore = useProviderStore()
const providerConfigStore = useProviderConfigStore()

const apiKey = ref('')
const baseUrl = ref('')
const accountId = ref('')
const acceptanceMode = !!getAcceptanceBudget()
const enableChatCheck = ref(!acceptanceMode)
const customFieldValues = ref<Record<string, string>>({})

const validation = ref<'unchecked' | 'pending' | 'succeed' | 'failed'>('unchecked')
const validationError = ref<string>()
const submitting = ref(false)

const hasSavedSecret = computed(() => Boolean(providerConfigStore.getProvider(props.selectedProviderId)?.secretReference))
const hasOnboardingFields = computed(() => (props.selectedProvider?.onboardingFields?.length ?? 0) > 0)

// Initialize form with default values when provider changes, rehydrating from
// the configuration saved on a previous visit to this step (for example after
// going back from model selection) so step navigation does not wipe user input
function initializeForm() {
  const provider = props.selectedProvider
  if (!provider)
    return

  const defaultOptions = provider.defaultConfig
  const defaultBaseUrl = ('baseUrl' in defaultOptions ? String(defaultOptions.baseUrl) : '') || ''
  const savedConfig = providerConfigStore.getProviderConfig(provider.id)
  const savedBaseUrl = typeof savedConfig?.baseUrl === 'string' ? savedConfig.baseUrl : ''
  const savedApiKey = typeof savedConfig?.apiKey === 'string' ? savedConfig.apiKey : ''
  const savedAccountId = typeof savedConfig?.accountId === 'string' ? savedConfig.accountId : ''

  baseUrl.value = savedBaseUrl || defaultBaseUrl
  apiKey.value = savedApiKey
  accountId.value = savedAccountId

  // Initialize custom fields with their saved or default values
  const fields: Record<string, string> = {}
  for (const field of provider.onboardingFields ?? []) {
    const savedValue = savedConfig?.[field.key]
    fields[field.key] = typeof savedValue === 'string' ? savedValue : (field.defaultValue ?? '')
  }
  customFieldValues.value = fields

  // Reset validation and chat check
  validation.value = 'unchecked'
  validationError.value = undefined
  enableChatCheck.value = !acceptanceMode
}

// Watch for provider changes
watch(() => props.selectedProvider?.id, initializeForm)

watch([apiKey, baseUrl, accountId, customFieldValues], () => {
  if (validation.value === 'failed' || validation.value === 'succeed') {
    validation.value = 'unchecked'
    validationError.value = undefined
  }
}, { deep: true })

// Computed properties
const needsApiKey = computed(() => {
  if (!props.selectedProvider)
    return false
  // Providers with custom onboarding fields handle their own auth
  if (hasOnboardingFields.value)
    return false
  return props.selectedProvider.id !== 'ollama' && props.selectedProvider.id !== 'player2'
})

const needsBaseUrl = computed(() => {
  if (!props.selectedProvider)
    return false
  // Providers with custom onboarding fields handle their own endpoints
  if (hasOnboardingFields.value)
    return false
  return props.selectedProvider.id !== 'cloudflare-workers-ai'
})

const showChatCheckOption = computedAsync(
  async () => !acceptanceMode && props.selectedProvider
    ? await providersStore.hasManualProviderValidators(props.selectedProvider.id)
    : false,
  false,
)

const canProceed = computed(() => {
  if (!props.selectedProviderId)
    return false

  if (hasOnboardingFields.value) {
    const fields = props.selectedProvider?.onboardingFields ?? []
    for (const field of fields) {
      if (field.required && !customFieldValues.value[field.key]?.trim() && (field.type !== 'password' || !hasSavedSecret.value))
        return false
    }
  }
  else if (needsApiKey.value && !apiKey.value.trim() && !hasSavedSecret.value) {
    return false
  }

  return !submitting.value && validation.value !== 'pending'
})

const primaryActionLabel = computed(() => {
  return validation.value === 'failed'
    ? t('settings.dialogs.onboarding.retry')
    : t('settings.dialogs.onboarding.next')
})

async function validateConfiguration() {
  if (!props.selectedProvider)
    return

  validation.value = 'pending'
  validationError.value = undefined

  try {
    // Prepare config object
    const config: Record<string, unknown> = {}

    if (hasOnboardingFields.value) {
      for (const [key, value] of Object.entries(customFieldValues.value)) {
        if (value)
          config[key] = value.trim()
      }
    }
    else {
      if (needsApiKey.value && apiKey.value.trim())
        config.apiKey = apiKey.value.trim()
      if (needsBaseUrl.value)
        config.baseUrl = baseUrl.value.trim()
      if (props.selectedProvider.id === 'cloudflare-workers-ai')
        config.accountId = accountId.value.trim()
    }

    // Validate using provider's validator
    const validationResult = await providersStore.validateProviderConfig(props.selectedProvider.id, config, {
      skipChatPingCheck: !enableChatCheck.value,
    })
    validation.value = validationResult.valid ? 'succeed' : 'failed'
    if (validation.value === 'failed') {
      validationError.value = t('settings.dialogs.onboarding.saveFailed')
    }
  }
  catch {
    validation.value = 'failed'
    validationError.value = t('settings.dialogs.onboarding.saveFailed')
  }
}
async function submitConfiguration(validate: boolean) {
  if (submitting.value || !props.selectedProvider)
    return
  const providerId = props.selectedProviderId
  submitting.value = true
  validationError.value = undefined
  try {
    if (validate) {
      await validateConfiguration()
      if (validation.value !== 'succeed')
        return
    }
    if (props.selectedProviderId !== providerId)
      return
    await props.onNext({
      apiKey: apiKey.value,
      baseUrl: baseUrl.value,
      accountId: accountId.value,
      customFields: hasOnboardingFields.value ? { ...customFieldValues.value } : undefined,
    })
  }
  catch {
    validation.value = 'failed'
    validationError.value = t('settings.dialogs.onboarding.saveFailed')
  }
  finally {
    submitting.value = false
  }
}

// Placeholder helpers
function getApiKeyPlaceholder(providerId: string): string {
  const placeholders: Record<string, string> = {
    'openai': 'sk-...',
    'azure-openai': 'Azure OpenAI API Key',
    'anthropic': 'sk-ant-...',
    'google-generative-ai': 'AI...',
    'openrouter-ai': 'sk-or-...',
    'deepseek': 'sk-...',
    'xai': 'xai-...',
    'together-ai': 'togetherapi-...',
    'mistral-ai': 'mis-...',
    'moonshot-ai': 'ms-...',
    'modelscope': 'ms-...',
    'fireworks-ai': 'fw-...',
    'featherless-ai': 'fw-...',
    'nvidia': 'nvapi-...',
    'novita-ai': 'nvt-...',
  }

  return placeholders[providerId] || 'API Key'
}

function getBaseUrlPlaceholder(_providerId: string): string {
  const defaultOptions = props.selectedProvider?.defaultConfig ?? {}
  return typeof defaultOptions.baseUrl === 'string' && defaultOptions.baseUrl
    ? defaultOptions.baseUrl
    : 'https://api.example.com/v1/'
}

// Initialize on mount
initializeForm()
</script>

<template>
  <fieldset :disabled="submitting" :aria-busy="submitting" :class="['h-full min-w-0 flex flex-col gap-4']">
    <div :class="['sticky top-0 z-100 flex flex-shrink-0 items-center gap-2']">
      <Button size="sm" :disabled="submitting" :aria-label="t('settings.pages.memory.actions.previous')" @click="props.onPrevious">
        <div :class="['i-solar:alt-arrow-left-line-duotone h-5 w-5']" />
      </Button>
      <h2 :class="['flex-1 text-center text-xl font-semibold md:text-left md:text-2xl', 'text-neutral-800 dark:text-neutral-100']">
        {{ t('settings.dialogs.onboarding.configureProvider', { provider: props.selectedProvider?.localizedName }) }}
      </h2>
      <div :class="['h-5 w-5']" />
    </div>
    <ScrollableArea v-if="props.selectedProvider" :class="['min-h-0 flex-1']">
      <div :class="['space-y-4']">
        <Callout :label="t('settings.dialogs.onboarding.credentialsSafeLabel')" theme="violet">
          <div>
            <div>
              {{ t('settings.dialogs.onboarding.credentialsSafeLocal') }}
            </div>
            <div>
              <i18n-t keypath="settings.dialogs.onboarding.credentialsSafeOpenSource" tag="span">
                <template #github>
                  <span :class="['inline-flex translate-y-1 items-center gap-1']">
                    <span :class="['i-simple-icons:github inline-block']" /><a :class="['underline decoration-dashed']" href="https://github.com/moeru-ai/airi" target="_blank" rel="noopener noreferrer">GitHub</a>
                  </span>
                </template>
              </i18n-t>
            </div>
          </div>
        </Callout>
        <div :class="['space-y-4']">
          <!-- Custom onboarding fields (provider-specific, e.g. Amazon Bedrock SigV4) -->
          <template v-if="hasOnboardingFields">
            <FieldInput
              v-for="field in props.selectedProvider.onboardingFields"
              :key="field.key"
              v-model="customFieldValues[field.key]"
              :type="field.type"
              :label="field.label"
              :description="field.description"
              :placeholder="field.placeholder || ''"
              :required="field.required"
            />
          </template>

          <!-- Standard fields for other providers -->
          <template v-else>
            <!-- API Key Input -->
            <div v-if="needsApiKey">
              <FieldInput
                v-model="apiKey"
                :placeholder="hasSavedSecret ? t('settings.dialogs.onboarding.storedCredential') : getApiKeyPlaceholder(props.selectedProvider.id)"
                type="password"
                label="API Key"
                :description="t(hasSavedSecret ? 'settings.dialogs.onboarding.storedCredentialHint' : 'settings.dialogs.onboarding.apiKeyDescription')"
                required
              />
            </div>

            <!-- Base URL Input -->
            <div v-if="needsBaseUrl">
              <FieldInput
                v-model="baseUrl"
                :placeholder="getBaseUrlPlaceholder(props.selectedProvider.id)"
                type="text"
                label="Base URL"
                :description="t('settings.dialogs.onboarding.baseUrlDescription')"
              />
            </div>

            <!-- Account ID for Cloudflare -->
            <div v-if="props.selectedProvider.id === 'cloudflare-workers-ai'">
              <ProviderAccountIdInput v-model="accountId" />
            </div>
          </template>
        </div>

        <!-- Chat Ping Check Option -->
        <p v-if="acceptanceMode" :class="['text-sm text-neutral-600 dark:text-neutral-400']">
          {{ t('settings.dialogs.onboarding.acceptanceTextOnly') }}
        </p>
        <FieldCheckbox
          v-if="showChatCheckOption"
          v-model="enableChatCheck"
          :label="t('settings.dialogs.onboarding.enableChatCheck')"
          placement="left"
        />

        <!-- Validation Status -->
        <Alert v-if="validation === 'failed'" type="error">
          <template #title>
            <div :class="['w-full flex items-center justify-between']">
              <span>{{ t('settings.dialogs.onboarding.validationFailed') }}</span>
              <button
                type="button"
                :class="['ml-2 rounded px-2 py-0.5 text-xs font-medium transition-colors', 'bg-red-100 text-red-600 dark:bg-red-800/30 hover:bg-red-200 dark:text-red-300 dark:hover:bg-red-700/40']"
                @click="submitConfiguration(false)"
              >
                {{ t('settings.pages.providers.common.continueAnyway') }}
              </button>
            </div>
          </template>
          <template v-if="validationError" #content>
            <pre :class="['whitespace-pre-wrap break-all']">{{ String(validationError) }}</pre>
          </template>
        </Alert>
      </div>
    </ScrollableArea>

    <!-- Action Buttons -->
    <Button
      :label="primaryActionLabel"
      :loading="submitting"
      :disabled="!canProceed"
      @click="submitConfiguration(true)"
    />
  </fieldset>
</template>
