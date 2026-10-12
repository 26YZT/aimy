import { describe, expect, it } from 'vitest'

import { createDecodedAudioBudget, estimateWavCost, MAX_QUEUED_BYTES } from './decoded-audio-budget'
import { wav } from './wav-fixture'

describe('decoded audio resource limits', () => {
  it('rejects duration or predicted PCM oversize before decoding', () => {
    expect(estimateWavCost(wav(16), 48000)).toBeUndefined()
    expect(estimateWavCost(wav(15, 2), 192000)).toBeUndefined()
    expect(estimateWavCost(wav(4, 8), 48000)).toEqual({ seconds: 4, bytes: 4 * 48000 * 8 * 4 })
  })

  it('bounds fast large WAV arrivals while playback is slow, then reuses released capacity', () => {
    const budget = createDecodedAudioBudget()
    const cost = estimateWavCost(wav(4, 8), 48000)!
    const held = Array.from({ length: 4 }, () => {
      const reservation = budget.reserve(cost)!
      expect(budget.markReady(reservation, cost)).toBe(true)
      return reservation
    })
    expect(held.every(Boolean)).toBe(true)
    expect(cost.bytes * held.length).toBeLessThanOrEqual(MAX_QUEUED_BYTES)
    expect(budget.reserve(cost)).toBeUndefined()
    budget.release(held[0])
    expect(budget.reserve(cost)).toBeDefined()
  })

  it('bounds queued duration independently of bytes', () => {
    const budget = createDecodedAudioBudget()
    const cost = estimateWavCost(wav(15), 48000)!
    expect(Array.from({ length: 3 }, () => {
      const reservation = budget.reserve(cost)!
      budget.markReady(reservation, cost)
      return reservation
    }).every(Boolean)).toBe(true)
    expect(budget.reserve(cost)).toBeUndefined()
  })

  it('does not let an old decode release subtract a newer turn reservation', () => {
    const budget = createDecodedAudioBudget()
    const cost = { bytes: 8 * 1024 * 1024, seconds: 10 }
    const old = budget.reserve(cost)!
    budget.markReady(old, cost)
    budget.reset()
    const current = Array.from({ length: 3 }, () => {
      const reservation = budget.reserve(cost)!
      budget.markReady(reservation, cost)
      return reservation
    })
    budget.release(old)
    expect(budget.reserve(cost)).toBeUndefined()
    expect(budget.adjust(old, cost)).toBe(false)
    current.forEach(reservation => budget.release(reservation))
    expect(budget.reserve(cost)).toBeDefined()
  })

  it('retains old decoding bytes, duration and slots through multiple generation resets', () => {
    const budget = createDecodedAudioBudget()
    const cost = { bytes: 8 * 1024 * 1024, seconds: 15 }
    const first = budget.reserve(cost)!
    budget.reset()
    const second = budget.reserve(cost)!
    for (let generation = 0; generation < 10; generation++) {
      budget.reset()
      expect(budget.reserve(cost)).toBeUndefined()
      expect(budget.usage()).toEqual({ bytes: 16 * 1024 * 1024, seconds: 30, decoding: 2 })
    }
    expect(budget.markReady(first, cost)).toBe(false)
    budget.release(first)
    const newer = budget.reserve(cost)!
    expect(newer).toBeDefined()
    expect(budget.markReady(newer, cost)).toBe(true)
    budget.release(first)
    expect(budget.usage()).toEqual({ bytes: 16 * 1024 * 1024, seconds: 30, decoding: 1 })
    budget.release(second)
    expect(budget.usage()).toEqual({ bytes: 8 * 1024 * 1024, seconds: 15, decoding: 0 })
    budget.reset()
    expect(budget.usage()).toEqual({ bytes: 0, seconds: 0, decoding: 0 })
  })
})
