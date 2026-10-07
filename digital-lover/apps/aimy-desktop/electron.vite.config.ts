import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import { presetAttributify, presetWind3 } from 'unocss'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { external: ['electron'], input: resolve(import.meta.dirname, 'src/main/index.ts') } } },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@moeru/eventa', '@electron-toolkit/preload'] })],
    build: { rollupOptions: { external: ['electron'], input: resolve(import.meta.dirname, 'src/preload/index.ts'), output: { format: 'cjs', entryFileNames: 'index.cjs' } } },
  },
  renderer: {
    resolve: { dedupe: ['vue', 'pinia'] },
    root: resolve(import.meta.dirname, 'src/renderer'), base: './', envDir: resolve(import.meta.dirname, 'build-env'),
    publicDir: resolve(import.meta.dirname, 'public'),
    plugins: [vue(), UnoCSS({ configFile: false, presets: [presetWind3(), presetAttributify()], content: { filesystem: [resolve(import.meta.dirname, '../../packages/ui/src/**/*.vue'), resolve(import.meta.dirname, '../../packages/stage-ui-three/src/**/*.vue')] } })],
    build: { rollupOptions: { input: resolve(import.meta.dirname, 'src/renderer/index.html') }, assetsInlineLimit: 0 },
  },
})
