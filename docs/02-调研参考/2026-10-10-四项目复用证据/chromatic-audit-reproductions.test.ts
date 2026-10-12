import { describe, it, expect, vi } from 'vitest'
import { mixColors, chromaticFrom, themeFrom } from './index'
describe('isolated audit reproductions', () => {
  it('records alpha loss in transparent color mixing', () => {
    const result = mixColors({mode:'oklch',l:.5,c:.1,h:200,alpha:.2}, {mode:'oklch',l:.7,c:.1,h:220,alpha:.4}, .5)
    expect(result.alpha).toBeUndefined()
  })
  it('records an in-flight animation overriding a later setHue', async () => {
    vi.useFakeTimers()
    try {
      const dynamic = chromaticFrom(0)
      const pending = dynamic.animateHue(120, 10, 1000)
      dynamic.setHue(240)
      await vi.advanceTimersByTimeAsync(1100)
      await pending
      expect(dynamic.getScheme().toHex('primary')).toBe(themeFrom(120,{primary:0}).toHex('primary'))
      expect(dynamic.getScheme().toHex('primary')).not.toBe(themeFrom(240,{primary:0}).toHex('primary'))
    } finally { vi.useRealTimers() }
  })
})
