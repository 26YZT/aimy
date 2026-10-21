import process from 'node:process'

import { app } from 'electron'

import { startLiveHost } from './live-host'

/** Explicit setup/run launch -> validated host -> existing Electron entry. */
try {
  if (!process.env.AIMY_LIVE_HOST_CONFIG)
    throw new Error('LIVE_HOST_CONFIG_REQUIRED')
  await startLiveHost(process.env.AIMY_LIVE_HOST_CONFIG)
}
catch {
  console.error('LIVE_HOST_START_FAILED')
  app.exit(1)
}
