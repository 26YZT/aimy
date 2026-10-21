import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useVisionOrchestratorStore } from './orchestrator'
import { useVisionStore } from './store'

const sendContextUpdate = vi.fn()
const runVisionInference = vi.fn()

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('../../../composables/vision', () => ({
  useVisionInference: () => ({
    lastText: { value: '' },
    runVisionInference,
  }),
}))

vi.mock('../../../composables/vision/use-vision-workloads', () => ({
  getVisionWorkload: (id: string) => ({
    id,
    label: `Workload ${id}`,
  }),
}))

vi.mock('../../mods/api/channel-server', () => ({
  useModsServerChannelStore: () => ({
    sendContextUpdate,
  }),
}))

describe('vision orchestrator', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    sendContextUpdate.mockReset()
    runVisionInference.mockReset()
    runVisionInference.mockResolvedValue('Frame summary')

    const visionStore = useVisionStore()
    visionStore.activeProvider = 'mock-provider'
    visionStore.activeModel = 'mock-model'
  })

  it('reuses a stable context id for repeated ReplaceSelf updates from the same source', async () => {
    const store = useVisionOrchestratorStore()

    await store.processCapture({
      imageDataUrl: 'data:image/jpeg;base64,first',
      workloadId: 'screen:interpret',
      sourceId: 'screen:0:0',
      publishContext: true,
    })

    await store.processCapture({
      imageDataUrl: 'data:image/jpeg;base64,second',
      workloadId: 'screen:interpret',
      sourceId: 'screen:0:0',
      publishContext: true,
    })

    expect(sendContextUpdate).toHaveBeenCalledTimes(2)
    expect(sendContextUpdate.mock.calls[0]?.[0].content).toEqual([{ type: 'text', text: 'Frame summary' }])
    expect(JSON.stringify(sendContextUpdate.mock.calls)).not.toContain('data:image/')
    expect(sendContextUpdate.mock.calls[0]?.[0]).toMatchObject({
      contextId: 'vision:screen:interpret:screen:0:0',
    })
    expect(sendContextUpdate.mock.calls[1]?.[0]).toMatchObject({
      contextId: 'vision:screen:interpret:screen:0:0',
    })
  })

  it('partitions context ids by workload when no source id is available', async () => {
    const store = useVisionOrchestratorStore()

    await store.processCapture({
      imageDataUrl: 'data:image/jpeg;base64,first',
      workloadId: 'screen:interpret',
      publishContext: true,
    })

    await store.processCapture({
      imageDataUrl: 'data:image/jpeg;base64,second',
      workloadId: 'screen:understand',
      publishContext: true,
    })

    expect(sendContextUpdate.mock.calls[0]?.[0]).toMatchObject({
      contextId: 'vision:screen:interpret',
    })
    expect(sendContextUpdate.mock.calls[1]?.[0]).toMatchObject({
      contextId: 'vision:screen:understand',
    })
  })

  it('records inference failures on the store before rethrowing', async () => {
    const store = useVisionOrchestratorStore()
    runVisionInference.mockRejectedValueOnce(new Error('Vision inference failed'))

    await expect(store.processCapture({
      imageDataUrl: 'data:image/jpeg;base64,broken',
      workloadId: 'screen:interpret',
    })).rejects.toThrow('Vision inference failed')

    expect(store.lastError).toBe('Vision inference failed')
  })

  it('drops a late model result after its screen stream stops without publishing context', async () => {
    const store = useVisionOrchestratorStore()
    const response = Promise.withResolvers<string>()
    runVisionInference.mockReturnValueOnce(response.promise)
    const capture = new AbortController()
    const result = store.processCapture({
      imageDataUrl: 'data:image/jpeg;base64,synthetic',
      workloadId: 'screen:interpret',
      publishContext: true,
      abortSignal: capture.signal,
    })
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    capture.abort(new DOMException('Source stopped', 'AbortError'))
    response.resolve('Late frame summary')
    await rejected
    expect(sendContextUpdate).not.toHaveBeenCalled()
    expect(store.lastResultText).toBe('')
    expect(store.lastError).toBeNull()
  })

  it('does not start inference for a source that was already stopped', async () => {
    const store = useVisionOrchestratorStore()
    const capture = new AbortController()
    capture.abort(new DOMException('Source stopped', 'AbortError'))
    await expect(store.processCapture({
      imageDataUrl: 'data:image/jpeg;base64,synthetic',
      workloadId: 'screen:interpret',
      abortSignal: capture.signal,
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(runVisionInference).not.toHaveBeenCalled()
  })
})
