/**
 * Text echo policy adapted from Ryza echo.js. Copyright (c) 2026 zeroa234. MIT.
 * The source attributes its window policy to Project-N.E.K.O (Apache-2.0). LCS is not SequenceMatcher.
 */
export class RecentSpeechEcho {
  private recent: Array<{ sessionId: string, text: string, at: number }> = []

  /** Record only audio that actually started. Pending synthesis never becomes echo evidence. */
  remember(sessionId: string, text: string, now = Date.now()): void {
    const normalized = normalize(text).slice(-1200)
    if (!normalized)
      return
    this.recent = this.recent.filter(item => item.at >= now - 20_000 && item.at <= now)
    this.recent.push({ sessionId, text: normalized, at: now })
    while (this.recent.reduce((size, item) => size + item.text.length, 0) > 2400)
      this.recent.shift()
  }

  /** A match blocks automatic submission only. The user can send the visible draft manually. */
  matches(sessionId: string, text: string, now = Date.now()): boolean {
    const needle = normalize(text)
    if (needle.length < 6 || needle.length > 1200)
      return false
    const hay = this.recent.filter(item => item.sessionId === sessionId && item.at >= now - 20_000 && item.at <= now).map(item => item.text).join('').slice(-1200)
    if (hay.length < 10)
      return false
    if (lcsRatio(needle, hay) >= 0.88)
      return true
    const window = Math.max(10, needle.length)
    const step = Math.max(1, Math.floor(needle.length / 4))
    for (let index = 0; index + window <= hay.length; index += step) {
      if (lcsRatio(needle, hay.slice(index, index + window)) >= 0.88)
        return true
    }
    return false
  }

  reset(): void {
    this.recent = []
  }
}

/** The existing voice host owns this transient evidence. It is never persisted or shared across processes. */
export const recentSpeechEcho = new RecentSpeechEcho()

/** Unicode letters and numbers form the comparison text. @example normalize('Hi!') // => 'hi' */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

function lcsRatio(left: string, right: string): number {
  let previous = new Uint16Array(right.length + 1)
  let current = new Uint16Array(right.length + 1)
  for (let i = 1; i <= left.length; i++) {
    for (let j = 1; j <= right.length; j++)
      current[j] = left[i - 1] === right[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1])
    const swap = previous
    previous = current
    current = swap
    current.fill(0)
  }
  return left.length + right.length ? 2 * previous[right.length] / (left.length + right.length) : 0
}

/** AionsHome VoiceCallPolicy timing rule. Copyright (c) 2026 death34018-hue. MIT. */
export function adaptiveSilenceTimeout(speechMs: number): number {
  return speechMs < 2000 ? 800 : 1200
}
