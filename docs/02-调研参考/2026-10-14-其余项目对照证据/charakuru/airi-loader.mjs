import {
  MToonMaterialLoaderPlugin,
  MToonMaterialOutlineWidthMode,
  VRMLoaderPlugin,
} from "file:///Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui-three/node_modules/@pixiv/three-vrm/lib/three-vrm.module.js"
import { VRMAnimationLoaderPlugin } from "file:///Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui-three/node_modules/@pixiv/three-vrm-animation/lib/three-vrm-animation.module.js"
import { GLTFLoader } from "file:///Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui-three/node_modules/three/examples/jsm/loaders/GLTFLoader.js"

let loader            

// Lilia: This is an experimental option to enable fallback outline for all materials regardless of the original outline settings.
const AIRI_ALL_OUTLINE = false

                                   
                                     
                     
 

class AiriMToonMaterialLoaderPlugin extends MToonMaterialLoaderPlugin {
          _outlineFallbackSettings                          

           async beforeRoot() {
    await super.beforeRoot()

    if (!AIRI_ALL_OUTLINE)
      return

    this._outlineFallbackSettings = this._resolveOutlineFallbackSettings()
  }

           extendMaterialParams(materialIndex        , materialParams                     ) {
    const pending = super.extendMaterialParams(materialIndex, materialParams)

    if (!AIRI_ALL_OUTLINE)
      return pending

    const extension = this._getMToonExtension(materialIndex)
    if (!extension)
      return pending

    if (this._hasEnabledOutline(extension))
      return pending

    if (!this._outlineFallbackSettings)
      return pending

    // NOTICE: We patch fallback outline params before three-vrm starts mesh setup so the upstream
    // `MToonMaterialLoaderPlugin` can keep using its own `_generateOutline()` path. This keeps the
    // same mesh + material array + geometry groups structure as the stock loader.
    materialParams.outlineWidthMode = this._outlineFallbackSettings.mode
    materialParams.outlineWidthFactor = this._outlineFallbackSettings.widthFactor

    return pending
  }

          _hasEnabledOutline(extension                                                                          ) {
    return typeof extension.outlineWidthMode === 'string'
      && extension.outlineWidthMode !== MToonMaterialOutlineWidthMode.None
      && typeof extension.outlineWidthFactor === 'number'
      && extension.outlineWidthFactor > 0
  }

          _resolveOutlineFallbackSettings() {
    const materials = (this.parser.json                             ).materials
    if (!materials?.length)
      return undefined

    const groupedWidthFactors = new Map                                         ()

    for (let materialIndex = 0; materialIndex < materials.length; materialIndex++) {
      const extension = this._getMToonExtension(materialIndex)
      if (!extension || !this._hasEnabledOutline(extension))
        continue

      const mode = extension.outlineWidthMode                                 
      const widthFactors = groupedWidthFactors.get(mode) ?? []
      widthFactors.push(extension.outlineWidthFactor )
      groupedWidthFactors.set(mode, widthFactors)
    }

    if (groupedWidthFactors.size === 0)
      return undefined

    let dominantMode                                           
    let dominantModeWidthFactors           = []

    for (const [mode, widthFactors] of groupedWidthFactors) {
      if (widthFactors.length <= dominantModeWidthFactors.length)
        continue

      dominantMode = mode
      dominantModeWidthFactors = widthFactors
    }

    if (!dominantMode || dominantModeWidthFactors.length === 0)
      return undefined

    const widthFactorAverage = dominantModeWidthFactors.reduce((sum, value) => sum + value, 0) / dominantModeWidthFactors.length

    return {
      mode: dominantMode,
      widthFactor: widthFactorAverage,
    }                                  
  }
}

export function useVRMLoader() {
  if (loader) {
    return loader
  }

  loader = new GLTFLoader()

  loader.crossOrigin = 'anonymous'
  loader.register((parser) => {
    // NOTICE: Keep the ALL_OUTLINE policy inside the loader stage so three-vrm itself can decide
    // whether to generate the built-in outline layer. This avoids rebuilding the same-mesh
    // dual-material/groups structure later in AIRI runtime hooks.
    const mtoonMaterialPlugin = new AiriMToonMaterialLoaderPlugin(parser)
    return new VRMLoaderPlugin(parser, { mtoonMaterialPlugin })
  })
  // loader.register(parser => new VRMCoreLoaderPlugin(parser))
  loader.register(parser => new VRMAnimationLoaderPlugin(parser))

  return loader
}
