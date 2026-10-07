import indexedDbDriver from 'unstorage/drivers/indexedb'
import memoryDriver from 'unstorage/drivers/memory'

import { createStorage } from 'unstorage'

export const storage = createStorage({
  driver: memoryDriver(),
})

// AIRI storage adaptation: a separate Aimy database and no cloud outbox mount.
storage.mount('local', indexedDbDriver({ base: 'aimy-local' }))
