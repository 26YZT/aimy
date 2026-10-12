import type { MediaState } from '../../shared/contracts'

/** Every IPC state source shares one main-process monotonic revision. */
export function newerMediaState(current: MediaState, next: MediaState) {
  return Number.isSafeInteger(next.revision) && next.revision >= 0 && next.revision > current.revision
}

export function copyMediaState(next: MediaState): MediaState {
  return { revision: next.revision, mic: { ...next.mic }, screen: { ...next.screen }, speech: { ...next.speech } }
}
