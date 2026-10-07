/** The two user-controlled observation inputs. This gate grants no system permission. */
export type CaptureKind = 'screen' | 'mic'

/** A request may publish only while its original user grant is still current. */
export interface CaptureLease {
  readonly signal: AbortSignal
  /** Complete asynchronous inference first; this callback must commit synchronously. */
  publish: (commit: () => undefined) => boolean
  finish: () => void
}

/**
 * Keeps capture cancellation and late-result rejection under deterministic control.
 * Capture/device/provider adapters must use the lease signal and publish through the lease.
 * Hiding the character revokes both grants; showing it again never restarts capture by itself.
 */
export function createPerceptionGate(options: { onRevoke?: (kind: CaptureKind) => void } = {}) {
  const grants: Record<CaptureKind, boolean> = { screen: false, mic: false }
  const pending: Record<CaptureKind, Set<AbortController>> = { screen: new Set(), mic: new Set() }
  let visible = true

  function isAllowed(kind: CaptureKind) {
    return visible && grants[kind]
  }

  function revoke(kind: CaptureKind) {
    const wasGranted = grants[kind]
    grants[kind] = false
    const requests = [...pending[kind]]
    pending[kind].clear()
    for (const request of requests)
      request.abort(new DOMException('Observation permission revoked', 'AbortError'))
    // The permission is already denied even if a device's cleanup callback fails.
    if (wasGranted || requests.length)
      options.onRevoke?.(kind)
  }

  function setVisible(value: boolean) {
    visible = value
    if (!value) {
      let failure: unknown
      for (const kind of ['screen', 'mic'] as const) {
        try { revoke(kind) }
        catch (error) { failure ??= error }
      }
      if (failure !== undefined)
        throw failure
    }
  }

  function begin(kind: CaptureKind): CaptureLease {
    if (!isAllowed(kind))
      throw new Error('Observation permission is disabled')
    const controller = new AbortController()
    pending[kind].add(controller)
    let finished = false
    return {
      signal: controller.signal,
      publish(commit) {
        if (finished || controller.signal.aborted || !pending[kind].has(controller) || !isAllowed(kind))
          return false
        commit()
        return true
      },
      finish() {
        finished = true
        pending[kind].delete(controller)
      },
    }
  }

  return {
    isAllowed,
    grant(kind: CaptureKind) {
      if (!visible)
        throw new Error('Hidden character cannot enable observation')
      grants[kind] = true
    },
    revoke,
    setVisible,
    begin,
  }
}
