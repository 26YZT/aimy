import { afterEach, expect, it } from 'vitest'

import { CompanionMotionPolicy, eligibleIdleMotionIndices, getCompanionMotionCatalog, registerCompanionMotionModel, setCompanionMotionPreferences } from './companion-motion'

const settings = { enabled: true, minimumIntervalMs: 800, avoidRecent: 2, models: { model: { head: [{ group: 'happy', weight: 1 }, { group: 'wave', weight: 3 }], body: [{ group: 'tap_body', weight: 1 }] } } }
afterEach(() => setCompanionMotionPreferences({ ...settings, enabled: false }))

it('retains AIRI behavior until the loaded model has an enabled mapping', () => {
  setCompanionMotionPreferences({ ...settings, enabled: false })
  const policy = new CompanionMotionPolicy('model')
  expect(policy.tap(['body'], ['tap_body'], 0)).toBeUndefined()
  setCompanionMotionPreferences(settings)
  expect(new CompanionMotionPolicy('other').tap(['body'], ['tap_body'], 0)).toBeUndefined()
  expect(policy.tap(['unknown'], ['tap_body'], 0)).toBeUndefined()
})

it('selects weighted groups, suppresses repeated clicks, and avoids a recent group', () => {
  setCompanionMotionPreferences(settings)
  const policy = new CompanionMotionPolicy('model')
  expect(policy.tap(['head'], ['happy', 'wave'], 0, () => 0)).toBe('happy')
  expect(policy.tap(['head'], ['happy', 'wave'], 100, () => 0)).toBeNull()
  expect(policy.tap(['head'], ['happy', 'wave'], 1000, () => 0)).toBe('wave')
  expect(policy.tap(['head'], ['happy', 'wave'], 2000, () => 0.99)).toBe('wave')
})

it('never selects an unavailable or invalid weighted group', () => {
  setCompanionMotionPreferences({ ...settings, models: { model: { head: [{ group: 'missing', weight: 3 }, { group: 'happy', weight: -1 }, { group: 'wave', weight: Number.NaN }] } } })
  expect(new CompanionMotionPolicy('model').tap(['head'], ['happy', 'wave'], 0)).toBeNull()
})

it('paces the existing idle dispatcher and yields after a semantic motion', () => {
  setCompanionMotionPreferences(settings)
  const policy = new CompanionMotionPolicy('model')
  expect(policy.idle('idle', [0, 1, 2], 0, false, () => 0)).toBe(0)
  expect(policy.idle('idle', [0, 1, 2], 3799, false, () => 0)).toBeNull()
  expect(policy.idle('idle', [0, 1, 2], 3800, false, () => 0)).toBe(1)
  policy.noteSemanticMotion(8000)
  expect(policy.idle('idle', [0, 1, 2], 10299, true, () => 0)).toBeNull()
  expect(policy.idle('idle', [0, 1, 2], 10300, true, () => 0)).toBe(2)
  setCompanionMotionPreferences({ ...settings, enabled: false })
  expect(policy.idle('idle', [0, 1, 2], 10301, false)).toBeUndefined()
})

it('removes only the unloaded catalog instance', () => {
  const first = registerCompanionMotionModel({ modelId: 'one', groups: ['idle'], areas: ['head'] })
  const second = registerCompanionMotionModel({ modelId: 'two', groups: [], areas: [] })
  expect(getCompanionMotionCatalog()).toHaveLength(2)
  first()
  expect(getCompanionMotionCatalog()).toEqual([{ modelId: 'two', groups: [], areas: [] }])
  second()
  expect(getCompanionMotionCatalog()).toEqual([])
})

it('chooses only an eligible SDK index and does not consume a cooldown when none is available', () => {
  setCompanionMotionPreferences(settings)
  const policy = new CompanionMotionPolicy('model')
  expect(policy.idle('idle', [], 0, false, () => 0)).toBeNull()
  expect(policy.idle('idle', [2], 1, false, () => 0)).toBe(2)
})

it('excludes failed loads and SDK active or reserved indices while retaining unloaded candidates', () => {
  const indices = eligibleIdleMotionIndices({ definitions: { idle: [{}, {}, {}, {}] }, motionGroups: { idle: [null, {}, undefined, {}] }, state: { isActive: (_group, index) => index === 1 || index === 3 } }, 'idle')
  expect(indices).toEqual([2])
  expect(eligibleIdleMotionIndices({ definitions: {}, motionGroups: {}, state: { isActive: () => false } }, 'idle')).toEqual([])
})
