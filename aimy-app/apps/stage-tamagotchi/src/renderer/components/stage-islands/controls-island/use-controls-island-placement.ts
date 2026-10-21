import type { InjectionKey, Ref } from 'vue'

import { inject } from 'vue'

/** The desktop rail stays in the character window's upper-right corner. */
export type ControlsIslandDock = 'top-right'

/** Visual phase for a Controls Island corner change. */
export type ControlsIslandMotionPhase = 'idle' | 'leaving' | 'entering' | 'arriving'

/** Placement state shared by the Controls Island and its anchored surfaces. */
export interface ControlsIslandPlacement {
  /** Current corner inside the AIRI window. */
  dock: Readonly<Ref<ControlsIslandDock>>
  /** True when the Island uses the left edge of the AIRI window. */
  isLeft: Readonly<Ref<boolean>>
  /** True when the Island uses the top edge of the AIRI window. */
  isTop: Readonly<Ref<boolean>>
  /** Current phase of the fade and move animation. */
  motionPhase: Readonly<Ref<ControlsIslandMotionPhase>>
}

/** Placement contract provided by the Controls Island root. */
export const controlsIslandPlacementKey: InjectionKey<ControlsIslandPlacement> = Symbol('controls-island-placement')

/** Returns the placement from the nearest Controls Island root. */
export function useControlsIslandPlacement(): ControlsIslandPlacement {
  const placement = inject(controlsIslandPlacementKey)
  if (!placement) {
    throw new Error('useControlsIslandPlacement() requires a parent ControlsIslandRoot')
  }

  return placement
}
