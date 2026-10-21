import type { Live2DExpressionSettingsCommand } from '@proj-airi/stage-ui-live2d/stores/expression-store'
import type { VrmGesture } from '@proj-airi/stage-ui-three/composables/vrm'
import type { ModelSettingsRuntimeSnapshot } from '@proj-airi/stage-ui/components/scenarios/settings/model-settings/runtime'
import type { MaybeRefOrGetter } from 'vue'

import type { ApplyLive2DExpressionSettingsCommandResponse, ModelSettingsRuntimeContext } from '../../shared/model-settings-runtime'

import { defineInvokeHandler } from '@moeru/eventa'
import { onBeforeUnmount, toValue, watch } from 'vue'

import {
  applyLive2DExpressionSettingsCommand,
  applyVrmGesture,
  getModelSettingsRuntimeContext,
  modelSettingsRuntimeOwnerGone,
  modelSettingsRuntimeSnapshotChanged,
  modelSettingsRuntimeSnapshotRequested,
} from '../../shared/model-settings-runtime'

interface UseModelSettingsRuntimeOwnerOptions {
  ownerInstanceId: string
  renderer: MaybeRefOrGetter<ModelSettingsRuntimeSnapshot['renderer'] | undefined>
  runtimeSnapshot: MaybeRefOrGetter<ModelSettingsRuntimeSnapshot>
  applyLive2DExpressionCommand: (command: Live2DExpressionSettingsCommand) => void
  applyVrmGesture?: (gesture: VrmGesture) => boolean
  context?: ModelSettingsRuntimeContext
}

/**
 * Owns the model-settings channel for the renderer that controls the active model.
 *
 * The owner publishes runtime snapshots and accepts commands for its current owner ID.
 * Commands for stale owners or non-Live2D renderers do not change the expression store.
 */
export function useModelSettingsRuntimeOwner(options: UseModelSettingsRuntimeOwnerOptions) {
  const context = options.context ?? getModelSettingsRuntimeContext()

  function postSnapshot(snapshot: ModelSettingsRuntimeSnapshot) {
    void context.emit(modelSettingsRuntimeSnapshotChanged, snapshot).catch((error) => {
      console.warn('[Model Settings Runtime] Failed to publish the runtime snapshot:', error)
    })
  }

  watch(() => toValue(options.runtimeSnapshot), (snapshot) => {
    postSnapshot(snapshot)
  }, { immediate: true })

  const stopSnapshotRequests = context.on(modelSettingsRuntimeSnapshotRequested, () => {
    postSnapshot(toValue(options.runtimeSnapshot))
  })
  const stopExpressionCommands = defineInvokeHandler(context, applyLive2DExpressionSettingsCommand, (request) => {
    const currentSnapshot = toValue(options.runtimeSnapshot)
    if (request.ownerInstanceId !== options.ownerInstanceId) {
      return {
        applied: false,
        snapshot: currentSnapshot,
        rejectionReason: 'owner-changed',
      }
    }

    if (!request.modelId || request.modelId !== currentSnapshot.modelId) {
      return {
        applied: false,
        snapshot: currentSnapshot,
        rejectionReason: 'model-changed',
      }
    }

    if (toValue(options.renderer) !== 'live2d' || currentSnapshot.controlsLocked) {
      return {
        applied: false,
        snapshot: currentSnapshot,
        rejectionReason: 'runtime-unavailable',
      }
    }

    options.applyLive2DExpressionCommand(request.command)
    return {
      applied: true,
      snapshot: toValue(options.runtimeSnapshot),
    }
  })

  const stopGestureCommands = defineInvokeHandler(context, applyVrmGesture, (request): ApplyLive2DExpressionSettingsCommandResponse => {
    const snapshot = toValue(options.runtimeSnapshot)
    if (request.ownerInstanceId !== options.ownerInstanceId)
      return { applied: false, snapshot, rejectionReason: 'owner-changed' }
    if (!request.modelId || request.modelId !== snapshot.modelId)
      return { applied: false, snapshot, rejectionReason: 'model-changed' }
    if (toValue(options.renderer) !== 'vrm' || snapshot.phase !== 'mounted' || snapshot.controlsLocked)
      return { applied: false, snapshot, rejectionReason: 'runtime-unavailable' }
    if (!['wave', 'nod', 'stop'].includes(request.gesture))
      return { applied: false, snapshot, rejectionReason: 'runtime-unavailable' }

    const applied = options.applyVrmGesture?.(request.gesture) ?? false
    return { applied, snapshot, rejectionReason: applied ? undefined : 'runtime-unavailable' }
  })

  onBeforeUnmount(() => {
    stopSnapshotRequests()
    stopExpressionCommands()
    stopGestureCommands()
    void context.emit(modelSettingsRuntimeOwnerGone, {
      ownerInstanceId: options.ownerInstanceId,
    }).catch((error) => {
      console.warn('[Model Settings Runtime] Failed to publish owner shutdown:', error)
    })
  })
}
