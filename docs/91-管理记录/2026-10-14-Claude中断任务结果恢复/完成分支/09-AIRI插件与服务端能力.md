# AIRI (`aimy-app`) — Capability Inventory

Repo root: `/Users/mima1234/Documents/aimy/aimy-app/` — `@proj-airi/root` v0.12.0-beta.5, pnpm workspace, Turbo + Vitest + tsdown. Git remote `26YZT/aimy`, branch `main`; commit `bf41903` ("R1 主工程切换——AIRI v0.12.0-beta.5 完整副本落库 aimy-app/") is the verbatim upstream AIRI import, so package names/author fields still say `@proj-airi/*` / Moeru AI Project AIRI Team.

---

## 1. Plugin / extension system — EXISTS, real, wired, well-tested

**Core SDK** `/Users/mima1234/Documents/aimy/aimy-app/packages/plugin-sdk/`
- `src/index.ts` — prints a WIP console warning, then re-exports `./extension`, `./kit`, `./plugin`.
- `package.json` exports two entries, and the second is the runtime split: `./plugin-host` → `node` condition resolves to `dist/plugin-host/runtimes/node/index.mjs`, default to `.../runtimes/web/index.mjs`. That is the isolation boundary mechanism (Node loader vs web loader), not a class-based sandbox.
- `src/plugin-host/core.ts` — `PermissionDeniedError`; `ExtensionSession` {id, extension{id,version,sessionId}, manifest, runtime?, entrypoint, phase: `'setting-up'|'ready'|'failed'|'stopped'`, modules: Map, permissions{requested/granted/revision}, subscriptions: DisposableStore}; `ExtensionHostBindingListOptions`. Host orchestration class lives here.
- `src/plugin-host/shared/manifest.ts` — `parseExtensionManifest(value)` via valibot `safeParse(extensionManifestV2Schema, value)` → `{success:true, manifest}` | `{success:false, diagnostics:{path,message}[]}`.
- `src/plugin-host/shared/types.ts` — `pluginRuntimeValues = ['electron','node','web']`, `PluginRuntime`, `HostDataValue/Array/Record`, `ExtensionProvidedKitDeclaration` {id, version, exposure: `'local-only'|'remote-observable'|'remote-callable'`}, `ExtensionUsedKitDeclaration` {id, version, optional?}, `ExtensionKitManifest`.
- `src/plugin-host/activation-plan.ts` — `ActivationDiagnosticCode` union: `duplicate-installed-extension`, `duplicate-loaded-extension`, `enabled-extension-not-installed`, `incompatible-airi-version`, `incompatible-runtime`, `duplicate-extension-provider`, `host-kit-id-conflict`, `missing-required-kit`, `incompatible-kit-version`, `dependency-cycle`, `restart-extension-not-loaded`. Plus `KitDependencyProvider = {kind:'host'|'extension'|'unresolved'}`.
- `src/channels/{index,shared}.ts` — `ExtensionChannelScope`, `ModuleChannelScope`, `createExtensionChannelScope()`, `createModuleChannelScope()`, `type ChannelHost = EventContext<unknown, {raw?: any}>`. **This is the only "Channel" abstraction in the repo** (see area 2).
- `src/plugin-host/runtimes/` — `node/index.ts` + `node/loaders/fs.ts`; `web/index.ts`; `shared/services/{dependencies,extension-sessions,kit-api-bindings,kits,permissions,resources}.ts` — each with a sibling `.test.ts`.
- Tests: `plugin-host/core.test.ts`, `activation-plan.test.ts`, `extension/index.test.ts`, `kit/index.test.ts`, `channels/index.test.ts`, `shared/packs.test.ts`, `bindings.test.ts`; 6 fixture extensions under `src/plugin-host/testdata/`.
- Design docs: `packages/plugin-sdk/docs/design/{architecture,multi-transport,capability-orchestration}.md` (control plane / data plane, capability model such as `context.read`, `ui.panel`, `vision.stream`, three deployment modes).

**Protocol** `/Users/mima1234/Documents/aimy/aimy-app/packages/plugin-protocol/src/types/events.ts` — WebSocket event payload types: `PluginIdentity`, `ModuleIdentity`, `ModulePermissionDeclaration`, `ModulePermissionGrant`, `ExtensionIdentity`, `Discord`/`DiscordGuildMember`; test `events.test.ts`.

**Tamagotchi kits** `/Users/mima1234/Documents/aimy/aimy-app/packages/plugin-sdk-tamagotchi/`
- `src/kits/gamelet/index.ts` — `CreateGameletOptions<TInit>`, `GameletHandle<TInit>` {id, bindingId (`<moduleId>:<gameletId>`), init, open/configure/request/close/isOpen}, `createGamelet(module, options)`.
- `src/kits/tool/index.ts` — `RegisterToolsOptions`, `normalizePrompt()`, `registerTools(module, options)`.
- `src/tools/registry.ts` — `TamagotchiToolRegistry` keyed `${ownerExtensionId}:${toolId}` with `register/registerToolsetPrompt/unregister/unregisterOwnerSession/unregisterOwnerScope/clear/listAvailableDescriptors/listToolsetPrompts/listSerializedXsaiTools/invoke`.

**Electron wiring** `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/main/services/airi/plugins/`
- `index.ts` — `setupExtensionHost(options)`. Creates an Eventa context over `ipcMain`, then `defineInvokeHandler`s for `electronPluginList / PrepareDirectoryImport / CommitDirectoryImport / CancelDirectoryImport / SetEnabled / SetAutoReload / LoadEnabled / Load / Unload / Inspect / GetAssetBaseUrl / ListAgentTools / ListXsaiTools / InvokeTool / UpdateCapability`. Registered as injeca key `'modules:plugin-host'` at `apps/stage-tamagotchi/src/main/index.ts:263`, depending on `{serverChannel, widgetsManager}`.
- Security detail worth noting: `requireExtensionManagementEvent()` enforces that directory import only comes from the Extension-management renderer (`event.sender.id === getExtensionManagementWebContentsId()`), and `assertImportPlanOwner()` binds each import plan to the renderer that created it; plans are cancelled when that window closes. Uses `securityScopedBookmarks: true` on macOS.
- Manifest discovery paths are documented in that file's docblock: `<userData>/extensions/v1`, state in `extensions-v1.json`.
- Other files: `types.ts` (`SetupExtensionHostOptions`, `ExtensionHostService`), `host/{index,registry,managed-sessions,config,debug,directory-import}.ts`, `features/auto-reload/index.ts`, `features/static-assets/index.ts`, `kits/gamelet/*`, `kits/widget/*`.

**Renderer surface** — `packages/stage-pages/src/pages/devtools/plugin-host.vue` (inspector), `packages/stage-ui/src/stores/devtools/plugin-host-debug.ts` (`usePluginHostInspectorStore`, `PluginHostDebugBridge` — injected via `setBridge` because stage-pages is shared web+desktop while the IPC only exists in Electron main), `packages/stage-ui/src/stores/plugin-host-capabilities.ts`, `apps/stage-tamagotchi/src/renderer/widgets/extension-ui/*`.

**Standalone plugins** `/Users/mima1234/Documents/aimy/aimy-app/plugins/` — `airi-plugin-claude-code` (src/cli.ts, run.ts), `airi-plugin-bilibili-laplace` (src/index.ts), `airi-plugin-web-extension` (wxt browser extension), and `airi-plugin-game-chess` which is **package.json only — a stub, no src/ directory**.

**Maturity: high for the host, low for the sample plugins.** Extensive unit coverage, real IPC wiring, a devtools inspector, and a design doc set. No `isolated-vm`, no VM/worker sandbox, no process-level isolation found — grep for `isolated-vm|isolated_vm|sandbox` across `packages/plugin-sdk/src` and the Electron plugin service returned **zero hits**. Containment is permission/declaration-based plus the node-vs-web loader split.

---

## 2. Server channel architecture — EXISTS

**`/Users/mima1234/Documents/aimy/aimy-app/packages/server-sdk/`**
- `README.md`, `src/client.ts` — `class Client<C>`, `ClientStatus = 'idle'|'connecting'|'authenticating'|'announcing'|'ready'|'reconnecting'|'closing'|'closed'|'failed'`, `ClientOptions` {url, name, token, connector, handshake: `'module'|'manual'`, connectTimeoutMs, possibleEvents, extension, identity, dependencies, configSchema, heartbeat, autoConnect, autoReconnect, maxReconnectAttempts, onError/onClose/onReady/onStateChange/onAnyMessage/onAnySend}. `createTextProtocolConnector`, `createDefaultProtocolConnector` (default **`ws://localhost:6121/ws`**), `prepareProtocolConnection` (authenticate → announce → await `extension:module:announced` / `registry:modules:sync`), `send`, `sendOrThrow`, `createClient()`.
- Also `src/codec.ts`, `src/extension-peer.ts`, `src/utils/node/process.ts` (`runUntilSignal`); tests `test/{codec,client,extension-peer}.test.ts`.

**`/Users/mima1234/Documents/aimy/aimy-app/packages/server-runtime/`** — H3 + `@proj-airi/better-ws/server` + crossws; auth via `timingSafeEqual`; `createPolicyMiddleware`, `collectDestinations`, `matchesDestinations`, `isDevtoolsPeer`.
- `src/server-ws/airi/{index,codec,routing,consumers,liveness,responses}.ts` (+tests). Routing: `resolveEventDelivery(event)` merges `getProtocolEventMetadata(event.type).delivery` with `event.route?.delivery` → `DeliveryConfig`; `forEachEventMiddlewares({event, fromPeer, peers, destinations, middleware})` returns the first `RouteDecision`. Consumers: `createConsumerOrchestrator`, `isConsumerDeliveryMode`, `normalizeConsumerMode`, `normalizeConsumerPriority`, `selectConsumerPeerId`, `ConsumerStickyAssignment`.
- Also `src/middlewares/{index,route}.ts`, `src/config/{index,env,config}.ts`, `src/bin/run.ts`.
- **No workflow or pipeline concept** — grep for `workflow|Workflow|pipeline|Pipeline` across `packages/server-{sdk,runtime,shared}/src` returned **zero hits**. The only `pipelines-*` package is `packages/pipelines-audio`, which is audio playback/TTS chunking, unrelated to server routing.

**`/Users/mima1234/Documents/aimy/aimy-app/packages/server-shared/`** — `src/errors.ts` (`parseServerErrorMessage`, `isTerminalAuthenticationServerErrorMessage`), `src/types/websocket/{events,index}.ts` (`WebSocketEvent`, `WebSocketBaseEvent`, `WebSocketEvents`, `DeliveryConfig`, `MessageHeartbeat`, `ContextUpdateStrategy`, `WebSocketEventSource`, `getProtocolEventMetadata`).

**Protocol event names** (from `plugin-protocol` + `server-shared`): `module:authenticate`, `module:authenticated`, `extension:module:announce`, `extension:module:announced`, `registry:modules:sync`, `extension:announced`, `module:configure`, `peer:authenticated`, `transport:connection:heartbeat`.

**Electron embedding** `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/main/services/airi/channel-server/{index,config,config.test}.ts` — `setupServerChannel`, `createServer`, `getLocalIPs`, `createServerChannelQrPayload`, default port 6121 (`SERVER_CHANNEL_PORT`), mkcert TLS, config persisted at `server-channel/config.json`.

**"Channel" abstraction answer:** there is **no `Channel` class or interface** in `server-sdk`, `server-runtime`, or `server-shared` — grep for `class Channel|interface Channel` across those three returned nothing. The word "channel" appears only as (a) `ExtensionChannelScope`/`ModuleChannelScope`/`ChannelHost` in `packages/plugin-sdk/src/channels/`, wrapping Eventa contexts, and (b) the Electron `channel-server` service, which is the host process for the WebSocket server. Message routing is Eventa + `DeliveryConfig`/`route.delivery` + consumer orchestration, not a Channel object.

**Hosted backend** `/Users/mima1234/Documents/aimy/aimy-app/server/` is a separate concern (not the channel plane): `apps/api`, `apps/auth` (Better Auth + OIDC; `src/plugins/{steam,ban-guard,oidc-jwt-bearer}.ts`), `packages/auth-shared`, `packages/server-sdk-shared`, `dev/caddy/Caddyfile`, `docker-compose.yaml`, and 15 ADRs under `server/docs/ai/adr/`.

---

## 3. IM / chat platform adapters — partially EXISTS, in `integrations/`, NOT plugin-host based

`/Users/mima1234/Documents/aimy/aimy-app/integrations/` contains: `discord-bot`, `minecraft`, `satori-bot`, `telegram-bot`, `twitter-services`, `vscode`.

- **Discord** — `integrations/discord-bot/src/adapters/airi-adapter.ts` is the adapter. Concrete interface: `export class DiscordAdapter` with `DiscordAdapterConfig {discordToken?, airiToken?, airiUrl?}`, and it imports `Client as ServerChannel` from `@proj-airi/server-sdk` plus `ContextUpdateStrategy` from `@proj-airi/server-shared/types`. So the adapter pattern is: a per-platform class holding a `ServerChannel` client, which normalizes platform payloads into AIRI `Discord` metadata (`normalizeDiscordMetadata()`) and pushes them over the channel. Supporting: `src/pipelines/tts.ts`, `src/bots/discord/commands/{ping,summon,index}.ts`, `src/utils/{audio,opus,audio-monitor}.ts`. Deps `discord.js ^14.27.0`, `@discordjs/voice`, `@snazzah/davey`, `opusscript`.
- **Telegram** — grammy-based: `src/index.ts`, `src/llm/{index,actions,image,photo,sticker,animated-sticker}.ts`, `src/models/*`, drizzle migrations (6), `deploy/{tempo,otel-collector,prometheus}`.
- **Satori** — `src/adapter/satori/{client,api,schema,types}.ts`, `src/core/dispatcher.ts`, `src/core/planner/{llm-client,prompts/*}`, `src/capabilities/{definition,registry}.ts` + `capabilities/actions/{send-message,read-messages,system}.ts`. Has its own capability registry, distinct from plugin-sdk Kits.
- **Minecraft** — mineflayer: `src/minecraft-bot-runtime.ts`, `src/cognitive/{container,types,event-bus}.ts` (+test), `src/skills/*` (inventory/blocks/crafting/movement/combat/containers + tests), `src/plugins/{status,echo,follow,pathfinder}.ts`.
- **twitter-services**, **vscode** — present; not inspected in depth.
- **Not found:** no Slack, QQ, or WeChat adapter. Searched `integrations/`, `plugins/`, and `packages/` by directory listing and name grep — the six integrations above are the complete set.

Note that each integration is an independent npm package with its own deps and deploy config; there is no shared `IMAdapter` interface in packages. Adapters share only the `server-sdk` `Client` as their transport.

---

## 4. LLM provider abstraction — EXISTS, two-layer

**Layer 1 — portable, framework-free:** `/Users/mima1234/Documents/aimy/aimy-app/packages/provider-inference/`
- `src/providers/registry.ts` — `interface ProviderRegistry { get(id), list() }`, `defineProvider<TConfig,TId>(definition)`, `createProviderRegistry(definitions)` (throws on duplicate id; sorts by `order` then `name`).
- `src/providers/index.ts` — `portableProviderDefinitions = eraseProviderDefinitions(...)`.
- `src/types.ts` — `ProviderInstance` union (Generation | Chat | Embed | Speech | Transcription | Model), `GenerationRequest = {protocol:'chat-completions', config} | {protocol:'responses', config, webSearch}`, `GenerationCapabilities`, `DEFAULT_CONCURRENT_VISION_READS = 4`, `ProviderValidationStatus = 'unconfigured'|'validating'|'configured'|'invalid'|'bypassed'`, `InferenceServiceProvider`, `ProviderExtraMethods {listModelCatalog, listModels, voiceCatalogConfig, listVoices, loadModel}`, `ProviderValidationCheck` (Connectivity/ModelList/ChatCompletions/Health), `getGenerationProvider()`, `isGenerationProvider()`.
- 43 provider directories under `src/providers/cloud/` and 8 under `src/providers/local/`. Chat/LLM ids observed: `302-ai`, `aihubmix`, `amazon-bedrock`, `anthropic`, `atlascloud`, `azure-ai-foundry`, `azure-openai`, `byteplus`, `byteplus-coding-plan`, `cerebras-ai`, `cloudflare-workers-ai`, `comet-api`, `deepseek`, `featherless-ai`, `fireworks-ai`, `google-generative-ai`, `groq`, `mimo`, `minimax`, `mistral-ai`, `modelscope`, `moonshot-ai`, `n1n`, `novita-ai`, `openai`, `openai-compatible`, `openpaths`, `openrouter-ai`, `perplexity-ai`, `together-ai`, `unspeech`, `volcengine-coding-plan`, `xai`, `zai`, `lm-studio`, `ollama`. Task distribution in the source: `tasks: ['chat']` ×34, `['text-to-speech']` ×14, `['text-to-speech','tts']` ×2, `['speech-to-text','asr','stt','automatic-speech-recognition']` ×4, ×2 with `'streaming-transcription'` added.
- Also `src/validators/{openai-compatible,run,index}.ts`, `src/model-catalog.ts`, `src/generation.ts`. xsai is the execution layer (`@xsai/stream-text`, `@xsai/tool`, `@xsai-ext/providers`, `@xsai-ext/responses`).

**Layer 2 — Stage (Vue) registry:** `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/libs/providers/providers/`
- `registry.ts` — module-level `providerRegistry = new Map<string, ProviderDefinition>()`; `defineProvider<T,TId>()` **self-registers on definition**; `registerProviders(definitions)` throws on duplicate; `StageProviderId = PortableProviderId | StageOnlyProviderId`.
- `index.ts` — side-effect imports `./aliyun-nls`, `./apple-speech`, `./apple-vision`, `./sherpaw`, `./local-audio`, `./kokoro-local`, `./nvidia`, `./official`, `./prompt-api`, then `registerProviders(portableProviderDefinitions)`.
- `official/index.ts` — `providerOfficialChat = defineProvider<OfficialChatConfig, typeof OFFICIAL_CHAT_PROVIDER_ID>({ id, order: -1, name: 'Official Provider', tasks: ['text-generation'], configuredBy: 'authentication', requiresCredentials: false, ... })`. Ids in `official/constants.ts`: `official-provider`, `official-provider-speech`, `official-provider-speech-streaming`, `official-provider-transcription`, `vision-official-provider`.

**Instance/config layer in stage-ui:** `src/services/inference-service-providers.ts`, `src/stores/providers/{provider,config,merge,config-defaults}.ts`, `src/libs/providers/metadata.ts`, `src/libs/providers/validators/{index,run}.ts`, `src/libs/inference/{coordinator,load-queue,protocol,gpu-resource-coordinator,adapters/*}.ts`.

Maturity: high — registry has its own test files (`provider-definitions.test.ts`, `provider-settings-pages.test.ts`), and validators are separate from definitions.

---

## 5. TTS / ASR abstraction — EXISTS, same two-layer mechanism

Speech providers are just `ProviderDefinition`s with `tasks: ['text-to-speech']`. Settings pages (one file per provider) are the authoritative enumeration — `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-pages/src/pages/settings/providers/speech/` (21 provider pages): `aivis-speech`, `alibaba-cloud-model-studio`, `app-local-audio-speech`, `browser-local-audio-speech`, `comet-api-speech`, `deepgram-tts`, `elevenlabs`, `google-gemini-audio-speech`, `index-tts-vllm`, `kokoro-local`, `microsoft-speech`, `mimo-audio-speech`, `minimax-speech`, `official-provider-speech`, `official-provider-speech-streaming`, `openai-audio-speech`, `openai-compatible-audio-speech`, `openrouter-audio-speech`, `player2-speech`, `voicevox`, `volcengine`.

Transcription/ASR — `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-pages/src/pages/settings/providers/transcription/` (9 pages): `aliyun-nls-transcription`, `app-local-audio-transcription`, `browser-local-audio-transcription`, `browser-web-speech-api`, `comet-api-transcription`, `mimo-audio-transcription`, `official-provider-transcription`, `openai-audio-transcription`, `openai-compatible-audio-transcription`. Plus `apple-speech` and `sherpaw-transcription` defined in stage-ui's registry. Vision, for comparison, has 8 pages (`[providerId]`, amazon-bedrock, apple-vision, azure-ai-foundry, cloudflare-workers-ai, lm-studio, official-provider, ollama).

Stage-only definition sites (grep of `defineProvider<`): `aliyun-nls/index.ts:28` (`providerAliyunNlsTranscription`), `apple-vision/index.ts:93`, `local-audio/index.ts:90/104/126/140` (app-local-audio-speech/transcription, browser-local-audio-speech/transcription), `nvidia/index.ts:22`, `apple-speech/index.ts:218` (`providerAppleSpeechTranscription`), `prompt-api/index.ts:19`.

Stores — `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/modules/speech.ts`: `useSpeechStore` (default `activeSpeechProvider: 'speech-noop'`, `activeSpeechModel`, `activeSpeechVoiceId`, pitch/rate/ssmlEnabled; executes via `generateSpeech` from `@xsai/generate-speech` and `streamSpeech` from `libs/speech/streaming-pipeline`), siblings `useSpeechCatalog` (synced across windows) and `useSpeechCatalogRequests` (explicitly not synced). `stores/modules/hearing.ts`: `createHearingTranscriber`, `streamTranscription`, `streamWebSpeechAPITranscription`, `executeSherpawStream`, `executeAppleSpeechStream`, `transcriptionAnalyticsErrorCode()`.

Audio pipeline package: `/Users/mima1234/Documents/aimy/aimy-app/packages/pipelines-audio/` — `speech-pipeline.ts`, `capture.ts`, `playback.ts`, `timeline.ts`, `managers/playback-manager.ts`, `processors/tts-chunker.ts`, `llm-streaming-control/{controller,parsers/*}.ts`, plus tests. Supporting: `packages/audio`, `packages/testing-audio`, `packages/model-driver-lipsync`, `packages/stream-kit`.

Maturity: high — 30 dedicated settings pages plus browser-mode persistence tests (`provider-config-persistence.browser.test.ts`, `minimax-speech.browser.test.ts`).

---

## 6. Memory subsystem — essentially NOT IMPLEMENTED

- `/Users/mima1234/Documents/aimy/aimy-app/packages/memory-pgvector/src/index.ts` — a stub: `main()` constructs `new Client<{connectionString: string}>({name: 'memory-pgvector'})` and registers an **empty** handler, `client.onEvent('module:configure', (_event) => {})`. No tests.
- `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-pages/src/pages/settings/memory/index.vue` — renders only `<WIP />`; route meta `settingsEntry: true, order: 5, icon: i-solar:leaf-bold-duotone`.
- `packages/stage-pages/src/pages/settings/modules/memory-short-term.vue` and `memory-long-term.vue` — both render only `<WIP />`.
- Docs corroborate: `docs/content/zh-Hans/docs/manual/tamagotchi/setup-and-use/index.md` marks 短期记忆/长期记忆 as "功能正在开发中" and 记忆体 as "功能暂未发布"; `README.md:247-249` lists `- [ ] Memory` and `- [ ] Memory Alaya (WIP)` beside a checked `Pure in-browser database support (DuckDB WASM | pglite)`.
- Adjacent but not memory: `packages/core-agent/src/messages/compaction.ts` (`compactHistoryBlock`, `keepRecentHistoryItems`, `countTurns`) is history/context compaction — old turns replaced by a `summary` `HistoryItem`, not a persistent store.
- Storage that does exist: `packages/stage-ui/src/composables/use-duck-db.ts` (+test), `packages/duckdb-wasm`, `packages/drizzle-duckdb-wasm`.
- **Not found:** no embeddings/vector store/RAG implementation. `@xsai/embed` / `@xsai-transformers/embed` imports in `packages/stage-ui/src/components/scenes/Stage.vue:25-27` are **commented out**. Grep for `pgvector|embedding|vector-store|VectorStore` across `packages/*/src`, `apps/*/src`, `integrations/*/src` returned only unrelated hits (`ccc/src/export/png.ts`, telegram-bot chat-message model, `server-sdk/extension-peer.ts`).

Verdict: placeholders and one stub package. If memory is a planned deliverable, it is greenfield.

---

## 7. Persona / character card — EXISTS, two parallel systems

**System A — AIRI card (primary, live).**
- `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/types/airiCard.ts` — `interface AiriExtension` (wakeWords?, `modules.{consciousness,vision,speech,vrm,live2d,displayModelId,activeBackgroundId,artistry}`, `agents: Record<string, {prompt, enabled?}>`), `interface AiriCard extends Card { extensions: { airi: AiriExtension } & Card['extensions'] }`.
- `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/modules/airi-card.ts` — `useAiriCardStore`; local keys `'airi-cards'`, `'airi-card-active-id'` (default `'default'`), `'airi-card-module-defaults'`; `CARDS_PATH = '/api/v1/character-cards'`; cloud sync gated by `CHARACTER_CARD_SYNC_FLAG`; `joinCard`/`splitCard` from `libs/character-card-sync`.
- **System prompt origin** — `resolveSystemPrompt(card)` in that store joins, in order and with `\n\n`: `card.systemPrompt`, `card.description`, `card.personality`, `card.scenario`, `card.extensions.airi.modules.artistry?.widgetInstruction`, dropping empty/whitespace-only parts; exposed as `systemPrompt: computed(...)` (~line 1066). The CCv3 import path separately sets `systemPrompt: ccv3Card.data.system_prompt ?? ''` (~line 500).
- Consumption: `packages/core-agent/src/types/llm.ts:35` (`systemPrompt: string`), replaced/prepended in `core-agent/src/runtime/chat-completions.ts:92-94` and `responses.ts:232-234`; supplements via `stage-ui/src/stores/chat.ts` (`systemPromptSupplement`) and `stores/chat/session-store.ts`.
- `/Users/mima1234/Documents/aimy/aimy-app/packages/ccc/` — CCv3 / SillyTavern character-card library (import/export, PNG embedding, `src/export/png.ts`).
- Editor UI: `packages/stage-pages/src/pages/settings/airi-card/{index,new,[cardId]/edit}.vue` + `components/{CardCreate,CardDetailDialog,CardEditor,CardListItem,DeleteCardDialog,RestoreVersionDialog,UnsavedChangesDialog}.vue` + `tabs/CardCreationTabArtistry.vue`.
- Services: `stage-ui/src/services/{airi-card-editor,airi-card-import-export,airi-card-modules}.ts`.

**System B — character marketplace model (separate).** `stage-ui/src/models/characters.ts` (`createCharactersModel`, `STORAGE_KEY = 'local:characters'` via unstorage `getItemRaw`/`setItemRaw`), `stores/characters.ts` (@pinia/colada `useQuery`/`useMutation`, `createCharacterStoreController`), `stores/character/index.ts` (`useCharacterStore`; reads `activeCard`/`systemPrompt` via `storeToRefs(useAiriCardStore())`; reactions with `MAX_REACTIONS = 200`), `stores/character/notebook.ts`, `stores/character/orchestrator/store.ts`.

**`/Users/mima1234/Documents/aimy/aimy-app/packages/core-character/src/index.ts` is essentially empty** — only an index file exists. Do not mistake it for the persona implementation.

---

## 8. Electron main process services and windows

Root: `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/main/`

**`services/airi/`** (AIRI-domain services):
| Path | Responsibility |
|---|---|
| `channel-server/{index,config}.ts` (+test) | Embed the server-runtime WebSocket server (port 6121, mkcert TLS, QR payload, persisted config) |
| `http-server/{index,server,errors/,http/auth/,server-manager/,static-assets/*}` | Local HTTP server, many tests |
| `plugins/**` | Extension host + IPC (area 1) |
| `mcp-servers/index.ts` (+test) | MCP client manager — see area 10 |
| `computer-use/{index,runtime}.ts` (+test) | Screen/computer control runtime via `@auv-js/cli/binary`; `computerUseRun`, `computerUseReadImage` |
| `home-assistant/{index,request}.ts` (+test) | Home Assistant REST integration; valibot-schema'd config, `homeAssistantGetConfig/SetConfig/Request` |
| `godot-stage/index.ts` | Godot stage manager — spawns child process, WebSocket peer coordination |
| `apple-speech-transcription/` | macOS native speech-to-text bridge |
| `apple-vision/` | macOS native Vision framework bridge (OCR/vision) |
| `widgets/{index,artistry-bridge,validation}.ts` + `widgets/providers/{base,comfyui,nanobanana,replicate}.ts` | Widget window manager + Artistry image-gen backends |
| `io-trace-recording/{index,register}.ts` (+test) | `IOTraceRecordingService` — appends serialized IO spans to disk, with a mutex |
| `onboarding/index.ts` | Onboarding window placement/animations |
| `i18n/index.ts` | main-process i18n |
| `auth.ts` (+test) | Authentication state in main |

**`services/electron/`** (generic platform services): `app.ts` (+test), `auto-updater.ts` (+test), `mock-auto-updater.ts`, `global-shortcut.ts` (+test), `global-shortcut-uiohook.ts` (+test), `media-permissions.ts` (+test), `powerMonitor.ts`, `screen.ts`, `sherpaw-model-assets.ts` (+test), `system-preferences.ts`, `window.ts`, `index.ts`.

**DI wiring** — `apps/stage-tamagotchi/src/main/index.ts` uses `injeca.provide(...)`: `configs:app`, `configs:artistry`, `configs:io-trace-recording`, `host:electron:app`, `services:auto-updater`, `libs:i18n`, `modules:channel-server`, `modules:airi-http-server`, `modules:godot-stage-manager`, `modules:apple-speech-transcription`, `modules:apple-vision`, `modules:mcp-manager`, `services:io-trace-recording`, `windows:widgets`, `modules:plugin-host`, `services:global-shortcut`, `windows:beat-sync`, `windows:devtools:markdown-stress`, `windows:onboarding`, `windows:notice`, `windows:about`, `windows:inlay`, `windows:chat`, `windows:spotlight`, `windows:editor`, `windows:settings`, `windows:main`, `windows:caption`, `app:tray`, plus optional `windows:desktop-overlay` gated by `AIRI_DESKTOP_OVERLAY=1`; then `setupComputerUse`, `setupHomeAssistant`, `setupArtistryBridge`, `injeca.start()`.

**Windows** — `main/windows/`: `about` (+rpc), `beat-sync`, `caption`, `chat` (floating.ts, floating-placement, mode-switch, +rpc), `dashboard` (+rpc), `desktop-overlay` (window-contract.ts + rpc), `devtools`, `editor` (+rpc), `inlay` (bounds.ts + rpc), `main` (+rpc), `notice`, `onboarding`, `settings` (+rpc), `shared` (animator, app-icon, display, persistence, referenced-window, window + tests), `spotlight`, `widgets` (iframe-request-coordinator.ts + rpc).

Note the shared `rpc.ts` per window directory — the cross-boundary convention is one Eventa RPC contract file per window rather than ad-hoc `ipcMain` calls.

---

## 9. Pinia stores — `packages/stage-ui/src/stores/`

Root files: `audio.ts` (audio device/output state), `auth.ts` (session + credentials, 2 test files), `background.ts` (stage background selection), `characters.ts` (marketplace characters via pinia-colada), `chat.ts` (main conversation orchestration, has contract test), `configurator.ts` (module config wizard state), `display-models.ts` (Live2D/VRM model list + active model), `feature-flags.ts` (runtime feature toggles), `journal-preview.ts` (journal/preview UI state), `live2d.ts` (Live2D runtime params), `markdown-stress.ts` (devtools stress harness), `mcp.ts` (`useMcpStore`: `serverCmd` `'settings/mcp/server-cmd'`, `serverArgs`, `connected` `'mcp/connected'` synced to local storage across windows, `resetState()`), `mcp-tool-bridge.ts` (renderer-side MCP tool bridge), `onboarding.ts` (+test), `perf-tracer-bridge.ts`, `plugin-host-capabilities.ts` (`listProvidersForPluginHost`, `shouldPublishPluginHostCapabilities`), `presence-bubble.ts` (+test), `speech-output-control.ts` (+test), `startup-resources.ts` (+test), `system-audio-lipsync.ts` (system audio → lipsync), `three.ts` (Three.js scene state), `tool-call-rerun.ts` (+test), `voice-controls.ts` (voice UI controls), `voice-messages.ts` (+test, voice message playback), `voice-packs.ts` (voice pack catalog), `voice.ts` (voice selection/identity), `wake-words.ts` (wake-word detection state), `index.ts`.

Subdirectories:
- `ai/` — `chat-llm/{llm,tool-resolver,tool-images,tools}` (+tests), `models`.
- `character/` — `index.ts` (`useCharacterStore`), `notebook.ts`, `orchestrator/store.ts`.
- `chat/` — `constants.ts`, `context-prompt.ts`, `context-providers/{index,minecraft,runtime-prompt,user-account}.ts`, `context-store.ts`, `data-store.ts`, `datetime-prefix.ts`, `hooks.ts`, `image-projection.ts`, `maintenance.ts`, `session-message-merge.ts`, `session-store.ts`, `state.ts`, `stream-store.ts`.
- `devtools/` — `context-observability.ts`, `io-tracer.ts`, `plugin-host-debug.ts`, `websocket-inspector.ts`.
- `mods/` — `api/`.
- `modules/` — `airi-card.ts`, `artistry.ts`, `artistry-autonomous.ts`, `consciousness.ts`, `consciousness-settings.ts`, `default.ts`, `discord.ts`, `gaming-factorio.ts`, `gaming-minecraft.ts`, `gaming-module-factory.ts`, `hearing.ts`, `home-assistant.ts`, `speech.ts`, `stickers.ts`, `twitter.ts`, `vision/`, `web-search.ts`, `index.ts`.
- `providers/` — `config.ts`, `config-defaults.ts`, `merge.ts`, `provider.ts`.
- `settings/` — `analytics.ts`, `audio-device.ts`, `beat-sync.ts`, `controls-island.ts`, `developer.ts`, `general.ts`, `spine.ts`, `stage-model.ts`, `theme.ts`, `index.ts`.

Module registry: `packages/stage-ui/src/composables/use-modules-list.ts` aggregates the module stores (consciousness, speech, stickers, hearing, vision, discord, twitter, web-search, minecraft, factorio, home-assistant, artistry, beat-sync) into `Module {id, name, description, icon, to, configured, category}`. Cross-window state uses `pinia-plugin-synced`.

---

## 10. MCP — EXISTS, client and server both

**Renderer/tool layer** `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/tools/mcp.ts` — `McpToolDescriptor`, `McpCallToolPayload`, `McpCallToolResult`, `interface McpToolRuntime { listTools(); callTool(payload) }`, and `createMcpTools(runtime)` producing xsai tools `builtIn_mcpListTools` and `builtIn_mcpCallTool` (JSON arg parsing, errors returned as `{isError:true, content:[{type:'text',...}]}`). Test `tools/mcp.test.ts`.

**Electron main MCP client** `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/main/services/airi/mcp-servers/index.ts` (+`index.test.ts`) — `setupMcpManager()` registered as injeca `'modules:mcp-manager'`. Real SDK usage:
```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
```
So both stdio and streamable-HTTP transports are supported. `@modelcontextprotocol/sdk: ^1.30.0` is in the workspace catalog.

**Server-side MCP (AIRI as an MCP server)** — `services/computer-use-mcp/src/server.ts` (`McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`, tools typed as `CallToolResult`); `integrations/minecraft/src/debug/mcp-repl-server.ts` (`McpServer`, `SSEServerTransport`, `StreamableHTTPServerTransport`); `integrations/twitter-services/src/adapters/mcp-adapter.ts` (`McpServer`, `ResourceTemplate`, `SSEServerTransport`).

**UI** — `packages/stage-pages/src/pages/settings/modules/mcp.vue` (shared), `apps/stage-tamagotchi/src/renderer/pages/settings/modules/mcp.vue` + `components/{McpJsonEditor,McpServerForm,McpConnectionTestPanel}.vue`, `apps/stage-tamagotchi/src/renderer/stores/tools/mcp.ts` (+test), `apps/stage-tamagotchi/src/shared/mcp-config.ts` (+test), `packages/stage-ui/src/libs/product-signals/events/mcp/events/server.ts`.

Notable gap: `integrations/minecraft` bundles a full debug MCP server, and `services/computer-use-mcp` is a standalone MCP service — the pattern for "AIRI exposes capabilities over MCP" exists but is per-integration, not centralized.

---

## 11. Web settings UI — EXISTS, file-based routes in the shared `stage-pages` package

Location: `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-pages/src/pages/` — shared between `stage-web` and `stage-tamagotchi` via unplugin-vue-router, with per-page `<route lang="yaml">` meta blocks (`layout: settings`, `titleKey`, `subtitleKey`, `descriptionKey`, `icon`, `settingsEntry`, `order`, `stageTransition`).

`settings/index.vue` builds the grid dynamically: `router.getRoutes().filter(route => route.meta?.settingsEntry).sort((a, b) => Number(a.meta?.order ?? 0) - Number(b.meta?.order ?? 0))`, rendered with `RippleGrid` + `IconItem`. Adding a settings page is therefore a matter of creating a `.vue` with the right meta — the registry mechanism is the router itself.

Sections present: `account/`, `airi-card/` (+`new`, `[cardId]/edit`, `components/`, `tabs/`), `connection/`, `data/`, `flux.vue`, `memory/` (WIP), `models/`, `modules/` (artistry, beat-sync, consciousness, gaming-factorio, gaming-minecraft, hearing, home-assistant, index, mcp, memory-long-term, memory-short-term, messaging-discord, speech, stickers, vision, web-search, x), `providers/` (artistry/{comfyui,nanobanana,replicate}, chat/, index, speech/, transcription/, vision/), `scene/`, `system/{color-scheme,experimental,general}`.

**Management-console-like pages** (as opposed to the live character display) live under `packages/stage-pages/src/pages/devtools/`: `plugin-host.vue`, `websocket-inspector.vue`, `io-tracer/` (6 components + index), `context-flow/` (10 components + index), `beat-sync.vue`, `image.vue`, `markdown-stress.vue`, `polaroid.vue`, `vibrant.vue`, `providers-transcription-realtime-aliyun-nls.vue`, `index.vue`. The four named first are the real operator consoles — plugin extension management, raw WS traffic, IO span tracing, and LLM context projection inspection.

**In-progress redesign:** `packages/stage-pages/src/pages/v2/{index.vue, settings.vue, settings/index.vue, settings/providers.vue, settings/providers/edit.vue, settings/providers/edit/[providerId]/index.vue, settings/providers/index.vue}` — a parallel route tree that is not the default.

**App-level pages** — `apps/stage-web/src/pages/{index.vue, [...all].vue, auth/{index,callback}.vue, settings/{account,characters,system/*}, devtools/*}`. Tamagotchi renderer (`apps/stage-tamagotchi/src/renderer/pages/`): `index.vue` (live character), `chat.vue`, `chat-floating.vue`, `caption.vue`, `spotlight.vue`, `inlay/index.vue`, `widgets.vue`, `desktop-overlay.vue`, `dashboard/index.vue`, `editor/index.vue`, `onboarding.vue`, `about.vue`, `notice/*`, `settings/*` (account, connection, data, models, modules/{mcp,home-assistant}, system/{developer,general,window-shortcuts}), and its own `devtools/*` (global-shortcut, live2d-ambient-light, live2d-motion, performance-visualizer, presence-bubble, screen-capture, updater, use-electron-*, vision, widgets-calling).

---

## Cross-cutting maturity summary

| Area | Status | Evidence |
|---|---|---|
| Plugin/extension host | Real, wired, tested | 10+ test files, injeca `modules:plugin-host`, inspector UI, design docs |
| Server channel | Real, wired, tested | server-{sdk,runtime,shared} with per-module tests; Electron embeds it on 6121 |
| IM adapters | Partial, functional | Discord/Telegram/Satori/Minecraft; no Slack/QQ/WeChat; no shared adapter interface |
| LLM providers | Real, mature | Two-layer registry, 40+ cloud + 8 local providers, validators, tests |
| TTS/ASR | Real, mature | 21 speech + 9 transcription settings pages, `pipelines-audio` |
| Memory | Stub only | `memory-pgvector` empty handler; 3 `<WIP/>` pages; no embeddings |
| Persona/card | Real, mature | AIRI card + CCv3; `resolveSystemPrompt` feeds core-agent |
| Electron main | Real, extensive | 20 injeca modules, 16 window dirs, per-window `rpc.ts` |
| Pinia stores | Real, extensive | ~30 root + 8 subdirs; `pinia-plugin-synced` for cross-window |
| MCP | Real both directions | SDK client in main, `McpServer` in computer-use-mcp/minecraft/twitter |
| Settings UI | Real, mature | Meta-driven route registry in `stage-pages`; devtools consoles |

Highest-value gaps if you are planning work: (1) memory is greenfield despite the package name existing, (2) `plugins/airi-plugin-game-chess` is an empty stub, (3) no sandboxing beyond permission declarations, (4) no unified IM adapter abstraction, (5) `packages/core-character` is an empty shell.