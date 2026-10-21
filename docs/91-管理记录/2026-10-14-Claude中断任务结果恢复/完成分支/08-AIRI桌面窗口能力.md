Findings below. All paths absolute. Items marked **ABSENT** were verified with grep and do not exist.

---

## 1. Window creation & window flags

**Main stage/tamagotchi window:** `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/main/windows/main/index.ts` (lines 82–100)

```ts
const window = new BrowserWindow({
  title: 'AIRI',
  width: mainWindowConfig?.width ?? 450.0,
  height: mainWindowConfig?.height ?? 600.0,
  x: mainWindowConfig?.x,
  y: mainWindowConfig?.y,
  show: false,
  icon,
  webPreferences: {
    preload: join(dirname(fileURLToPath(import.meta.url)), '../preload/index.mjs'),
    sandbox: false,
  },
  type: isMacOS ? 'panel' : undefined,
  ...transparentWindowConfig(),
})
```

**Shared flags:** `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/main/windows/shared/window.ts:32`

```ts
export function transparentWindowConfig(): BrowserWindowConstructorOptions {
  return { frame: false, titleBarStyle: isMacOS ? 'hidden' : undefined, transparent: true, hasShadow: false }
}
export function blurryWindowConfig() { return { vibrancy: 'hud', backgroundMaterial: 'acrylic' } }
```

Post-creation, `main/index.ts:168–175`:

```ts
window.setVisibleOnAllWorkspaces(true)
if (isMacOS) { window.setFullScreenable(false); window.setWindowButtonVisibility(false) }
setWindowAlwaysOnTop(window, true)
window.on('ready-to-show', () => window!.show())
```

**ABSENT / not set anywhere:** `contextIsolation`, `nodeIntegration`, `backgroundColor`, `backgroundThrottling` (except desktop-overlay), `resizable: false` on main, `trafficLightPosition`, `hiddenInMissionControl`, `acceptsFirstMouse`, `roundedCorners` (except desktop-overlay `false`), `setShape`. `skipTaskbar` is not a constructor option on main; it is applied at runtime via `excludeWindowFromTaskbar` (spotlight only) and `AppIconVisibility`.

**Dragging:** `electron-click-drag-plugin` `startDrag(window.getNativeWindowHandle())` in `main/index.ts` on non-Linux. `-webkit-app-region:drag` **does** exist in renderer drag handles: `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/renderer/pages/widgets.vue:311`, `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/renderer/pages/caption.vue:102`; `no-drag` in `apps/stage-tamagotchi/src/renderer/components/Window/TitleBar.vue:30,39` and `apps/stage-tamagotchi/src/renderer/pages/devtools/live2d-motion.vue:37`.

---

## 2. Always-on-top

- **Level:** `'screen-saver'` with a `relativeLevel`. `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/main/windows/shared/window.ts:101`

```ts
if (isMacOS || isWindows) { window.setAlwaysOnTop(true, 'screen-saver', relativeLevel); return }
window.setAlwaysOnTop(true)   // Linux fallback
```

- `relativeLevel`: **1** for main window (`main/index.ts:175`), **2** for caption (`caption/index.ts`), plain `true` for spotlight constructor option, `'screen-saver'` (no relative) for desktop overlay (`desktop-overlay/window-contract.ts:60`).
- **User-toggleable, yes.** Stored in localStorage key `settings/always-on-top`, default `true`: `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/settings/controls-island.ts:6`

```ts
const alwaysOnTop = useLocalStorageManualReset<boolean>('settings/always-on-top', true)
```

Exposed at `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/settings/index.ts:91`. Toggled in `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/renderer/components/stage-islands/controls-island/index.vue:169,174` via `useElectronEventaInvoke(electronWindowSetAlwaysOnTop)`; pin button at lines 409–419. Main process handler: `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/main/services/electron/window.ts`.

---

## 3. Click-through / mouse passthrough

**Three independent mechanisms, all via `setIgnoreMouseEvents`:**

1. **Main window, fade-on-hover.** `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/renderer/utils/fade-on-hover.ts:41`

```ts
ignoreMouseEvents: params.clickThroughAvailable && (fadeStage || (transparentPixelsClickThrough && params.transparentForPointer)),
```

Driven from `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/renderer/pages/index.vue:331–339`:

```ts
clickThroughAvailable: !isWayland.value,   // native Wayland makes it one-way
transparentForPointer: isTransparentForMouseEvents.value,
...
setIgnoreMouseEvents([interaction.ignoreMouseEvents, { forward: true }])
```

Gate: `settings/always-on-top` must be on for `transparentPixelsClickThrough` (`fade-on-hover.ts`, `transparentPixelsClickThrough = params.enabled || params.alwaysOnTop`). `fadeOnHoverEnabled` from `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/renderer/stores/controls-island.ts:6` key `controls-island/fade-on-hover-enabled`, default `false`.

2. **Floating chat window, DOM hit test.** `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/renderer/composables/use-chat-floating-click-through.ts:115,188,204` — `void setIgnoreMouseEvents([!next, { forward: true }])` with `useMutationObserver(document.body, hitTest, { childList: true })`. Window starts ignoring: `apps/stage-tamagotchi/src/main/windows/chat/floating.ts:427` `target.setIgnoreMouseEvents(true, { forward: true })`.

3. **Caption overlay, bound to follow-mode.** `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/main/windows/caption/index.ts` — `applyIgnoreMouseEvents(win, ignore)` → `win.setIgnoreMouseEvents(true, { forward: true })` / `setIgnoreMouseEvents(false)`, bound to `isFollowing`.

4. **Desktop overlay, permanently isolated.** `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/main/windows/desktop-overlay/window-contract.ts:57`

```ts
window.setIgnoreMouseEvents(true, { forward: true })
window.setAlwaysOnTop(true, 'screen-saver')
window.setContentProtection(true)
window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
```

**IPC handler:** `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/main/services/electron/window.ts`

```ts
defineInvokeHandler(params.context, electron.window.setIgnoreMouseEvents, (opts, options) => {
  if (opts && params.window.webContents.id === options?.raw.ipcMainEvent.sender.id) {
    params.window.setIgnoreMouseEvents(...opts)
  }
})
```

**ABSENT:** `setShape`, `hitTest` as a native API, `clickThrough` as a config key, `pointer-events` in a windowing sense.

---

## 4. Multi-display / multi-monitor

**ABSENT: `display-metrics-changed`, `display-added`, `display-removed` listeners — grep over `apps/*/src` and `packages/*/src` returns zero hits.** AIRI does not react to display hot-plug events.

What does exist (all recompute on demand):

| Concern | File | Mechanism |
|---|---|---|
| Dominant-display math | `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/main/windows/shared/display.ts:11,63` | `screen.getDisplayMatching(bounds)`, `computeCenteredWindowBounds`, `computeResizedBoundsAnchoredToDominantDisplay`, `computeAdjacentPosition` |
| Per-display-matrix persistence | `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/main/windows/caption/index.ts:47` | `computeDisplayMatrixHash()` sha256 over sorted display bounds, stored in `matrices` key of config |
| Cursor-relative placement | `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/main/windows/spotlight/index.ts:43` | `screen.getCursorScreenPoint()` → `screen.getDisplayNearestPoint(cursorPoint)` → `display.workArea`, `y: y + workArea.height * 0.22` |
| Clamp-on-restore | `chat/floating.ts:420`, `widgets/index.ts:388` | `keepChatOnDisplay(...)` / clamp to `screen.getDisplayMatching(saved).workArea` |
| Tray alignment | `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/main/tray/index.ts:144` | `findDominantDisplayArea(mainWindowBounds, screen.getAllDisplays()) ?? screen.getDisplayMatching(mainWindowBounds)` |
| Overlay bounds | `desktop-overlay/index.ts:78` | `screen.getPrimaryDisplay()` |
| Renderer bridge | `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/main/services/electron/screen.ts:30-36` | invoke handlers for `electron.screen.getAllDisplays/getPrimaryDisplay/getCursorScreenPoint/dipToScreenPoint/screenToDipPoint` |

So: yes to display-relative positioning and position memory, **no** to display-change handling.

---

## 5. Auto-launch / startup — **ABSENT**

`grep -rn "setLoginItemSettings|openAtLogin|autoLaunch|auto-launch|launchAtLogin|loginItem"` over `apps/` and `packages/` (excluding `.cache` and `out/`) returns **zero hits**. The main-process app config has no such key: `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/main/configs/global.ts`

```ts
export const globalAppConfigSchema = object({
  hideAppIcon: optional(boolean()),
  language: optional(string()),
  spotlightShortcutAccelerator: optional(shortcutAcceleratorSchema),
  updateChannel: picklist(['latest','stable','alpha','beta','nightly','canary']),
})
export function createGlobalAppConfig() {
  const config = createConfig('app', 'options.json', globalAppConfigSchema)
  config.setup()
  return config
}
```

Only startup-adjacent feature is single-instance guarding (`installSingleInstanceGuard` in `main/index.ts`). **No launch-at-login.**

---

## 6. Tray

`/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/main/tray/index.ts` (304 lines). Icon: `nativeImage.createFromPath(isMacOS ? macOSTrayIcon : icon).resize({ width: 16 })` + `setTemplateImage(isMacOS)`. Constants `RECOMMENDED_WIDTH = 450`, `RECOMMENDED_HEIGHT = 600`.

Menu items (verbatim labels from i18n keys, lines ~150–265): show / **adjust_sizes** (recommended_size, full_height, half_height, full_screen) / **align_to** (center, top-left, top-right, bottom-left, bottom-right — each a `checkbox` with `checked: isPositionMatch(...)`) / settings / about / **open_inlay** / **open_widgets** / caption open-close / **caption_overlay** submenu (`follow_window` checkbox → `setFollowWindow`, `reset_position` → `resetToSide()`) / dev-only beatsync devtools / quit.

```ts
{ label: ..., checked: params.captionWindow.getIsFollowingWindow(),
  click: async menuItem => await params.captionWindow.setFollowWindow(Boolean(menuItem.checked)) },
```

Sizing/aligning uses `Animator(params.mainWindow).windowBoundsAnimateTo(bounds)`. Menu is rebuilt on `mainWindow.on('resize')` / `on('move')` and `captionWindow.onVisibilityChanged` (debounced 50 ms). Tray is the only way to open/close caption and widgets.

---

## 7. Global shortcuts

Service: `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/main/services/electron/global-shortcut.ts` — `setupGlobalShortcutService()` returns `{ registerWindow, registerMainShortcut, dispose }`. Two drivers: Electron `globalShortcut` (renderer-owned, broadcast `electronShortcutTriggered` with `phase: 'down'`) and `uiohook-napi` fallback (`global-shortcut-uiohook.ts`, dynamically imported, Linux ARM64 workaround documented). Main-owned shortcuts survive without a renderer context.

Only **two** shortcut registrations exist in the whole repo:

1. **Spotlight** — `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/main/windows/spotlight/index.ts:33`

```ts
const SPOTLIGHT_SHORTCUT_ID = 'spotlight'
const defaultSpotlightAccelerator: ShortcutAccelerator = { modifiers: ['ctrl', 'shift'], key: 'KeyA' }
```

Registered at lines 183 and 202 via `params.globalShortcut.registerMainShortcut({...})`; user-rebindable (`updateShortcutAccelerator`), persisted as `spotlightShortcutAccelerator` in `configs/global.ts`, edited in `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/renderer/pages/settings/system/window-shortcuts.vue`.

2. **Renderer window shortcuts** — `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/main/windows/settings/rpc/index.electron.ts:66` `params.globalShortcut.registerWindow({ context, window: params.settingsWindow })`, devtools page `apps/stage-tamagotchi/src/renderer/pages/devtools/global-shortcut.vue`.

Accelerator parsing/formatting shared: `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-shared/src/global-shortcut/accelerators.ts` (`parseAccelerator`, `formatAccelerator`, `formatElectronAccelerator`) and `types.ts` (`ShortcutAccelerator`, `ShortcutBinding`, `ShortcutRegistrationResult`, `ShortcutFailureReasons`).

---

## 8. Window position persistence — **yes, three separate systems**

| Window | Config file (namespace/filename) | Where |
|---|---|---|
| Main | `createConfig('app', 'config.json', appConfigSchema, { default: { windows: [] }, autoHeal: true })` — entry `{ title, tag, x, y, width, height }` matched by `w.title === 'AIRI' && w.tag === 'main'` | `windows/main/index.ts:72,80` |
| Caption | `createConfig('windows-caption', 'config.json', captionConfigSchema, { default: { isFollowing: true, matrices: {} } })` | `windows/caption/index.ts:152` |
| Chat | `createConfig('chat-window', 'config.json', chatWindowConfigSchema)` | `windows/chat/index.ts:106` |
| Widgets | `createConfig('windows-widgets', 'config.json', widgetsWindowConfigSchema)` | `windows/widgets/index.ts:288` |
| Dashboard | `createConfig('app', 'config.json', appConfigSchema, { default: { windows: [] } })` | `windows/dashboard/index.ts:55` |

Write path for main: `handleNewBounds(newBounds)` bound to `window.on('resize')` and `window.on('move')`. Re-export shim: `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/main/windows/shared/persistence.ts` → `../../libs/electron/persistence`.

Note: **no `electron-window-state` dependency**, and it is not app-wide — about/settings/editor/notice/onboarding/inlay/spotlight do not persist bounds. Caption and widgets additionally clamp saved positions into the display work area on restore (handles a display that went away).

---

## 9. Multi-window architecture

Every directory under `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/main/windows/`:

| Window | Purpose | Frameless/transparent | Always-on-top | Other |
|---|---|---|---|---|
| `main/` | Stage / tamagotchi pet | yes (transparent) | yes, `screen-saver` rel 1 | `type: 'panel'` macOS, all workspaces, title `AIRI` |
| `caption/` | Caption overlay | yes | yes, rel 2 | per-display matrix persistence, `setIgnoreMouseEvents` w/ follow mode |
| `spotlight/` | Cursor-anchored launcher, 720×100 | yes, `titleBarStyle: undefined` | yes (ctor `alwaysOnTop: true`) | `resizable/maximizable/minimizable: false`, `skipTaskbar: true`, `blur('hide')`, ctrl+shift+A |
| `chat/` | Chat window + `floating.ts` detached bubble | main plain, floating transparent | no | floating: `resizable: false` (renderer owns resize), starts click-through on |
| `widgets/` | Widget overlay, 760h | yes + `spotlightLikeWindowConfig()` (vibrancy hud) | via `showWindowOnAllWorkspaces` | `setFullScreenable(false)`, macOS button visibility |
| `desktop-overlay/` | Screen-wide ambient overlay | `roundedCorners: false`, `focusable: false` | yes, `screen-saver` | `backgroundThrottling: false`, `setContentProtection(true)`, `showInactive()` |
| `inlay/` | Inlay bar, 450×`INLAY_WINDOW_HEIGHT` | yes + blurry | no | `resizable: false`, `skipTaskbar: true`, `setWindowButtonVisibility(false)` |
| `settings/` | Settings, 600×800 | no | no | not settings-persisted |
| `dashboard/` | Dashboard, 1200×600 | no | no | shares `'app'` config |
| `editor/` | Editor, 1200×800 | no | no | |
| `about/` | About, 670×880 | no | no | |
| `notice/` | Notice, 1020×600 | no | no | |
| `onboarding/` | Welcome, 1000×650, `frame: !isMacOS` | no | no | only window that keeps a native frame on Windows/Linux |
| `beat-sync/` | Background audio analysis | hidden | — | devtools target in tray |
| `devtools/` | Devtools, 1020×720 | no | no | |
| `devtools/markdown-stress` | dev-only | — | — | |
| `shared/` | `window.ts`, `display.ts`, `persistence.ts`, `app-icon.ts`, `animator.ts`, `referenced-window.ts` | — | — | |

**Toggleable from settings UI: no.** The settings window (`apps/stage-tamagotchi/src/renderer/pages/settings/`) only exposes `hideAppIcon` in `system/general.vue`. Caption/inlay/widgets are toggled from **the tray** (section 6); opened from the stage at `apps/stage-tamagotchi/src/renderer/pages/index.vue:376,384` via `electronOpenInlay`; chat/settings/account via `electronOpenChat`/`electronOpenSettings` invokes.

---

## 10. TTS/audio pipeline & interruption

**`/Users/mima1234/Documents/aimy/aimy-app/packages/pipelines-audio/src/speech-pipeline.ts`** (479 lines)

```ts
export function createSpeechPipeline<TAudio>(options: SpeechPipelineOptions<TAudio>) {
  const priorityResolver = options.priority ?? createPriorityResolver()
  const segmenter = options.segmenter ?? createTtsSegmentStream
  const ttsMaxConcurrent = Math.max(1, options.ttsMaxConcurrent ?? 4)   // default 4
```

`IntentState` carries `priority`, `ownerId`, `behavior: 'queue' | 'interrupt' | 'replace'`, `controller: AbortController`, `stream`, `canceled`. `openIntent` (line 329):

```ts
const priority = priorityResolver.resolve(optionsInput?.priority)
const behavior = optionsInput?.behavior ?? 'queue'   // default behavior is 'queue'
const controller = new AbortController()
```

Behavior handling:

```ts
if (behavior === 'replace') { cancelIntent(activeIntent.intentId, 'replace'); void runIntent(intent); return handle }
if (behavior === 'interrupt' && intent.priority >= activeIntent.priority) {
  cancelIntent(activeIntent.intentId, 'interrupt'); void runIntent(intent); return handle
}
enqueueIntent(intent)
```

`pickNextIntent` sorts `(b.priority - a.priority) || (a.createdAt - b.createdAt)`. Returns `{ openIntent, cancelIntent, interrupt, stopAll, on }`. `cancelIntent` calls `options.playback.stopByIntent(intentId, reason)` when active; `stopAll(reason)` aborts all and calls `options.playback.stopAll(reason)`.

**Priorities** — `/Users/mima1234/Documents/aimy/aimy-app/packages/pipelines-audio/src/priority.ts`

```ts
const DEFAULT_LEVELS: Record<PriorityLevel, number> = { critical: 300, high: 200, normal: 100, low: 0 }
```

`createPriorityResolver(levels?)` → `resolve(priority?)` returns `resolved.normal` for null/unknown.

**Playback manager** — `/Users/mima1234/Documents/aimy/aimy-app/packages/pipelines-audio/src/managers/playback-manager.ts`

```ts
const maxVoices = Math.max(1, options.maxVoices ?? 1)                  // default 1
const maxVoicesPerOwner = options.maxVoicesPerOwner != null ? Math.max(1, options.maxVoicesPerOwner) : undefined
const overflowPolicy = options.overflowPolicy ?? 'queue'              // 'queue'|'reject'|'steal-oldest'|'steal-lowest-priority'
const ownerOverflowPolicy = options.ownerOverflowPolicy ?? 'steal-oldest'
```

Each `ActivePlayback` owns `controller: new AbortController()`; `interrupt()` does `entry.controller.abort(reason)` then `finalize()`. Public API: `{ schedule, stopAll(reason = 'stop-all'), stopByIntent(intentId, reason = 'stop-by-intent'), stopByOwner(ownerId, reason = 'stop-by-owner'), onStart, onEnd, onInterrupt, onReject }`.

**Only production consumer:** `/Users/mima1234/Documents/aimy/aimy-app/packages/core-agent/src/voice/output/response.ts:94`

```ts
const pipeline = createSpeechPipeline<Blob>({ tts: async (request, signal) => {...}, playback: {...} })
...
this.intent = pipeline.openIntent({ turnId: response.turn.turnId, ownerId: response.turn.sessionId })
```

It passes **no** `priority` and **no** `behavior` — so every normal speech turn is `normal` priority with `queue` behavior. Its `stopByIntent` only flushes its own `pending` set and fires interrupt listeners; `stopAll`/`stopByOwner` both delegate to `this.cancel(reason)`; `onReject` is a documented no-op.

**TTS chunking** — `/Users/mima1234/Documents/aimy/aimy-app/packages/pipelines-audio/src/processors/tts-chunker.ts`

```ts
export const TTS_FLUSH_INSTRUCTION = '\u200B'
export const TTS_SPECIAL_TOKEN = '\u2063'
const { boost = 2, minimumWords = 4, maximumWords = 12 } = options
```

Punctuation classes: `keptPunctuations = new Set('?？!！')`, `hardPunctuations = new Set('.。?？!！…⋯～~\n\t\r')`, `softPunctuations = new Set(',，、–—:：;；《》「」')`. Chunk `reason` is `'boost' | 'limit' | 'hard' | 'flush' | 'special'`. Also `processNarrative`/`isProbablyAngleTag` (stripNarrative) and `createTtsSegmentStream(tokens, meta, options)`.

---

## 11. VAD / speech input

**Library:** `@huggingface/transformers` + `onnx-community/silero-vad`, run inside an AudioWorklet. `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/workers/vad/silero-vad.ts`

```ts
this.model = AutoModel.from_pretrained('onnx-community/silero-vad', { config: new PretrainedConfig({ model_type: 'custom' }), dtype: 'fp32' })
// requires window.sampleRate === 16000 && window.channels[0]?.length === 512
```

**Params** — `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/ai/models/vad.ts`

```ts
const DEFAULT_VAD_THRESHOLD = 0.52
const DEFAULT_VAD_MIN_SILENCE_DURATION_MS = 1200
const DEFAULT_VAD_SPEECH_PAD_MS = 360
const DEFAULT_VAD_MIN_SPEECH_DURATION_MS = 300
// resolveVADConfig → { speechThreshold, exitThreshold: resolvedThreshold * 0.3, minSilenceDurationMs, speechPadMs, minSpeechDurationMs }
```

`useVAD(workerUrl, options)` creates the VAD at `{ sampleRate: 16000 }` and `createVADStates(createdVad, workerUrl, { minChunkSize: 512, audioContextOptions: { sampleRate: 16000, latencyHint: 'interactive' } })`. Watchers push `updateConfig` (`vad.ts:235`: `updateConfig({ speechThreshold: newVal, exitThreshold: newVal * 0.3 })`). Events: `speech-start`, `speech-audio`, `speech-end`, `speech-cancel`, `speech-ready`, `debug`, `status`.

Worklet-side default differs: `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/workers/vad/vad.ts:29` `speechThreshold: 0.3`, decision at line 236 `speechProb > this.config.speechThreshold`.

Worklet host: `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/libs/audio/vad.ts` — `BaseVADConfig` (sampleRate, speechThreshold, exitThreshold, minSilenceDurationMs, speechPadMs, minSpeechDurationMs, maxBufferDuration, newBufferSize) and `createVADStates` building `new AudioWorkletNode(audioContext, 'vad-audio-worklet-processor')` behind a silent GainNode.

**Echo suppression** — `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/renderer/utils/voice-input-suppression.ts`

```ts
export const DEFAULT_ASSISTANT_SPEECH_INPUT_COOLDOWN_MS = 800
export function shouldSuppressVoiceInput(options: VoiceInputSuppressionOptions, now = Date.now()) {
  return options.assistantSpeaking || now < options.suppressedUntil
}
export function assistantSpeechCooldownDeadline(endedAt = Date.now(), cooldownMs = DEFAULT_ASSISTANT_SPEECH_INPUT_COOLDOWN_MS) {
  return endedAt + cooldownMs
}
```

**This file has no production caller.** A full repo grep finds only its own test (`voice-input-suppression.test.ts`) referencing it. Echo suppression is written but **not wired in**.

---

## 12. Proactive/autonomous behavior ("spark")

**Orchestrator:** `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/character/orchestrator/store.ts` (324 lines)

```ts
const attentionConfig = ref({ tickIntervalMs: 2_000, taskNotifyWindowMs: 60_000, requeueDelayMs: 30_000, maxAttempts: 3 })
...
tickTimer = setInterval(() => { void tick() }, attentionConfig.value.tickIntervalMs)
```

`computeNextRunAt` (line 73): urgency `immediate` → 0, `soon` → 10 s, `later` → 60 s, default → 30 s, plus `attempts * requeueDelayMs`. `handleIncomingSparkNotify` runs immediately only when `urgency === 'immediate' && !processing`, else enqueues. `enqueueDueTasks` (line 189) synthesizes a `spark:notify` with

```ts
urgency: task.priority === 'critical' ? 'immediate' : 'soon',
```

`handleSparkEmit` (line 262) is `// Currently no-op`. `initialize()` subscribes to `spark:notify` and `spark:emit` on the mods server channel. Agent created at line 49 `createSparkNotifyAgent({...})`.

**Notebook:** `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/character/notebook.ts` (150 lines)

```ts
type NotebookEntryKind = 'note' | 'diary' | 'focus'
type TaskPriority = 'low' | 'normal' | 'high' | 'critical'
type TaskStatus = 'queued' | 'scheduled' | 'done' | 'dropped'
```

API: `scheduleTask`, `markTaskDone`, `requeueTask`, `markTaskNotified`, `getDueTasks(now, windowMs)`.

**Command schema / policy:** `/Users/mima1234/Documents/aimy/aimy-app/packages/core-agent/src/agents/spark-notify/agent.ts`

```ts
interrupt: (command.interrupt === true ? 'force' : command.interrupt) ?? false,
priority: command.priority ?? 'normal',
intent: command.intent ?? 'action',
```

`schema.ts:91-93` — `interrupt: 'force' | 'soft' | 'false' | null`, `priority: 'critical' | 'high' | 'normal' | 'low' | null`, `intent: 'plan' | 'proposal' | 'action' | 'pause' | 'resume' | 'reroute' | 'context' | null`. `resolveSparkNotifyRuntimePolicy(control?)` picks `forceTextResponse` / `forceSparkCommandResponse` / `forceResponse` / default variants over `allowNoResponse`, `allowSparkCommand`, `supportsTools`, `waitForTools`, `toolChoice`, `ignoreTextOutput`.

**Proactive speech vs. normal speech — the mapping does not exist.** These `interrupt` / `priority` / `intent` fields are parsed and forwarded onto the `spark:command` event (`orchestrator/store.ts:147`), but a repo-wide grep for `openIntent` shows only one production call site (`core-agent/src/voice/output/response.ts:151`) and it passes neither `priority` nor `behavior`. So a proactive spark utterance currently enters the speech pipeline as `priority: normal`, `behavior: 'queue'` — **identical to a normal reply**, with no forced interruption of in-flight speech.

---

## 13. Tools auto-disable by provider — **yes**

**Detection:** `/Users/mima1234/Documents/aimy/aimy-app/packages/core-agent/src/runtime/llm-service.ts:323-338`

```ts
const TOOLS_RELATED_ERROR_PATTERNS: RegExp[] = [
  /does not support tools/i,                          // Ollama
  /no endpoints found that support tool use/i,        // OpenRouter
  /functions are not supported/i,                     // Azure AI Foundry
  /unrecognized request argument.+tools/i,            // Azure AI Foundry
  /tool use with function calling is unsupported/i,   // Google Generative AI
  /does not support function.?calling/i,              // Anthropic
  /tools?\s+(is|are)\s+not\s+supported/i,             // Cloudflare Workers AI
]
export function isToolRelatedError(error: unknown): boolean {
  const message = String(error)
  return TOOLS_RELATED_ERROR_PATTERNS.some(pattern => pattern.test(message))
}
```

Plus `isContentArrayRelatedError` / `CONTENT_ARRAY_RELATED_ERROR_PATTERNS` (issue #1500).

**Per-model state:** `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/ai/chat-llm/llm.ts:23-73`

```ts
const toolsCompatibility = ref<Map<string, boolean>>(new Map())
const contentArrayCompatibility = ref<Map<string, boolean>>(new Map())
const key = modelKey(model, chatProvider.generation(model))
...
if (isToolRelatedError(err)) {
  console.warn(`[llm] Auto-disabling tools for "${key}" due to tool-related error`)
  toolsCompatibility.value.set(key, false)
}
```

**Enforcement:** `/Users/mima1234/Documents/aimy/aimy-app/packages/core-agent/src/runtime/request-context.ts:24-30`

```ts
export function supportsTools(model, request, options?): boolean {
  return options?.supportsTools ?? (options?.toolsCompatibility?.get(modelKey(model, request)) !== false)
}
```

Auto-disable is one-way per model per session (no re-enable logic).

---

## 14. Screen capture / vision

**Package:** `/Users/mima1234/Documents/aimy/aimy-app/packages/electron-screen-capture/` (`@proj-airi/electron-screen-capture`), exports `.`, `./main`, `./renderer`, `./vue`.

**Main module** `/Users/mima1234/Documents/aimy/aimy-app/packages/electron-screen-capture/src/main/index.ts` does four things:

1. `initScreenCaptureForMain({ forceCoreAudioTap = false, mutexAcquireTimeout = 5000 })` — appends Chromium feature flags `PulseaudioLoopbackForScreenShare` + `MacLoopbackAudioForScreenShare`, plus either `MacCatapSystemAudioLoopbackCapture` or `MacSckSystemAudioLoopbackOverride`. Guards re-entry with `initMainCalled`.
2. `hasSelectedScreenCaptureSource()` → `screenCaptureSourceMutexHandle !== undefined`, used by AIRI's permission handler to distinguish its own capture from an unsolicited request.
3. `initScreenCaptureForWindow(window, options)` — installs eventa invoke handlers `screenCapture.checkMacOSPermission`, `.requestMacOSPermission`, `.getSources`, `.setSource`, `.resetSource`, scoped `{ onlySameWindow: true }`. `setSource` acquires a timeout-guarded `async-mutex`, then assigns `session.setDisplayMediaRequestHandler` to resolve a specific `sourceId` into `{ video: source, audio: loopbackWithMute ? LoopbackAudioTypes.LoopbackWithMute : LoopbackAudioTypes.Loopback }`; auto-releases after `timeout ?? 5000` with a warning telling the caller to invoke `screenCaptureResetSource`.
4. macOS permission wrappers in `src/main/utils.ts`.

Contracts in `/Users/mima1234/Documents/aimy/aimy-app/packages/electron-screen-capture/src/index.ts` — `screenCaptureGetSources`, `screenCaptureSetSourceEx`, `screenCaptureResetSource`, `screenCaptureCheckMacOSPermission`, `screenCaptureRequestMacOSPermission`.

Renderer composable `/Users/mima1234/Documents/aimy/aimy-app/packages/electron-screen-capture/src/vue/use-electron-screen-capture.ts` — `useElectronScreenCapture(ipcRenderer, sourcesOptions)` returning `{ getSources, setSource, resetSource, selectWithSource, checkMacOSPermission, requestMacOSPermission }`.

Consumers: `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/renderer/composables/use-screen-ambient-light.ts:143`, `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/renderer/composables/use-vision-screen-capture.ts:44`, `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/renderer/components/WithScreenCapture.vue:26`.

**Vision model slot: yes.** `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/modules/vision/store.ts:17-23`

```ts
const activeProvider = useLocalStorageManualReset('settings/vision/active-provider', '', persistenceOptions)
const activeModel = useLocalStorageManualReset('settings/vision/active-model', '', persistenceOptions)
const activeCustomModelName = useLocalStorageManualReset('settings/vision/active-custom-model', '', persistenceOptions)
const ollamaThinkingEnabled = useLocalStorageManualReset('settings/vision/ollama-thinking-enabled', false, persistenceOptions)
const useForChat = useLocalStorageManualReset('settings/vision/use-for-chat', true, persistenceOptions)
```

All default `''` / unset — a user must configure vision explicitly. Consumer chain: `orchestrator.ts:52` `const { activeProvider, activeModel } = storeToRefs(visionStore)`, bailing at line 62 `if (!activeProvider.value || !activeModel.value)`. Activity tracking in `activity.ts` (`useVisionActivityStore`, `contextId: 'vision:screen:interpret'`). UI: `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-pages/src/pages/settings/modules/vision.vue` plus provider pages under `settings/providers/vision/{azure-ai-foundry,[providerId],lm-studio,apple-vision,ollama,cloudflare-workers-ai,official-provider,amazon-bedrock}.vue`.

---

## 15. Memory subsystem — **stub**

`/Users/mima1234/Documents/aimy/aimy-app/packages/memory-pgvector/src/index.ts` is the entire package source (only `package.json`, `tsconfig.json`, `src/index.ts` exist):

```ts
async function main() {
  const client = new Client<{ connectionString: string }>({ name: 'memory-pgvector' })
  client.onEvent('module:configure', (_event) => {
  })
  runUntilSignal()
  process.on('SIGINT', () => client.close())
  process.on('SIGTERM', () => client.close())
}
main()
```

No pgvector import, no embeddings, no retrieval, no storage. The `module:configure` handler body is empty.

**Every memory settings page is the same `WIP` placeholder:**

`/Users/mima1234/Documents/aimy/aimy-app/packages/stage-pages/src/pages/settings/memory/index.vue`, `.../settings/modules/memory-short-term.vue`, `.../settings/modules/memory-long-term.vue` all reduce to

```vue
<script setup lang="ts">
import { WIP } from '@proj-airi/stage-ui/components'
</script>
<template>
  <WIP />
</template>
```

No "unavailable" wording — it is a WIP badge. Short-term and long-term memory are both unimplemented in the UI and in the module.

---

## Summary of explicit absences

| Not present | Evidence |
|---|---|
| `setLoginItemSettings` / `openAtLogin` / any auto-launch | repo-wide grep, zero hits |
| `display-metrics-changed` / `display-added` / `display-removed` | repo-wide grep over `src`, zero hits |
| `trafficLightPosition`, `hiddenInMissionControl`, `acceptsFirstMouse` | zero hits |
| `contextIsolation`, `nodeIntegration`, `backgroundThrottling` as explicit options | never set; only desktop-overlay sets `backgroundThrottling: false` |
| `setShape` | zero hits |
| Production caller of `voice-input-suppression.ts` | only its own `.test.ts` |
| Spark→speech `priority` / `behavior` mapping | single `openIntent` call site passes neither |
| Working memory subsystem | stub + `WIP` pages |
| Window toggles in settings UI | toggles live in the tray, not settings |