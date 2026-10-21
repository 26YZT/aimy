import { configureAcceptanceGeneration, flushAcceptanceGeneration } from '@proj-airi/stage-ui/services/acceptance-generation'
import { readMemoryAcceptanceDiagnostics } from '@proj-airi/stage-ui/services/memory-acceptance-diagnostics'
import { useMemoryStore } from '@proj-airi/stage-ui/stores/memory'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'

import { installAcceptanceDriver, waitForIdle } from './driver-common'

import './driver-setup'

installAcceptanceDriver({
  arm: 'aimy',
  ready: () => useMemoryStore().ready && !useMemoryStore().recovering,
  async configure(info, restoring) {
    const config = useProviderConfigStore()
    const previous = config.getProvider(info.providerInstanceId)
    if (restoring && (!previous || previous.definitionId !== 'deepseek' || previous.config.baseUrl !== info.baseURL || previous.config.model !== info.modelId
      || previous.secretReference?.secretRef !== info.reference.secretRef || previous.secretReference.revision !== info.reference.revision)) {
      throw new Error('ACCEPTANCE_PROVIDER_NOT_RESTORED')
    }
    if (!previous && !restoring) {
      await config.commitPreparedConfiguration({ providerId: info.providerInstanceId, definitionId: 'deepseek', config: { baseUrl: info.baseURL, model: info.modelId }, secretReference: info.reference, expectedRevision: undefined, status: 'configured', added: true })
    }
    configureAcceptanceGeneration(info.campaign, { arm: 'aimy', caseId: info.caseId, runId: info.runId })
  },
  async idle() {
    const memory = useMemoryStore()
    await waitForIdle(() => memory.ready && !memory.recovering && memory.pendingJobCount === 0 && !memory.busy, 'ACCEPTANCE_MEMORY_TIMEOUT')
    await memory.flush()
    await flushAcceptanceGeneration()
    if (memory.failedJobCount > 0)
      throw new Error('ACCEPTANCE_MEMORY_JOB_FAILED')
  },
  async memory() {
    const memory = useMemoryStore()
    return { implemented: true, metadata: await readMemoryAcceptanceDiagnostics(memory, { expectedScope: memory.scope ?? undefined }), facts: await memory.listMemory({ stateFilter: 'current' }) }
  },
})
