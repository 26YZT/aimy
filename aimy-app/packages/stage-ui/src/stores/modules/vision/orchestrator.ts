import type { VisionWorkloadId } from '../../../composables/vision/use-vision-workloads'

import { errorMessageFrom } from '@moeru/std'
import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { defineStore, storeToRefs } from 'pinia'
import { onScopeDispose, ref } from 'vue'

import { useVisionInference } from '../../../composables/vision'
import { getVisionWorkload } from '../../../composables/vision/use-vision-workloads'
import { getResourcePolicy, onResourceRevoked } from '../../../services/resource-policy'
import { useModsServerChannelStore } from '../../mods/api/channel-server'
import { useVisionStore } from './store'

/**
 * Payload describing one captured frame routed through the vision orchestrator.
 */
export interface VisionCapturePayload {
  /** JPEG or PNG data URL captured from the selected source. */
  imageDataUrl: string
  /** Vision workload that describes how the frame should be interpreted. */
  workloadId: VisionWorkloadId
  /** Optional source identifier used to keep context updates stable per source. */
  sourceId?: string
  /** Timestamp recorded when the frame was captured. */
  capturedAt?: number
  /** When `true`, publish the inference result into the character context channel. */
  publishContext?: boolean
  /** The desktop game mode supplies a bounded observation prompt. */
  promptOverride?: string
  /** Cancels work when its source stream stops or changes, independently of other screen consumers. */
  abortSignal?: AbortSignal
}

function getVisionContextId(payload: Pick<VisionCapturePayload, 'workloadId' | 'sourceId'>) {
  return payload.sourceId
    ? `vision:${payload.workloadId}:${payload.sourceId}`
    : `vision:${payload.workloadId}`
}

/**
 * Coordinates screen-capture inference and optional context publishing for vision workflows.
 *
 * Use when:
 * - A renderer page captures frames and needs multimodal inference results
 * - Successful results may also need to become context updates for downstream modules
 *
 * Expects:
 * - The vision settings store to already contain an active provider and model
 *
 * Returns:
 * - A Pinia store that tracks the latest result, last error, and capture-processing actions
 */
export const useVisionOrchestratorStore = defineStore('vision-orchestrator', () => {
  const visionStore = useVisionStore()
  const { activeProvider, activeModel } = storeToRefs(visionStore)
  const modsServerChannelStore = useModsServerChannelStore()
  const { runVisionInference, lastText } = useVisionInference()

  const lastResultText = ref('')
  const lastResultAt = ref<number | null>(null)
  const lastError = ref<string | null>(null)
  const lastWorkloadId = ref<VisionWorkloadId>('screen:interpret')
  onScopeDispose(onResourceRevoked((_, kind) => {
    if (!kind || kind === 'screen') {
      lastText.value = ''
      lastResultText.value = ''
      lastResultAt.value = null
    }
  }))

  async function processCapture(payload: VisionCapturePayload) {
    if (!activeProvider.value || !activeModel.value) {
      const configurationError = new Error('Vision model is not configured')
      recordError(configurationError)
      throw configurationError
    }

    lastWorkloadId.value = payload.workloadId

    const lease = getResourcePolicy()?.acquire('screen')
    const abortSignal = payload.abortSignal && lease
      ? AbortSignal.any([payload.abortSignal, lease.signal])
      : payload.abortSignal ?? lease?.signal
    const assertCurrent = () => {
      abortSignal?.throwIfAborted()
      lease?.assertCurrent()
    }
    try {
      assertCurrent()
      const text = await runVisionInference({
        imageDataUrl: payload.imageDataUrl,
        workloadId: payload.workloadId,
        promptOverride: payload.promptOverride,
        abortSignal,
        assertCurrent,
      })
      assertCurrent()

      lastResultText.value = text
      lastResultAt.value = Date.now()
      lastError.value = null

      if (payload.publishContext) {
        const workload = getVisionWorkload(payload.workloadId)

        modsServerChannelStore.sendContextUpdate({
          strategy: ContextUpdateStrategy.ReplaceSelf,
          contextId: getVisionContextId(payload),
          text,
          content: [{ type: 'text', text }],
          metadata: {
            module: 'vision',
            workload: workload.id,
            workloadLabel: workload.label,
            sourceId: payload.sourceId,
            capturedAt: payload.capturedAt,
            provider: activeProvider.value,
            model: activeModel.value,
          },
        })
        return { contextUpdates: 1, text }
      }

      return { contextUpdates: 0, text }
    }
    catch (error) {
      if (!abortSignal?.aborted)
        recordError(error)
      throw error
    }
    finally {
      lease?.release()
    }
  }

  function recordError(error: unknown) {
    lastError.value = errorMessageFrom(error) ?? 'Unknown error'
  }

  return {
    lastText,
    lastResultText,
    lastResultAt,
    lastError,
    lastWorkloadId,
    processCapture,
    recordError,
  }
})
