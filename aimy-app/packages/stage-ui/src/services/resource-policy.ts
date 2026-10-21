/** Capture consent and lifecycle generations shared by the desktop host and its renderers. */
export type CaptureKind = 'microphone' | 'screen'

export interface ResourceSnapshot {
  revision: number
  appEpoch: number
  active: boolean
  reason: string
  microphone: { enabled: boolean, epoch: number }
  screen: { enabled: boolean, epoch: number }
}

export interface ResourceLease {
  readonly signal: AbortSignal
  assertCurrent: () => void
  release: () => void
}

export interface ResourcePolicyPort {
  setEnabled: (kind: CaptureKind, enabled: boolean, appEpoch: number) => Promise<ResourceSnapshot>
}

/** Owns renderer capture leases. Host snapshots revoke old work before listeners observe the change. */
export class ResourcePolicy {
  private snapshot: ResourceSnapshot = {
    revision: -1,
    appEpoch: 0,
    active: false,
    reason: 'initial',
    microphone: { enabled: false, epoch: 0 },
    screen: { enabled: false, epoch: 0 },
  }

  private readonly leases = new Map<AbortController, CaptureKind>()
  private readonly listeners = new Set<(reason: string, kind?: CaptureKind) => void>()
  private readonly blocked = new Set<CaptureKind>()
  private readonly pendingOff = new Set<CaptureKind>()
  private readonly changes = { microphone: 0, screen: 0 }
  private readonly startup = Promise.withResolvers<void>()
  private windowClosing = false

  constructor(private readonly port: ResourcePolicyPort) {}

  get state(): ResourceSnapshot {
    return { ...this.snapshot, active: this.snapshot.active && !this.windowClosing, microphone: { ...this.snapshot.microphone }, screen: { ...this.snapshot.screen } }
  }

  get isWindowClosing(): boolean { return this.windowClosing }

  resumeAfterCloseFailure(): void { this.windowClosing = false }

  apply(next: ResourceSnapshot): void {
    if (next.revision <= this.snapshot.revision)
      return
    const previous = this.snapshot
    this.snapshot = next
    this.startup.resolve()
    if (previous.appEpoch !== next.appEpoch || !next.active) {
      this.stopLocal(next.reason)
      if (!next.active)
        return
    }
    for (const kind of ['microphone', 'screen'] as const) {
      if (previous[kind].enabled && (previous[kind].epoch !== next[kind].epoch || !next[kind].enabled))
        this.stopLocal(next.reason, kind)
      if (next[kind].enabled && !this.pendingOff.has(kind))
        this.blocked.delete(kind)
    }
  }

  /** Capture owners wait for the first host snapshot before interpreting stored UI preferences. */
  ready(): Promise<void> {
    return this.startup.promise
  }

  async setEnabled(kind: CaptureKind, enabled: boolean): Promise<void> {
    if (this.windowClosing && enabled)
      throw new DOMException('Window is closing', 'AbortError')
    const change = ++this.changes[kind]
    if (!enabled) {
      this.pendingOff.add(kind)
      this.blocked.add(kind)
      this.stopLocal('permission-off', kind)
    }
    else {
      this.pendingOff.delete(kind)
    }
    const next = await this.port.setEnabled(kind, enabled, this.snapshot.appEpoch)
    if (change !== this.changes[kind])
      throw new DOMException('Capture choice changed', 'AbortError')
    this.apply(next)
    this.pendingOff.delete(kind)
    this.blocked.delete(kind)
    if (enabled && (this.windowClosing || !this.snapshot.active || !this.snapshot[kind].enabled))
      throw new DOMException('Capture permission is off', 'NotAllowedError')
  }

  acquire(kind: CaptureKind): ResourceLease {
    const appEpoch = this.snapshot.appEpoch
    const epoch = this.snapshot[kind].epoch
    const controller = new AbortController()
    const assertCurrent = () => {
      controller.signal.throwIfAborted()
      if (this.windowClosing || !this.snapshot.active || !this.snapshot[kind].enabled || this.blocked.has(kind)
        || appEpoch !== this.snapshot.appEpoch || epoch !== this.snapshot[kind].epoch) {
        throw new DOMException('Capture permission is off or changed', 'NotAllowedError')
      }
    }
    assertCurrent()
    this.leases.set(controller, kind)
    return { signal: controller.signal, assertCurrent, release: () => this.leases.delete(controller) }
  }

  /** Stops local work synchronously while an off request or shutdown acknowledgement is in flight. */
  stopLocal(reason: string, kind?: CaptureKind): void {
    if (reason === 'window-close' || reason === 'quit')
      this.windowClosing = true
    if (kind) {
      this.blocked.add(kind)
    }
    else {
      this.blocked.add('microphone')
      this.blocked.add('screen')
    }
    for (const [controller, ownedKind] of this.leases) {
      if (!kind || kind === ownedKind) {
        this.leases.delete(controller)
        controller.abort(new DOMException(reason, 'AbortError'))
      }
    }
    for (const listener of this.listeners)
      listener(reason, kind)
  }

  onRevoked(listener: (reason: string, kind?: CaptureKind) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

let installed: ResourcePolicy | undefined

/** Desktop bootstrap installs its policy before stores or capture consumers initialize. */
export function installResourcePolicy(policy: ResourcePolicy): void {
  if (installed && installed !== policy)
    throw new Error('A resource policy is already installed')
  installed = policy
}

export function getResourcePolicy(): ResourcePolicy | undefined {
  return installed
}

/** User-operated controls call this before capture. Existing non-desktop platforms keep their permission flow. */
export async function requestResourceAccess(kind: CaptureKind): Promise<void> {
  await installed?.ready()
  await installed?.setEnabled(kind, true)
}

export async function disableResourceAccess(kind: CaptureKind): Promise<void> {
  await installed?.setEnabled(kind, false)
}

export function onResourceRevoked(listener: (reason: string, kind?: CaptureKind) => void): () => void {
  return installed?.onRevoked(listener) ?? (() => {})
}

/** Stops active and late streams when their host consent or application generation changes. */
export async function captureResourceStream(kind: CaptureKind, open: () => Promise<MediaStream>): Promise<MediaStream> {
  const lease = installed?.acquire(kind)
  let stream: MediaStream | undefined
  const stop = () => {
    stream?.getTracks().forEach(track => track.stop())
    lease?.release()
  }
  lease?.signal.addEventListener('abort', stop, { once: true })
  try {
    stream = await open()
    lease?.assertCurrent()
    for (const track of stream.getTracks()) {
      track.addEventListener('ended', () => {
        if (stream?.getTracks().every(item => item.readyState === 'ended')) {
          lease?.release()
          lease?.signal.removeEventListener('abort', stop)
        }
      }, { once: true })
    }
    return stream
  }
  catch (error) {
    stop()
    lease?.release()
    lease?.signal.removeEventListener('abort', stop)
    throw error
  }
}
