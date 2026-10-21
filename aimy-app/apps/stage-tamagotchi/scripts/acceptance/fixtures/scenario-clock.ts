/** Replaces only conversation-clock.ts in explicitly marked acceptance builds. */
export function conversationClock(): { now: number, timeZone: string } {
  const value: unknown = Reflect.get(globalThis, '__aimyAcceptanceClock')
  if (!value || typeof value !== 'object' || !('now' in value) || !('timeZone' in value)
    || typeof value.now !== 'number' || !Number.isSafeInteger(value.now)
    || value.now < 946684800000 || value.now >= 4102444800000 || value.timeZone !== 'Asia/Shanghai') {
    throw new Error('SCENARIO_CLOCK_UNAVAILABLE')
  }
  return { now: value.now, timeZone: value.timeZone }
}

export function conversationNow(): number {
  return conversationClock().now
}
