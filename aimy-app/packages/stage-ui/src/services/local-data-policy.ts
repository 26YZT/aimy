let localOnly = false
const listeners = new Set<() => void>()

/**
 * Disables account replicas for this renderer before stores initialize.
 * The policy cannot be reversed during the process lifetime. Model requests remain separate.
 */
export function configureLocalOnly(): void {
  if (localOnly)
    return
  localOnly = true
  for (const listener of listeners)
    listener()
}

/** Unconfigured hosts retain AIRI's existing account replica behavior. */
export function isCloudReplicaEnabled(): boolean {
  return !localOnly
}

/** Call immediately before each account replica transport attempt, including retries. */
export function assertCloudReplicaAllowed(): void {
  if (localOnly)
    throw new Error('Cloud replicas are disabled by the local data policy')
}

/** Active transports use this notification to close sockets and pending retry schedules. */
export function onLocalDataPolicyChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
