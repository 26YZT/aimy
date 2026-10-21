import { getElectronEventaContext } from '@proj-airi/electron-vueuse'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'

import { createBaselineRendererFetch } from './baseline-renderer-fetch'
import { installAcceptanceDriver } from './driver-common'

installAcceptanceDriver({
  arm: 'airi',
  ready: () => true,
  async configure(info, restoring) {
    const config = useProviderConfigStore()
    const previous = config.getProvider(info.providerInstanceId)
    if (restoring && (!previous || previous.definitionId !== 'deepseek' || previous.config.baseUrl !== info.baseURL || previous.config.model !== info.modelId
      || previous.config.apiKey !== 'offline-transport-placeholder')) {
      throw new Error('ACCEPTANCE_PROVIDER_NOT_RESTORED')
    }
    // Original AIRI receives only a deliberately unusable placeholder credential.
    if (!previous && !restoring)
      await config.ensureProvider(info.providerInstanceId, 'deepseek', { baseUrl: info.baseURL, apiKey: 'offline-transport-placeholder', model: info.modelId })
    const consciousness = useConsciousnessStore()
    const original = consciousness.getChatProviderInstance.bind(consciousness)
    const transport = createBaselineRendererFetch(getElectronEventaContext(), () => info.epoch)
    consciousness.getChatProviderInstance = async (id) => {
      const provider = await original(id)
      if (!provider || id !== info.providerInstanceId)
        throw new Error('ACCEPTANCE_PROVIDER_MISMATCH')
      return { ...provider, generation(model) {
        const route = provider.generation(model)
        return { ...route, config: { ...route.config, fetch: transport } }
      } }
    }
  },
  async idle() {},
  async memory() { return { implemented: false, source: 'original-airi' } },
})
