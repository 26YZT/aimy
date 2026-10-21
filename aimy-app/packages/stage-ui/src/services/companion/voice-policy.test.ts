import { expect, it } from 'vitest'

import { adaptiveSilenceTimeout, RecentSpeechEcho } from './voice-policy'

it('matches recent played text only within the same session', () => {
  const echo = new RecentSpeechEcho()
  expect(echo.matches('alice', '今天辛苦了，先好好休息一下。', 1000)).toBe(false)
  echo.remember('alice', '今天辛苦了，先好好休息一下。', 1000)
  expect(echo.matches('alice', '今天辛苦了先好好休息一下', 2000)).toBe(true)
  expect(echo.matches('bob', '今天辛苦了先好好休息一下', 2000)).toBe(false)
  expect(echo.matches('alice', '今天辛苦了先好好休息一下', 21001)).toBe(false)
})

it('keeps short replies, new facts and evidence outside the time range', () => {
  const echo = new RecentSpeechEcho()
  echo.remember('alice', 'Yes please take a break and drink water.', 1000)
  expect(echo.matches('alice', 'Yes', 2000)).toBe(false)
  expect(echo.matches('alice', 'No I want to go outside', 2000)).toBe(false)
  expect(echo.matches('alice', 'Yes please take a break and drink water', 0)).toBe(false)
  echo.reset()
  expect(echo.matches('alice', 'Yes please take a break and drink water', 2000)).toBe(false)
})

it('limits comparison work and resets old evidence', () => {
  const echo = new RecentSpeechEcho()
  echo.remember('alice', 'x'.repeat(10000), 0)
  expect(echo.matches('alice', 'x'.repeat(1201), 1)).toBe(false)
  echo.remember('alice', 'a new sentence is spoken', 30000)
  expect(echo.matches('alice', 'xxxxxxxxxx', 30001)).toBe(false)
})

it('uses the optional short-segment threshold without changing the long threshold', () => {
  expect(adaptiveSilenceTimeout(1999)).toBe(800)
  expect(adaptiveSilenceTimeout(2000)).toBe(1200)
  expect(adaptiveSilenceTimeout(5000)).toBe(1200)
})
