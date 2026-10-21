import { afterEach, describe, expect, it } from 'vitest'

import { storage, updateRawLocal, updateRawLocalMany } from './storage'

const ownedKeys: string[] = []

function key(suffix: string) {
  const value = `local:atomic-test/${crypto.randomUUID()}/${suffix}`
  ownedKeys.push(value)
  return value
}

afterEach(async () => {
  await Promise.all(ownedKeys.splice(0).map(value => storage.removeItem(value)))
})

describe('atomic writes in the existing local mount', () => {
  it('reads driver data and commits a value that the driver can read', async () => {
    const id = key('counter')
    await storage.setItemRaw(id, 3)
    await updateRawLocal<number>(id, current => (current ?? 0) + 2)
    expect(await storage.getItemRaw(id)).toBe(5)
  })

  it('serializes competing updates without losing writes', async () => {
    const id = key('race')
    await Promise.all(Array.from({ length: 12 }, () => updateRawLocal<number>(id, current => (current ?? 0) + 1)))
    expect(await storage.getItemRaw(id)).toBe(12)
  })

  it('rolls back the record when its related index cannot be cloned', async () => {
    const session = key('session')
    const index = key('index')
    await storage.setItemRaw(session, 'before')
    await storage.setItemRaw(index, 'registered')
    await expect(updateRawLocalMany([session, index], () => ['after', () => 'invalid'])).rejects.toThrow()
    expect(await storage.getItemRaw(session)).toBe('before')
    expect(await storage.getItemRaw(index)).toBe('registered')
  })

  it('commits all records and rejects duplicate normalized keys', async () => {
    const session = key('session')
    const index = key('index')
    await updateRawLocalMany([session, index], () => [{ messages: ['hello'] }, { registered: true }])
    expect(await storage.getItemRaw(session)).toEqual({ messages: ['hello'] })
    expect(await storage.getItemRaw(index)).toEqual({ registered: true })
    await expect(updateRawLocalMany([session, session.replaceAll('/', ':')], () => [1, 2])).rejects.toThrow('repeat')
  })
})
