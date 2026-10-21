import type { CaptureKind, ResourceSnapshot } from './resource-policy'

import { describe, expect, it, vi } from 'vitest'

import { ResourcePolicy } from './resource-policy'

function fixture() {
  let host: ResourceSnapshot = {
    revision: 0,
    appEpoch: 0,
    active: true,
    reason: 'shown',
    microphone: { enabled: false, epoch: 0 },
    screen: { enabled: false, epoch: 0 },
  }
  const setEnabled = vi.fn(async (kind: CaptureKind, enabled: boolean, epoch: number) => {
    if (epoch !== host.appEpoch)
      throw new Error('Expired choice')
    host = { ...host, revision: host.revision + 1, [kind]: { enabled, epoch: host[kind].epoch + 1 } }
    return structuredClone(host)
  })
  const policy = new ResourcePolicy({ setEnabled })
  policy.apply(host)
  return { policy, setEnabled }
}

describe('resource policy', () => {
  it('denies both resources until the host and user enable each one', async () => {
    const policy = new ResourcePolicy({ setEnabled: vi.fn() })
    expect(() => policy.acquire('microphone')).toThrow('off or changed')
    expect(() => policy.acquire('screen')).toThrow('off or changed')
    const { policy: ready } = fixture()
    await ready.setEnabled('microphone', true)
    expect(() => ready.acquire('microphone')).not.toThrow()
    expect(() => ready.acquire('screen')).toThrow('off or changed')
  })

  it('revokes all microphone subscribers without revoking an independent screen lease', async () => {
    const { policy } = fixture()
    await policy.setEnabled('microphone', true)
    await policy.setEnabled('screen', true)
    const microphone = policy.acquire('microphone')
    const secondMicrophone = policy.acquire('microphone')
    const screen = policy.acquire('screen')
    const stopped = vi.fn()
    microphone.signal.addEventListener('abort', stopped)
    const closing = policy.setEnabled('microphone', false)
    expect(stopped).toHaveBeenCalledOnce()
    expect(secondMicrophone.signal.aborted).toBe(true)
    expect(screen.signal.aborted).toBe(false)
    await closing
    expect(() => microphone.assertCurrent()).toThrow()
    expect(() => screen.assertCurrent()).not.toThrow()
  })

  it('rejects late results and does not restore capture when the stage becomes visible again', async () => {
    const { policy } = fixture()
    await policy.setEnabled('screen', true)
    const pending = policy.acquire('screen')
    policy.apply({ ...policy.state, revision: 8, appEpoch: 1, active: false, reason: 'stage-hide', screen: { enabled: false, epoch: 2 } })
    expect(pending.signal.aborted).toBe(true)
    expect(() => pending.assertCurrent()).toThrow()
    policy.apply({ ...policy.state, revision: 9, active: true, reason: 'stage-show' })
    expect(() => policy.acquire('screen')).toThrow('off or changed')
  })

  it('does not accept an older enable response after the user turns the resource off', async () => {
    const { policy, setEnabled } = fixture()
    let finish: (value: ResourceSnapshot) => void = () => {}
    setEnabled.mockImplementationOnce(() => new Promise((resolve) => {
      finish = resolve
    }))
    const enabling = policy.setEnabled('microphone', true)
    const rejected = expect(enabling).rejects.toMatchObject({ name: 'AbortError' })
    await policy.setEnabled('microphone', false)
    finish({ ...policy.state, revision: 0, microphone: { enabled: true, epoch: 1 } })
    await rejected
    expect(() => policy.acquire('microphone')).toThrow('off or changed')
  })

  it('releasing an old lease cannot stop a newer lease', async () => {
    const { policy } = fixture()
    await policy.setEnabled('microphone', true)
    const old = policy.acquire('microphone')
    await policy.setEnabled('microphone', false)
    await policy.setEnabled('microphone', true)
    const current = policy.acquire('microphone')
    old.release()
    expect(current.signal.aborted).toBe(false)
    expect(() => current.assertCurrent()).not.toThrow()
  })

  it('accepts a later host grant from another window after an earlier stage suspension', () => {
    const { policy } = fixture()
    policy.apply({ ...policy.state, revision: 4, appEpoch: 1, active: false, reason: 'stage-hide' })
    policy.apply({ ...policy.state, revision: 5, active: true, reason: 'stage-show' })
    policy.apply({ ...policy.state, revision: 6, reason: 'permission-on', microphone: { enabled: true, epoch: 2 } })
    expect(() => policy.acquire('microphone')).not.toThrow()
    expect(() => policy.acquire('screen')).toThrow('off or changed')
  })

  it('keeps a closing window suspended while another window changes global consent', async () => {
    const { policy, setEnabled } = fixture()
    await policy.setEnabled('microphone', true)
    const old = policy.acquire('microphone')
    policy.stopLocal('window-close')
    policy.apply({ ...policy.state, active: true, revision: 5, microphone: { enabled: true, epoch: 3 } })
    expect(policy.state.active).toBe(false)
    expect(() => policy.acquire('microphone')).toThrow()
    await expect(policy.setEnabled('microphone', true)).rejects.toMatchObject({ name: 'AbortError' })
    expect(setEnabled).toHaveBeenCalledOnce()
    policy.resumeAfterCloseFailure()
    expect(policy.state.active).toBe(true)
    expect(() => policy.acquire('microphone')).not.toThrow()
    expect(old.signal.aborted).toBe(true)
  })
})
