import { setCompanionMotionPreferences } from '@proj-airi/stage-ui-live2d/composables/live2d'

import { getCompanionPreferences, onCompanionPreferencesChange } from './preferences'

export { getCompanionMotionCatalog, onCompanionMotionCatalogChange } from '@proj-airi/stage-ui-live2d/composables/live2d'
export type { CompanionMotionCatalog } from '@proj-airi/stage-ui-live2d/composables/live2d'

/** The stage owner installs this projection once. It neither persists settings nor controls the renderer. */
export function installCompanionMotionPreferences(): () => void {
  const project = () => setCompanionMotionPreferences(getCompanionPreferences().interaction)
  project()
  return onCompanionPreferencesChange(project)
}
