import { describe, expect, it } from 'vitest'

import {
  DEFAULT_CONFIG,
  createRelationshipEngine,
  resolveStage,
} from './relationship-engine'
import type { RelationshipEvent, RelationshipStage } from './relationship-engine'

const up = (engine: ReturnType<typeof createRelationshipEngine>, times: number, event: RelationshipEvent = { type: 'user_compliment' }) => {
  for (let i = 0; i < times; i++)
    engine.apply(event)
}

describe('relationship-engine', () => {
  it('初始状态：初识、0 好感、情绪中性', () => {
    const e = createRelationshipEngine()
    expect(e.snapshot()).toEqual({ stage: 'initial', affinity: 0, emotion: 'neutral', emotionIntensity: 0 })
  })

  it('好感度在 0..100 之间 clamp', () => {
    const e = createRelationshipEngine()
    up(e, 100, { type: 'user_cold' })
    expect(e.affinity).toBe(0)
    up(e, 200, { type: 'user_compliment' })
    expect(e.affinity).toBe(100)
  })

  it('好感度跨阈值依次升级到亲密', () => {
    const e = createRelationshipEngine()
    const stages: RelationshipStage[] = []
    for (let i = 0; i < 200; i++) {
      e.apply({ type: 'user_compliment' })
      if (stages.at(-1) !== e.stage)
        stages.push(e.stage)
    }
    expect(stages).toEqual(['initial', 'familiar', 'ambiguous', 'lover', 'intimate'])
  })

  it('resolveStage 升级即时、降级滞回，避免阈值抖动', () => {
    expect(resolveStage('initial', 20)).toBe('familiar')
    expect(resolveStage('familiar', 19)).toBe('familiar') // 未跌破滞回
    expect(resolveStage('familiar', 9)).toBe('initial') // 跌破 20-10
  })

  it('吃醋事件触发负面情绪', () => {
    const e = createRelationshipEngine()
    const effect = e.apply({ type: 'user_with_other' })
    expect(effect.emotion).toBe('jealous')
    expect(effect.emotionIntensity).toBe(70)
    expect(effect.expressionHint).toBe(DEFAULT_CONFIG.expressionHints.jealous)
  })

  it('道歉清空负面情绪', () => {
    const e = createRelationshipEngine()
    e.apply({ type: 'user_with_other' })
    e.apply({ type: 'user_apologize' })
    expect(e.emotion).toBe('neutral')
    expect(e.emotionIntensity).toBe(0)
  })

  it('settle 随时间衰减情绪强度并回归 neutral', () => {
    const e = createRelationshipEngine()
    e.apply({ type: 'user_cold' })
    for (let i = 0; i < 20; i++)
      e.settle()
    expect(e.emotion).toBe('neutral')
    expect(e.emotionIntensity).toBe(0)
  })

  it('每次事件返回 stageChanged 与表情提示', () => {
    const e = createRelationshipEngine()
    up(e, 40) // 跨到 ambiguous
    const effect = e.apply({ type: 'user_share' })
    expect(effect.stageChanged).toBe(false)
    expect(typeof effect.expressionHint).toBe('string')
  })
})
