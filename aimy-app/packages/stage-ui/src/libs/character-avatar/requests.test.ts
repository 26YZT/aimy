import { describe, expect, it } from 'vitest'

import { parseCharacterAvatarCancellation, parseCharacterAvatarUpdate } from './index'
import { AVATAR_REQUEST_LIFETIME_MS, CharacterAvatarRequests } from './requests'

function request(requestedAt: number, requestId = crypto.randomUUID()) {
  return { requestId, requestedAt, ownerId: 'local', cardId: 'default', activeCardId: 'default', expectedAvatar: null, avatar: null }
}

describe('bounded avatar save intents', () => {
  it('keeps pre-arrival cancellation, rejects replay and does not undo completed writes', () => {
    const ledger = new CharacterAvatarRequests(() => 10000)
    const cancelled = request(10000)
    expect(ledger.cancel(cancelled)).toBe(true)
    expect(() => ledger.begin(cancelled)).toThrow('changed')
    const next = request(10000)
    const permit = ledger.begin(next)!
    expect(permit.current()).toBe(true)
    ledger.cancel(cancelled)
    expect(permit.current()).toBe(true)
    permit.complete()
    expect(ledger.cancel(next)).toBe(false)
    expect(() => ledger.begin(next)).toThrow('changed')
  })

  it('expires a decoder permit and keeps cancelled overflow intents closed after cache eviction', () => {
    let now = 10000
    const ledger = new CharacterAvatarRequests(() => now)
    const old = request(now)
    const permit = ledger.begin(old)!
    for (let i = 0; i < 128; i++)
      ledger.cancel(request(now))
    const overflow = request(now)
    ledger.cancel(overflow)
    expect(() => ledger.begin(overflow)).toThrow('changed')
    now += AVATAR_REQUEST_LIFETIME_MS + 1
    expect(permit.current()).toBe(false)
    expect(() => ledger.begin(overflow)).toThrow('changed')
    const replacement = request(now, old.requestId)
    const current = ledger.begin(replacement)!
    expect(ledger.cancel(old)).toBe(false)
    expect(current.current()).toBe(true)
    ledger.dispose()
    expect(current.current()).toBe(false)
    expect(() => ledger.begin(request(now))).toThrow('changed')
  })

  it('requires bounded identities and a timestamp paired with each optional token', () => {
    const valid = request(Date.now())
    expect(parseCharacterAvatarUpdate(valid)).toEqual(valid)
    expect(() => parseCharacterAvatarUpdate({ ...valid, requestedAt: undefined })).toThrow('changed')
    expect(() => parseCharacterAvatarCancellation({ requestId: 'x'.repeat(1000), ownerId: 'local', requestedAt: Date.now() })).toThrow('changed')
  })
})
