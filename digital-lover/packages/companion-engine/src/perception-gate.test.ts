import { describe, expect, it, vi } from 'vitest'
import { createPerceptionGate } from './perception-gate'

describe('perception permission and late results', () => {
  it('starts with both inputs denied', () => {
    const gate = createPerceptionGate()
    expect(gate.isAllowed('screen')).toBe(false)
    expect(gate.isAllowed('mic')).toBe(false)
    expect(() => gate.begin('screen')).toThrow('disabled')
  })

  it('publishes an authorized result and expires a finished lease', () => {
    const gate = createPerceptionGate()
    gate.grant('screen')
    const lease = gate.begin('screen')
    const commit = vi.fn()
    expect(lease.publish(commit)).toBe(true)
    expect(commit).toHaveBeenCalledTimes(1)
    lease.finish()
    expect(lease.publish(commit)).toBe(false)
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('cancels every existing request before device cleanup', () => {
    const cleanup = vi.fn(() => {
      expect(gate.isAllowed('screen')).toBe(false)
      expect(first.signal.aborted).toBe(true)
      expect(second.signal.aborted).toBe(true)
    })
    const gate = createPerceptionGate({ onRevoke: cleanup })
    gate.grant('screen')
    const first = gate.begin('screen')
    const second = gate.begin('screen')
    gate.revoke('screen')
    expect(cleanup).toHaveBeenCalledWith('screen')
    expect(first.publish(vi.fn())).toBe(false)
    expect(() => gate.begin('screen')).toThrow('disabled')
  })

  it('rejects an old provider result after off-on permission changes', async () => {
    const gate = createPerceptionGate()
    gate.grant('screen')
    const lease = gate.begin('screen')
    let resolve!: (result: string) => void
    const result = new Promise<string>((done) => { resolve = done })
    const commit = vi.fn()
    const publish = result.then(text => lease.publish(() => commit(text)))
    gate.revoke('screen')
    gate.grant('screen')
    resolve('old screen summary')
    expect(await publish).toBe(false)
    expect(commit).not.toHaveBeenCalled()
    expect(gate.begin('screen').signal.aborted).toBe(false)
  })

  it('keeps the microphone independent from screen permission', () => {
    const gate = createPerceptionGate()
    gate.grant('screen')
    gate.grant('mic')
    const mic = gate.begin('mic')
    gate.revoke('screen')
    expect(mic.signal.aborted).toBe(false)
    expect(mic.publish(vi.fn())).toBe(true)
  })

  it('hides by revoking both inputs and requires new user grants', () => {
    const gate = createPerceptionGate()
    gate.grant('screen')
    gate.grant('mic')
    const screen = gate.begin('screen')
    const mic = gate.begin('mic')
    gate.setVisible(false)
    expect(screen.signal.aborted).toBe(true)
    expect(mic.signal.aborted).toBe(true)
    expect(() => gate.grant('screen')).toThrow('Hidden')
    gate.setVisible(true)
    expect(gate.isAllowed('screen')).toBe(false)
    expect(gate.isAllowed('mic')).toBe(false)
  })

  it('still revokes the microphone when screen cleanup throws', () => {
    const gate = createPerceptionGate({ onRevoke(kind) {
      if (kind === 'screen') throw new Error('device cleanup failed')
    } })
    gate.grant('screen')
    gate.grant('mic')
    const mic = gate.begin('mic')
    expect(() => gate.setVisible(false)).toThrow('device cleanup failed')
    expect(mic.signal.aborted).toBe(true)
    expect(gate.isAllowed('mic')).toBe(false)
  })
})
