import type { Plugin } from 'vue'
import type { RouteRecordRaw } from 'vue-router'

import Tres from '@tresjs/core'

import { autoAnimatePlugin } from '@formkit/auto-animate/vue'
import { PiniaColada } from '@pinia/colada'
import { trackButtonPlugin } from '@proj-airi/stage-ui/directives/track-button'
import { browserAuthorizationHandler, registerAuthorizationHandler } from '@proj-airi/stage-ui/libs/auth'
import { setupSynced } from '@proj-airi/stage-ui/libs/pinia'
import { configureAnalyticsAdapter } from '@proj-airi/stage-ui/libs/product-signals'
import { configureAcceptanceGeneration } from '@proj-airi/stage-ui/services/acceptance-generation'
import { configureLocalOnly } from '@proj-airi/stage-ui/services/local-data-policy'
import { configureProviderSecretStorage } from '@proj-airi/stage-ui/services/provider-secret-storage'
import { configureAcceptanceBudget } from '@proj-airi/stage-ui/stores/memory/budget'
import { MotionPlugin } from '@vueuse/motion'
import { createPinia } from 'pinia'
import { setupLayouts } from 'virtual:generated-layouts'
import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import { handleHotUpdate, routes } from 'vue-router/auto-routes'

import App from './App.vue'

import { createAcceptanceBudgetBridge, readAcceptanceCampaign } from './bridges/acceptance-budget'
import { createProviderSecretStorageBridge } from './bridges/provider-secrets'
import { installDesktopResourcePolicy } from './bridges/resource-policy'
import { i18n } from './modules/i18n'
import { resolveRendererWindowContext } from './window-context'

import '@unocss/reset/tailwind.css'
import 'splitpanes/dist/splitpanes.css'
import 'vue-sonner/style.css'
import './styles/main.css'
import 'uno.css'
// Fonts
import '@proj-airi/font-cjkfonts-allseto/index.css'
import '@proj-airi/font-xiaolai/index.css'
import '@fontsource-variable/dm-sans/index.css'
import '@fontsource-variable/jura/index.css'
import '@fontsource-variable/quicksand/index.css'
import '@fontsource-variable/urbanist/index.css'
import '@fontsource-variable/comfortaa/index.css'
import '@fontsource/dm-mono/index.css'
import '@fontsource/dm-serif-display/index.css'
import '@fontsource/gugi/index.css'
import '@fontsource/kiwi-maru/index.css'
import '@fontsource/m-plus-rounded-1c/index.css'
import '@fontsource-variable/nunito/index.css'

async function bootstrap() {
  configureLocalOnly()
  configureProviderSecretStorage(createProviderSecretStorageBridge())
  installDesktopResourcePolicy()
  const acceptanceCampaign = await readAcceptanceCampaign()
  if (acceptanceCampaign) {
    configureAcceptanceBudget(createAcceptanceBudgetBridge())
    configureAcceptanceGeneration(acceptanceCampaign)
  }

  configureAnalyticsAdapter(async (options) => {
    const { createOpenpanelAdapter } = await import('@proj-airi/stage-ui/libs/product-signals/openpanel')
    return createOpenpanelAdapter(options)
  })
  registerAuthorizationHandler(browserAuthorizationHandler)

  const pinia = createPinia()
  const synced = setupSynced({
    leadership: resolveRendererWindowContext().leadership,
  })
  pinia.use(synced.pinia)

  const router = createRouter({
    history: createWebHashHistory(),
    // TODO: vite-plugin-vue-layouts is long deprecated, replace with another layout solution
    routes: setupLayouts(routes as RouteRecordRaw[]),
  })

  if (import.meta.hot) {
    handleHotUpdate(router, (updatedRoutes) => {
      router.clearRoutes()
      for (const route of setupLayouts(updatedRoutes))
        router.addRoute(route)
    })
  }

  createApp(App)
    .use(synced.vue)
    .use(MotionPlugin)
    // TODO: Fix autoAnimatePlugin type error
    .use(autoAnimatePlugin as unknown as Plugin)
    .use(router)
    .use(pinia)
    .use(PiniaColada)
    .use(i18n)
    .use(Tres)
    .use(trackButtonPlugin)
    .mount('#app')
}

void bootstrap().catch(() => {
  console.error('[startup] Aimy could not complete its protected initialization.')
  const root = document.querySelector('#app')
  const notice = document.createElement('p')
  notice.setAttribute('role', 'alert')
  notice.textContent = navigator.language.startsWith('zh')
    ? 'Aimy 未能完成启动，请重新打开。'
    : 'Aimy could not start. Please reopen the app.'
  root?.replaceChildren(notice)
})
