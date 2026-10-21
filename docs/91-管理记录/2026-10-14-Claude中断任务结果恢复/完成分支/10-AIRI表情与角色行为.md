I have enough for a complete report. Here are my findings.

---

# AIRI Emotion / Expression / Character-Behavior Capability Report

**Root:** `/Users/mima1234/Documents/aimy/aimy-app` (pnpm monorepo, Vue 3 + Pinia)

---

## 1. Emotion system

**There is no affect/emotion state machine, no mood vector, no per-character affect that persists over time.** What exists is a **stateless, per-turn act-token pipeline**: the LLM emits an emotion tag inline in its reply text, the stage parses it and dispatches to the renderer, and the renderer plays a one-shot animation/morph. Emotion is not remembered, not accumulated, and not stored in any DB.

**Canonical owner:** `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/constants/emotions.ts`

**The 9 emotion labels** (identical `enum Emotion` copied into four renderer packages):
`happy`, `sad`, `angry`, `think`, `surprised`, `awkward`, `question`, `curious`, `neutral`

**Key types in that file:**
- `Emotion` enum (line 1)
- `EmotionPayload { name: Emotion, intensity: number }` (line 61) — `intensity` is a 0–1 float, the only quantitative affect dimension
- `EMOTION_EmotionMotionName_value` (line 25) — emotion → Live2D/VRM motion-group name
- `EMOTION_VRMExpressionName_value` (line 37) — emotion → VRM expression name
- `EMOTION_SpineAnimationName_value` (line 49) — emotion → Spine animation name

**How emotion enters the system (text protocol, not a model):**
- `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/composables/use-airi-runtime-prompt.ts` — injects the emotion list into every request prompt from `base.prompt.emotion` (line 7, 21–23)
- `/Users/mima1234/Documents/aimy/aimy-app/packages/i18n/src/locales/en/base.yaml` (lines 27–56) — the actual prompt text. Format is `|<ACT {"emotion":{"name":"surprised","intensity":1},"motion":"shrug"}|>` inline in the reply. Also `DELAY` and `CALL` tokens.
- `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/composables/queues.ts:24` — `parseActEmotion(content)` parses the token, `normalizeIntensity`, then emits to the emotions queue
- `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/components/scenes/Stage.vue:265–292` — `emotionsQueue`, the fan-out to `vrm | live2d | spine | tachie | mmd`; `toStageEmotionPayload` at line 294 validates the name

**Persistence: none.** No `emotion` key exists in localStorage/IndexedDB/Postgres for emotion state. (Settings *about* animations persist — e.g. `settings/mmd/emotion-action-map` in `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui-mmd/src/stores/mmd.ts:205` — but that is a mapping table, not affect state.)

**Related but separate:** a sticker library has its own 12-tag vocabulary at `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/types/sticker.ts:2` — `happy, sad, confused, surprised, thanks, celebrate, angry, tired, affectionate, awkward, agree, disagree`. Note `affectionate` and `confused` are not in the stage emotion enum.

**Documented-but-unbuilt emotional model:** `/Users/mima1234/Documents/aimy/aimy-app/docs/content/en/blog/DevLog-2025.04.14/index.md` (lines 183–225) describes an intended emotion/memory simulation ("memory-emotional-model", forgetting curves, emotionally influenced reranking, paraphrases a third-party emotional model, cites Mem0/Zep as insufficient). It is a design blog post; none of it is implemented in code.

---

## 2. Expression mapping

**Each renderer package owns its own mapping table. There is no shared mapping layer** — confirmed explicitly in `/Users/mima1234/Documents/aimy/aimy-app/packages/model-driver-lipsync/README.md`: *"The package does not write weights to VRM expressions or MMD morphs. Each renderer owns that mapping."*

| Renderer | Mapping file | Mechanism |
|---|---|---|
| Live2D | `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui-live2d/src/constants/emotions.ts:37` (`EMOTION_VRMExpressionName_value`) + `EMOTION_EmotionMotionName_value` | Emotion → **motion group name** via `currentMotion.value = { group: ... }` (Stage.vue:277). Also a per-parameter exp3 system. |
| VRM | `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui-three/src/composables/vrm/expression.ts:53` (`emotionStates` Map) | emotion → array of `{name, value}` VRM expression weights + `blendDuration`. This is the richest table. |
| MMD | `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui-mmd/src/constants/morphs.ts:91` (`EMOTION_MORPHS`) | emotion → `MorphInfluence[]` over logical `MorphSlot`s + blendDuration |
| Spine | `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui-spine/src/constants/emotions.ts:56` | emotion → Spine *animation track name* (2-track layering) |
| Tachie | `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui-tachie/src/constants/emotions.ts:7` | emotion → **whole static image filename** |

**VRM table values** (packages/stage-ui-three/src/composables/vrm/expression.ts:53–105): `happy` → happy 0.7 + `aa` 0.2; `sad` → sad 0.7 + `oh` 0.15; `angry` → angry 0.7 + `ee` 0.3; `surprised` → surprised 0.8 + `oh` 0.4; `neutral` → 1.0; `think` → 0.7; plus an extra `relaxed` state not reachable from the AIRI enum. Weights deliberately kept at 0.7–0.8, not 1.0 ("too raw / smiles too much", issue #590, documented at line 51).

**Live2D is the odd one out** and is the clearest gap: emotion does **not** map to Live2D *expressions*, it maps to **motion groups** via `EmotionHappyMotionName = 'Happy'` etc. (line 15–23), i.e. it plays a whole-body motion clip. `EMOTION_VRMExpressionName_value` in the Live2D file (line 37) is largely dead/`undefined` for 4 of 9 emotions. Separately, Live2D has a full **expression parameter system** that is *not* emotion-driven:
- `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui-live2d/src/stores/expression-store.ts` — parses `exp3.json`, tracks `parameterId`/`blend`/`currentValue`/`modelDefault`, supports `saveDefaults`, groups from `model3.json`
- `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui-live2d/src/composables/live2d/expression-controller.ts` — registers and applies per frame
- `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui-live2d/src/tools/expression-tools.ts` — these expressions are **LLM-callable as tools**, with expose settings `none | all | custom` (`/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.vue:144`)

**MMD morph resolution is name-fallback based** (`morphs.ts:37`, `MORPH_CANDIDATES`): each slot tries Japanese names first then English — e.g. `smile: ['笑い', 'にこり', 'わらい', 'smile']`, `blink: ['まばたき','blink']`. Models can override at runtime via `settings/mmd/morph-overrides`.

**Spine mappings are user-overridable at runtime** (`emotions.ts:29–34` comment: "Models that ship custom names can override the mapping at runtime through the settings panel"; store keys `settings/spine/*` in `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui-spine/src/stores/spine.ts`).

---

## 3. Stage renderer packages

All five confirmed present. Full list of `stage-*` packages: `stage-layouts`, `stage-pages`, `stage-shared`, `stage-ui`, `stage-ui-live2d`, `stage-ui-mmd`, `stage-ui-spine`, `stage-ui-tachie`, `stage-ui-three`.

| Package name | Path | Purpose (from package.json description / README) |
|---|---|---|
| `@proj-airi/stage-ui-live2d` | `packages/stage-ui-live2d` | "Live2D scene components and stores for Project AIRI" — **no README exists** |
| `@proj-airi/stage-ui-three` | `packages/stage-ui-three` | "A collection of 3D scene components that used by Project AIRI" — Three.js runtime, loads/mounts/disposes **VRM** models, hit-testing, render targets, preview generation |
| `@proj-airi/stage-ui-mmd` | `packages/stage-ui-mmd` | "MMD (MikuMikuDance) scene components and stores" — PMX/PMD + VMD/VPD, Bullet physics via Ammo.js, CCD IK + append-bone, importable VMD clips persisted to IndexedDB |
| `@proj-airi/stage-ui-spine` | `packages/stage-ui-spine` | "Spine 2D scene components and stores" — Spine 2D animations; **requires a paid Spine Editor license to develop** (`@esotericsoftware/spine-webgl`) |
| `@proj-airi/stage-ui-tachie` | `packages/stage-ui-tachie` | "Tachie static image scene components" — one full static image per emotion, PixiJS on transparent canvas, `.tachie.zip` archives |

**Other renderers / engines:**
- **Godot** exists but is *not* a `stage-ui-*` package — it is `/Users/mima1234/Documents/aimy/aimy-app/engines/stage-tamagotchi-godot` (C#/.NET Godot project, "Godot-native desktop stage runtime project"). Scope today is camera/view-state and VRM import only. There is **no emotion, expression, or blendshape code** in it — a grep for `emotion|expression|blendshape|viseme` across `engines/stage-tamagotchi-godot/scripts`, `scenes`, and `apps/stage-tamagotchi-kirie/src-godot` returns only two unrelated camera files. The settings UI stub is `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/components/scenarios/settings/model-settings/godot.vue`.
- Shared Godot contract: `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-shared/src/godot-stage/view-state.ts`
- Second Godot copy: `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi-kirie/src-godot`
- Renderer selection is a `stageModelRenderer` value of `'vrm' | 'live2d' | 'spine' | 'tachie' | 'mmd'` — the fan-out switch is `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/components/scenes/Stage.vue:266–292`. **Godot is absent from this switch**, so Godot gets no emotion dispatch.

---

## 4. Lip sync / mouth movement

**Partially shared, with renderer-specific write layers.** The shared core is:

`/Users/mima1234/Documents/aimy/aimy-app/packages/model-driver-lipsync/`
- `src/shared/wlipsync/profile.json` — the **wLipSync MFCC calibration profile** (12 MFCC coefficients, 30 mel channels, 16 kHz, 1024 sample window), with "A/I/U/E/O" calibration data lists. Sourced in from a SteamVR/wLipSync project path.
- `src/shared/wlipsync/vowel-driver.ts` — converts raw AEIOU frames into stable weights; owns winner selection, silence detection, smoothing
- `src/runtime/wlipsync/index.ts` — browser-only Web Audio node factory (`createWLipSyncNode`)
- `src/live2d/index.ts` — the Live2D driver
- Explicit boundary in its README: shared entry has no Web Audio side effects; each renderer owns its own model writes

**Per-renderer write layers:**
- VRM: `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui-three/src/composables/vrm/lip-sync.ts`, viseme set `VISEME_NAMES = {'aa','ee','ih','oh','ou'}` at `expression.ts:110`, with emotion yielding to lip-sync while speech is active
- MMD: `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui-mmd/src/composables/mmd/lip-sync.ts` + `morph.ts`; maps phonemes to canonical あいうえお morphs (`morphs.ts:39`, `VOWEL_SLOTS` line 61)
- Live2D: driver in `model-driver-lipsync/src/live2d/`, plus a **separate system-audio path** for desktop: `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/system-audio-lipsync.ts` (drives Live2D mouth-open from system audio capture, with `inputVolumeThreshold`, `randomCloseDelayMs`, `randomCloseProbability` shaping options — default threshold 0.08). Electron implementations: `apps/stage-tamagotchi/src/renderer/features/live2d/system-audio-lipsync.ts` and the kirie variant.
- Tachie: **no lip sync** — explicitly excluded in its README ("Do not use it for layered sprites, rigged animation, lip-sync...").

---

## 5. Motion / animation system

Idle and autonomous behavior exists per renderer, implemented independently in each package (not shared).

**Auto-blink:**
- VRM: `useBlink` — randomized 1–6 s interval, 0.2 s sine close/open; helpers in `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui-three/src/composables/vrm/animation.ts` (`randomSaccadeInterval`) and `utils/eye-motions`
- MMD: `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui-mmd/src/composables/mmd/blink.ts` — same 1–6 s / 0.2 s timing model, explicitly noted as "identical timing model to the VRM renderer's `useBlink`"
- Live2D: blink is a **mode setting** — `blinkModeOptions`: none / auto-blink / force-auto-blink, at `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.vue:110–120`

**Idle motion:**
- Live2D: `currentMotion = { group: ... }`, idle group detection and a plugin chain in `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts` (line 136 reads `selected-runtime-motion-group` from localStorage; `isIdleMotion` checks `motionManager.groups.idle`). Idle can be disabled via `<motion disabled>` sentinel (live2d.vue:99). Idle eye saccades at `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui-live2d/src/composables/live2d/animation.ts` (`useLive2DIdleEyeFocus`, "simulate idle eye saccades and focus (head) movements in a *pretty* naive way"); breath curve sampled from `stores/motion-control.ts`
- Spine: 2-track convention — `SPINE_IDLE_TRACK = 0` (persistent loop), `SPINE_EMOTION_TRACK = 1` (one-shot overlay) in `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui-spine/src/composables/spine/animation-manager.ts` (`setIdle`, `playEmotion`, mixDuration, alpha)
- MMD: `idleMotionName` persisted at `settings/mmd/idle-motion` (`stores/mmd.ts:153`); VMD clips importable and persisted to IndexedDB
- VRM: `.vrma` clips via `loadVRMAnimation`/`clipFromVRMAnimation` (`composables/vrm/animation.ts`)

**Gaze / look-at:**
- VRM: `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui-three/src/composables/eye-tracking.ts` — `useVRMEyeFocusFor`, uses an actual Three.js Raycaster. Modes `'camera' | 'mouse' | 'none'` + `eyeHeight` + `lookAtTarget`, all persisted under `settings/stage-ui-three/*` in `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui-three/src/stores/model-store.ts:87,168,172`
- MMD: `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui-mmd/src/composables/mmd/gaze.ts` — bone-driven (eye yaw ±0.35 rad, pitch ±0.25, head yaw ±0.2), bone-name fallback lists (`左目/eye_L/EyeLeft`, `頭/head`), and **idle saccades** (400–2200 ms, range 0.4)
- Live2D: `live2dEyeTrackingEnabled` / `live2dEyeFocusSourceActive` / `live2dForceIdleEyeAnimation` flags in the motion-manager plugin chain

**MAGIC procedural motion:** `/Users/mima1234/Documents/aimy/aimy-app/packages/motion-driver-magic/` — "Markovian Animation Generator with Illusory Conditioning". Fits VAR and AR-HMM models (`src/var.ts`, `src/ar-hmm.ts`, `src/fit.ts`) to motion recordings and generates seeded normalized frames. This is the only *generative* motion capability. Its README states the caller owns transport and renderer integration, and it must not import Vue/Three. Selected from the Live2D settings panel as a "motion driver" (`universal` vs `magic` — `live2d.vue:53`). Related: `/Users/mima1234/Documents/aimy/aimy-app/packages/model-driver-magic-live2d/`.

**Autonomous character behavior (separate axis):** `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/modules/artistry-autonomous.ts` — an "AutonomousArtist" that watches chat context and triggers *image* generation when a threshold is met. Config flags `autonomousEnabled`, `autonomousThreshold`, `autonomousTarget` live on the character card. It is not a motion/emotion autonomy system.

---

## 6. Character card / persona / model library

**Character card protocol:** `/Users/mima1234/Documents/aimy/aimy-app/packages/ccc/` (`@proj-airi/ccc`)
- `src/define/card.ts` — `Card`, `defineCard`, `defineCardFn`
- `src/codec/characterCardV3.ts` — CCv3 JSON validation + `'older' | 'current' | 'newer'` compatibility classification, forward-preserving unknown fields
- `src/export/{json,md,png,apng}.ts` — export to JSON/Markdown/PNG/APNG
- `src/define/ext.ts` — `export interface Ext {}` — **the AIRI extension namespace is an empty shell**; the real module schema is typed elsewhere
- `/Users/mima1234/Documents/aimy/aimy-app/packages/core-character/src/index.ts` — single-file re-export stub
- Card editor: `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-pages/src/pages/settings/airi-card/components/CardEditor.vue`, `services/airi-card-editor.ts`, `services/airi-card-import-export.ts`
- Card store: `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/modules/airi-card.ts` — modules keyed by `artistry`, and `card.personality` (line 79, 493)
- Character orchestrator: `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/character/orchestrator/index.ts` + `store.ts`

**Model library UI (this is a real, complete feature):**
- `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/display-models.ts` — `DisplayModelFormat` enum (line 8): `live2d-zip`, `live2d-directory`, `vrm`, `spine-zip`, `tachie-zip`, `pmx-zip`, `pmx-directory`, `pmd`. Models persisted to **IndexedDB via localforage** with preview images. Ships presets: Live2D Hiyori (pro + free zh), VRM AvatarSample-A and -B (lines 23–29, 51).
- Selector dialog: `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/components/scenarios/dialogs/model-selector/model-selector.vue` (import handlers for `.zip`/`.vrm`/MMD at lines 57, 90, 131, 146, 161) plus validation report modals at `reports/live2d/modal.vue` and `tachieReportModal.vue`
- Per-renderer "model settings" panels: `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/components/scenarios/settings/model-settings/` — `live2d.vue`, `vrm.vue`, `mmd.vue`, `spine.vue`, `tachie.vue`, `godot.vue`, `panel.vue`, `preview-stage.vue`, `runtime.ts`, `index.vue`

**Where models come from:** all local, user-supplied. Import a file (IndexedDB) or use a bundled preset — there is no model marketplace, no remote catalog, no download service. `extensions.airi.modules.artistry` / card-level `vrm.source = 'url' | 'file'` and `live2d.source = 'file'` exist in tests, so card-embedded model references are supported.

---

## 7. Model creation from image / 3D tooling integration — **ABSENT**

Reported honestly: **there is no capability to create a model from an image, and no Blender, Tripo, Meshy, or any other 3D-authoring integration.**

- No `blender` / `tripo` / `meshy` matches anywhere in `packages/`, `apps/`, `docs/`, or `scripts/` except two incidental hits: a comment in `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui-mmd/src/constants/morphs.ts:35` ("English fallbacks cover the minority of Western/**Blender-exported** models") and the historical v0.1.0 chronicle docs.
- No `GLTFExporter`, no `exportGLB`, no `.glb` writer. Three.js `examples/jsm` imports are read-only consumers: `OrbitControls.js`, `LightProbeGenerator.js`, `RGBELoader.js` (all in `packages/stage-ui-three/src/components/`).
- `rig` / `rigging`: only *consuming* existing rigs — MMD "IK (CCD solver) and append-bone propagation for standard and custom rigs", plus physics for "hair, skirts, and custom rigs". No rig authoring.
- `mesh`: present only as read-side `SkinnedMesh`/`skeleton.bones` traversal in `packages/stage-ui-mmd/src/composables/mmd/gaze.ts`.
- All formats are **import-only**: `.zip`, `.vrm`, `.pmx`/`.pmd`, `.tachie.zip`, Spine `.zip`, Live2D `model3.json` — see the DisplayModelFormat enum.
- The autonomous artistry store generates **2D images** (backgrounds/widgets), not models: `packages/stage-ui/src/stores/modules/artistry-autonomous.ts`, `packages/stage-ui/src/stores/modules/artistry.ts`.

The nearest thing to "create visual assets" is the sticker import path (`packages/stage-ui/src/libs/stickers/import.ts`, `stores/modules/stickers.ts`) — user-supplied images tagged with emotions, validated for dimensions.

---

## 8. Plugin / Skill architecture

Two **separate and unrelated** systems share this vocabulary:

### (a) Runtime plugins/extensions — AIRI's own, real product feature
- SDK: `/Users/mima1234/Documents/aimy/aimy-app/packages/plugin-sdk/` — "Runtime-agnostic SDK for AIRI extensions"
- Protocol: `/Users/mima1234/Documents/aimy/aimy-app/packages/plugin-protocol/` (`src/types/events.ts`)
- Design docs: `packages/plugin-sdk/docs/design/architecture.md`, `multi-transport.md`, `capability-orchestration.md`

**Manifest format — `extension.airi.json` at package root, Manifest v2 only** (documented in `/Users/mima1234/Documents/aimy/aimy-app/packages/plugin-sdk/README.md`):

```json
{
  "manifestVersion": 2,
  "kind": "manifest.extension.airi.moeru.ai",
  "id": "example-extension",
  "version": "1.0.0",
  "engines": { "airi": "*", "runtimes": ["electron"] },
  "entrypoints": { "electron": "./extension.mjs" },
  "permissions": {},
  "kits": { "uses": [{ "id": "dev.airi.example", "version": "^1.0.0", "optional": true }] }
}
```
Parsing is strict — unknown fields, unsafe ids, empty entrypoints, and missing runtime entrypoints all fail validation. Kit *providers* declare exact semver; kit *consumers* accept ranges.

**Working examples** (the only three manifests in the tree):
- `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/main/services/airi/plugins/examples/devtools-sample-plugin/extension.airi.json` — the fullest example, showing `permissions.apis` / `permissions.resources` / `permissions.capabilities` with `key` + `actions[]`
- `.../examples/activation-planner-provider/extension.airi.json`
- `.../examples/activation-planner-consumer/extension.airi.json`

**Authoring API:** `defineExtension()` in `/Users/mima1234/Documents/aimy/aimy-app/packages/plugin-sdk/src/extension/define.ts` (id must match the manifest). Source layout: `src/{extension,plugin,plugin-host,kit,channels}/`. Plugin host with validation and an activation planner: `src/plugin-host/core.ts`, `api.ts`, `activation-plan.ts`.

**Real plugin packages:** `/Users/mima1234/Documents/aimy/aimy-app/plugins/` — `airi-plugin-bilibili-laplace`, `airi-plugin-claude-code`, `airi-plugin-game-chess`, `airi-plugin-web-extension` (the last is a WXT browser extension).

### (b) Developer agent skills — tooling for coding assistants, NOT a product feature
- `/Users/mima1234/Documents/aimy/aimy-app/.claude/skills/` and `/Users/mima1234/Documents/aimy/aimy-app/.agents/skills/` — 32 skills, mostly third-party (Vue, Pinia, pnpm, UnoCSS, tsdown, agent-browser, vishot, eventa) plus a few AIRI-specific ones (`stage-tamagotchi-godot-csharp`, `enforce-rules-for-*`, `use-agent-browser-for-airi`)
- Format is standard `SKILL.md` with YAML frontmatter (`name`, `description`, `metadata.author/version/source`)
- `/Users/mima1234/Documents/aimy/aimy-app/skills-lock.json` — version 1 lockfile pinning each skill to a `source` repo + `skillPath` + `computedHash`

**Important:** there is no "Skills" concept exposed to end users or to the character. `SKILL.md` is purely a developer-workflow artifact. Runtime LLM tools are a different mechanism entirely (`@xsai/tool` + zod, e.g. `packages/stage-ui-live2d/src/tools/expression-tools.ts`, `packages/stage-ui-spine/src/tools/animation-tools.ts`, `packages/stage-ui-mmd/src/tools/`).

---

## 9. Scripts and model-preparation docs

**Scripts directory is essentially empty of model tooling:**
- `/Users/mima1234/Documents/aimy/aimy-app/scripts/` contains only `audit-ui-components.mjs`, `list-module-loc.mjs`, and `scripts/sponsorkit/` (test + vitest config). No Blender/VRM/MMD processing scripts anywhere.
- `/Users/mima1234/Documents/aimy/aimy-app/skills-lock.json`, `alint.config.ts`, `knip.json` — repo tooling only.

**Docs about model preparation / assets:**
- `/Users/mima1234/Documents/aimy/aimy-app/docs/ai/adr/2026-09-22-sherpaw-model-assets.md` — ADR on the model-asset pipeline (`vite-plugin-sherpaw` at `packages/vite-plugin-sherpaw/`)
- `/Users/mima1234/Documents/aimy/aimy-app/docs/content/en/docs/manual/tamagotchi/setup-and-use/` — user-facing model setup manual (assets `manual-models.avif`)
- `/Users/mima1234/Documents/aimy/aimy-app/docs/content/public/assets/tutorial-settings-change-model.mp4` (+ `-poster.avif`) — tutorial on changing models
- `/Users/mima1234/Documents/aimy/aimy-app/docs/content/en/references/research/live2d-recording-curve-fitting.md` — research note on fitting curves from Live2D recordings (tied to the MAGIC motion work)
- Bundle locations: `packages/stage-ui/src/assets/live2d/models/` and `packages/stage-ui/src/assets/vrm/models/`

---

# Gap Summary

| # | Capability | Status |
|---|---|---|
| 1 | Emotion **state machine / affect vector / mood that persists over time** | **Absent.** 9-label enum + per-turn `intensity` only. No accumulation, no decay, no relationship/affection score, no DB. |
| 2 | Emotion reachable on **all** renderers | **Partial.** Godot has zero emotion dispatch; Tachie is image-swap only. |
| 3 | **Live2D** emotion → *expression* (vs. whole-body motion) | **Weakest mapping.** 5 of 9 emotions map to `undefined`. |
| 4 | **Shared** emotion→output mapping layer | **Absent by design.** Five independent tables; the enum itself is copy-pasted into 4 packages. |
| 5 | Emotion card schema (`ccc/define/ext.ts`) | **Empty interface** — real schema lives in `stage-ui/src/types/airiCard.ts`. |
| 6 | Lip sync | **Solid and shared** at the AEIOU core, per-renderer writes. Tachie and Godot excluded. |
| 7 | Idle / blink / gaze | **Solid per-renderer**, freshly reimplemented each time (VRM & MMD blink are acknowledged duplicates). |
| 8 | **Create a model from an image / Blender / Tripo / GLB export / rigging** | **Entirely absent.** Import-only, every format. |
| 9 | Emotional *memory* (docs describe it, code doesn't) | **Absent.** `docs/content/en/blog/DevLog-2025.04.14/index.md` is design-only. |
| 10 | Plugin architecture | **Real and specified** (Manifest v2, `extension.airi.json`). But it is a desktop/Electron extension system — no plugin hook exists for emotion providers or renderer backends. |