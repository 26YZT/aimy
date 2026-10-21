import type { ShutdownParticipant } from './persistence-drain'

import { defineInvoke } from '@moeru/eventa'
import { getElectronEventaContext } from '@proj-airi/electron-vueuse'
import { installResourcePolicy, ResourcePolicy } from '@proj-airi/stage-ui/services/resource-policy'

import { resourceChanged, resourceSetEnabled, resourceSnapshot, shutdownCompleted, shutdownRequested, windowCloseAborted } from '../../shared/eventa/aimy-lifecycle'
import { WindowShutdownCoordinator } from './persistence-drain'

const participants = new Set<ShutdownParticipant>()
const closeFailureListeners = new Set<() => void>()
let installed = false

/** Notifies only this window after a matching failed close handshake. */
export function onDesktopCloseFailure(listener: () => void) {
  closeFailureListeners.add(listener)
  return () => closeFailureListeners.delete(listener)
}

/** Registers existing owners for shutdown. Each owner reports failure instead of claiming a successful flush. */
export function registerDesktopShutdownParticipant(participant: ShutdownParticipant): () => void {
  participants.add(participant)
  return () => participants.delete(participant)
}

/** Installs the host policy before Pinia and capture consumers. Initialization stays denied until the host responds. */
export function installDesktopResourcePolicy(): void {
  if (installed)
    return
  installed = true
  const context = getElectronEventaContext()
  const coordinator = new WindowShutdownCoordinator(participants)
  const setEnabled = defineInvoke(context, resourceSetEnabled)
  const policy = new ResourcePolicy({ setEnabled: (kind, enabled, appEpoch) => setEnabled({ kind, enabled, appEpoch }) })
  let activeWindowCloseId: string | undefined
  installResourcePolicy(policy)
  context.on(resourceChanged, event => event?.body && policy.apply(event.body))
  context.on(windowCloseAborted, (event) => {
    if (!activeWindowCloseId || event?.body?.shutdownId !== activeWindowCloseId)
      return
    coordinator.abort(activeWindowCloseId)
    activeWindowCloseId = undefined
    policy.resumeAfterCloseFailure()
    for (const listener of closeFailureListeners)
      listener()
  })
  const getSnapshot = defineInvoke(context, resourceSnapshot)
  void getSnapshot().then(snapshot => policy.apply(snapshot)).catch(() => policy.stopLocal('host-unavailable'))
  context.on(shutdownRequested, async (event) => {
    const request = event?.body
    if (!request)
      return
    if (request.phase === 'prepare') {
      activeWindowCloseId = request.scope === 'window' ? request.shutdownId : undefined
      policy.stopLocal(request.scope === 'window' ? 'window-close' : 'quit')
    }
    const receipt = await coordinator.run(request)
    const acknowledge = defineInvoke(context, shutdownCompleted)
    // A missing host or lost acknowledgement is reported by the host deadline.
    await acknowledge(receipt).catch(() => {})
  })
}
