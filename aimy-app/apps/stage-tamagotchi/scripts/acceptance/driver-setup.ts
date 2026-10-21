import type { SetupStage } from './entry-events'

import { defineInvoke } from '@moeru/eventa'
import { getElectronEventaContext } from '@proj-airi/electron-vueuse'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useMemoryStore } from '@proj-airi/stage-ui/stores/memory'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useOnboardingStore } from '@proj-airi/stage-ui/stores/onboarding'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { watch } from 'vue'

import { electronOpenSettings } from '../../src/shared/eventa'
import { requireLeader, waitForIdle } from './driver-common'
import { acceptanceInfo, acceptanceSetupInvalidate, acceptanceSetupRecord, acceptanceSetupUi } from './entry-events'

let setupStage: SetupStage = 'startup'

/** The setup window edits an ordinary provider. Only committed public metadata reaches this observer. */
async function initializeSetup() {
  await waitForIdle(() => {
    try {
      requireLeader()
      return useChatSessionStore().isReady && !!useAiriCardStore().activeCard
    }
    catch { return false }
  }, 'ACCEPTANCE_SETUP_NOT_READY')
  setupStage = 'host-info'
  const context = getElectronEventaContext()
  const result = await defineInvoke(context, acceptanceInfo)()
  if (!result.ok || result.value.phase !== 'setup')
    return
  const info = result.value
  if (info.providerInstanceId !== 'acceptance-deepseek')
    throw new Error('ACCEPTANCE_SETUP_PROVIDER_MISMATCH')
  setupStage = 'memory-pause'
  const memory = useMemoryStore()
  memory.suspendWork()
  // Credential configuration does not wait for an unrelated memory ownership recovery.
  const stopMemory = watch(() => memory.ready, (ready) => {
    if (ready && memory.enabled)
      void memory.setEnabled(false).catch(() => {})
  }, { immediate: true })
  setupStage = 'onboarding'
  await useOnboardingStore().markSetupSkipped()
  setupStage = 'provider-defaults'
  const configs = useProviderConfigStore()
  await configs.ensureProvider(info.providerInstanceId, 'deepseek', { baseUrl: info.baseURL, model: info.modelId, thinkingMode: 'disable' })
  setupStage = 'provider-observer'
  let queued = Promise.resolve()
  const stop = watch(() => configs.getProviderConfigRevision(info.providerInstanceId), () => {
    queued = queued.catch(() => {}).then(async () => {
      const provider = configs.getProvider(info.providerInstanceId)
      if (!provider)
        return
      const configurationRevision = configs.getProviderConfigRevision(info.providerInstanceId)
      const reference = provider.secretReference
      const correct = provider.definitionId === 'deepseek' && provider.config.baseUrl === info.baseURL
        && provider.config.model === info.modelId && provider.config.thinkingMode === 'disable'
      if (!correct || !reference) {
        await defineInvoke(context, acceptanceSetupInvalidate)({ configurationRevision })
        return
      }
      await defineInvoke(context, acceptanceSetupRecord)({
        providerId: 'acceptance-deepseek',
        definitionId: 'deepseek',
        baseUrl: 'https://api.deepseek.com/',
        modelId: 'deepseek-flash',
        thinkingMode: 'disable',
        configurationRevision,
        secretReference: { secretRef: reference.secretRef, revision: reference.revision },
      })
    })
    void queued.catch(() => {})
  }, { immediate: true })
  window.addEventListener('pagehide', stop, { once: true })
  window.addEventListener('pagehide', stopMemory, { once: true })
  setupStage = 'open-settings'
  await defineInvoke(context, electronOpenSettings)({ route: `/settings/providers/chat/${info.providerInstanceId}` })
  await defineInvoke(context, acceptanceSetupUi)({ state: 'page-opened', stage: 'ready' })
}

// This file is bundled only into a marked test build. Follower windows do not become setup owners.
void initializeSetup().catch(() => {
  try {
    requireLeader()
    void defineInvoke(getElectronEventaContext(), acceptanceSetupUi)({ state: 'failed', stage: setupStage }).catch(() => {})
  }
  catch { /* Follower windows do not report a setup-owner failure. */ }
})
