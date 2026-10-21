<script setup lang="ts">
import type { ArtistrySyncPayload } from '@proj-airi/stage-shared'

import { defineInvokeHandler } from '@moeru/eventa'
import { useElectronEventaContext, useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { themeColorFromValue, useThemeColor } from '@proj-airi/stage-layouts/composables/theme-color'
import { artistrySyncConfig } from '@proj-airi/stage-shared'
import { ToasterRoot } from '@proj-airi/stage-ui/components'
import { useInferencePreload } from '@proj-airi/stage-ui/composables'
import { usePiniaSynced } from '@proj-airi/stage-ui/libs/pinia'
import { initializeAnalytics } from '@proj-airi/stage-ui/libs/product-signals'
import { flushAcceptanceGeneration } from '@proj-airi/stage-ui/services/acceptance-generation'
import { installCompanionMotionPreferences } from '@proj-airi/stage-ui/services/companion/motion'
import { onResourceRevoked } from '@proj-airi/stage-ui/services/resource-policy'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { useCharacterOrchestratorStore } from '@proj-airi/stage-ui/stores/character'
import { useChatStore } from '@proj-airi/stage-ui/stores/chat'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useCompanionStore } from '@proj-airi/stage-ui/stores/companion'
import { useCompanionSettingsStore } from '@proj-airi/stage-ui/stores/companion-settings'
import { usePluginHostInspectorStore } from '@proj-airi/stage-ui/stores/devtools/plugin-host-debug'
import { useDisplayModelsStore } from '@proj-airi/stage-ui/stores/display-models'
import { useMemoryStore } from '@proj-airi/stage-ui/stores/memory'
import { useModsServerChannelStore } from '@proj-airi/stage-ui/stores/mods/api/channel-server'
import { useContextBridgeStore } from '@proj-airi/stage-ui/stores/mods/api/context-bridge'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useArtistryStore } from '@proj-airi/stage-ui/stores/modules/artistry'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useHearingStore } from '@proj-airi/stage-ui/stores/modules/hearing'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useVisionStore } from '@proj-airi/stage-ui/stores/modules/vision'
import { useOnboardingStore } from '@proj-airi/stage-ui/stores/onboarding'
import { usePerfTracerBridgeStore } from '@proj-airi/stage-ui/stores/perf-tracer-bridge'
import { listProvidersForPluginHost, shouldPublishPluginHostCapabilities } from '@proj-airi/stage-ui/stores/plugin-host-capabilities'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { DEFAULT_THEME_COLORS_HUE, useSettings, useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings'
import { useSettingsStageModel } from '@proj-airi/stage-ui/stores/settings/stage-model'
import { useTheme } from '@proj-airi/ui'
import { isEqual } from 'es-toolkit'
import { storeToRefs } from 'pinia'
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { toast, Toaster } from 'vue-sonner'

import ResizeHandler from './components/ResizeHandler.vue'

import {
  electronGetServerChannelConfig,
  electronGodotStageGetStatus,
  electronGodotStageStatusChanged,
  electronSettingsNavigate,
  i18nGetLocale,
  i18nSetLocale,
} from '../shared/eventa'
import {
  electronPluginUpdateCapability,
  pluginProtocolListProviders,
  pluginProtocolListProvidersEventName,
} from '../shared/eventa/plugin/capabilities'
import {
  electronPluginCancelDirectoryImport,
  electronPluginCommitDirectoryImport,
  electronPluginInspect,
  electronPluginList,
  electronPluginLoad,
  electronPluginLoadEnabled,
  electronPluginPrepareDirectoryImport,
  electronPluginSetAutoReload,
  electronPluginSetEnabled,
  electronPluginUnload,
} from '../shared/eventa/plugin/host'
import { electronPluginToolsChanged } from '../shared/eventa/plugin/tools'
import { initializeElectronAuthCallbackBridge } from './bridges/electron-auth-callback'
import { initializeIOTraceRecordingBridge } from './bridges/io-trace-recording'
import { PersistenceDrain } from './bridges/persistence-drain'
import { onDesktopCloseFailure, registerDesktopShutdownParticipant } from './bridges/resource-policy'
import { initializeStageThreeRuntimeTraceBridge } from './bridges/stage-three-runtime-trace'
import { useLanguage } from './composables/use-language'
import { useScreenSharingStore } from './stores/screen-sharing'
import { useServerChannelSettingsStore } from './stores/settings/server-channel'
import { useStageWindowLifecycleStore } from './stores/stage-window-lifecycle'
import {
  useTamagotchiBuiltinToolsStore,
  useTamagotchiHomeAssistantStore,
  useTamagotchiMcpToolsStore,
  useTamagotchiPluginToolsStore,
} from './stores/tools'
import { resolveInitialRendererRoutePath, resolveRendererWindowContext } from './window-context'

import './styles/aimy-palette.css'

const { isDark: dark } = useTheme()
const settingsStore = useSettings()
const { language, themeColorsHue, themeColorsHueDynamic } = storeToRefs(settingsStore)
const router = useRouter()
const route = useRoute()
const context = useElectronEventaContext()
const getMainLocale = useElectronEventaInvoke(i18nGetLocale)
const setLocale = useElectronEventaInvoke(i18nSetLocale)
const windowContext = resolveRendererWindowContext()
const initialRoutePath = resolveInitialRendererRoutePath(route.path)
const chatStore = useChatStore()
const memoryStore = useMemoryStore()
const companionSettings = useCompanionSettingsStore()
const companionStore = useCompanionStore()
const screenSharingStore = useScreenSharingStore()
const stopCompanionMotion = installCompanionMotionPreferences()
const providerConfigStore = useProviderConfigStore()
const chatSessionStore = useChatSessionStore()
const persistenceDrain = new PersistenceDrain()
const stopPersistenceTracking = [
  // Avatar saves commit synchronously after validation; closing first awaits their owner-side cancellation.
  persistenceDrain.track(useAiriCardStore(), ['cancelCardAvatar']),
  persistenceDrain.track(companionSettings, ['save']),
  persistenceDrain.track(companionStore, ['createReview', 'cancel', 'runRules']),
  persistenceDrain.track(providerConfigStore, [
    'patchProviderConfig',
    'updateProviderConfig',
    'addProvider',
    'ensureProvider',
    'commitPreparedConfiguration',
    'ensurePreparedProvider',
    'removeProvider',
    'resetProviders',
    'setProviderModel',
    'setProviderModelIfUnset',
    'setProviderStatus',
    'markProviderAdded',
    'unmarkProviderAdded',
  ]),
  persistenceDrain.track(useProviderStore(), [
    'initializeProvider',
    'forceProviderConfigured',
    'setProviderUnconfigured',
    'deleteProvider',
    'resetProviderSettings',
  ]),
  persistenceDrain.track(memoryStore, ['submitProfile', 'correctFact', 'removeFact', 'setEnabled', 'setModelPolicy', 'retryFailedJobs']),
  persistenceDrain.track(chatSessionStore, [
    'commitUserMessage',
    'recordInterruption',
    'deleteMessage',
    'persistSessionMessages',
    'createSession',
    'deleteSession',
    'forkSession',
    'importSessions',
    'resetAllSessions',
    'setSessionMessages',
    'appendSessionMessage',
    'setActiveSession',
  ]),
  persistenceDrain.track(useOnboardingStore(), ['markSetupCompleted', 'markSetupSkipped', 'resetSetupState']),
]
const { t } = useI18n()
const stopCloseFailureNotice = onDesktopCloseFailure(() => toast.error(t('settings.pages.memory.closeFailed')))
const stopMemoryInvalidation = memoryStore.onInvalidated(() => {
  void chatStore.cancelPendingSends()
})
const stopResourceRevocation = onResourceRevoked((reason, kind) => {
  if (kind || reason === 'window-close')
    return
  memoryStore.revoke()
  void chatStore.cancelPendingSends()
})
const stopShutdownParticipant = registerDesktopShutdownParticipant({
  id: 'chat-and-memory',
  begin: request => persistenceDrain.begin(request.shutdownId),
  drain: request => persistenceDrain.waitFor(request.shutdownId, request.deadline),
  abort: shutdownId => persistenceDrain.abort(shutdownId),
  stop: async () => {
    memoryStore.revoke()
    await screenSharingStore.dispose()
    await companionStore.dispose()
    await chatStore.cancelPendingSends()
  },
  flush: async () => {
    await providerConfigStore.flushProviderConfigurations()
    await chatSessionStore.flushPersistence()
    await memoryStore.flush()
    await flushAcceptanceGeneration()
  },
  finalize: async () => {
    if (windowContext.leadership === 'leader-only') {
      await memoryStore.dispose()
      await flushAcceptanceGeneration()
    }
  },
})
const builtinToolsStore = useTamagotchiBuiltinToolsStore()
const homeAssistantStore = useTamagotchiHomeAssistantStore()
const mcpToolsStore = useTamagotchiMcpToolsStore()
const pluginToolsStore = useTamagotchiPluginToolsStore()
const syncedPinia = usePiniaSynced()
const companionRuntimeAllowed = ref(false)
const stopCompanionReady = watch([() => companionSettings.ready, companionRuntimeAllowed], ([ready, allowed]) => {
  if (ready && allowed && windowContext.leadership === 'leader-only')
    void companionStore.initialize(syncedPinia).catch(() => {})
})
const isSpotlightWindow = initialRoutePath === '/spotlight'
// The floating chat resizes from its own grip, which keeps the corner beside the character in place.
const isFloatingChatWindow = initialRoutePath === '/chat-floating'
const isSettingsWindow = initialRoutePath === '/settings' || initialRoutePath.startsWith('/settings/')
const stopIOTraceRecordingBridge = initialRoutePath === '/'
  ? initializeIOTraceRecordingBridge(context.value)
  : undefined

async function refreshPluginRuntimeTools() {
  try {
    await pluginToolsStore.refresh()
  }
  catch (error) {
    console.warn('[App] Failed to refresh plugin runtime tools:', error)
  }
}

// Every renderer creates the runtime tool stores for synchronized state. Only
// the main Stage renderer discovers tools and keeps executors.
const stopLeadershipListener = syncedPinia.onLeadershipChange((isLeader) => {
  if (!isLeader)
    return

  void builtinToolsStore.refresh().catch((error) => {
    console.warn('[App] Failed to refresh built-in runtime tools:', error)
  })
  void mcpToolsStore.refresh().catch((error) => {
    console.warn('[App] Failed to refresh MCP runtime tools:', error)
  })
  void homeAssistantStore.refresh().catch((error) => {
    console.warn('[App] Failed to refresh Home Assistant tools:', error)
  })
  void refreshPluginRuntimeTools()
})

function createFullStageRuntime() {
  const authStore = useAuthStore()
  const onboardingStore = useOnboardingStore()
  const contextBridgeStore = useContextBridgeStore()
  const displayModelsStore = useDisplayModelsStore()
  const serverChannelSettingsStore = useServerChannelSettingsStore()
  const cardStore = useAiriCardStore()
  const serverChannelStore = useModsServerChannelStore()
  const characterOrchestratorStore = useCharacterOrchestratorStore()
  const inferencePreload = useInferencePreload()
  const pluginHostInspectorStore = usePluginHostInspectorStore()
  const stageWindowLifecycleStore = useStageWindowLifecycleStore()
  const settingsAudioDeviceStore = useSettingsAudioDevice()
  const artistryStore = useArtistryStore()
  useConsciousnessStore()
  useHearingStore()
  useSpeechStore()
  useSettingsStageModel()
  useVisionStore()

  let stopAuthenticatedSetup: (() => void) | undefined
  let stopLoggedOutSetup: (() => void) | undefined

  async function removeAuthenticationProviderConfiguration() {
    if (!syncedPinia.isLeader())
      return

    await cardStore.configureForAuthentication(false)
  }

  function registerAuthenticatedSetup() {
    stopAuthenticatedSetup ??= authStore.onAuthenticated(async () => {
      if (!syncedPinia.isLeader())
        return

      await cardStore.configureForAuthentication(true)
      await onboardingStore.closeAfterAuthentication()
    })
    stopLoggedOutSetup ??= authStore.onLogout(removeAuthenticationProviderConfiguration)
  }

  const { activeProvider, artistryGlobals, activeModel, defaultPromptPrefix, providerOptions } = storeToRefs(artistryStore)
  const getServerChannelConfig = useElectronEventaInvoke(electronGetServerChannelConfig)
  const listPlugins = useElectronEventaInvoke(electronPluginList)
  const preparePluginDirectoryImport = useElectronEventaInvoke(electronPluginPrepareDirectoryImport)
  const commitPluginDirectoryImport = useElectronEventaInvoke(electronPluginCommitDirectoryImport)
  const cancelPluginDirectoryImport = useElectronEventaInvoke(electronPluginCancelDirectoryImport)
  const setPluginEnabled = useElectronEventaInvoke(electronPluginSetEnabled)
  const setPluginAutoReload = useElectronEventaInvoke(electronPluginSetAutoReload)
  const loadEnabledPlugins = useElectronEventaInvoke(electronPluginLoadEnabled)
  const loadPlugin = useElectronEventaInvoke(electronPluginLoad)
  const unloadPlugin = useElectronEventaInvoke(electronPluginUnload)
  const inspectPluginHost = useElectronEventaInvoke(electronPluginInspect)
  const reportPluginCapability = useElectronEventaInvoke(electronPluginUpdateCapability)
  const getGodotStageStatus = useElectronEventaInvoke(electronGodotStageGetStatus)
  const syncArtistryConfig = useElectronEventaInvoke(artistrySyncConfig)
  const usesGodotStage = initialRoutePath === '/' || initialRoutePath.startsWith('/settings')
  const isWidgetsWindow = initialRoutePath === '/widgets'

  function syncGodotStageRenderer(state: { state: 'stopped' | 'starting' | 'running' | 'stopping' | 'error' }) {
    if (state.state === 'running') {
      settingsStore.setStageModelRenderer('godot')
      return
    }

    if ((state.state === 'stopped' || state.state === 'error') && settingsStore.stageModelRenderer === 'godot')
      settingsStore.restoreBuiltInStageModelRenderer()
  }

  usePerfTracerBridgeStore()
  initializeStageThreeRuntimeTraceBridge()
  // The main process returns the callback only to the renderer that started
  // sign-in. Each login-capable window listens locally, while the synchronized
  // auth action still executes once in the main Stage leader.
  initializeElectronAuthCallbackBridge()
  void stageWindowLifecycleStore.initializeWindowLifecycleBridge()

  contextBridgeStore.setSparkNotifyHostRole(isWidgetsWindow ? 'client' : 'main')

  // NOTICE: register plugin host bridge during setup to avoid race with pages using it in immediate watchers.
  pluginHostInspectorStore.setBridge({
    prepareDirectoryImport: () => preparePluginDirectoryImport(),
    commitDirectoryImport: payload => commitPluginDirectoryImport(payload),
    cancelDirectoryImport: payload => cancelPluginDirectoryImport(payload),
    list: () => listPlugins(),
    setEnabled: async (payload) => {
      const result = await setPluginEnabled(payload)
      await refreshPluginRuntimeTools()
      return result
    },
    setAutoReload: payload => setPluginAutoReload(payload),
    loadEnabled: async () => {
      const result = await loadEnabledPlugins()
      await refreshPluginRuntimeTools()
      return result
    },
    load: async (payload) => {
      const result = await loadPlugin(payload)
      await refreshPluginRuntimeTools()
      return result
    },
    unload: async (payload) => {
      const result = await unloadPlugin(payload)
      await refreshPluginRuntimeTools()
      return result
    },
    inspect: () => inspectPluginHost(),
  })

  let lastSyncedArtistryConfig: ArtistrySyncPayload | undefined
  watch([activeProvider, artistryGlobals, activeModel, defaultPromptPrefix, providerOptions], () => {
    if (!activeProvider.value)
      return

    const config = JSON.parse(JSON.stringify({
      provider: activeProvider.value,
      globals: artistryGlobals.value,
      model: activeModel.value,
      promptPrefix: defaultPromptPrefix.value,
      options: providerOptions.value,
    })) as ArtistrySyncPayload
    if (isEqual(config, lastSyncedArtistryConfig))
      return

    // Pinia synchronization applies cloned snapshots in every renderer. Keep
    // this IPC bridge edge-triggered so equal snapshots do not repeat IO.
    lastSyncedArtistryConfig = config
    void syncArtistryConfig(config)
  }, { deep: true, immediate: true })

  context.value.on(electronGodotStageStatusChanged, (event) => {
    if (!event.body) {
      return
    }

    syncGodotStageRenderer(event.body)
  })

  context.value.on(electronPluginToolsChanged, () => {
    void refreshPluginRuntimeTools()
  })

  return {
    async initialize() {
      initializeAnalytics()
      await authStore.initialize()
      await displayModelsStore.initialize()
      await cardStore.initialize()
      if (windowContext.leadership === 'leader-only')
        await memoryStore.initialize(syncedPinia)
      await companionSettings.load().catch(() => {})
      registerAuthenticatedSetup()
      if (!authStore.isAuthenticated)
        await removeAuthenticationProviderConfiguration()

      await displayModelsStore.loadDisplayModelsFromIndexedDB()
      await settingsStore.initializeStageModel()
      await settingsAudioDeviceStore.initialize()

      if (usesGodotStage) {
        try {
          syncGodotStageRenderer(await getGodotStageStatus())
        }
        catch (error) {
          console.warn('[App] Failed to fetch Godot stage status:', error)
        }
      }

      const serverChannelConfig = await getServerChannelConfig()
      serverChannelSettingsStore.tlsConfig = serverChannelConfig.tlsConfig ?? null
      serverChannelSettingsStore.hostname = serverChannelConfig.hostname
      serverChannelSettingsStore.authToken = serverChannelConfig.authToken

      await serverChannelStore.initialize({
        token: serverChannelConfig.authToken || undefined,
        possibleEvents: ['ui:configure'],
      }).catch(err => console.error('Failed to initialize Mods Server Channel in App.vue:', err))
      contextBridgeStore.initialize()
      if (!isWidgetsWindow) {
        characterOrchestratorStore.initialize()
        companionRuntimeAllowed.value = true
        if (windowContext.leadership === 'leader-only')
          await companionStore.initialize(syncedPinia).catch(() => {})
      }

      defineInvokeHandler(context.value, pluginProtocolListProviders, async () => listProvidersForPluginHost())

      if (shouldPublishPluginHostCapabilities()) {
        await reportPluginCapability({
          key: pluginProtocolListProvidersEventName,
          state: 'ready',
          metadata: {
            source: 'stage-ui',
          },
        })
      }

      inferencePreload.triggerPreload()
    },
    dispose() {
      stopAuthenticatedSetup?.()
      stopLoggedOutSetup?.()
      contextBridgeStore.dispose()
    },
  }
}

const fullStageRuntime = windowContext.stageRuntime === 'full'
  ? createFullStageRuntime()
  : null

const { restore: restoreLocale } = useLanguage(language, getMainLocale, setLocale)

const { updateThemeColor } = useThemeColor(themeColorFromValue({ light: 'rgb(255 255 255)', dark: 'rgb(18 18 18)' }))
watch(dark, () => updateThemeColor(), { immediate: true })
watch(route, () => updateThemeColor(), { immediate: true })
onMounted(() => updateThemeColor())

if (isSettingsWindow) {
  context.value.on(electronSettingsNavigate, (event) => {
    const targetRoute = event?.body?.route
    if (!targetRoute || route.fullPath === targetRoute) {
      return
    }

    void router.push(targetRoute).catch((error) => {
      console.warn('Failed to navigate settings window:', error)
    })
  })
}

onMounted(async () => {
  // NOTICE: Issue #1658
  // When Electron restarts, renderer localStorage may not be flushed to disk.
  // The store's onMounted hook falls back to navigator.language, which triggers
  // watch(language) and overwrites the main-process config with the OS locale.
  // We must restore the correct locale from main process before allowing sync.
  // https://github.com/moeru-ai/airi/issues/1658
  await restoreLocale()

  await chatStore.initialize(syncedPinia)

  await fullStageRuntime?.initialize()
  if (initialRoutePath === '/') {
    // The store owns capture in the leader renderer only. Election can settle
    // after mount, so this refusal is expected and must not reject startup.
    try {
      screenSharingStore.initialize(syncedPinia)
    }
    catch (error) {
      console.warn('[App] Screen sharing is unavailable in this window:', error)
    }
  }
})

watch([themeColorsHue, themeColorsHueDynamic], ([hue, dynamic]) => {
  document.documentElement.style.setProperty('--chromatic-hue', hue.toString())
  document.documentElement.classList.toggle('dynamic-hue', dynamic)
  document.documentElement.classList.toggle('aimy-misty-pink', !dynamic && Math.abs(hue - DEFAULT_THEME_COLORS_HUE) < 0.01)
}, { immediate: true })

onUnmounted(() => {
  companionRuntimeAllowed.value = false
  stopCompanionReady()
  stopCompanionMotion()
  void screenSharingStore.dispose()
  void companionStore.dispose()
  stopCloseFailureNotice()
  stopMemoryInvalidation()
  stopResourceRevocation()
  stopShutdownParticipant()
  stopPersistenceTracking.forEach(stop => stop())
  // The synchronization plugin may already have disposed its live leadership state.
  if (windowContext.leadership === 'leader-only') {
    void memoryStore.dispose().catch(() => {
      console.warn('[memory] Renderer cleanup could not finish its persistence drain.')
    })
  }
  stopIOTraceRecordingBridge?.()
  stopLeadershipListener?.()
  chatStore.dispose()
  fullStageRuntime?.dispose()
})
</script>

<template>
  <ToasterRoot @close="id => toast.dismiss(id)">
    <Toaster />
  </ToasterRoot>
  <ResizeHandler v-if="!isSpotlightWindow && !isFloatingChatWindow" />
  <RouterView />
</template>

<style>
/* We need this to properly animate the CSS variable */
@property --chromatic-hue {
  syntax: '<number>';
  initial-value: 0;
  inherits: true;
}

@keyframes hue-anim {
  from {
    --chromatic-hue: 0;
  }
  to {
    --chromatic-hue: 360;
  }
}

.dynamic-hue {
  animation: hue-anim 10s linear infinite;
}
</style>

<style>
/* A lower chroma keeps the approved rose soft across existing AIRI primary controls. */
html.aimy-misty-pink {
  --chromatic-chroma: 0.093;
  --chromatic-chroma-50: 0.008;
  --chromatic-chroma-100: 0.016;
  --chromatic-chroma-200: 0.028;
  --chromatic-chroma-300: 0.045;
  --chromatic-chroma-400: 0.065;
  --chromatic-chroma-500: 0.093;
  --chromatic-chroma-600: 0.09;
  --chromatic-chroma-700: 0.078;
  --chromatic-chroma-800: 0.06;
  --chromatic-chroma-900: 0.04;
  --chromatic-chroma-950: 0.025;
}
</style>
