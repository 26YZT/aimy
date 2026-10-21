import type { ResourceSnapshot } from './resource-policy'

import { describe, expect, it, vi } from 'vitest'

import { captureResourceStream, installResourcePolicy, ResourcePolicy } from './resource-policy'

describe('capture stream lifecycle', () => {
  it('stops real browser tracks both during capture and after a revoked pending open', async () => {
    let snapshot: ResourceSnapshot = {
      revision: 1,
      appEpoch: 0,
      active: true,
      reason: 'shown',
      microphone: { enabled: false, epoch: 0 },
      screen: { enabled: false, epoch: 0 },
    }
    const policy = new ResourcePolicy({
      async setEnabled(kind, enabled) {
        snapshot = { ...snapshot, revision: snapshot.revision + 1, [kind]: { enabled, epoch: snapshot[kind].epoch + 1 } }
        return snapshot
      },
    })
    installResourcePolicy(policy)
    policy.apply(snapshot)
    const context = new AudioContext()
    try {
      const open = vi.fn(async () => context.createMediaStreamDestination().stream)
      await expect(captureResourceStream('microphone', open)).rejects.toMatchObject({ name: 'NotAllowedError' })
      expect(open).not.toHaveBeenCalled()
      await policy.setEnabled('microphone', true)
      const active = await captureResourceStream('microphone', open)
      expect(active.getAudioTracks()[0].readyState).toBe('live')
      await policy.setEnabled('microphone', false)
      expect(active.getAudioTracks()[0].readyState).toBe('ended')

      await policy.setEnabled('microphone', true)
      let finish: (stream: MediaStream) => void = () => {}
      const pending = captureResourceStream('microphone', () => new Promise((resolve) => {
        finish = resolve
      }))
      const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      await policy.setEnabled('microphone', false)
      const late = context.createMediaStreamDestination().stream
      finish(late)
      await rejected
      expect(late.getAudioTracks()[0].readyState).toBe('ended')
    }
    finally {
      await context.close()
    }
  })
})
