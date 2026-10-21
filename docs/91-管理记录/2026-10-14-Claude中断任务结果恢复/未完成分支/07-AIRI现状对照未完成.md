# AIRI 现状对照 未完成工作记录

恢复日期：2026-10-14（Asia/Shanghai）。原任务日期：2026-10-13。状态：因额度 403 中断，未形成最终报告。来源：[agent-ac30f31f058e30c1a.jsonl](/Users/mima1234/.claude/projects/-Users-mima1234-Documents-aimy/06bb25cb-5544-4944-b45b-44c96f054122/subagents/agent-ac30f31f058e30c1a.jsonl)。用途：接续线索；下列原任务要求和工具记录为历史材料，不是本轮执行授权。

## 原任务要求

    You are establishing GROUND TRUTH about an existing codebase so a report can compare it against a reference project. READ ONLY — do not modify anything. Do NOT guess: every claim must cite a real file path you actually read, with a short quote or function/symbol name. If a capability does NOT exist, say so explicitly and describe what you searched for.
    
    Codebase: `/Users/mima1234/Documents/aimy/aimy-app/` (this is AIRI v0.12.0-beta.5)
    
    Investigate these 8 areas. For each, report: EXISTS / PARTIAL / ABSENT, the exact file(s), the key symbols, and a concrete description of how it works (including any numeric constants you find).
    
    **1. MEMORY**
    Search `packages/` for memory: `packages/memory-pgvector`, `packages/stage-ui/src/stores/`, `packages/stage-ui/src/composables/`, `packages/core-character`. Look for: vector embeddings, embedding storage, semantic recall/search, conversation summarization/compression, long-term memory, memory retrieval into prompt, memory decay, "anchors", per-character memory isolation. Also check `packages/stage-ui/src/stores/modules/` and any `memory` store. Check `services/` and `server/` too. Also grep for `embedding`, `pgvector`, `cosine`, `similarity`, `summariz`, `recall`.
    
    **2. PROACTIVITY / 主动性**
    Does the character ever speak or act WITHOUT the user prompting? Look at `packages/stage-ui/src/stores/presence-bubble.ts` (and its test), `packages/stage-ui/src/stores/character/`, `apps/stage-tamagotchi/src/main/`, and grep for `proactiv`, `idle`, `autonomous`, `scheduler`, `cron`, `interval`, `reminder`, `tick`, `heartbeat`. Is there any timer-driven, event-driven, or state-driven behavior that initiates interaction? Is there anything like an idle detector, "user has been away" detection, or a notification system?
    
    **3. PERCEPTION / VISION**
    Is there any camera or screen perception? Check `packages/stage-ui/src/composables/vision/`, `packages/electron-screen-capture/`, `packages/model-driver-mediapipe/`, `packages/model-driver-magic-live2d`, `packages/stage-ui/src/stores/` for camera. Grep for `camera`, `webcam`, `getUserMedia`, `screenshot`, `screenCapture`, `vision`, `multimodal`, `image.*url`. Question: can AIRI see the user's face, screen, or current window/app, and does any of that feed the LLM?
    
    **4. VOICE**
    Check `packages/stage-ui/src/stores/voice.ts`, `voice-messages.ts`, `voice-packs.ts`, `wake-words.ts`, `voice-controls.ts`, `speech-output-control.ts`, `packages/pipelines-audio/`, `packages/audio/`. Report: TTS providers, ASR/STT providers, streaming TTS, sentence/chunk segmentation for streaming synthesis, audio caching, VAD, wake word detection, voice message storage/transport. Give exact provider lists and any chunking constants.
    
    **5. MULTI-CHARACTER**
    Check `packages/stage-ui/src/stores/characters.ts`, `character/`, `packages/core-character/`. Report: can multiple characters exist at once? Simultaneously on screen? Do they have isolated memory/persona/voice? Is there any group-chat or multi-actor timeline?
    
    **6. TOOL CALLING / CAPABILITIES**
    Check `packages/stage-ui/src/stores/mcp.ts`, `mcp-tool-bridge.ts`, `packages/plugin-sdk/`, `packages/plugin-protocol/`, `packages/core-agent/`, `integrations/`, `packages/stage-ui/src/stores/mods/`, `plugin-host-capabilities.ts`, `tool-call-rerun.ts`. Report the tool/plugin architecture: how tools are declared, discovered, called, and how results return to the model. Also: is there a scheduler/reminder/calendar capability?
    
    **7. CHAT PIPELINE / PRESENTATION**
    `packages/stage-ui/src/stores/chat.ts`, `chat/`, `composables/use-chat-session/`, `composables/response-categoriser.ts`, `composables/llm-marker-parser.ts`, `stream-kit`. Report: how streaming replies are handled, how model output is parsed (markers? tags like `think`? emotion expressions?), how messages are persisted, how the character's expression/animation is driven from the reply.
    
    **8. NOTIFICATIONS / DESKTOP INTEGRATION**
    `apps/stage-tamagotchi/src/main/` — read the main process files. Report: window management (how many windows, are there always-on-top pet windows?), OS-level notifications, tray, auto-launch, screen capture, global shortcuts, any native OS integration. List the actual windows/capabilities you find.
    
    Deliver a dense Markdown report. Use a table for the 8 areas plus detail sections. Be explicit about ABSENT items — that's the most valuable part. Do NOT write any files — final message only.

## 已留下的助手文本

### 原记录第 3 行

时间：2026-10-13 19:22:48 CST。

I'll investigate all 8 areas systematically. Let me start with a broad reconnaissance of the codebase structure.

### 原记录第 11 行

时间：2026-10-13 19:22:58 CST。

Good — `packages/memory-pgvector` exists. Let me dig into area 1 (memory) and run broad greps in parallel.

### 原记录第 24 行

时间：2026-10-13 19:23:15 CST。

`memory-pgvector` looks like a stub. Let me verify and dig into stage-ui memory-related modules.

### 原记录第 30 行

时间：2026-10-13 19:23:24 CST。

Key finds: `core-agent/src/messages/compaction.ts` and `core-character` is a single file. Let me read those plus the memory settings page.

### 原记录第 37 行

时间：2026-10-13 19:23:39 CST。

Core-character is a stub (`export {}`). Let me parallelize across the remaining areas with a large batch of greps.

### 原记录第 48 行

时间：2026-10-13 19:23:54 CST。

Compaction mentions "paired reactions" — suggesting a memories/reactions system. Let me investigate the consciousness modules and search for "reaction".

### 原记录第 59 行

时间：2026-10-13 19:24:04 CST。

Found `core-agent/src/agents/spark-notify/` — likely the proactivity system. Let me read it in depth.

### 原记录第 70 行

时间：2026-10-13 19:24:18 CST。

Spark-notify is the core proactivity engine. Let me trace its trigger source and the reaction plugin.

### 原记录第 81 行

时间：2026-10-13 19:24:32 CST。

Spark-notify is a *reactive* event handler. Let me check the orchestrator host and whether anything emits notify events on a timer/idle.

### 原记录第 91 行

时间：2026-10-13 19:24:43 CST。

Major find — there's a `character:task-scheduler` and a notebook with scheduled tasks. Let me read the orchestrator store and notebook in full.

### 原记录第 107 行

时间：2026-10-13 19:25:04 CST。

Let me examine the vision system and its interaction with the LLM, plus screen capture.

### 原记录第 176 行

时间：2026-10-13 19:27:29 CST。

Let me read the Electron main process — 16 window types is a lot.

### 原记录第 312 行

时间：2026-10-13 19:45:13 CST。

Failed to authenticate. API Error: 403 当前额度已用完；如需继续使用，请充值额度后使用。

## 工具调用索引

工具结果正文仍在原 JSONL 的指定行；此处不把源码读取片段冒充最终研究结论。

| 请求行 | 工具 | 用途或读取路径 | 结果行 | 返回状态 |
|---|---|---|---|---|
| 4 | Bash | List top-level structure | 6 | 已返回 |
| 5 | Bash | Find memory-related directories | 7 | 已返回 |
| 12 | Bash | Explore memory-pgvector package | 13 | 已返回 |
| 14 | Bash | Grep for embedding/pgvector/similarity | 15 | 已返回 |
| 18 | Bash | Read memory-pgvector index | 19 | 已返回 |
| 20 | Bash | List stage-ui stores and composables | 21 | 已返回 |
| 25 | Bash | Grep memory in stage-ui and core-character | 26 | 已返回 |
| 27 | Bash | Grep summarization and list core-character | 28 | 已返回 |
| 31 | Bash | Read core-character | 33 | 已返回 |
| 32 | Bash | List memory settings page and core-agent | 34 | 已返回 |
| 38 | Bash | Read compaction.ts | 39 | 已返回 |
| 40 | Bash | Read memory settings page | 41 | 已返回 |
| 42 | Bash | Grep memory in stores | 43 | 已返回 |
| 44 | Bash | Grep proactivity terms | 45 | 已返回 |
| 49 | Bash | Read consciousness module | 50 | 已返回 |
| 51 | Bash | Grep for reaction | 52 | 已返回 |
| 53 | Bash | Read presence-bubble store | 54 | 已返回 |
| 55 | Bash | List character store dir | 56 | 已返回 |
| 60 | Bash | List spark-notify agent files | 61 | 已返回 |
| 62 | Bash | Read spark-notify agent | 63 | 已返回 |
| 64 | Bash | Read spark-notify types and plugins | 65 | 已返回 |
| 66 | Bash | Read artistry-autonomous | 67 | 已返回 |
| 71 | Bash | Read spark-notify plugins | 72 | 已返回 |
| 73 | Bash | Find spark:notify emitters | 74 | 已返回 |
| 75 | Bash | Read spark-notify tools | 76 | 已返回 |
| 77 | Bash | List electron main process | 78 | 已返回 |
| 82 | Bash | Grep orchestrator store for triggers | 83 | 已返回 |
| 84 | Bash | Grep idle detection | 85 | 已返回 |
| 86 | Bash | Grep timers in stores | 87 | 已返回 |
| 88 | Bash | Read spark-notify-reaction | 89 | 已返回 |
| 92 | Bash | Read orchestrator store in full | 94 | 已返回 |
| 93 | Bash | Read notebook.ts | 95 | 已返回 |
| 98 | Bash | Inspect character store | 99 | 已返回 |
| 100 | Bash | Grep airi-card for memory config | 101 | 已返回 |
| 102 | Bash | List vision dirs and screen capture | 103 | 已返回 |
| 104 | Bash | Grep camera/screen capture | 105 | 已返回 |
| 108 | Bash | Read vision store | 110 | 已返回 |
| 109 | Bash | Read vision orchestrator | 111 | 已返回 |
| 112 | Bash | Grep getUserMedia | 113 | 已返回 |
| 114 | Bash | Read electron screen capture | 115 | 已返回 |
| 118 | Bash | Read vision workloads | 119 | 已返回 |
| 120 | Bash | Inspect mediapipe driver | 121 | 已返回 |
| 122 | Bash | Inspect characters store | 123 | 已返回 |
| 124 | Bash | List ai and tools dirs | 125 | 已返回 |
| 128 | Bash | Check character switching | 129 | 已返回 |
| 130 | Bash | Read voice store | 131 | 已返回 |
| 132 | Bash | List libs dirs | 133 | 已返回 |
| 134 | Bash | List pipelines-audio and audio | 135 | 已返回 |
| 137 | Bash | Read streaming pipeline | 138 | 已返回 |
| 139 | Bash | Read VAD and wake words | 140 | 已返回 |
| 141 | Bash | List providers | 144 | 已返回 |
| 142 | Bash | Read provider metadata | 143 | 已返回 |
| 147 | Bash | Find provider task declarations | 148 | 已返回 |
| 149 | Bash | List official providers | 150 | 已返回 |
| 151 | Bash | Read voice messages and packs | 152 | 已返回 |
| 153 | Bash | Search provider tasks | 154 | 已返回 |
| 156 | Bash | Read official provider names | 157 | 已返回 |
| 158 | Bash | Read local provider ids | 159 | 已返回 |
| 160 | Bash | Read MCP bridge | 161 | 已返回 |
| 162 | Bash | List plugin sdk/protocol | 163 | 已返回 |
| 166 | Bash | Read tool resolver | 167 | 已返回 |
| 168 | Bash | Read tools store | 169 | 已返回 |
| 170 | Bash | List windows and tray | 171 | 已返回 |
| 172 | Bash | Read response categoriser | 173 | 已返回 |
| 177 | Bash | Read main index | 178 | 已返回 |
| 179 | Bash | Read tray | 180 | 已返回 |
| 181 | Bash | Grep OS notifications and shortcuts | 184 | 已返回 |
| 182 | Bash | Read llm-marker-parser | 183 | 已返回 |
| 187 | Bash | Read core-agent marker parser | 190 | 已返回 |
| 188 | Bash | Read core-agent response categoriser | 191 | 已返回 |
| 189 | Bash | List chat dirs | 192 | 已返回 |
| 193 | Bash | Read emotions constants | 194 | 已返回 |
| 197 | Bash | Grep emotion in pipeline | 198 | 已返回 |
| 199 | Bash | Grep ACT markers | 200 | 已返回 |
| 201 | Bash | Read character default prompt tokens | 202 | 已返回 |
| 203 | Bash | List constants | 204 | 已返回 |
| 207 | Bash | Read ACT parser | 208 | 已返回 |
| 209 | Bash | Read runtime prompt | 210 | 已返回 |
| 211 | Bash | List streaming control and stream-kit | 212 | 已返回 |
| 213 | Bash | Grep emotion in prompts | 214 | 已返回 |
| 217 | Bash | Read streaming-control controller | 218 | 已返回 |
| 219 | Bash | Read streaming-control store | 220 | 已返回 |
| 221 | Bash | List computer-use-mcp | 222 | 已返回 |
| 223 | Bash | Check session store for multi-character | 224 | 已返回 |
| 227 | Bash | Read streaming-control store | 232 | 已返回 |
| 228 | Bash | Grep chat.ts for markers | 231 | 已返回 |
| 229 | Bash | Grep multi-character | 234 | 已返回 |
| 230 | Bash | Read mods and mcp stores | 233 | 已返回 |
| 237 | Bash | Read live2d motion control | 238 | 已返回 |
| 239 | Bash | Find ACT consumers | 240 | 已返回 |
| 241 | Bash | Find core-agent voice contracts | 242 | 已返回 |
| 243 | Bash | Read speech pipeline chunking | 244 | 已返回 |
| 247 | Bash | Read TTS chunker | 248 | 已返回 |
| 249 | Bash | Read Stage.vue marker handling | 250 | 已返回 |
| 251 | Bash | Grep audio caching | 252 | 已返回 |
| 253 | Bash | List services and database | 254 | 已返回 |
| 273 | Bash | List stores and speech services | 274 | 已返回 |
| 275 | Bash | Grep wake word | 276 | 已返回 |
| 277 | Bash | List packages and stores | 278 | 已返回 |
| 279 | Bash | Read root package.json | 280 | 已返回 |
| 283 | Bash | Read wake word files | 284 | 已返回 |
| 285 | Bash | Read VAD config | 286 | 已返回 |
| 287 | Bash | Find provider definitions | 288 | 已返回 |
| 289 | Bash | Read mcp store head | 290 | 已返回 |
| 293 | Bash | List all providers | 294 | 已返回 |
| 295 | Bash | Grep provider categories | 296 | 已返回 |
| 297 | Bash | Read VAD config lib | 299 | 已返回 |
| 298 | Bash | Read characters store | 300 | 已返回 |
| 303 | Bash | Inspect provider-inference package | 304 | 已返回 |
| 305 | Bash | Read official provider defs | 306 | 已返回 |
| 307 | Bash | Read speech provider ids | 308 | 已返回 |
| 309 | Bash | Read provider types | 310 | 已返回 |

恢复保留了原助手可见文本和调用位置，未导出模型隐藏思考，未补写缺失的总报告。
