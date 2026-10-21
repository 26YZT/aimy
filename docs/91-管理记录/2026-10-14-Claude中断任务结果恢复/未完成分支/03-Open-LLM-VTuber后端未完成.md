# Open-LLM-VTuber 后端 未完成工作记录

恢复日期：2026-10-14（Asia/Shanghai）。原任务日期：2026-10-13。状态：因额度 403 中断，未形成最终报告。来源：[agent-a6b779effea381eeb.jsonl](/Users/mima1234/.claude/projects/-Users-mima1234-Documents-aimy/06bb25cb-5544-4944-b45b-44c96f054122/subagents/agent-a6b779effea381eeb.jsonl)。用途：接续线索；下列原任务要求和工具记录为历史材料，不是本轮执行授权。

## 原任务要求

    你是资深 AI 产品经理 + AI Agent 架构师。任务：深度拆解一个项目的**后端**，产出「能力清单与复用裁决」报告。
    
    ## 大背景（必须理解）
    用户在做 Aimy——桌面 AI 虚拟陪伴（macOS 优先，Electron 桌宠，角色常驻桌面，要"活"：能看见你、主动说话、记得住事）。
    **关键：这不是 0-1，是 1-100。** Aimy 已有完整底座：AIRI (moeru-ai/airi v0.12.0-beta.5) 直接衍生，代码在 `/Users/mima1234/Documents/aimy/aimy-app/`。
    AIRI 已有：Live2D/VRM/MMD 渲染、多 LLM Provider 抽象、TTS/ASR 多个供应商、几十个窗口、Pinia、i18n、记忆包（`packages/` 下有 memory 相关）、Electron 主进程、Eventa IPC。
    **Aimy 目前最缺的是"陪伴感三件套"：主动性（她主动开口）、长期记忆（她自己记住并主动提起）、环境感知（看得见用户在干嘛）。**
    
    ## 拆解对象（**重点就是这一块**）
    `/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/`（MIT License, Copyright 2025 Yi-Ting Chiu）
    只拆**后端**：`src/`、`prompts/`、`characters/`、`config_templates/`、`doc/`、`upgrade_codes/`、`scripts/`、`run_server.py`、`model_dict.json`、`mcp_servers.json`、`.cursor/rules`、`.gemini/`。
    **不要**拆 `frontend/`（另一个 agent 负责）和 `live2d-models/`、`backgrounds/`、`assets/`。
    
    ## 必须完整阅读并深挖的机制
    1. **主动性**：`prompts/utils/proactive_speak_prompt.txt` 是核心。搜遍代码找 proactive 相关逻辑——她怎么决定主动开口？触发条件、提示词设计、怎么和正常对话流交织？这是**最高优先级**。
    2. **记忆系统**：`agent/agents/basic_memory_agent.py`、`letta_agent.py`、`mem0_llm.py` 三套后端各自怎么工作？差异是什么？哪个最轻量可用？`chat_history_manager.py` 的持久化设计。
    3. **Agent 抽象层**：`agent/agent_factory.py`、`agent_interface.py`、`input_types.py`、`output_types.py`、`transformers.py`——这套输入输出契约设计得怎么样？为什么值得借鉴？
    4. **LLM 抽象**：`agent/stateless_llm/*`（claude/ollama/llama_cpp/openai_compatible/template）怎么统一的？
    5. **对话流与并发**：`conversations/`（conversation_handler / single_conversation / group_conversation / tts_manager / types）——**单角色和群聊分别怎么编排**？消息怎么流转？`service_context.py` 的依赖注入。
    6. **语音链路**：`asr/`（8 个供应商）、`tts/`（20+ 供应商）、`vad/silero.py`（本地 VAD）、`utils/sentence_divider.py`（**句子切分**）、`utils/stream_audio.py`（**流式音频**）、`utils/tts_preprocessor.py`、`config_manager/tts_preprocessor.py`——**TTS 怎么做到低延迟的？句子切分和流式是关键技术，必须讲清楚。**
    7. **Prompt 工程**：`prompts/` 下全部文件——`prompt_loader.py` 怎么加载组装？`speakable_prompt`、`think_tag_prompt`、`concise_style_prompt`、`live2d_expression_prompt`、`tool_guidance_prompt`、`live_prompt` 各解决什么问题？`characters/*.yaml` 的角色卡格式（含 `zh_米粒.yaml` 中文示例）。
    8. **MCP 工具系统**：`mcpp/` 全部——工具怎么注册、发现、执行、结果怎么回到对话？`json_detector.py` 做什么？
    9. **配置体系**：`config_manager/` 全部 + `config_templates/conf.default.yaml` 和 `conf.ZH.default.yaml`——**用 pydantic 分层定义配置**，这套设计对 Aimy 设置面板极有价值。
    10. **WebSocket 协议**：`websocket_handler.py`、`message_handler.py`、`routes.py`、`server.py`、`proxy_handler.py`、`proxy_message_queue.py`——前后端消息协议长什么样？
    
    ## 必须做的对照
    去 `/Users/mima1234/Documents/aimy/aimy-app/` 核实 AIRI 是否已有同类能力（尤其：记忆、VAD、TTS 流式、句子切分、主动说话、MCP 支持）。**AIRI 大概率在语音方面已经很强，别把 AIRI 已有的当缺口。结论必须基于实际读到的代码。**
    
    ## 产出
    写到 `/Users/mima1234/Documents/aimy/docs/02-调研参考/2026-10-13-Open-LLM-VTuber后端拆解复用评估.md`（中文，UTF-8）。结构：
    
    1. **项目速览**：定位、栈、规模、许可证、整体架构分层图（用文字或 mermaid）
    2. **完整功能清单表**：| 编号 | 功能 | 做什么 | 实现方式 | 核心文件 | 成熟度 |
    3. **深度专章**（每章都要具体到文件和行为，不许空泛）：
       - 3.1 主动性机制（**最高优先级**，逐行分析 proactive_speak_prompt 和它的调用链）
       - 3.2 记忆系统三套实现对比
       - 3.3 低延迟语音链路（VAD→ASR→LLM→句子切分→TTS 流式→音频推送）
       - 3.4 Agent 抽象与输入输出契约
       - 3.5 Prompt 体系设计
       - 3.6 MCP 工具系统
       - 3.7 配置体系（pydantic 分层）
       - 3.8 WebSocket 前后端协议
    4. **对照 AIRI 的差距分析表**：| 能力 | AIRI 现状 | 该项目做法 | Aimy 是否缺 | 差距有多大 |
    5. **复用裁决表**：| 能力 | 裁决 | 理由 | 落地方式 | 成本 | 优先级 |
       - 裁决：**直接复用** / **借鉴设计** / **弃用**
       - ⚠️ 它是 Python，AIRI 是 TypeScript。**跨语言不能直接搬代码**，只能借鉴设计与算法，用 TS 重写。"直接复用"仅适用于：纯算法/公式、prompt 文本、yaml 配置格式、协议设计这类与语言无关的东西。
    6. **风险与坑**
    7. **一句话结论**：最值得抄的 3 件事 + 最不值得抄的 3 件事
    
    ## 纪律
    - 只读不写：除产出文件外，不改任何文件、不装依赖、不跑服务
    - 结论必须有文件路径支撑，不许猜
    - 引用 prompt 原文时要贴关键段落
    - 能用表格就用表格
    - 写完返回一句话摘要 + 文件路径

## 已留下的助手文本

### 原记录第 3 行

时间：2026-10-13 19:22:03 CST。

I'll start by exploring both codebases to understand their structure, then deep-dive into the Open-LLM-VTuber backend.

### 原记录第 17 行

时间：2026-10-13 19:22:20 CST。

Now let me dig into the highest-priority mechanism: the proactive speaking chain.

### 原记录第 24 行

时间：2026-10-13 19:22:33 CST。

The proactive prompt is surprisingly short — one line. Let me trace the whole chain.

### 原记录第 31 行

时间：2026-10-13 19:22:45 CST。

The proactive prompt is 84 bytes — one sentence. The real mechanism is in the handlers. Let me read the core conversation chain.

### 原记录第 44 行

时间：2026-10-13 19:23:06 CST。

Excellent material. Now the TTS streaming layer and the memory agents.

### 原记录第 55 行

时间：2026-10-13 19:23:29 CST。

Let me delegate the AIRI comparison to a subagent while I continue reading the Python backend.

### 原记录第 60 行

时间：2026-10-13 19:23:50 CST。

Subagent slots are busy; I'll do the AIRI comparison myself. Continuing with the Python backend first.

### 原记录第 79 行

时间：2026-10-13 19:24:21 CST。

`mem0_llm.py` is 0 bytes — a stub. Let me verify and continue with the remaining MCP, config, and websocket layers.

### 原记录第 92 行

时间：2026-10-13 19:24:39 CST。

Now the config system, VAD/TTS/ASR layers, and remaining MCP pieces.

### 原记录第 182 行

时间：2026-10-13 19:40:07 CST。

Now the critical AIRI comparison. Let me survey the actual codebase.

### 原记录第 292 行

时间：2026-10-13 19:45:03 CST。

Failed to authenticate. API Error: 403 当前额度已用完；如需继续使用，请充值额度后使用。

## 工具调用索引

工具结果正文仍在原 JSONL 的指定行；此处不把源码读取片段冒充最终研究结论。

| 请求行 | 工具 | 用途或读取路径 | 结果行 | 返回状态 |
|---|---|---|---|---|
| 4 | Bash | List Open-LLM-VTuber root | 5 | 已返回 |
| 6 | Bash | List AIRI app root | 7 | 已返回 |
| 11 | Bash | List backend file tree | 12 | 已返回 |
| 13 | Bash | Read project metadata files | 14 | 已返回 |
| 18 | Bash | Read all prompt files | 19 | 已返回 |
| 20 | Bash | Find prompt_loader | 21 | 已返回 |
| 25 | Bash | Grep proactive across backend | 26 | 已返回 |
| 27 | Bash | Read prompt_loader.py | 28 | 已返回 |
| 32 | Bash | Read conversation_handler and single_conversation | 33 | 已返回 |
| 34 | Bash | Read input/output types | 35 | 已返回 |
| 38 | Bash | Read conversation_utils | 39 | 已返回 |
| 40 | Bash | Read sentence_divider | 41 | 已返回 |
| 45 | Bash | Read tts_manager, stream_audio, types | 48 | 已返回 |
| 46 | Bash | Read basic_memory_agent | 47 | 已返回 |
| 51 | Read | /Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/agent/agents/basic_memory_agent.py | 52 | 已返回 |
| 56 | Agent | Verify AIRI existing capabilities | 57 | 失败 |
| 61 | Bash | Read transformers.py | 62 | 已返回 |
| 63 | Bash | Read agent factory and interface | 64 | 已返回 |
| 67 | Bash | Read chat_history_manager | 68 | 已返回 |
| 69 | Bash | Read letta and mem0 agents | 70 | 已返回 |
| 73 | Bash | Read mem0_llm.py | 74 | 已返回 |
| 75 | Bash | Read MCP tool manager and json detector | 76 | 已返回 |
| 80 | Bash | Check mem0 file state | 81 | 已返回 |
| 82 | Bash | Read server_registry and mcp types | 83 | 已返回 |
| 86 | Bash | Read websocket_handler | 87 | 已返回 |
| 88 | Bash | Read service_context | 89 | 已返回 |
| 93 | Bash | Read config_manager init, main, agent | 94 | 已返回 |
| 95 | Bash | Read VAD and tts_preprocessor | 96 | 已返回 |
| 99 | Bash | Read character yaml files | 100 | 已返回 |
| 101 | Bash | Read default config template | 102 | 已返回 |
| 105 | Bash | Read i18n, system, utils config | 106 | 已返回 |
| 107 | Bash | Read tool_adapter | 108 | 已返回 |
| 134 | Bash | Read tool_executor and mcp_client | 135 | 已返回 |
| 136 | Bash | Read group_conversation | 137 | 已返回 |
| 140 | Bash | Read LLM interface, template, factory | 141 | 已返回 |
| 142 | Bash | Read claude_llm | 143 | 已返回 |
| 146 | Bash | Read openai/ollama/llamacpp LLMs | 149 | 已返回 |
| 147 | Bash | Read server entry and routes | 148 | 失败 |
| 152 | Bash | Locate and read run_server.py | 153 | 已返回 |
| 154 | Bash | Read server.py and routes.py | 155 | 已返回 |
| 158 | Bash | Read message_handler and proxy queue | 159 | 已返回 |
| 160 | Bash | Read ASR and TTS interfaces/factories | 161 | 已返回 |
| 164 | Bash | Read tts_preprocessor, vad, agent config | 165 | 已返回 |
| 166 | Bash | Read proxy handler and ZH tool_prompts | 167 | 已返回 |
| 170 | Bash | Read character/main config | 171 | 已返回 |
| 172 | Bash | Read TTS factory, doc, scripts, prompts tree | 173 | 失败 |
| 176 | Bash | List doc, scripts, prompts, characters | 177 | 已返回 |
| 178 | Bash | Read tts_preprocessor util | 179 | 已返回 |
| 183 | Bash | Survey AIRI repo layout | 184 | 已返回 |
| 185 | Bash | Find memory/proactive/MCP in AIRI | 186 | 已返回 |
| 189 | Bash | Explore AIRI memory + core-agent | 190 | 已返回 |
| 191 | Bash | Grep proactive across AIRI | 192 | 已返回 |
| 195 | Bash | Read core-agent structure | 196 | 已返回 |
| 197 | Bash | Read AIRI memory-pgvector | 198 | 已返回 |
| 201 | Bash | Read memory settings page | 202 | 已返回 |
| 203 | Bash | Find AIRI MCP support | 204 | 已返回 |
| 207 | Bash | Explore AIRI audio pipelines | 208 | 已返回 |
| 209 | Bash | Grep AIRI sentence splitting and VAD | 210 | 已返回 |
| 213 | Bash | Read AIRI tts-chunker | 215 | 已返回 |
| 214 | Bash | Read AIRI VAD | 216 | 已返回 |
| 219 | Bash | Read AIRI MCP store and tools | 220 | 已返回 |
| 221 | Bash | Find AIRI chat history persistence | 222 | 已返回 |
| 225 | Bash | Read compaction and summary | 227 | 已返回 |
| 226 | Bash | Find AIRI screen capture and autonomy | 228 | 已返回 |
| 231 | Bash | Inspect vision orchestrator and providers | 232 | 已返回 |
| 233 | Bash | Check AIRI chat persistence | 234 | 已返回 |
| 237 | Bash | Inspect AIRI database layer | 238 | 已返回 |
| 239 | Bash | Inspect AIRI MCP main process | 240 | 已返回 |
| 243 | Bash | Check AIRI persona and long-term memory | 244 | 已返回 |
| 245 | Bash | Inspect AIRI voice providers and stores | 246 | 已返回 |
| 249 | Bash | Read journal-preview and wake-words | 250 | 已返回 |
| 251 | Bash | Read presence-bubble and consciousness | 252 | 已返回 |
| 254 | Bash | Read character notebook store | 255 | 已返回 |
| 256 | Bash | Look for AIRI scheduling/proactive | 257 | 已返回 |
| 277 | Bash | List task output files | 278 | 已返回 |
| 279 | Bash | List docs structure | 280 | 已返回 |
| 283 | Bash | Read task orchestration and research README | 284 | 已返回 |
| 285 | Bash | Read project state and decision records | 286 | 已返回 |
| 289 | Bash | Check status of running subagents | 290 | 失败 |

恢复保留了原助手可见文本和调用位置，未导出模型隐藏思考，未补写缺失的总报告。
