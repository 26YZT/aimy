import indexedDbDriver from 'unstorage/drivers/indexedb'
import memoryDriver from 'unstorage/drivers/memory'

import { createStore, update } from 'idb-keyval'
import { createStorage, normalizeKey } from 'unstorage'

const localBase = 'airi-local'
const localStore = createStore('keyval-store', 'keyval')

export const storage = createStorage({
  driver: memoryDriver(),
})

storage.mount('local', indexedDbDriver({ base: localBase }))
storage.mount('outbox', indexedDbDriver({ base: 'airi-sync-queue' }))

/**
 * Uses the same mount normalization and physical prefix as the unstorage driver.
 *
 * @example
 * physicalLocalKey('local:chat/sessions/example')
 * // => 'airi-local:chat:sessions:example'
 */
function physicalLocalKey(key: string) {
  const normalized = normalizeKey(key)
  if (!normalized.startsWith('local:'))
    throw new Error('Atomic local writes require the local mount.')
  return `${localBase}:${normalized.slice('local:'.length)}`
}

/** Commits a synchronous update in the existing local IndexedDB transaction. */
export async function updateRawLocal<T>(key: string, updater: (current: T | undefined) => T): Promise<void> {
  await update<T>(physicalLocalKey(key), updater, localStore)
}

/**
 * Commits related local records together. A failed write rolls back every key.
 * The updater cannot perform asynchronous work. Undefined values remove that key.
 */
export async function updateRawLocalMany(
  keys: readonly string[],
  updater: (current: readonly unknown[]) => readonly unknown[],
): Promise<void> {
  if (keys.length === 0)
    throw new Error('An atomic local write requires at least one key.')
  const physicalKeys = keys.map(physicalLocalKey)
  if (new Set(physicalKeys).size !== physicalKeys.length)
    throw new Error('An atomic local write cannot repeat a key.')

  await localStore('readwrite', store => new Promise<void>((resolve, reject) => {
    const transaction = store.transaction
    const current = new Array<unknown>(physicalKeys.length)
    let remaining = physicalKeys.length
    let failure: unknown
    transaction.addEventListener('complete', () => resolve(), { once: true })
    transaction.addEventListener('abort', () => reject(failure ?? transaction.error ?? new Error('Local transaction aborted.')), { once: true })

    for (const [index, key] of physicalKeys.entries()) {
      const request = store.get(key)
      request.addEventListener('success', () => {
        current[index] = request.result
        remaining--
        if (remaining !== 0)
          return
        try {
          const next = updater(current)
          if (!Array.isArray(next) || next.length !== physicalKeys.length)
            throw new Error('An atomic local updater must return one value per key.')
          for (const [writeIndex, value] of next.entries()) {
            if (value === undefined)
              store.delete(physicalKeys[writeIndex])
            else
              store.put(value, physicalKeys[writeIndex])
          }
        }
        catch (error) {
          failure ??= error
          try {
            transaction.abort()
          }
          catch (abortError) {
            // An earlier IDB request can already have aborted this transaction.
            // Reject the operation instead of throwing from this event callback.
            if (abortError instanceof DOMException && abortError.name === 'InvalidStateError')
              reject(failure)
            else
              reject(abortError)
          }
        }
      }, { once: true })
    }
  }))
}
