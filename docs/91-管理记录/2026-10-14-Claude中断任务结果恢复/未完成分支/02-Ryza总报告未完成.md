# Ryza 总报告 未完成工作记录

恢复日期：2026-10-14（Asia/Shanghai）。原任务日期：2026-10-13。状态：因额度 403 中断，未形成最终报告。来源：[agent-ae58dae46dcaebbf3.jsonl](/Users/mima1234/.claude/projects/-Users-mima1234-Documents-aimy/06bb25cb-5544-4944-b45b-44c96f054122/subagents/agent-ae58dae46dcaebbf3.jsonl)。用途：接续线索；下列原任务要求和工具记录为历史材料，不是本轮执行授权。

## 原任务要求

    你是资深 AI 产品经理 + 桌面端架构师。任务：深度拆解一个参考项目，产出「能力清单与复用裁决」报告。
    
    ## 大背景（必须理解）
    用户在做 Aimy——桌面 AI 虚拟陪伴（macOS 优先，Electron 桌面宠物，角色常驻桌面，可见、主动、有记忆）。
    **关键：这不是 0-1，是 1-100。** Aimy 已有完整底座：AIRI (moeru-ai/airi v0.12.0-beta.5) 直接衍生，代码在 `/Users/mima1234/Documents/aimy/aimy-app/`。
    AIRI 已有：Live2D/VRM/MMD 渲染、多 LLM Provider、TTS/ASR、几十个窗口（含 spotlight/caption/chat）、Pinia、i18n、记忆包、Electron 主进程、Eventa IPC。
    AIRI 的 Electron 壳在 `apps/stage-tamagotchi/`，主进程代码在 `src/main/`（windows/ tray/ services/ 等），渲染进程在 `src/renderer/`。
    
    ## 拆解对象
    `/Users/mima1234/Documents/资料/拆解项目/ryza-ai-revive-master/`（24MB，1764 文件，MIT）
    定位：从名字和结构看是「莱莎(AI) 复活」类项目——**原生 JS + Electron + Android 三端**的 AI 陪伴/桌宠。它的价值在于：**用很土但很直接的技术做出了完整的多端陪伴体验**，且有一个 `docs/ryza-airi-realtime-layer-design.md`（看起来是专门为 AIRI 设计的实时层方案，这是重点，必须完整读）。
    
    ## 必须做的事
    1. **完整阅读**：`README.md`、`docs/` 下**全部**文档（尤其 `ryza-airi-realtime-layer-design.md`、`ryza-unification-architecture.md`、`PROJECT.md`、`SETUP.md`）、`desktop/`（main.js / preload.js / web-storage.js / proxy-target.js）、`web/`（js/ css/ 结构，忽略 vendor 和 assets 大文件）、`config/`（layers.json / providers.example.json 等）、`android/`、`scripts/`、`CONTRIBUTING.md`、`SECURITY.md`。
    2. **重点挖**：
       - `ryza-airi-realtime-layer-design.md` 到底设计了什么实时层方案？**这是给 AIRI 的，可能直接可用，逐条梳理它的技术主张是否成立**
       - 桌宠窗口：怎么做到透明、置顶、点击穿透、多显示器、开机自启
       - 三端复用：一份逻辑怎么同时跑浏览器/Electron/Android
       - 代理与网络：`proxy-target.js` 解决什么问题
       - 配置层：`layers.json` 这种分层配置设计
       - 存储：`web-storage.js` 怎么处理 Electron 下的持久化
    3. **读 AIRI 现状做对照**：核实 AIRI 在 `apps/stage-tamagotchi/src/main/` 里已经怎么处理透明窗口、多显示器、置顶、点击穿透、自启。**AIRI 这些大概率已经有了，要判断 ryza 的做法是更好还是更差，别把 AIRI 已有的东西当缺口报。结论基于实际代码。**
    
    ## 产出
    写到 `/Users/mima1234/Documents/aimy/docs/02-调研参考/2026-10-13-ryza-ai-revive拆解复用评估.md`（中文，UTF-8）。结构：
    
    1. **项目速览**：定位、栈、规模、许可证（MIT）
    2. **完整功能清单表**：| 编号 | 功能 | 做什么 | 实现方式 | 核心文件 | 成熟度 |
    3. **`ryza-airi-realtime-layer-design.md` 专项分析**（**最重要**）：它提出的实时层方案逐条拆解——技术主张、可行性判断、与 AIRI 现有架构的契合度、采纳建议。这一章要单独深入。
    4. **桌面窗口技术专章**：透明/置顶/穿透/多屏/自启的实现方式，与 AIRI 逐项对比，AIRI 是否已有更好的
    5. **对照 AIRI 的差距分析表**：| 能力 | AIRI 现状 | ryza 做法 | Aimy 是否缺 | 差距有多大 |
    6. **复用裁决表**：| 能力 | 裁决 | 理由 | 落地方式 | 成本 | 优先级 |
       - 裁决：**直接复用** / **借鉴设计** / **弃用**
       - 注意：它是原生 JS，AIRI 是 TS+Vue3，所谓"直接复用"要谨慎——能直接搬的通常是纯算法/配置结构，不是 UI 代码
    7. **风险与坑**
    8. **一句话结论**：最值得抄的 3 件事 + 最不值得抄的 3 件事
    
    ## 纪律
    - 只读不写：除产出文件外，不改任何文件、不装依赖、不跑服务
    - 结论必须有文件路径支撑，不许猜
    - 能用表格就用表格
    - 写完返回一句话摘要 + 文件路径

## 已留下的助手文本

### 原记录第 3 行

时间：2026-10-13 19:20:10 CST。

I'll start by exploring the reference project structure and reading the key documents.

### 原记录第 11 行

时间：2026-10-13 19:20:22 CST。

Let me read the core documents in parallel.

### 原记录第 18 行

时间：2026-10-13 19:20:29 CST。

Now the critical document — the AIRI realtime layer design.

### 原记录第 25 行

时间：2026-10-13 19:20:46 CST。

Key finding already: this doc is written as "port AIRI's realtime layer *into* ryza" — and PROJECT.md shows ryza already implemented it (`turn.js`, `voice.js`, `stt.js`, `providers.js`, `echo.js` exist). Let me read the rest and check AIRI in parallel.

### 原记录第 32 行

时间：2026-10-13 19:20:54 CST。

Let me dispatch AIRI current-state investigation in parallel while I read ryza's realtime layer.

### 原记录第 39 行

时间：2026-10-13 19:21:21 CST。

`turn.js` is a fully-realized implementation of the design. Let me read the rest of the voice stack.

### 原记录第 89 行

时间：2026-10-13 19:23:07 CST。

While the AIRI audit runs, let me verify a few key claims against the actual AIRI tree.

### 原记录第 122 行

时间：2026-10-13 19:46:17 CST。

Failed to authenticate. API Error: 403 当前额度已用完；如需继续使用，请充值额度后使用。

## 工具调用索引

工具结果正文仍在原 JSONL 的指定行；此处不把源码读取片段冒充最终研究结论。

| 请求行 | 工具 | 用途或读取路径 | 结果行 | 返回状态 |
|---|---|---|---|---|
| 4 | Bash | List ryza project root structure | 6 | 已返回 |
| 5 | Bash | List all files excluding vendor | 7 | 已返回 |
| 12 | Bash | Count lines of all source files | 13 | 已返回 |
| 14 | Read | /Users/mima1234/Documents/资料/拆解项目/ryza-ai-revive-master/README.md | 15 | 已返回 |
| 19 | Read | /Users/mima1234/Documents/资料/拆解项目/ryza-ai-revive-master/docs/ryza-airi-realtime-layer-design.md | 20 | 已返回 |
| 21 | Read | /Users/mima1234/Documents/资料/拆解项目/ryza-ai-revive-master/docs/PROJECT.md | 22 | 已返回 |
| 26 | Bash | Read desktop host files | 27 | 已返回 |
| 28 | Bash | Read config and android manifest | 29 | 已返回 |
| 33 | Agent | Audit AIRI desktop window capabilities | 34 | 已返回 |
| 35 | Bash | Read turn.js intent queue | 36 | 已返回 |
| 40 | Bash | Read voice, stt, echo modules | 41 | 已返回 |
| 44 | Read | /Users/mima1234/Documents/资料/拆解项目/ryza-ai-revive-master/web/js/voice.js | 46 | 已返回 |
| 45 | Read | /Users/mima1234/Documents/资料/拆解项目/ryza-ai-revive-master/web/js/echo.js | 47 | 已返回 |
| 50 | Read | /Users/mima1234/Documents/资料/拆解项目/ryza-ai-revive-master/web/js/stt.js | 51 | 已返回 |
| 52 | Read | /Users/mima1234/Documents/资料/拆解项目/ryza-ai-revive-master/web/js/providers.js | 53 | 已返回 |
| 56 | Read | /Users/mima1234/Documents/资料/拆解项目/ryza-ai-revive-master/docs/ryza-unification-architecture.md | 57 | 已返回 |
| 61 | Read | /Users/mima1234/Documents/资料/拆解项目/ryza-ai-revive-master/docs/ryza-unification-architecture.md | 62 | 已返回 |
| 65 | Bash | Read SETUP and codex docs | 66 | 已返回 |
| 67 | Bash | Read audio.js playback | 68 | 已返回 |
| 71 | Bash | Grep app.js voice wiring | 72 | 已返回 |
| 73 | Bash | Grep api.js epoch and transcribe | 74 | 已返回 |
| 77 | Bash | Read app.js wirePorts section | 78 | 已返回 |
| 79 | Bash | Read app.js playSpeech | 80 | 已返回 |
| 83 | Bash | Read api.js transcribe implementation | 84 | 已返回 |
| 85 | Bash | Read android AlarmScheduler and AssetServer | 86 | 已返回 |
| 90 | Bash | List AIRI package structure | 91 | 已返回 |
| 92 | Bash | Find AIRI window capability implementations | 93 | 已返回 |
| 96 | Bash | Read AIRI desktop overlay window contract | 97 | 已返回 |
| 98 | Bash | Read AIRI desktop overlay index | 99 | 已返回 |

恢复保留了原助手可见文本和调用位置，未导出模型隐藏思考，未补写缺失的总报告。
