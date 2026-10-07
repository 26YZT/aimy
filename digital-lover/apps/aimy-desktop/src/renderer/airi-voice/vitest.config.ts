import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['src/renderer/airi-voice/**/*.test.ts', 'src/renderer/composables/*.test.ts'], environment: 'node' } })
