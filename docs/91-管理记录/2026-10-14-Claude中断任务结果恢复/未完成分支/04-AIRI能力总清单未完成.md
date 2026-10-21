# AIRI 统一能力清单 未完成工作记录

恢复日期：2026-10-14（Asia/Shanghai）。原任务日期：2026-10-13。状态：因额度 403 中断，未形成最终报告。来源：[agent-a891a321c3f976178.jsonl](/Users/mima1234/.claude/projects/-Users-mima1234-Documents-aimy/06bb25cb-5544-4944-b45b-44c96f054122/subagents/agent-a891a321c3f976178.jsonl)。用途：接续线索；下列原任务要求和工具记录为历史材料，不是本轮执行授权。

## 原任务要求

    你是资深代码考古专家 + 技术架构师。任务：为整个项目建立一份**权威的 AIRI 现状能力清单**。这份文档是其他所有复用决策的共同基线，所以必须准确、具体、有文件路径。
    
    ## 为什么需要这份文档
    用户在做 Aimy——桌面 AI 虚拟陪伴产品，是 AIRI (moeru-ai/airi v0.12.0-beta.5) 的**品牌衍生版**，不是从零开始。
    团队正在拆解 5-6 个外部项目，评估「哪些能力值得引入」。**判断某个能力"缺不缺"的前提，是准确知道 AIRI 已经有什么。** 这份文档就是那个前提。
    如果这份文档不准，后面所有复用裁决都会错——把已有的当缺口去重造，或者漏掉真正的缺口。
    
    ## 拆解对象
    `/Users/mima1234/Documents/aimy/aimy-app/`（AIRI v0.12.0-beta.5 的完整副本，pnpm monorepo）
    
    ## 要做的事
    系统性盘点 AIRI **实际已实现**的能力。方法建议：
    1. 先读顶层 `AGENTS.md`（给 agent 的项目指南，有项目地图）、`README.md`、根 `package.json`、`pnpm-workspace.yaml`
    2. 逐个 `apps/` 和 `packages/` 列出其 `package.json` 的 name/描述，读关键包的 `README.md`
    3. 对重点能力，**深入源码确认是否真的实现**（不是只有目录骨架）
    4. 忽略：`node_modules/`、构建产物、`.git/`、大二进制资源
    
    ## 必须覆盖的维度（每项都要回答「有没有 / 实现在哪 / 成熟度 / 关键限制」）
    
    **A. 角色表现层**
    - 模型渲染：Live2D / VRM / MMD / Spine / Tachie 各自的包、成熟度、支持的功能
    - 表情与情绪：情绪系统在哪？怎么触发？有没有情绪状态机？
    - 动作与口型：口型同步怎么做的？动作库？
    - 角色卡片/人设：角色配置怎么定义、存在哪
    
    **B. 对话与推理**
    - LLM Provider 抽象：支持哪些供应商，在哪定义
    - 对话流编排：一次对话从输入到输出的完整链路，关键文件
    - 结构化输出/工具调用：有没有 function calling、MCP 支持
    - **主动性（proactive）**：她会不会主动开口？有没有定时/事件触发的说话机制？**重点查，这是产品核心诉求**
    - 打断/插话：用户中途打断怎么处理
    
    **C. 记忆系统**
    - 有没有记忆？在哪个包？
    - 短期/长期记忆怎么分的？存储在哪（IndexedDB？文件？）
    - 有没有向量检索/embedding？有没有自动总结？
    - **她会不会主动"提起"过去的事？** 有没有相关机制？
    - 记忆的读写触发时机
    
    **D. 感知输入**
    - 语音：ASR 哪些供应商、VAD 在哪、录音链路
    - 视觉：屏幕感知？摄像头？看图能力？（搜 screen / vision / camera / screenshot 相关）
    - 环境感知：有没有"看用户在干嘛"的能力
    - 输入方式：文字、语音、快捷键、Spotlight 唤起等
    
    **E. 语音输出**
    - TTS 供应商清单
    - 流式播放？句子切分？音频处理管线？
    - 口型同步的音频驱动
    
    **F. 桌面集成（Electron）**
    - 窗口体系：列出全部窗口类型及其用途（`apps/stage-tamagotchi/src/main/windows/`）
    - 窗口能力：透明、置顶、点击穿透、多显示器、鼠标跟随
    - 托盘、快捷键、开机自启
    - 主进程服务：`src/main/services/` 有哪些
    - IPC 机制（Eventa）
    
    **G. 设置与配置**
    - 设置面板结构（页面清单）
    - 配置存储方式与位置
    - i18n 支持情况（`packages/i18n`）
    
    **H. 服务端与扩展**
    - `packages/server-*` 是什么，干什么用的
    - `services/` 目录（如 computer-use-mcp）
    - 插件机制
    - 有没有云端依赖？本地优先程度如何
    
    **I. 工程基建**
    - 测试：什么框架、覆盖哪些、怎么跑
    - 构建：electron-vite？打包配置
    - 代码质量：lint、typecheck 命令
    - 更新机制：自动更新怎么做的
    
    ## 产出
    写到 `/Users/mima1234/Documents/aimy/docs/02-调研参考/2026-10-13-AIRI现状能力清单.md`（中文，UTF-8）。结构：
    
    1. **一句话总览**：AIRI 是什么、技术栈、规模
    2. **能力清单主表**（**核心产出**）：| 大类 | 能力 | 有无 | 实现位置（文件路径） | 成熟度 | 关键限制/缺口 |
       - 成熟度用：**完整** / **可用** / **雏形** / **缺失**
       - 要穷尽，覆盖上面 A–I 全部维度
    3. **架构地图**：目录树 + 每个关键包/目录干什么（简表）
    4. **明确的能力缺口清单**：AIRI **没有**或**很弱**的能力，单独列表。这是给后续复用裁决用的——哪些外部项目能补上这些洞
    5. **改动边界提醒**：哪些是品牌衍生时**不能动**的内部约定（搜 `@proj-airi`、`airi-local`、`airi-sherpaw`、IPC 通道名等），列出来
    6. **给复用裁决的提示**：基于你看到的现状，指出哪几类能力最值得从外部引入
    
    ## 纪律
    - 只读不写：除产出文件外，不改任何文件、不装依赖、不跑构建
    - **准确性 > 完整性**：宁可写"没找到"或"存疑"，也不要猜测或编造。任何结论必须有文件路径支撑
    - 如果发现某个包只是空壳/占位，如实标注为"雏形"
    - 能用表格就用表格
    - 写完返回一句话摘要 + 文件路径

## 已留下的助手文本

### 原记录第 4 行

时间：2026-10-13 19:22:46 CST。

I'll start with a top-level recon of the repository structure and project guides.

### 原记录第 12 行

时间：2026-10-13 19:22:57 CST。

Large monorepo. Let me read the project guide and dispatch parallel deep-dives.

### 原记录第 19 行

时间：2026-10-13 19:23:20 CST。

Now I'll dispatch parallel deep-dives across the A–I dimensions while I survey the desktop app and architecture myself.

### 原记录第 38 行

时间：2026-10-13 19:26:23 CST。

Subagents are unavailable in this environment — I'll do the audit directly with targeted parallel searches.

### 原记录第 45 行

时间：2026-10-13 19:26:33 CST。

This repo has far more than expected. Let me map the core `stage-ui` stores and the desktop windows.

### 原记录第 52 行

时间：2026-10-13 19:26:42 CST。

Found `consciousness` and `artistry-autonomous` modules — likely the proactivity core. Let me dig in.

### 原记录第 59 行

时间：2026-10-13 19:26:55 CST。

Big finding: there's a `database` layer, a consciousness/vision module, and chat session management. Let me examine these.

### 原记录第 83 行

时间：2026-10-13 19:27:45 CST。

Found memory settings pages and a memory module area. Let me check those and the vision/hearing modules.

### 原记录第 113 行

时间：2026-10-13 19:28:44 CST。

Now let me survey the window system and desktop capabilities.

### 原记录第 131 行

时间：2026-10-13 19:29:18 CST。

Note: the branding has already been partially changed (appId `ai.aimy.desktop`, productName `Aimy`). Let me check the internal identifier boundaries.

### 原记录第 150 行

时间：2026-10-13 19:29:54 CST。

Found it — `character/orchestrator` with an attention loop and scheduled tasks. Let me read it.

### 原记录第 230 行

时间：2026-10-13 19:45:09 CST。

Failed to authenticate. API Error: 403 当前额度已用完；如需继续使用，请充值额度后使用。

## 工具调用索引

工具结果正文仍在原 JSONL 的指定行；此处不把源码读取片段冒充最终研究结论。

| 请求行 | 工具 | 用途或读取路径 | 结果行 | 返回状态 |
|---|---|---|---|---|
| 5 | Bash | List repo root and workspace config | 6 | 已返回 |
| 7 | Bash | List apps, packages, services, plugins | 8 | 已返回 |
| 13 | Bash | Read AGENTS.md project guide | 14 | 已返回 |
| 15 | Bash | List all package names and descriptions | 16 | 已返回 |
| 20 | Agent | Audit rendering and character layer | 21 | 失败 |
| 22 | Agent | Audit LLM conversation and proactivity | 23 | 失败 |
| 24 | Agent | Audit memory system | 25 | 失败 |
| 26 | Agent | Audit perception inputs | 27 | 失败 |
| 28 | Agent | Audit TTS and audio output | 29 | 失败 |
| 30 | Agent | Audit Electron desktop integration | 31 | 失败 |
| 32 | Agent | Audit settings, i18n, engineering | 33 | 失败 |
| 34 | Agent | Audit server, plugins, services | 35 | 失败 |
| 39 | Bash | Read README head and desktop app dir tree | 40 | 已返回 |
| 41 | Bash | List main process windows, services, shared contracts | 42 | 已返回 |
| 46 | Bash | List stage-ui stores and composables | 47 | 已返回 |
| 48 | Bash | Grep for proactivity mechanisms | 49 | 已返回 |
| 53 | Bash | Read consciousness and autonomous modules | 54 | 已返回 |
| 55 | Bash | List chat/character/ai/mods/settings dirs and memory refs | 56 | 已返回 |
| 60 | Bash | Explore database layer | 61 | 已返回 |
| 62 | Bash | Inspect memory-pgvector, ccc, core-agent | 63 | 已返回 |
| 66 | Bash | List provider-inference source tree | 67 | 已返回 |
| 68 | Bash | List stage-ui subdirectories in detail | 69 | 已返回 |
| 72 | Bash | Explore i18n package layout | 73 | 已返回 |
| 74 | Bash | List three and live2d package sources | 75 | 已返回 |
| 78 | Bash | Read eventa contracts and list window files | 79 | 已返回 |
| 80 | Bash | List all settings pages | 81 | 已返回 |
| 84 | Bash | Search for memory implementations | 85 | 已返回 |
| 86 | Bash | Read vision module store | 87 | 已返回 |
| 90 | Bash | Read memory settings pages and pgvector source | 91 | 已返回 |
| 92 | Bash | Read emotions constants and AIRI card type | 93 | 已返回 |
| 96 | Bash | Read the hearing (ASR/VAD) module | 97 | 已返回 |
| 98 | Bash | Inspect speech/TTS module | 99 | 已返回 |
| 102 | Bash | List all provider definitions | 103 | 已返回 |
| 104 | Bash | Inspect official hosted provider and base URLs | 105 | 已返回 |
| 107 | Bash | Inspect cloud/API base URL config | 108 | 已返回 |
| 109 | Bash | Read desktop main entry and electron services | 110 | 已返回 |
| 114 | Bash | List each window directory contents | 115 | 已返回 |
| 116 | Bash | Grep window flags across window modules | 117 | 已返回 |
| 119 | Bash | Grep window flags with include filter | 121 | 已返回 |
| 120 | Bash | Read purpose comments of each window module | 122 | 已返回 |
| 125 | Bash | Read electron-builder config | 126 | 已返回 |
| 127 | Bash | Read auto-updater, tray, global shortcut | 128 | 已返回 |
| 132 | Bash | Find internal identifier boundaries | 133 | 已返回 |
| 134 | Bash | Find storage keys and userData references | 135 | 已返回 |
| 138 | Bash | Read rest of consciousness store | 139 | 已返回 |
| 140 | Bash | Read chat session store | 141 | 已返回 |
| 144 | Bash | Grep for proactivity terms in source | 145 | 已返回 |
| 146 | Bash | Read core-agent README and core-character tree | 147 | 已返回 |
| 151 | Bash | Read character orchestrator attention loop | 152 | 已返回 |
| 155 | Bash | Read character store and notebook | 156 | 已返回 |
| 157 | Bash | Inspect server channel and spark event producers | 158 | 已返回 |
| 161 | Bash | Trace notebook writers and spark-command tools | 162 | 已返回 |
| 163 | Bash | Inspect character card v3 schema | 164 | 已返回 |
| 167 | Bash | Read the LLM chat orchestration store | 168 | 已返回 |
| 169 | Bash | List audio pipeline sources | 170 | 已返回 |
| 173 | Bash | Read VAD and interruption implementation | 174 | 已返回 |
| 175 | Bash | Survey integrations, engines, server, services | 176 | 失败 |
| 179 | Bash | List engines, server, computer-use-mcp | 180 | 已返回 |
| 181 | Bash | Inspect official speech provider | 182 | 已返回 |
| 185 | Bash | Extract all provider IDs | 186 | 已返回 |
| 187 | Bash | List settings entries | 188 | 已返回 |
| 207 | Bash | Check docs dir and target file | 208 | 失败 |
| 209 | Bash | List all settings pages | 210 | 已返回 |
| 213 | Bash | List windows, services, autostart | 214 | 失败 |
| 215 | Bash | Find test configs and counts | 216 | 已返回 |
| 219 | Bash | Trace emotion triggering | 220 | 已返回 |
| 221 | Bash | Find lip sync and tray | 222 | 已返回 |
| 225 | Bash | Inspect Stage.vue emotion wiring | 226 | 已返回 |
| 227 | Bash | Inspect lip sync implementation | 228 | 已返回 |

恢复保留了原助手可见文本和调用位置，未导出模型隐藏思考，未补写缺失的总报告。
