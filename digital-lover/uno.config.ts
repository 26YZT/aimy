import { defineConfig, presetAttributify, presetWind3 } from 'unocss'

/** Preserved AIRI settings icon contract; the desktop slice uses a smaller preset set. */
export function safelistSettingsEntryIcons(): string[] {
  return ['i-solar:emoji-funny-square-bold-duotone', 'i-solar:people-nearby-bold-duotone', 'i-solar:leaf-bold-duotone', 'i-solar:armchair-2-bold-duotone', 'i-solar:database-bold-duotone', 'i-solar:wi-fi-router-bold-duotone', 'i-solar:layers-bold-duotone', 'i-solar:box-minimalistic-bold-duotone', 'i-solar:filters-bold-duotone']
}
export function sharedUnoConfig() {
  return defineConfig({ presets: [presetWind3(), presetAttributify()], safelist: safelistSettingsEntryIcons() })
}
export default sharedUnoConfig()
