/** Conversation timestamps are separate from persistence, ownership and request deadlines. */
export function conversationClock(): { now: number, timeZone: string } {
  return { now: Date.now(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
}

/** Supplies the existing chat runtime clock without changing its monotonic elapsed clock. */
export function conversationNow(): number {
  return conversationClock().now
}
