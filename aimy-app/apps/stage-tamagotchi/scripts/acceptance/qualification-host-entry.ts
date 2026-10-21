import process from 'node:process'

import { join } from 'node:path'

import { app } from 'electron'

import * as v from 'valibot'

import { openLiveCampaign, readCampaignJson } from './live-campaign'
import { startLiveHost } from './live-host'
import { createQualificationTransport } from './qualification-transport'

/** Qualification CLI -> exact live host -> pinned local TLS fixture, never a cloud provider. */
try {
  if (!process.env.AIMY_LIVE_HOST_CONFIG)
    throw new Error('LIVE_HOST_CONFIG_REQUIRED')
  const config = v.parse(v.object({ campaignRoot: v.string() }), await readCampaignJson(process.env.AIMY_LIVE_HOST_CONFIG))
  const campaign = await openLiveCampaign(config.campaignRoot)
  if (campaign.manifest.purpose !== 'qualification')
    throw new Error('QUALIFICATION_PURPOSE_REQUIRED')
  await startLiveHost(process.env.AIMY_LIVE_HOST_CONFIG, { create: authorize => createQualificationTransport({
    certificatePath: join(campaign.root, 'qualification-tls/cert.pem'),
    keyPath: join(campaign.root, 'qualification-tls/key.pem'),
    authorize,
  }) })
}
catch {
  console.error('QUALIFICATION_HOST_START_FAILED')
  app.exit(1)
}
