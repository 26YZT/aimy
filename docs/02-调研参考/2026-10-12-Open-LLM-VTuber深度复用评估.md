# Open-LLM-VTuber：面向 Aimy 的深度复用评估

- 产出日期：2026-10-12（Asia/Shanghai）。状态：调研建议，未选型、未接入、未完成产品运行验收。
- 产生原因：用户补充官方用户指南和 GitHub 地址，要求进一步检查该项目；深化此前多模态候选中的浅查。
- 来源：官方用户指南、后端及独立前端的固定版本源码；对照 `/Users/mima1234/Documents/airi-main`。未使用工作区内旧 AIRI 副本。
- 用途与风险：判断可以借用哪些能力、怎样接入及其限制；不能自动变成需求、依赖选型、主工程切换或开发任务。
- 替代关系：本报告更新此前 Open-LLM-VTuber 子项的许可证与“已听回复”判断；其他候选结论不变。证据见[本次证据目录](2026-10-12-Open-LLM-VTuber深度复用证据/README.md)。

## 1. 建议如何使用

**值得保留为语音陪伴体验的重点对照项目，复用价值主要在局部策略和数据结构。Aimy 仍应由完整 AIRI 承担桌面、会话、采集、播放和角色渲染。** 该项目覆盖语音、Live2D、看屏、主动说话，但不能据此认定它已经满足 Aimy 的长期记忆、隐私关闭和可靠取消要求。

| 方向 | 具体价值 | 建议处理 |
|---|---|---|
| 首句响应 | 先把首个短句交给 TTS，减少等待完整回复的时间 | 与 AIRI 已有分句策略对照，按实际中文效果调参；不新增整套分句器 |
| 说话与角色表现 | 显示文字、朗读文字、表情动作分开表达，在语音播放时衔接 | 借用后端输出结构，映射到 AIRI 原有表情、动作和音频事件 |
| 用户插话 | 停播、停口型、清待播项，并将回复进度反馈给对话上下文 | 借鉴行为目标；需要更准确的播放进度和完整取消链路 |
| 授权看屏 | 发起对话时截取当前帧并提交给视觉模型 | 使用 AIRI 已有采集入口，补充帧预算、权限检查与关闭后拒绝晚到结果 |
| 主动陪伴 | 空闲计时后发起一次主动说话 | 只参考触发设计；要适配用户开关、频率、打扰程度和调用成本 |
| 长期记忆 | 默认是短期上下文和历史会话；额外 Agent 有明显限制 | 不作为本轮长期记忆首选，不替代事实记忆与纠正、删除、重启验收 |
| 角色构建 | 配置人格、已有模型、表情映射和点击动作 | 属于角色运行配置，不能替代绘制、建模、绑定或音色制作工具 |

其中**没有完整模块能无改动放进 AIRI 即可使用**：后端为 Python，前端为 React，而 AIRI 主要使用 Vue/TypeScript；前端还存在单独的商业许可限制。

## 2. 版本与全局源码地图

| 对象 | 本轮固定版本 | 说明 |
|---|---|---|
| 后端 `Open-LLM-VTuber` | `992309c0aa19845960228f880013d4685fde93b5`，提交于 2026-05-15 UTC | 包声明 1.2.1；本次 API 返回的最新 release 为 v1.2.1（2025-08-26） |
| 后端锁定的前端构建 | `06a659b114fff788cf0daaa86e484576db4975bf` | `frontend` 是独立仓库的 `build` 分支子模块，不能只审查后端许可证 |
| 对应前端源码 | `3d57a9a0125a0ca13e5d096f7092e4e494ed389e`，提交于 2025-08-21 UTC | 按上述构建提交说明追溯；未独立复现构建字节一致性 |
| 前端当前 main | `d176e7df2366952e3bacbf12cf9a8b18a4315932` | 仅核对版本与许可证；实现判断使用构建对应源码，未混用 main |

完成后端与前端的完整递归目录预览，取回 84 份后端/配置/提示词/许可文本及 48 份前端/许可文本；重点检查对话、取消、历史、媒体采集、播放、角色配置和桌面生命周期。取回文件不等于逐行审计整个项目，也未逐个运行所有 provider 或审计所有第三方依赖。

整体链路为：

```text
React/Electron：麦克风 VAD／文字输入／按需截屏
        ↓ WebSocket
Python：ASR → Agent/文本或视觉模型 → 分句、朗读过滤、表情提取
        ↓ 并行生成 TTS、按句序发送
React：播放队列 → 字幕、Live2D 表情／Talk 动作／音量驱动口型
        ↓ 播放完成回执
Python：完成本轮、写会话历史
```

主要入口：`run_server.py`、`server.py`、`routes.py`、`websocket_handler.py`；业务在 `conversations/`、`agent/`、`asr/`、`tts/`、`mcpp/`；人格与 provider 在 YAML 配置，已有模型映射在 `model_dict.json`。前端集中在 `src/main/`、React `context/`、`hooks/`、`services/` 和 `WebSDK/`。

[后端 README](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber/blob/992309c0aa19845960228f880013d4685fde93b5/README.md#L14)说明 v2 正处于重写的早期讨论与规划，v1 继续修错；不能把 v2 当现成能力。官方[架构页](https://docs.llmvtuber.com/docs/user-guide/backend/structure/)明确基于 v1.0.0，部分路径已变化，具体实现以本次固定源码为准。

## 3. 对 Aimy 需求的实际覆盖

### 连续语音与插话：有完整实现路径，可靠性和中文体验尚未验收

前端 VAD 检测真实说话后触发打断，语音结束再把音频发送给后端 ASR；通常走 ASR → 文本模型 → TTS 的逐轮链路。它不等于已经获得原生语音模型的情绪理解、准确轮次判断或无回声的全双工体验。官方也说明当前 Hume 接入仍先转文字，不能完整利用音频情绪能力。[Agent 指南](https://docs.llmvtuber.com/docs/user-guide/backend/agent/)

后端 `SentenceOutput` 明确分开 `display_text`、`tts_text` 与 `actions`，便于括号动作不被念出来、表情与对应句子一起传递。前端在播放任务中设置表情、随机 Talk 动作并启动基于 RMS 音量的口型；没有据此证明音素级对齐或动作完全同步。证据：[输出类型](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber/blob/992309c0aa19845960228f880013d4685fde93b5/src/open_llm_vtuber/agent/output_types.py#L45-L63)、[播放处理](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber-Web/blob/3d57a9a0125a0ca13e5d096f7092e4e494ed389e/src/renderer/src/hooks/utils/use-audio-task.ts#L128-L199)。

“用户已经听到的回复”需要修正理解：前端在实际播放开始前，就把当前整句加入 `fullResponse`，中断时将它发回后端。它近似于**已进入播放任务的句子文本**，不是用户确实听完的逐字前缀。若一句播到一半，历史可能包含还没听到的后半句。证据：[整句追加位置](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber-Web/blob/3d57a9a0125a0ca13e5d096f7092e4e494ed389e/src/renderer/src/hooks/utils/use-audio-task.ts#L85-L98)、[中断回传](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber-Web/blob/3d57a9a0125a0ca13e5d096f7092e4e494ed389e/src/renderer/src/hooks/utils/use-interrupt.ts#L13-L37)。

### 图片与看屏：有帧输入，持续理解游戏／视频仍是体验缺口

`captureAllMedia()` 从已开启的媒体流抓帧、缩放压缩成 JPEG；文字、语音提交或主动说话时附带图片。后端 BasicMemoryAgent 将图片放入当前视觉模型请求。**这能提供当前画面线索，不足以证明连续视频、声音事件或游戏过程理解。** 效果依赖实际模型、截帧时机和图像预算。任意文件上传/剪贴板图片的完整交互本轮未验收。[抓帧代码](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber-Web/blob/3d57a9a0125a0ca13e5d096f7092e4e494ed389e/src/renderer/src/hooks/utils/use-media-capture.tsx#L54-L131)

它还包含摄像头路径；Aimy 当前无摄像头需求，不应连带引入。Electron 抓屏入口直接使用第一块屏幕，不能覆盖用户选择窗口／屏幕和授权撤销的产品要求。[桌面抓屏入口](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber-Web/blob/3d57a9a0125a0ca13e5d096f7092e4e494ed389e/src/main/index.ts#L70-L73)

### 记忆：会话续接成立于源码层，可靠长期记忆不成立

- 默认 `BasicMemoryAgent` 保存本会话消息列表，并可加载选定历史；未发现该路径具备跨会话事实提取、检索、来源追踪和纠正/删除闭环。[历史载入](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber/blob/992309c0aa19845960228f880013d4685fde93b5/src/open_llm_vtuber/agent/agents/basic_memory_agent.py#L176-L223)
- 官方标明 Mem0 Agent 暂时移除；固定源码中的 `mem0_llm.py` 是空文件，factory 的残留导入不能证明可用。[残留分支](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber/blob/992309c0aa19845960228f880013d4685fde93b5/src/open_llm_vtuber/agent/agent_factory.py#L88-L108)
- Letta 需要另行运行服务和创建 Agent；官方注明该路径目前不支持图片，模型/人格配置也转由 Letta 服务管理。其本地历史载入和中断接口仍是 `pass`，不能认定与默认 Agent 行为等价。[Letta 源码](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber/blob/992309c0aa19845960228f880013d4685fde93b5/src/open_llm_vtuber/agent/agents/letta_agent.py#L53-L58)、[官方说明](https://docs.llmvtuber.com/docs/user-guide/backend/agent/)

这些是本项目集成路径的结论，不否定 Mem0 或 Letta 各自独立项目的能力。

### 人格、角色、主动说话：适合参考运行配置

人格提示词与角色配置可以控制称呼、语气、模型和音色；`emotionMap`、`tapMotions` 将已有 Live2D 资产的表情和动作接到对话/点击上。它使用已有模型，并非角色制作软件。[角色配置指南](https://docs.llmvtuber.com/docs/user-guide/backend/character_settings/)、[Live2D 指南](https://docs.llmvtuber.com/docs/user-guide/live2d/)

主动说话主要是空闲计时 + 特定 prompt；默认关闭，源码默认等待时间为 5 秒，开启后随状态重设计时。没有在该路径中证明日调用额度、情境判断、安静时段或持续关系状态管理。`skip_memory/skip_history` 对主动触发主要跳过合成的用户输入，不能据注释推断主动回复完全不留存。[主动触发前端](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber-Web/blob/3d57a9a0125a0ca13e5d096f7092e4e494ed389e/src/renderer/src/context/proactive-speak-context.tsx)、[后端触发](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber/blob/992309c0aa19845960228f880013d4685fde93b5/src/open_llm_vtuber/conversations/conversation_handler.py#L33-L62)

MCP、多人对话和直播属于扩展能力；当前不应因此扩大 Aimy 一期范围。MCP 可启动配置中的外部命令，不能代替用户授权或工具行为审查。[MCP 指南](https://docs.llmvtuber.com/docs/user-guide/mcp/overview/)

## 4. 哪些能拆，哪些需要适配

| 分类 | 源码范围／内容 | 复用方式与 AIRI 对接点 |
|---|---|---|
| 后端小函数可摘取后适配 | `utils/tts_preprocessor.py` 的嵌套括号过滤；`live2d_model.py` 的情绪标签提取 | Python → TypeScript；仅在 AIRI 原有处理存在具体缺口时移植，并保留来源许可。括号内容何时显示/朗读需产品确认 |
| 后端结构可参考 | `agent/output_types.py` 的显示/朗读/动作分离；表情关键词映射、提示词骨架 | 转换为 AIRI 的类型、角色参数和流事件；不新增第二份角色/会话存储，不复制示例角色素材 |
| 首句算法需比较适配 | `utils/sentence_divider.py`、`agent/transformers.py` | AIRI 已有 `tts-chunker.ts` 的开头软标点分句和最小长度；优先验证现有实现，避免移植整个 Python/pysbd/langdetect 依赖链 |
| ASR/TTS provider 可单独评测 | `asr/`、`tts/` 的接口和 factory | 如果特定引擎有优势，优先使用其官方 SDK/API 接 AIRI provider；Python 只能作为必要时的窄接口服务，不能接管麦克风、会话或播放 |
| 前端代码暂作行为参考 | React VAD、播放器、屏幕上下文、Electron 桌宠菜单/窗口 | 技术上要改成 Vue/现有 Electron 桥接；另有商业许可门槛，未经相应授权不列为可直接复制代码 |
| 不继承整套 | `ServiceContext`、WebSocket 协议、Agent 内存、JSON 历史、两端任务队列、配置装配 | 会与 AIRI 的取消、持久化、音频、权限和凭证边界重复；保留 AIRI 唯一所有者 |
| 不作为记忆方案 | 默认 history、空 Mem0 实现、当前 Letta 适配 | 单独选定符合本地优先/纠正删除要求的记忆方案；本次不作选型 |
| 角色制作工具 | 本项目无独立建模/绘制/绑定能力 | 只能提供运行配置参考，角色制作继续走专门工具与资产流程 |

本地 AIRI 已核对：`packages/pipelines-audio/src/processors/tts-chunker.ts`、`speech-pipeline.ts`、`managers/playback-manager.ts`；`packages/stage-layouts/src/composables/use-chat-interruption.ts`；`apps/stage-tamagotchi/src/renderer/composables/use-vision-screen-capture.ts`；`packages/stage-ui/src/components/scenes/Stage.vue`。已有首句提前分段、带 turn/intent 的音频调度、会话中断、屏幕源管理和角色表现入口；源码存在仍不等于真实体验通过。文件指纹保存在本次证据目录。

## 5. 代码检查中需要优先处理的问题

| 发现 | 证据与验证级别 | 对复用的影响 |
|---|---|---|
| `clear()` 不逐个取消 TTS 子任务 | [tts_manager.py:174–182](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber/blob/992309c0aa19845960228f880013d4685fde93b5/src/open_llm_vtuber/conversations/tts_manager.py#L174-L182)；隔离模拟已重现：列表清空后合成仍继续，结果进入新队列，但没有发送 | 不能认定“清队列=停合成”。是否传播父任务取消取决于中断时机；完整串音尚未复现 |
| 同客户端新对话覆盖任务引用 | [conversation_handler.py:97–110](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber/blob/992309c0aa19845960228f880013d4685fde93b5/src/open_llm_vtuber/conversations/conversation_handler.py#L97-L110)；隔离模拟重现两个任务仍挂起、字典只追踪后一个 | 需要串行/替换规则及 turn ID。未证明正常 UI 一定触发该情况 |
| 播放回执没有设置等待超时 | [conversation_utils.py:162–190](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber/blob/992309c0aa19845960228f880013d4685fde93b5/src/open_llm_vtuber/conversations/conversation_utils.py#L162-L190)、[MessageHandler](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber/blob/992309c0aa19845960228f880013d4685fde93b5/src/open_llm_vtuber/message_handler.py#L16-L55)；静态确认 | 连接存续而前端漏回执时存在无限等待路径；音频/回执未按 turn 关联，不能借来充当可靠完成协议 |
| 历史文件全量覆盖写入 | [chat_history_manager.py:121–146](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber/blob/992309c0aa19845960228f880013d4685fde93b5/src/open_llm_vtuber/chat_history_manager.py#L121-L146)；静态确认无原子替换；读失败后仍可能用空列表写回 | 崩溃、损坏及并发写的耐久性需重做；未运行断电/重启/纠正删除验证 |
| 隐藏、关闭与采集停止没有形成所需闭环 | [Electron close/hide](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber-Web/blob/3d57a9a0125a0ca13e5d096f7092e4e494ed389e/src/main/index.ts#L31-L49)、[close 事件](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber-Web/blob/3d57a9a0125a0ca13e5d096f7092e4e494ed389e/src/main/index.ts#L91-L98)、[屏幕上下文](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber-Web/blob/3d57a9a0125a0ca13e5d096f7092e4e494ed389e/src/renderer/src/context/screen-capture-context.tsx)；检查路径未发现统一停采集/拒绝新调用联动 | Aimy 需单独实施权限状态和异步代次检查；未运行验证 macOS 隐藏后实际采集行为 |
| 调试输出包含陪伴内容 | [用户/AI 文字日志](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber/blob/992309c0aa19845960228f880013d4685fde93b5/src/open_llm_vtuber/conversations/single_conversation.py#L94-L96)、[图片数组 console 输出](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber-Web/blob/3d57a9a0125a0ca13e5d096f7092e4e494ed389e/src/renderer/src/hooks/utils/use-media-capture.tsx#L128)；静态确认 | 不能继承到 Aimy 日志。没有读取真实凭证或用户聊天来验证 |

另见默认 loopback 配置与不带登录认证的 `/client-ws` 接入：不能由“本地可用”推导可直接公网部署，官方[远程部署指南](https://docs.llmvtuber.com/docs/user-guide/backend/remote/)也明确提示这一边界。本轮没有开放端口或进行攻击测试。

## 6. 许可边界：后端 MIT 不涵盖全部前端与资产

1. **后端仓库**根 [LICENSE](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber/blob/992309c0aa19845960228f880013d4685fde93b5/LICENSE)是 MIT，并明确排除按独立条款提供的 Live2D 样例。摘取原创后端代码须保留许可与版权信息，并继续检查具体文件/依赖来源。
2. **独立前端仓库** [LICENSE](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber-Web/blob/3d57a9a0125a0ca13e5d096f7092e4e494ed389e/LICENSE#L21-L29)是 Open-LLM-VTuber License 1.0（Apache 2.0 加附加条件），列出收费托管、商业改牌/分发，以及向收费产品中整合全部或部分软件需要另获商业许可。本轮同时确认前端当前 main 的 LICENSE 字节相同。**不能统一标为“MIT，可以直接拆进商业 Aimy”。** 本次仅作条款核对，未取得商业授权，也不推定内测/免费使用覆盖未来商业发行。
3. **Live2D SDK、模型和音色**分别核对。前端 Cubism Core 有[独立专有许可声明](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber-Web/blob/3d57a9a0125a0ca13e5d096f7092e4e494ed389e/src/renderer/WebSDK/Core/LICENSE.md)，后端[样例许可](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber/blob/992309c0aa19845960228f880013d4685fde93b5/LICENSE-Live2D.md)中也包含限制修改、商业使用或再分发的不同资产条件。源码许可不能替代正式角色与声音的授权。

## 7. 接入顺序与下一轮验收

1. **先体验 AIRI 基线。** 使用同一中文场景和模型配置，对比首句等待、插话、当前截图理解、表情口型及隐藏关闭行为；Open-LLM-VTuber 作为独立体验样本，不接入 Aimy。
2. **再补分句与输出协调。** 若测得明确缺口，优先调整 AIRI 现有分句/播放事件；有必要才有界适配后端过滤函数、显示/朗读/动作结构。前端受限代码先解决授权。
3. **再补看屏与主动说话。** 继续用 AIRI 采集权限和源选择，验证关闭后无新帧/新调用、快速开关无晚到结果、主动说话可关闭且不频繁打扰。
4. **特定语音引擎最后引入。** 只有中文识别/音色有实际收益且 macOS 打包、模型体积、延迟可接受，才接 provider；无需为一个引擎搬入整套 Python 后端。
5. **长期记忆独立推进。** 用已确认事实的写入、跨会话/重启召回、纠正、删除验收筛选候选，本项目不承担该方案的默认实现。

以上是调研顺序，不是已获实施授权。正式实施前仍需相应技术手册和可见验收产物。

本次验证：64 份下载 Python 文件仅做 AST 语法解析；2 个问题通过提取原始 AST 定义、替换语音/网络/模型依赖的隔离模拟重现，脚本与结果已保存。未安装项目依赖、未启动前后端、未调用模型或真实设备、未测 macOS 打包，也未修改 Aimy/AIRI 产品代码。不能将这两项问题复现写成“项目功能测试通过”。
