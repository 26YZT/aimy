import type { AimyBridge } from '../shared/contracts'

declare global {
  interface Window {
    aimy: AimyBridge
  }
}

export {}
