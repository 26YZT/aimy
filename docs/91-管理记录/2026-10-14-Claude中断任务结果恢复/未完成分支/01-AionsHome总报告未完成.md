# AionsHome 总报告 未完成工作记录

恢复日期：2026-10-14（Asia/Shanghai）。原任务日期：2026-10-13。状态：因额度 403 中断，未形成最终报告。来源：[agent-a09cd6abbec0f0a7c.jsonl](/Users/mima1234/.claude/projects/-Users-mima1234-Documents-aimy/06bb25cb-5544-4944-b45b-44c96f054122/subagents/agent-a09cd6abbec0f0a7c.jsonl)。用途：接续线索；下列原任务要求和工具记录为历史材料，不是本轮执行授权。

## 原任务要求

    你是资深 AI 产品经理 + 全栈架构师。任务：深度拆解一个参考项目，产出「能力清单与复用裁决」报告。
    
    ## 大背景（必须理解，它决定你的写法）
    用户在做 Aimy——一个桌面 AI 虚拟陪伴产品（macOS 优先，Electron 桌面宠物形态，角色常驻桌面）。
    **关键：这不是 0-1，是 1-100。** Aimy 已经有完整底座：它是 AIRI (github.com/moeru-ai/airi v0.12.0-beta.5) 的直接衍生，代码库在 `/Users/mima1234/Documents/aimy/aimy-app/`。
    AIRI 已具备：Live2D/VRM/MMD/Spine/Tachie 全模型渲染、多 LLM Provider 抽象、语音识别 TTS/ASR、几十个窗口（chat/spotlight/settings/caption/dashboard/editor）、Pinia 状态、i18n、记忆系统（memory 包）、Electron 主进程架构、Eventa IPC。
    
    所以你的产出**不是「建议怎么做一个 AI 陪伴」**，而是：**对照 AIRI 现状，这个项目有什么 AIRI 没有或缺的能力，值不值得引入，引入要付出什么代价。**
    
    ## 拆解对象
    `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/`（447MB，1555 个文件，MIT，本地个人使用场景）
    定位：局域网+Tailscale 多端同步 AI 聊天 + 摄像头智能监控 + 桌面陪伴。Python FastAPI + SQLite + 原生 JS 前端 + 摄像头 OpenCV + Android WebView 壳。
    
    ## 必须做的事
    1. **完整阅读**：README.md（156KB，是主档案，必须读完）、`docs/`、`说明&教程/`、`给朋友的部署教程.md`、`aion-chat/` 下全部 Python 模块（main/config/database/ws/ai_providers/memory/camera 等）、`AionPet/`、`AionsHome-Visitor-Lounge/`、`Connor-Codex/`。忽略 `vendor/`（290MB 依赖）、`public/` 里的媒体大文件、`AionApp/` 的构建产物。
    2. **重点挖「陪伴感」相关机制**，这是 Aimy 最缺的：
       - 主动性：她怎么决定"现在该说话"？触发条件、频率控制、防打扰机制
       - 记忆：向量记忆的具体实现（embedding 维度、召回打分公式、总结触发时机、锚点机制、RAG 路由"即时哨兵"）
       - 摄像头/视觉感知：怎么感知用户状态、分析频率、成本控制、"设备活动摘要"是什么
       - 生活感：日程、基金监控、音乐、EPUB 读书——这些"非聊天"功能怎么让角色显得有生活
       - 多角色：Aion 和 Connor 双 AI 如何共存、群聊时间线怎么合并、各自独立音色与记忆
       - 语音：TTS 流式切分与并行合成、VAD、语音消息
    3. **读 AIRI 现状做对照**：去 `/Users/mima1234/Documents/aimy/aimy-app/` 里核实 AIRI 是否已有同类能力。重点看 `packages/stage-ui/src/stores/`、`packages/stage-ui/src/composables/`、`apps/stage-tamagotchi/src/main/`、以及记忆相关包。**结论必须基于实际读到的代码，不许猜。**
    
    ## 产出
    写到 `/Users/mima1234/Documents/aimy/docs/02-调研参考/2026-10-13-AionsHome拆解复用评估.md`（中文，UTF-8）。结构：
    
    1. **项目速览**：定位、栈、规模、许可证结论（MIT，本地自用可参考）
    2. **完整功能清单表**：| 编号 | 功能 | 做什么 | 实现方式 | 核心文件 | 成熟度 | —— 要穷尽，不许抽样
    3. **架构总结**：分层、数据流、关键设计决策（哪些是聪明的、哪些是技术债）
    4. **对照 AIRI 的差距分析表**（**最重要**）：| 能力 | AIRI 现状 | AionsHome 做法 | Aimy 是否缺 | 差距有多大 |
       - AIRI 现状要写具体：已有/部分有/没有，有的话在哪个文件
       - 明确标出哪些是 AionsHome 真正比 AIRI 强的
    5. **复用裁决表**：| 能力 | 裁决 | 理由 | 落地方式 | 成本 | 优先级 |
       - 裁决只能是三种：**直接复用**（同栈可直接搬）/ **借鉴设计**（思路照搬，TypeScript 重写）/ **弃用**（有更好方案或不适用）
       - **必须明确：Python 代码无法直接搬进 AIRI 的 TypeScript 代码库。跨语言只能借鉴，不能说"直接复用"。**
       - 落地方式要具体到「改哪个模块、新增什么文件、需要什么数据结构」
    6. **风险与坑**：它踩过的坑（Windows 路径硬编码、单文件膨胀、无框架前端等），Aimy 要避开什么
    7. **一句话结论**：最值得抄的 3 件事 + 最不值得抄的 3 件事
    
    ## 纪律
    - 只读不写：除上述产出文件外，不改任何文件、不装依赖、不跑服务
    - 结论必须有文件路径支撑，不许"一般来说""通常"
    - 报告用 Markdown，能用表格就用表格
    - 写完返回一句话摘要 + 文件路径

## 已留下的助手文本

### 原记录第 4 行

时间：2026-10-13 19:19:44 CST。

I'll start by mapping both codebases, then read deeply.

### 原记录第 18 行

时间：2026-10-13 19:20:40 CST。

Large project. Let me map both sides in parallel — first a full inventory of AionsHome, then AIRI ground truth via subagents.

### 原记录第 25 行

时间：2026-10-13 19:21:03 CST。

Now let me fan out deep reads across both codebases in parallel.

### 原记录第 46 行

时间：2026-10-13 19:23:16 CST。

While the deep reads run, let me get the quantitative metrics and read Aimy's own docs for context.

### 原记录第 169 行

时间：2026-10-13 19:36:33 CST。

Memory recon landed. Continuing to wait on the remaining agents while I check a couple of gaps myself.

### 原记录第 196 行

时间：2026-10-13 19:48:15 CST。

Failed to authenticate. API Error: 403 当前额度已用完；如需继续使用，请充值额度后使用。

## 工具调用索引

工具结果正文仍在原 JSONL 的指定行；此处不把源码读取片段冒充最终研究结论。

| 请求行 | 工具 | 用途或读取路径 | 结果行 | 返回状态 |
|---|---|---|---|---|
| 5 | Bash | List AionsHome top level | 8 | 已返回 |
| 6 | Bash | Find Python files | 7 | 已返回 |
| 12 | Bash | List aion-chat files by size | 13 | 已返回 |
| 14 | Bash | List subdirs and non-py files | 15 | 已返回 |
| 19 | Bash | Inventory non-test modules and subdirs | 20 | 已返回 |
| 21 | Bash | Map AIRI structure | 22 | 已返回 |
| 26 | Agent | AionsHome docs inventory | 27 | 已返回 |
| 28 | Agent | AionsHome autonomy deep read | 29 | 已返回 |
| 30 | Agent | AionsHome memory deep read | 31 | 已返回 |
| 32 | Agent | AionsHome perception deep read | 33 | 已返回 |
| 36 | Agent | AionsHome life-features read | 37 | 已返回 |
| 38 | Agent | AionsHome multi-char and voice | 39 | 已返回 |
| 40 | Agent | AionsHome infra and frontend | 41 | 已返回 |
| 42 | Agent | AIRI capability ground truth | 43 | 已返回 |
| 47 | Bash | Compute LOC metrics | 48 | 已返回 |
| 49 | Bash | Deps, data dir, client apps | 50 | 已返回 |
| 53 | Bash | List Aimy docs tree | 56 | 已返回 |
| 54 | Read | /Users/mima1234/Documents/aimy/docs/PROJECT_STATE.md | 55 | 已返回 |
| 59 | Read | /Users/mima1234/Documents/aimy/docs/02-调研参考/2026-10-13-AIRI原生实现复核.md | 60 | 已返回 |
| 61 | Bash | Check prior AionsHome audit | 62 | 已返回 |
| 65 | Bash | Read rest of prior audit | 66 | 已返回 |
| 67 | Bash | Extract DB table names | 68 | 已返回 |
| 71 | Read | /Users/mima1234/Documents/aimy/docs/任务编排.md | 72 | 已返回 |
| 73 | Read | /Users/mima1234/Documents/aimy/docs/00-当前方向/开发方向与边界.md | 74 | 已返回 |
| 77 | Bash | Verify memory scoring constants | 78 | 已返回 |
| 79 | Bash | Provider list and memories DDL | 80 | 已返回 |
| 83 | Bash | Check doc conventions | 84 | 已返回 |
| 85 | Read | /Users/mima1234/Documents/aimy/docs/01-决策记录/2026-10-13-三项产品行为与立项方法.md | 86 | 已返回 |
| 89 | Bash | Quantify frontend duplication | 90 | 已返回 |
| 93 | Bash | Read Aimy PRD head | 94 | 已返回 |
| 97 | Bash | Read PRD 2.0 draft | 98 | 已返回 |
| 101 | Bash | Root README section map | 102 | 已返回 |
| 105 | Bash | Read prompt injection order section | 106 | 已返回 |
| 109 | Bash | Read supported models and features | 110 | 已返回 |
| 113 | Bash | Read more features | 114 | 已返回 |
| 117 | Bash | Read R4 handbook structure | 118 | 已返回 |
| 120 | Bash | Read R4 handbook headings | 121 | 已返回 |
| 123 | Read | /Users/mima1234/Documents/aimy/docs/05-实施手册/R4-记忆与语音增量技术方案.md | 124 | 已返回 |
| 127 | Bash | Wait for agents | 128 | 已返回 |
| 130 | Bash | Continue reading features list | 131 | 已返回 |
| 134 | Bash | Continue reading features | 135 | 已返回 |
| 138 | Bash | Continue reading README features | 139 | 已返回 |
| 142 | Bash | Continue README | 143 | 已返回 |
| 146 | Bash | Continue README features 1050-1175 | 147 | 已返回 |
| 150 | Bash | Read pitfalls and notes sections | 151 | 已返回 |
| 154 | Bash | List changelog entries | 155 | 已返回 |
| 158 | Bash | Wait for background agents | 159 | 失败 |
| 161 | Bash | Read recent changelog | 162 | 已返回 |
| 164 | Bash | Wait for background agents | 165 | 已返回 |
| 170 | Bash | Wait for remaining agents | 171 | 已返回 |

恢复保留了原助手可见文本和调用位置，未导出模型隐藏思考，未补写缺失的总报告。
