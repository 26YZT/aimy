import type { CaptureKind, ResourceSnapshot } from '@proj-airi/stage-ui/services/resource-policy'

import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

export interface ShutdownRequest { shutdownId: string, deadline: number, scope: 'window' | 'application', phase: 'prepare' | 'finalize' }
export interface ShutdownReceipt { shutdownId: string, phase: 'prepare' | 'finalize', stopped: boolean, persisted: boolean, failed: string[] }

export const resourceSnapshot = defineInvokeEventa<ResourceSnapshot>('eventa:invoke:aimy:resource:snapshot')
export const resourceSetEnabled = defineInvokeEventa<ResourceSnapshot, { kind: CaptureKind, enabled: boolean, appEpoch: number }>('eventa:invoke:aimy:resource:set-enabled')
export const resourceChanged = defineEventa<ResourceSnapshot>('eventa:event:aimy:resource:changed')
export const shutdownRequested = defineEventa<ShutdownRequest>('eventa:event:aimy:shutdown:requested')
export const shutdownCompleted = defineInvokeEventa<void, ShutdownReceipt>('eventa:invoke:aimy:shutdown:completed')
export const windowCloseAborted = defineEventa<{ shutdownId: string, reason: 'persistence-incomplete' }>('eventa:event:aimy:window-close:aborted')
