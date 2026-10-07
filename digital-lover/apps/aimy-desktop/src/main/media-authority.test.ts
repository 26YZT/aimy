import { describe, expect, it } from 'vitest'
import { createMediaAuthority } from './media-authority'

describe('ephemeral device and speech grants', () => {
  it('defaults closed; revokes active requests and rejects the same token after reopening', async () => {
    const authority = createMediaAuthority({ authorize: async () => ({ ok: true }) })
    expect(authority.state()).toEqual({ revision: 0, mic: { enabled: false }, screen: { enabled: false }, speech: { enabled: false } })
    for (const kind of ['mic', 'screen', 'speech'] as const) {
      const allowed = await authority.set({ kind, enabled: true })
      const token = allowed.state[kind].token!
      const lease = authority.acquire(kind, token)!
      expect(lease.current()).toBe(true)
      authority.revoke(kind)
      expect(lease.signal.aborted).toBe(true)
      expect(lease.current()).toBe(false)
      await authority.set({ kind, enabled: true })
      expect(authority.acquire(kind, token)).toBeUndefined()
      lease.finish()
    }
  })
  it('does not grant a device when its permission dialog completes after hide or explicit off', async () => {
    let finish!: (value: { ok: boolean }) => void
    const authority = createMediaAuthority({ authorize: () => new Promise(resolve => { finish = resolve }) })
    const pending = authority.set({ kind: 'mic', enabled: true })
    authority.setVisible(false)
    authority.setVisible(true)
    finish({ ok: true })
    expect((await pending).ok).toBe(false)
    expect(authority.state().mic.enabled).toBe(false)
    const other = authority.set({ kind: 'screen', enabled: true })
    authority.revoke('screen')
    finish({ ok: true })
    expect((await other).ok).toBe(false)
  })
  it('hiding cancels all three channels; displaying again cannot reacquire them', async () => {
    const authority = createMediaAuthority({ authorize: async () => ({ ok: true, sourceName: 'fixture source' }) })
    const leases = []
    for (const kind of ['mic', 'screen', 'speech'] as const) {
      const granted = await authority.set({ kind, enabled: true })
      leases.push(authority.acquire(kind, granted.state[kind].token!)!)
    }
    authority.setVisible(false)
    expect(leases.every(lease => lease.signal.aborted && !lease.current())).toBe(true)
    expect((await authority.set({ kind: 'mic', enabled: true })).ok).toBe(false)
    authority.setVisible(true)
    expect(['mic', 'screen', 'speech'].every(kind => !authority.enabled(kind as 'mic' | 'screen' | 'speech'))).toBe(true)
  })
  it('keeps channels independent and a finished lease cannot publish', async () => {
    const authority = createMediaAuthority({ authorize: async () => ({ ok: true }) })
    const mic = await authority.set({ kind: 'mic', enabled: true })
    const output = await authority.set({ kind: 'speech', enabled: true })
    const inputLease = authority.acquire('mic', mic.state.mic.token!)!
    const outputLease = authority.acquire('speech', output.state.speech.token!)!
    expect(authority.acquire('mic', output.state.speech.token!)).toBeUndefined()
    authority.revoke('screen')
    expect(inputLease.current()).toBe(true)
    expect(outputLease.current()).toBe(true)
    inputLease.finish(); outputLease.finish()
    expect(inputLease.current()).toBe(false)
    expect(outputLease.current()).toBe(false)
  })
  it('versions all channels together and never mutates an already returned snapshot', async () => {
    const publications: ReturnType<ReturnType<typeof createMediaAuthority>['state']>[] = []
    const authority = createMediaAuthority({ authorize: async () => ({ ok: true, sourceName: 'fixture source' }), changed: state => publications.push(state) })
    const original = authority.state()
    const speech = await authority.set({ kind: 'speech', enabled: true })
    const mic = await authority.set({ kind: 'mic', enabled: true })
    expect(original.revision).toBe(0)
    expect(speech.state.revision).toBeLessThan(mic.state.revision)
    expect(speech.state.mic.enabled).toBe(false)
    expect(mic.state.mic.enabled).toBe(true)
    expect(publications.at(-1)).toEqual(mic.state)
    authority.revoke('mic')
    expect(authority.state().revision).toBeGreaterThan(mic.state.revision)
    expect(mic.state.mic.enabled).toBe(true)
    expect(authority.state().mic.enabled).toBe(false)
    authority.setVisible(false)
    authority.setVisible(true)
    expect(publications.every((state, index) => index === 0 || state.revision > publications[index - 1]!.revision)).toBe(true)
    expect(authority.state().speech.enabled).toBe(false)
  })
  it('returns current revision when an older system permission finishes after revocation', async () => {
    let finish!: (value: { ok: boolean }) => void
    const authority = createMediaAuthority({ authorize: () => new Promise(resolve => { finish = resolve }) })
    const enabling = authority.set({ kind: 'mic', enabled: true })
    authority.revoke('mic')
    const closed = authority.state()
    finish({ ok: true })
    const late = await enabling
    expect(late.ok).toBe(false)
    expect(late.state).toEqual(closed)
    expect(late.state.mic.enabled).toBe(false)
  })
})
