/// <reference types="vite/client" />
import type { Profile } from 'wlipsync'
import { createWLipSyncNode as createUpstreamNode } from 'wlipsync'
import processorUrl from 'wlipsync/audio-processor.js?url'

const modules = new WeakMap<AudioContext, Promise<void>>()
const isClosed = (context: AudioContext) => context.state === 'closed'

/** Pre-register the trusted local processor so the upstream data-script fallback is unused. */
export async function createWLipSyncNode(context: AudioContext, profile: Profile) {
  if (isClosed(context)) throw new Error('Audio context is closed')
  let loading = modules.get(context)
  if (!loading) {
    const pending = context.audioWorklet.addModule(processorUrl)
    modules.set(context, pending)
    void pending.catch(() => { if (modules.get(context) === pending) modules.delete(context) })
    loading = pending
  }
  await loading
  if (isClosed(context)) throw new Error('Audio context is closed')
  return createUpstreamNode(context, profile)
}
