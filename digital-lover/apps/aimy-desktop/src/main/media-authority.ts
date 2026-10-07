import { randomUUID } from 'node:crypto'
import { createPerceptionGate } from '@digital-lover/companion-engine'
import type { MediaControl, MediaControlResult, MediaKind, MediaState } from '../shared/contracts'

export interface MediaOperationLease { signal: AbortSignal; current: () => boolean; finish: () => void }
interface MediaAuthorityOptions {
  authorize: (input: MediaControl) => Promise<{ ok: boolean; message?: string; sourceName?: string }>
  changed?: (state: MediaState) => void
  revoked?: (kind: MediaKind) => void
}

/** Ephemeral user grants. Saved model configuration never reopens a device. */
export function createMediaAuthority(options: MediaAuthorityOptions) {
  let visible = true
  let revision = 0
  const tokens: Partial<Record<MediaKind, string>> = {}
  const versions: Record<MediaKind, number> = { mic: 0, screen: 0, speech: 0 }
  let sourceName: string | undefined
  const outputRequests = new Set<AbortController>()
  const gate = createPerceptionGate()
  function state(): MediaState {
    return {
      revision,
      mic: { enabled: Boolean(visible && tokens.mic && gate.isAllowed('mic')), ...(tokens.mic ? { token: tokens.mic } : {}) },
      screen: { enabled: Boolean(visible && tokens.screen && gate.isAllowed('screen')), ...(tokens.screen ? { token: tokens.screen, sourceName } : {}) },
      speech: { enabled: Boolean(visible && tokens.speech), ...(tokens.speech ? { token: tokens.speech } : {}) },
    }
  }
  function notify() { revision++; options.changed?.(state()) }
  function revoke(kind: MediaKind) {
    versions[kind]++
    delete tokens[kind]
    if (kind === 'speech') {
      for (const controller of outputRequests) controller.abort()
      outputRequests.clear()
    } else {
      gate.revoke(kind)
      if (kind === 'screen') sourceName = undefined
    }
    options.revoked?.(kind)
    notify()
  }
  function revokeAll() { for (const kind of ['mic', 'screen', 'speech'] as const) revoke(kind) }
  function setVisible(value: boolean) {
    visible = value
    if (!value) revokeAll()
    gate.setVisible(value)
    notify()
  }
  async function set(input: MediaControl): Promise<MediaControlResult> {
    if (!input.enabled) { revoke(input.kind); return { ok: true, state: state() } }
    if (!visible) return { ok: false, state: state(), message: '窗口隐藏时不能开启采集或播放。' }
    if (state()[input.kind].enabled) return { ok: true, state: state() }
    const version = ++versions[input.kind]
    let decision: Awaited<ReturnType<MediaAuthorityOptions['authorize']>>
    try { decision = await options.authorize(input) } catch { decision = { ok: false, message: '权限未能开启，请重试。' } }
    if (!visible || versions[input.kind] !== version)
      return { ok: false, state: state(), message: '本次开启已取消。' }
    if (!decision.ok) return { ok: false, state: state(), message: decision.message || '权限未开启。' }
    tokens[input.kind] = randomUUID()
    if (input.kind !== 'speech') gate.grant(input.kind)
    if (input.kind === 'screen') sourceName = decision.sourceName
    notify()
    return { ok: true, state: state() }
  }
  function acquire(kind: MediaKind, token: string): MediaOperationLease | undefined {
    if (!visible || !token || token !== tokens[kind] || !state()[kind].enabled) return undefined
    if (kind !== 'speech') {
      const lease = gate.begin(kind)
      return {
        signal: lease.signal,
        current() { let permitted = false; if (tokens[kind] === token && visible) lease.publish(() => { permitted = true; return undefined }); return permitted },
        finish: lease.finish,
      }
    }
    const controller = new AbortController()
    outputRequests.add(controller)
    let finished = false
    return { signal: controller.signal, current: () => !finished && !controller.signal.aborted && visible && tokens.speech === token, finish() { finished = true; outputRequests.delete(controller) } }
  }
  return { state, set, revoke, revokeAll, setVisible, acquire, enabled: (kind: MediaKind) => state()[kind].enabled }
}
