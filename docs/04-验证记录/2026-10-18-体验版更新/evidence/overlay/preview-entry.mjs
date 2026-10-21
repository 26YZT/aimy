import { app } from 'electron'
import { join } from 'node:path'
// Local preview identity is stable across package replacements; no test or old profile is imported.
app.setName('Aimy体验版')
const previewData = join(app.getPath('appData'), 'Aimy-Preview')
app.setPath('userData', previewData)
process.env.APP_USER_DATA_PATH = previewData
for (const name of ['AIMY_ACCEPTANCE_CONFIG', 'AIMY_ACCEPTANCE_SETUP_ONLY', 'AIMY_LIVE_HOST_CONFIG', 'AIMY_OFFLINE_HOST_CONFIG', 'APP_REMOTE_DEBUG', 'APP_REMOTE_DEBUG_PORT', 'APP_REMOTE_DEBUG_NO_OPEN']) delete process.env[name]
await import('./out/main/index.js')
