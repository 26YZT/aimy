# Open-LLM-VTuber 后端面向 Aimy 的拆解复用评估

> 本轮范围/证据校正（2026-10-14）：前端pinned build对应source 3d57a9a已在本轮新tmp固定浅克隆补齐；8个关键文件与旧main相同，仅证明这些链路。独立译播/区域权重动作是局部条件候选，过滤算法不更强，详见新裁决。 [当前五项目裁决](2026-10-14-五项目功能增量与验证裁决.md)。

日期：2026-10-14，Asia/Shanghai。状态：只读调查；建议未获选型或实施授权。源码调查与隔离检查只在临时目录写入结果，本报告集中到根 docs；没有修改产品代码、资料来源、用户 Git 暂存。用户目标是 AIRI 现有底座上的 1–100，补陪伴体验，不新建第二套桌面/聊天/音频/会话权威。用户原问答已明确现阶段仅个人自用、不外传；跨语言复用方式仍“看完拆解再定”。

**建议：保留 OLV 作为语音陪伴行为样本，拿走显示/朗读/动作分离、合成主动输入不写成用户发言、可组合 Prompt 这三类规则。默认记忆、TTS取消、WS任务生命周期和整个 Python ServiceContext 不适合接管 Aimy。AIRI 已有语音、MCP、视觉与主动调度基础；真正缺口在产品接线、可靠长期记忆、可控主动陪伴和真实体验验证。**

## 1. 版本、规模与历史纠偏

- 固定来源 `/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber`，HEAD `992309c0aa19845960228f880013d4685fde93b5`；开始/结束 `git status --short` 都为空。
- 包版本 `1.2.1`，Python `>=3.10,<3.13`；107 个 `src/open_llm_vtuber/**/*.py`，15,690 行（含空模块）；253 个普通 tracked 文件与 1 个 frontend gitlink，共 254 tracked entries。完整字节SHA、符号起止行和阅读级别在 `source-manifest.json`。
- 目录是 `src/open_llm_vtuber/agent`，不存在历史叙述中的 `src/agent` 根路径。ASR factory 7 种，TTS factory 19 种。Claude 原任务中的“8个/20+”不能直接当本固定版本计数。
- 本轮 107/107 后端 Python 做完整 AST 解析/符号盘点，55 个核心模块完整读源码，1 个模块部分读，余下仅目录+符号层。逐模块级别见 `reading-scope.json` / `backend-symbol-index.md`。不能称全仓逐行审计或所有 provider 测试通过。
- 10-12 深度评估和本轮 HEAD **相同**，不是新版本让 Mem0 被删。准确措辞是：`mem0_llm.py` tracked、0 字节；factory:88–108/配置 Literal 仍有 Mem0，但没有可导入 `LLM` 实现。旧“Mem0移除”是功能不可用的概括，不是文件不存在。
- frontend pinned build `06a659b114fff788cf0daaa86e484576db4975bf` 未初始化。10-13 前端报告主实现使用 main `d176e7df...`，不是 build 对应源码 `3d57a9a...`。本轮只读已存在 `/tmp/olv-web-src` 的主动计时模块/许可作为补充（已核 HEAD d176e7），没有下载/切换/fetch。`3d57a9a...` object 在该浅克隆不可读取，故不把补充 main 源码当 pinned 前端实现。

## 2. 后端完整模块地图

|层|模块|作用与边界|
|---|---|---|
|入口/HTTP/WS|run_server、server、routes、websocket_handler|引擎初始化、静态资源、`/client-ws`、调试ASR/TTS、消息分派；不是独立安全权限边界|
|会话|conversations、chat_group、message_handler|单聊/群聊、合成编排、中断、播放回执；存在同client重入/无turn绑定等缺口|
|状态与历史|service_context、chat_history_manager|客户端上下文登记、引擎/配置、JSON会话；agent引用默认共享，JSON无原子写/锁|
|Agent|agent/agents、input/output_types、transformers|BasicMemory/Letta/Hume；Mem0空；有状态agent+无状态LLM+输出转换|
|LLM|agent/stateless_llm + factory|OpenAI兼容、Claude、Ollama、llama.cpp、Jinja模板；别名不代表独立模型能力|
|语音|asr、tts、vad、utils|7 ASR、19 TTS、后端Silero、分句、过滤、整句音频包装；供应商质量未运行|
|MCP|mcpp 7模块+path helper|服务注册、发现、schema转换、调用、状态、JSON fallback；非权限/预算策略|
|配置/Prompt|config_manager 13模块、config_templates、prompts、characters|Pydantic分层、差量角色卡、9个工具Prompt；不是关系状态或可恢复记忆|
|扩展|proxy、live、translate、scripts|代理合并、直播弹幕、语音翻译；一期后置，不因为存在就加入Aimy|
|维护|upgrade_codes、doc、规则文件|迁移/注释同步/说明和AI开发规则；此处作为来源内容，不执行源仓规则|

63 项能力逐项含绝对路径、精确行、接线与 S1/S2/S3 证据等级，见本文附录和同日证据目录的机器清单。

```text
WS输入（文字 / 前端VAD结束音频 / raw-audio后端VAD / 主动信号+可选截图）
 → ServiceContext（config复制；默认agent/asr/tts/vad引用共享）
 → conversation trigger（单聊task覆盖，群聊有done守卫）
 → 音频需要时ASR → BatchInput(texts, images, metadata)
 → 有状态Agent + 无状态LLM（可工具循环）
 → 增量分句 → Actions抽取 → DisplayText → TTS过滤
 → SentenceOutput(display_text, tts_text, actions)
 → 每句并行生成完整音频文件 → sequence排序发送audio(base64 WAV)
 → frontend播放completion回执 → force-new-message / chain-end
 → 写JSON历史 → finally clear（不逐个cancel合成task）
```

## 3. 主动性：最高优先级的真实实现

`prompts/utils/proactive_speak_prompt.txt:1` 全文只有一句（84字节）：

> Please say something that would be engaging and appropriate for the current context.

它只影响“这一次说什么”，并不决定“应不应该说”。后端全树主动相关命中只有配置名、trigger、metadata、Prompt与注释，没有主动调度器、情境打分、安静时段、关系状态、日预算或撤销代次。

1. 前端补充 main 的 `proactive-speak-context.tsx:19–23` 默认关闭，空闲秒数5；47–65 在 `IDLE` 用 `setTimeout` 触发，离开IDLE/卸载清计时器。5秒是样例默认，不能直接作Aimy陪伴策略。
2. 同 main `use-trigger-speak.ts:9–16` 会在触发时 `captureAllMedia()`，发送 `{type:'ai-speak-signal',idle_time,images}`。后端 `conversation_handler.py:35–55` 没有消费 `idle_time` 作确定性频率门；只读Prompt，设置 `proactive_speak/skip_memory/skip_history=true`。
3. 35–64 Prompt缺失就退为“Please say something.”并发一条状态文字；71–109 与正常对话共用相同的Agent/TTS链。后端不检查产品开关、来源权限、上一轮是否结束、允许打扰的时间窗。
4. `BasicMemoryAgent._to_messages:273–287` 跳过的是**合成用户输入**的内部memory；简单chat:644–660 仍存 assistant。`single_conversation:70–82` 不把触发语写成人类历史，但151–160仍保存主动回复。14项离线检查中的 `proactive_skips_input_but_keeps_assistant` 证实这一点。
5. 群聊 `is_first_responder=False`（group_conversation:108）导致114–118的“首个回复传metadata”条件永远不入；302–303是 `for ... else` 的误导日志，并非skip开关。群聊主动语义不应从单聊泛化。

**对Aimy有价值的叶子规则**：把系统触发与用户输入区分，避免LLM误记“用户说了请主动说话”；仍记录助手真实说出内容。建议新Prompt改为基于已授权上下文/真实记忆选择一句合适内容，并允许沉默；触发资格、开关、预算、取消/代次全由AIRI既有owner执行。这里是裁决建议，未冻结实现。

**AIRI对照**：`packages/stage-ui/src/stores/character/orchestrator/store.ts:119–164,183–205,267–300` 已有 `spark:notify` 处理、到期任务、队列/调度；`notebook.ts:33–35` notes/tasks只是 `ref`。不能说“AIRI完全没有主动性”，也不能说“已有这些就满足持久、自然、不打扰的陪伴”。OLV timer不比这套基础强；只有触发时Prompt/输入身份规则值得对照补足。

## 4. 记忆、人格与历史

|路径|真实实现|缺口|裁决|
|---|---|---|---|
|BasicMemoryAgent|_memory文字列表、当前请求图像、get_history加载历史|无事实提取/召回、无来源与纠正删除闭环、无token限额自动裁剪；图片只入当前请求；不是跨会话可靠长期记忆|保留为history与事实记忆区别的案例；不引入第二份会话authority|
|Mem0|空实现+factory/config残留|选择后不能导入目标类，配置结构也与factory要求不完全对应|本版本弃用，不能列三套可用记忆后端|
|Letta|客户端指向独立HTTP服务+agent id，服务管记忆；默认图片被丢；history、中断方法pass|需要另跑服务；不能证明本地删除、纠正、断连与Aimy主会话一致|后置实验候选；不默认接入，不否定Letta独立项目能力|
|Hume|ASR后的文字→EVI、音频返回；resume_id记metadata、连接空闲超时|非麦克风原生情感输入；本适配不传图、中断pass|保持外部服务行为样本，不作为事实记忆或Aimy默认语音替代|
|JSON history|conf/history分目录，创建/加载/列表/改最后一句/删/改名|read失败后空列表覆盖，普通`w`全量写，无事务/原子rename/锁；列表还会自动删除空history|不继承存储；AIRI聊天仓库已有持久化路径|

`set_memory_from_history` 将 human 之外角色都映射 assistant（basic_memory:180–189），包括本地system interruption记录；因此恢复后与运行中 `interrupt_role=system/user` 的语义不完全一致。`_handle_delete_history:453–476` 删除文件/清history_uid却不清 `_memory`；删除会话≠当前模型上下文忘记。这是静态调用链结论，本轮没有读用户聊天，也没执行真实历史写入。

**人格**位于 `persona_prompt`，角色卡可覆盖名字/模型/音色/LLM；4个样例已完整读。中文“米粒”是攻击讽刺人格样例，不是符合Aimy陪伴、安全要求的可交付人设。只有“稳定人设与模块Prompt可组合”方式可借鉴。

**与AIRI**：`memory-pgvector/src/index.ts` 配置handler为空、记忆设置页WIP；角色notebook没有持久化；`database/repos/chat-sessions.repo.ts:29–53` 已有会话读取、保存和删除。真正缺的是自动长期记忆→跨会话恢复/纠正删除→主动提起，不是再做JSON聊天历史。用户“自动保存”已作答，不要重新加人工逐条确认；允许模型提出候选，但事实写入、修订、删除由确定性代码维护。

## 5. 低延迟语音、Agent、Prompt、配置与MCP

### 5.1 语音链路

- 常规语音走客户端VAD→`mic-audio-data`累计→`mic-audio-end`→ASR→文本LLM→TTS。后端另一条 `raw-audio-data` 走Silero，`PAUSE`通知前端中断，语音段再提示结束；不是两个应同时复制进Aimy的采集owner。
- `ASRInterface:11–25`、`TTSInterface:9–25` 默认 `asyncio.to_thread` 包同步调用；async接口不等于底层可真正取消。供应商未运行、未下载模型。
- `SentenceDivider:492–507` 第一短句碰逗号就yield，后续按终止标点与pysbd/regex。相比AIRI的boost/最短词数/最大词数，这不是更优默认。无标点需等到流结束；极短首句可能增加请求固定开销。
- 每个SentenceOutput进入TTS后 `create_task` 并行合成，按序号保序发送；**没有最大并发控制**，长回复可能瞬间排大量合成请求。
- `stream_audio.py:62–78` 在每句生成结束后读取完整音频文件，转WAV/base64并发送整包；`volumes`每20ms只是RMS采样。**这是LLM流+按句TTS，并不是逐PCM边合成边播放。** 个别provider有stream字段，不改变标准manager这条完整文件契约。
- 清理使用 `finally remove_file`；TTS失败发静音显示包，隔离验证有2句乱序合成仍按序发送/失败降级。`AudioOutput`（Hume）是旁路，不走TTSmanager，不能把合成完成协议泛化到它。
- 分句实证：`comma_splitter('你好，今天,后面')`先找逗号类型列表中的ASCII逗号，得到`你好，今天,`，不是文本中最早的中文逗号；regex `Dr. Smith is here.` 输出只有`Smith is here.`。它们是确定性边界bug，不宜直接移植。

**AIRI**：产品 `Stage.vue:362–413,503–539` 已接voice output；`stores/modules/speech.ts:545–588` 有signal贯穿，支持独立streamSpeech或synthesize；真实voice activity路径通过`voice-activity-plugin.ts:68–70` / `stores/voice.ts:420`将activeTurns交给输入控制，最终`core-agent/src/voice/output/response.ts:342–356`先停/淡出playback再abort producer。`pipelines-audio` 还保有分句/保序/并发控制基础。没有证据要求再搬OLV播放器/WS/TTS队列；真实中文延迟、回声、插话仍须真人设备验收。

### 5.2 Agent输入输出契约

`AgentInterface` 按 `chat / handle_interrupt / set_memory_from_history` 分层；`BatchInput`把source metadata和text/image分开；`SentenceOutput`明确显示/朗读/动作分离，便于叙事不朗读、表情与句子绑定；`AudioOutput`允许真正音频生成服务旁路。

这套**契约意图**值得保留。不是建议引入其Python类或把AIRI的结构化marker替换成`[joy]`。源后端 `display_processor` 不统一移除动作标记，TTS通过括号过滤忽略它们；部分历史/显示可能保留原标记。动作表达有整数索引，缺少turn/session/sequence语义身份和授权能力枚举。AIRI已有流式marker/parser/具名情绪/强度/表达式工具，应在既有契约内明确text_to_display/text_to_speak/actions责任，不建第二条会话。

### 5.3 Prompt完整盘点

9个Prompt均已完整读：

|文件|用途|实际接线/注意|
|---|---|---|
|proactive_speak_prompt|单轮主动说话指令|trigger临时load，不拼长期system；可作改写骨架|
|live2d_expression_prompt|列合法表达式标记并给例子|construct_system_prompt用emo_map替换；不取代AIRI marker|
|think_tag_prompt|让模型生成角色内心/动作标签|默认模板注释关闭；“内心”是表演文案，不应展示隐藏推理|
|concise_style_prompt|简短、动态交流、偏好提问|文件存在但默认tool_prompts未启用；不直接照搬“每次追问”|
|speakable_prompt|数值/日期/符号转易朗读格式|默认注释关闭，示例英语倾向；中文需评测|
|mcp_prompt|无native工具时按JSON表达工具|construct_system_prompt跳过，真正注入由agent fallback控制；示例JSON缺逗号、参数类型也与parser不一致|
|tool_guidance_prompt|工具前最多一句、主动使用工具|默认注释关闭；其文本不是本轮权限，不直接导入产品策略|
|live_prompt|直播弹幕情境|默认关闭/后置，不扩大一期|
|group_conversation_prompt|群聊参与者/轮转语境|在start_group_conversation加到memory；一期后置|

Prompt loader尝试UTF8/GBK等编码，支持文本文件复用；但不需要把整个loader搬进AIRI。Prompt优化效果未用真实模型评测，不以文本存在声称“角色更活”。

### 5.4 配置

Pydantic `Config → System/Character/Live → Agent/ASR/TTS/VAD/TTSPreprocessor`，provider选择用Literal，配分层验证与 `DESCRIPTIONS(en,zh,notes)`。角色yaml只写差量，`deep_merge + validate_config` 后引擎更新。

可借的是**类型/默认/帮助文案/条件校验的单一schema思路**。AIRI现有providers/Pinia/i18n/角色卡仍是owner；不复制YAML作为密钥存储、不把provider配置当角色资产。源 `validate_config:70–73`、ServiceContext `__str__`打印整个配置，运行日志DEBUG留30天；真实密钥/截图可能随配置/消息进入日志，是代码路径风险，没有读取真实日志或凭证。

模板英中文存在实际差异：EN `use_mcpp:True`，ZH `False`（都是69行）；英文初始化可触发工具发现/外部命令。不能说“模板只改翻译”，也不能为了只读研究直接run入口。

### 5.5 MCP

`ServerRegistry`读命令/环境/工作目录→`ToolAdapter`通过临时client发现→同时转换OpenAI/Claude schemas→`ToolManager`存→`MCPClient`持久stdio session→`ToolExecutor`状态与结果→Agent再次生成。

价值：状态化工具反馈和原生schema/fallback明确分层。代价/问题：

- 已有AIRI MCP服务、Eventa桥接、`createMcpTools`与App refresh，故不缺MCP基础；不应建立Python第二条tools owner。
- ToolAdapter按**tool.name**作全局key，无server命名空间，跨server同名可覆盖；AIRI主进程使用`server::tool`，保留现状。
- Prompt JSON的`arguments`示例为object，但executor:135 `json.loads(arguments_str)`要求字符串，离线相同输入object得空list，string得1个调用。
- StreamJSONDetector仅数花括号，不跟踪字符串/转义，合法`{"text":"}","ok":1}`得空结果；不能作为模型输出校验器。
- BasicMemoryAgent fallback:489–490 调`ToolManager.disable()`，本地ToolManager没有该方法；这是源码接口不匹配，未实跑该LLM错误路径。
- 工具循环 `while True`没有总轮次/时间/调用/成本预算。LLM能发请求并不等于授权，尤其Aimy一期不含电脑代操作/外部发信/支付。

## 6. 正常→中断→失败→重连/恢复生命周期

|阶段|源码实际行为|核验与应保留的边界|
|---|---|---|
|连接|accept/new client UUID→clone config→共享默认引擎→set-model/config/start-mic|源码级；start-mic不是Aimy默认采集许可；agent共享已隔离证实|
|正常文本/语音|trigger create_task→ASR（如果音频）→user history→Agent→按句TTS/audio→gather→回执→assistant history→clear|两个保序发送/失败静音隔离证实；真实音质延迟未知|
|主动触发|prompt生成合成user input+skip flags→相同链|只跳过合成user，assistant仍存；非“主动轮次完全不入记忆”|
|请求重入|新单聊task覆盖旧引用|两个任务同时pending，map只留新；旧task可能无法被后续interrupt跟踪|
|用户中断|cancel当前tracked task；无await；agent以heard_response改memory；写本地history；finally clear|clear本身不cancel已派发TTS。若父任务正在await gather，取消可能传播到children，因此本轮隔离复现只证明clear本身；不声称整UI串音已复现|
|晚到结果|无turn/generation id；旧合成可写入manager新queue，sender已取消|实测晚到queue=1、送出=0。前端字符串状态可能丢包，但不是可恢复身份协议|
|LLM失败|单聊内层发error可继续finalize/save partial；OpenAI兼容错误会yield普通字符串|错误可能被当assistant文案送TTS/写memory，需保留错误与内容区分；未调用真实模型|
|TTS失败|silent audio + display；无音频也保持sequence|隔离证实不会因该单句失败堵后句；并不证明frontend静音包行为|
|播放完成|单聊140–143和utils169–175重复gather/发backend-synth-complete；wait无timeout/request_id|早到回执未注册即丢；同client同类型wait可覆盖；测试超时仅harness，不是源码已有保护|
|断连|移除connections/contexts/buffer，cancel tracked task，后再取context.close|context已pop，close调用0隔离证实；wait cleanup能唤醒但不恢复中断合成|
|重连|新client uid；原WS无重放/断点/turn恢复。Proxy有heartbeat/retry，Hume有resume id|代理重连不是持久会话恢复；额外网络/重复副作用未测|
|历史恢复|用户fetch-and-set-history载入JSON→agent._memory；Letta pass、Hume另用metadata|不是自动重新建立所有历史/已听进度/长期事实；需实际重启场景验证|
|删除/纠正|本地history delete/modify_latest存在；无事实来源/版本/撤销后台任务闭环|不满足Aimy事实删除、记忆纠正与重启恢复验收|

## 7. 对照 AIRI：保留现成owner，再判断增量

以下只按本地 `/Users/mima1234/Documents/aimy/aimy-app` 已读代码；`airi-anchor-manifest.json`记录19个对照文件指纹。源码接线≠真实使用验收。

|能力|AIRI已核现状|OLV是否更强/真实缺口|裁决|
|---|---|---|---|
|可打断语音|voice activity→activeTurns→VoiceController→response.stop/playback receipt/abort；Stage接voice|OLV取消更弱、无turn绑定；中文真实体验仍需验证|保留AIRI，OLV只做行为对照|
|首句/分句|pipelines-audio boost/最短词数/最大词数，Intl.Segmenter；源stage-ui还有chunkTTSInput|OLV无最短门槛且发现确定bug；未证明效果强于AIRI|调已有分句，不搬pysbd链|
|TTS边流边播|speech.createOutput有streamSpeech与synthesize signal路径|OLV标准manager完整文件→整句audio；不更强|保留AIRI|
|ASR/TTS providers|现有provider registry/store；本轮不数全部供应商|OLV数量不证明质量；只对确实缺的引擎评测|官方SDK窄adapter，后置|
|MCP|Electron manager双transport、命名空间、关闭接口，renderer createMcpTools→LLM tools|OLV同名覆盖/JSON fallback脆弱；不更强|保留AIRI；只借状态反馈表达|
|视觉|source选择/captureFrame、vision inference abort/60s timeout/provider队列、orchestrator ReplaceSelf|OLV只是图像附带当前请求，无自动理解视频事件保证|保留AIRI采集/推理；补产品入口与权限撤销|
|主动调度|spark notify/orchestrator/tasks/ticker已接，notebook ref无持久化|OLV idle timer更简单；Aimy缺完整产品策略/持久恢复|只借synthetic-input语义/Prompt骨架|
|聊天历史|chatSessionsRepo save/get/delete|OLV JSON写更弱；不构成缺口|保留AIRI|
|长期事实记忆|memory页WIP、pgvector空handler、notebook无持久化|OLV Basic仅history，Mem0空，Letta服务不等价|本项目不能补齐；从其他候选抽规则|
|输出三路|AIRI已有marker分流、audio与角色表现事件|OLV契约名字清楚可作评审对照；不一定产品缺|在已有结构内写清显示/朗读/动作责任|
|人设Prompt|AIRI已有runtime prompt/角色卡|OLV样例人格非Aimy目标；模块组合可参考|借Prompt分层，不照搬人设|
|配置|AIRI provider stores/i18n；多个界面与角色模块已有|OLV schema帮助文案/默认值得系统化；不是缺框架|借schema组织，不新YAML authority|
|独立诊断工具|本轮未全面核AIRI devtools/语音测试工具|不能沿用10-13“未见所以缺”的结论|依统一 AIRI 清单复核后再裁定|
|群聊/直播/proxy|一期单角色，外部消息不属于当前缺口|增加能力不等于增加陪伴价值|后置/不纳一期|
|隐藏/关闭停止采集|本轮未运行AIRI macOS生命周期|OLV自身未闭环，不能拿来当权限门|单独真人验收，不照抄窗口语义|

## 8. 复用裁决与转换代价

“成本”是结构级相对成本，不是未经实做的人日承诺。L=文案/规则与定向用例；M=现有TS owner内的跨层适配+取消/持久化契约；H=新增服务/打包/第二生命周期，当前不建议。Python不是技术上绝不可能复用，而是不能无改动放进当前TS模块图；本轮没有替用户决定永远禁止sidecar。

|候选|三档裁决|可工程化边界|代价/优先级|验收入口|
|---|---|---|---|---|
|主动Prompt单句|借鉴设计（文本可直接读取，但不建议原样成为产品策略）|改为上下文/记忆依据+允许沉默，接AIRI spark/attention|L/M，优先|关闭不触发、已授权上下文、预算、重复/打扰、人设稳定|
|synthetic input不冒充用户消息|借鉴设计|已有turn metadata标来源，保留真实assistant发言，不污染用户memory|M，优先|主动前后历史、重启、纠正、取消后拒绝晚到保存|
|display/tts/actions职责|借鉴设计|映射现有AIRI特殊marker、speech、expression事件；不加协议服务器|M，中高|动作/旁白不朗读、工具不泄入TTS、中断同步静音/停动作|
|嵌套括号/Unicode过滤|借鉴设计/可有界适配叶子|先比较AIRI narrative过滤；仅明确中文缺口时TS移植并保留MIT来源|L，中|嵌套/未闭合/代码/数学正文不丢失；首句时序不变|
|模块化Prompt体系|直接复用候选仅限通用文本骨架，默认建议改写|Prompt文件无语言运行时依赖；人格与安全规则用Aimy已定边界|L，中|中文读数、人设、主动沉默、危机等离线集|
|JSON/类型/config/schema结构|借鉴设计|现有AIRI provider/角色卡单一schema+默认/i18n/条件校验|M，中|无效值拒绝、变更回滚、凭证不入前端/日志、重启一致|
|ASR/TTS特定provider|后置借鉴设计|如真人中文效果明显更好，再接官方SDK/窄接口|M/H，后置|同模型/设备基线、延迟/错字/音色/取消/成本/体积|
|首句完整分句器|弃用整体|保留AIRI；可用其失败样例补评测|L，当前无需开发|混合标点、缩写/数字、emoji、无标点、chunk边界|
|TTSTaskManager/播放回执|弃用整体|保留AIRI voice/audio生命周期|H，当前不做|清单缺陷用于回归要求，不移植缺陷|
|BasicMemory+JSON history|弃用整体|保留AIRI session，长期事实另定|H，当前不做|事实写入/恢复/纠正/删除独立验收|
|Mem0空适配|弃用本版本|没有实现可复用|无|不列为可用记忆后端|
|Letta独立服务|后置借鉴设计/独立样本|先看完其他候选，再决定是否必要侧车；不并行接管主会话|H，后置|图像支持、中断、删除、重启、服务不可达、macOS打包|
|MCP/ServiceContext/WS/server|弃用整体|AIRI已有并更完整；第二owner收益不足|H，当前不做|仅取状态反馈/失败用例|
|群聊/直播/proxy|后置|尊重一个主要角色与当前产品范围|H，后置|未来独立需求另验作用域、恢复与预算|

**本轮没有“可不改直接嵌入AIRI的完整后端模块”。** 即便个人自用可以宽松试样，也不改变第二套server/session/audio queue在工程上的重复。当前自用范围不应被旧“商用绝对不能抄”结论替代。

## 9. 许可证与资产分层（只核来源，不泛化法律结论）

|对象|本地依据|本轮处理|
|---|---|---|
|后端原创代码/Prompt|根LICENSE:1–23 MIT、Yi-Ting Chiu 2025，明确排除Live2D样例|允许作为候选分析；实际摘取保留版权/许可；不把MIT延伸覆盖所有依赖|
|独立前端|现存main LICENSE:1–29；10-12已留pinned源码许可快照，字节需以manifest对照|Open-LLM-VTuber License1.0（Apache2.0+附加条件），文字列个人非商业允许、收费集成另有条件。用户当前自用不构成一刀切拒绝理由；不是整体MIT|
|Cubism Core|前端WebSDK/Core/LICENSE.md:1–7|独立专有声明，不包含在后端MIT内；本轮不复用运行时|
|Live2D样例|后端LICENSE-Live2D.md:21/30–32/208–210/245–253|具体角色、主体与使用条件分别记录；Shizuku有不改名/设定条款；不推导所有Live2D模型许可相同|
|第三方语音/ASR模型|provider本地model_path/下载链接/config|代码不授予模型权重或音色/参考录音授权；未下载、未调查所有权重条款，不声称已经可分发|
|人物/音色正式资产|用户另定；样例不自动入Aimy默认资产|现阶段只读自用研究，未来若分发按具体资产另核；不冻结角色格式/音色|

没有把现阶段研究扩成商业发行审查或选型批准。

## 10. 离线检查与未确认项

执行：`python3 /tmp/aimy-20261014-olv-audit/offline_checks.py`。

结果：**14项精确AST定义+stub依赖隔离断言全部通过；107/107 src Python AST语法解析通过。** 这里“通过”是预期行为/缺陷被重复观测，不是产品功能全通过。JSON保留逐项输出和源SHA。没有启动整个应用、没有项目依赖安装、没有联网调用模型/账号/设备、没有读真实keychain/conf/log/history。

14项覆盖：clear不取消、TTS保序、失败静音、同client重入、主动memory语义、回执早到丢失/键碰撞、disconnect关闭遗漏、cache共享agent、Mem0空、JSON字符串括号、Prompt参数类型、分句边界、Letta丢图、嵌套括号。

仍未确认：真实mic全双工/回声与误打断；供应商中文质量/音色/TTFT/成本；真实Live2D动作和音频同步；完整取消时机对网络/线程/播放的传播；macOS隐藏/关闭权限回收；重连/断电/跨进程恢复与存储耐久；当前pinned前端源码运行一致性；所有模型/音色具体授权；AIRI所有devtools是否已有同类ASR/TTS诊断入口。后续手册应把它们写为待验，不用本静态研究代替验收。

## 附录 后端能力完整清单


2026-10-14。S1=类型/目录或符号；S2=已读调用链静态接线；S3=真实AST定义配stub依赖隔离执行。全部均非真实产品运行验收。

|编号|能力|做什么及边界|绝对源码路径与行|接线/证据|
|---|---|---|---|---|
|OB01|启动配置与本地服务|同步配置、初始化引擎、启动 Uvicorn；启动入口会尝试初始化前端子模块|[run_server.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/run_server.py:119):119–164|S2；run → initialize → server app|
|OB02|客户端连接入口|accept 后分配新 UUID，不恢复旧 client_uid|[routes.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/routes.py:29):29–43|S2；/client-ws → handle_new_connection → receive loop|
|OB03|按客户端上下文登记|复制配置、共享默认引擎引用；agent 也共享|[websocket_handler.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/websocket_handler.py:178):178–202|S3；load_cache 保留默认 agent reference；隔离 `new_contexts_share_agent_reference`|
|OB04|ServiceContext 生命周期|装配 ASR/TTS/VAD/agent/MCP/translator，close 可关闭 MCP；断连调用顺序有缺陷|[service_context.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/service_context.py:190):190–245|S3；WebSocketHandler disconnect 先 pop 再 get；隔离 `disconnect_pops_context_before_close`|
|OB05|文本与图像批输入|TextSource 与 ImageSource 记录来源，BatchInput 可带 images/metadata|[input_types.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/agent/input_types.py:6):6–94|S2；create_batch_input → BasicMemoryAgent._to_messages|
|OB06|文件输入类型声明|FileData/files 字段有定义，但 create_batch_input 不填 files，默认 agent 不消费 files|[input_types.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/agent/input_types.py:38):38–94|S1；声明级，不计作已接文件上传|
|OB07|主动说话 Prompt|单句要求结合当前上下文说有吸引力的话，非主动决策系统|[proactive_speak_prompt.txt](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/prompts/utils/proactive_speak_prompt.txt:1):1–1|S2；ai-speak-signal 按名称 load_util|
|OB08|主动触发路由|合成 user_input 后进入与文字/语音相同的对话链，后端没有空闲定时决策|[conversation_handler.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/conversations/conversation_handler.py:35):35–109|S2；WS ai-speak-signal → prompt → process_single/group|
|OB09|主动输入记忆语义|skip_memory/skip_history 跳过合成用户输入；单聊 assistant 回复仍进入记忆/历史|[basic_memory_agent.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/agent/agents/basic_memory_agent.py:273):273–287|S3；single_conversation 151–160 无 skip_history 判定；隔离 `proactive_skips_input_but_keeps_assistant`|
|OB10|默认 working memory|_memory 保存文字消息；整会话加载，无事实提取/检索/来源/时效维护|[basic_memory_agent.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/agent/agents/basic_memory_agent.py:128):128–193|S2；_to_messages 复制列表；不是跨会话事实记忆|
|OB11|中断后的记忆改写|把最后 assistant 改成 heard_response + ...，插入 interrupted 文本|[basic_memory_agent.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/agent/agents/basic_memory_agent.py:195):195–223|S2；handle_individual_interrupt 回调；准确性依赖前端heard_response|
|OB12|Mem0 残留入口|tracked mem0_llm.py 0 字节，factory 导入 LLM 不存在|[agent_factory.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/agent/agent_factory.py:88):88–108|S3；配置 Literal 仍有 mem0_agent；不能作为可用实现；隔离 `mem0_empty_impl`|
|OB13|Letta 适配|通过 http 服务/agent id 生成文字流；本地加载历史和中断是 pass；图像不传|[letta_agent.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/agent/agents/letta_agent.py:20):20–128|S3；AgentFactory letta分支；隔离 `letta_drops_image_inputs`|
|OB14|Hume 音频输出适配|输入先经 ASR 成文本，向 EVI 发送 user_input；音频回 AudioOutput；不传图像|[hume_ai.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/agent/agents/hume_ai.py:157):157–224|S2；AgentFactory → AudioOutput 路径；非原生麦克风直接送情感模型|
|OB15|无状态 LLM 抽象|chat_completion(messages, system, tools) 契约与有状态 agent 分层|[stateless_llm_interface.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/agent/stateless_llm/stateless_llm_interface.py:5):5–64|S2；LLMFactory 的5类适配/12配置别名；provider未实跑|
|OB16|OpenAI兼容流与工具拼接|流式文字、按 index 拼 tool arguments，末尾 close stream|[openai_compatible_llm.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/agent/stateless_llm/openai_compatible_llm.py:83):83–237|S2；BasicMemoryAgent simple/openai tool loops|
|OB17|Claude 事件流|转换图片格式，区分 text_delta/tool_use/error，async with stream|[claude_llm.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/agent/stateless_llm/claude_llm.py:43):43–246|S2；BasicMemoryAgent Claude tool loop|
|OB18|Ollama 预热/卸载|继承 OpenAI兼容适配，构造/cleanup 发本地 HTTP preload/unload|[ollama_llm.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/agent/stateless_llm/ollama_llm.py:30):30–73|S2；LLMFactory ollama；不能安全盲导入初始化|
|OB19|llama.cpp 适配|加载 GGUF，executor 创建流后同步迭代|[llama_cpp_llm.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/agent/stateless_llm/llama_cpp_llm.py:49):49–76|S2；factory lazy import；未验证取消/阻塞|
|OB20|非ChatML模板适配|Jinja模板转 prompt，requests 同步流；async 声明不代表非阻塞|[stateless_llm_with_template.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/agent/stateless_llm/stateless_llm_with_template.py:139):139–195|S2；LLMFactory template；不等价 native工具/图像|
|OB21|首句软标点提前发送|首句碰到任一种逗号可立即yield，缺少最短长度门槛|[sentence_divider.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/utils/sentence_divider.py:492):492–507|S3；transformers sentence_divider → TTS；隔离 `sentence_helpers_edge_cases`|
|OB22|多语言分句|langdetect+pysbd 支持集，失败回退regex；正则缩写分支会丢前缀|[sentence_divider.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/utils/sentence_divider.py:173):173–266|S3；SentenceDivider._segment_text；未运行pysbd本体；隔离 `sentence_helpers_edge_cases`|
|OB23|think 标签分流|维护标签栈；think内容显示但TTS为空；不是真实模型推理的可靠证明|[transformers.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/agent/transformers.py:103):103–207|S2；sentence_divider → display_processor → tts_filter|
|OB24|显示/朗读/动作三路输出|SentenceOutput独立 display_text/tts_text/actions；AudioOutput可旁路已有音频|[output_types.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/agent/output_types.py:6):6–77|S2；single_conversation → process_agent_output|
|OB25|Live2D表情索引抽取|从 [keyword] 找 emotionMap 数值，按句填 Actions.expressions|[live2d_model.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/live2d_model.py:146):146–194|S2；actions_extractor，不是AIRI结构化marker替代|
|OB26|TTS文字规范化|可选去特殊字符/括号/星号，和显示/内部memory分离|[tts_preprocessor.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/utils/tts_preprocessor.py:7):7–105|S2；transformers.tts_filter读取TTSPreprocessorConfig|
|OB27|嵌套括号过滤叶子|深度计数跳过括号内部；未闭合括号会吃掉后文|[tts_preprocessor.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/utils/tts_preprocessor.py:108):108–177|S3；filter_brackets/parentheses/angle；隔离 `nested_bracket_filter`|
|OB28|TTS按句并行合成|每句 create_task，task_list 无最大并发/排队上限|[tts_manager.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/conversations/tts_manager.py:69):69–90|S3；handle_sentence_output 调 speak；两句隔离已测；隔离 `parallel_tts_ordered_send`|
|OB29|TTS保序发送|sequence + buffered_payloads保证完成乱序时按序发；缺少turn id|[tts_manager.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/conversations/tts_manager.py:92):92–114|S3；同一 TTSTaskManager 私有 sender；隔离 `parallel_tts_ordered_send`|
|OB30|TTS失败静音降级|合成或payload准备失败时发silent display，避免阻塞后句|[tts_manager.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/conversations/tts_manager.py:139):139–164|S3；_process_tts except分支；隔离 `tts_failure_sends_silent_display`|
|OB31|整句音频包装|读取完整文件、转WAV/base64，20ms RMS只是口型采样；非逐PCM流|[stream_audio.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/utils/stream_audio.py:27):27–82|S2；TTSTaskManager 成句后发送 audio|
|OB32|清队列语义|clear仅清task_list/取消sender/换队列，不取消in-flight合成子任务|[tts_manager.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/conversations/tts_manager.py:174):174–182|S3；single_conversation finally清理；隔离 `clear_does_not_cancel_inflight_tts`|
|OB33|单聊中断|取消map中目前task、回调agent、写heard_response/system；没有await取消完成|[conversation_handler.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/conversations/conversation_handler.py:112):112–143|S2；WS interrupt-signal → handle_individual_interrupt|
|OB34|同client重入|单聊create_task直接覆盖map，没有先取消旧任务/互斥|[conversation_handler.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/conversations/conversation_handler.py:97):97–109|S3；群聊分支另有done守卫；隔离 `same_client_task_overwrite`|
|OB35|合成与播放完成协议|gather合成后发backend-synth-complete，等客户端completion；没有timeout/turn绑定|[conversation_utils.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/conversations/conversation_utils.py:162):162–190|S3；single还在140–143先gather/发一次；隔离 `ack_early_loss_and_same_key_collision`|
|OB36|ASR插件工厂|7种选项：faster-whisper/whisper.cpp/whisper/funasr/azure/groq/sherpa|[asr_factory.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/asr/asr_factory.py:5):5–62|S2；ServiceContext.init_asr；不是8种已测|
|OB37|ASR异步外观|默认asyncio.to_thread包装同步转写，固定16k单声道PCM基础契约|[asr_interface.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/asr/asr_interface.py:6):6–57|S2；process_user_input 音频→文本；未测真实设备|
|OB38|TTS插件工厂|19种选项，含本地/云/HTTP服务适配；数量不是质量证明|[tts_factory.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/tts/tts_factory.py:5):5–215|S2；ServiceContext.init_tts；全部注册索引，不逐供应商验收|
|OB39|TTS缓存与异步外观|默认to_thread生成完整文件，cache目录与删除接口|[tts_interface.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/tts/tts_interface.py:8):8–81|S2；_generate_audio await → prepare_payload → remove_file|
|OB40|Silero后端VAD|512样本16k窗、概率/分贝平滑、连续hit/miss与前缓冲|[silero.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/vad/silero.py:14):14–188|S2；raw-audio-data可进入；默认可关闭，未真实设备验收|
|OB41|VAD打断与音频结束通知|PAUSE发control interrupt，语音字节缓冲后通知前端mic-audio-end|[websocket_handler.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/websocket_handler.py:489):489–511|S2；不同于前端MicVAD主路径；不能重复接两套采集|
|OB42|可选TTS翻译|在语音合成前翻译，display_text保留原文|[conversation_utils.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/conversations/conversation_utils.py:84):84–113|S2；translate_engine来自config translator；外部服务未调用|
|OB43|Prompt可组合加载|persona后附工具prompt，proactive/group另走单轮；按表情map替换|[service_context.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/service_context.py:436):436–470|S2；load_util UTF8/GBK检测，默认仅表情等启用|
|OB44|配置分层与选择验证|Config→System/Character/Live；character→Agent/ASR/TTS/VAD/预处理|[main.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/config_manager/main.py:11):11–30|S2；Pydantic模型；全部13模块已AST盘点|
|OB45|角色卡差量覆盖|配置文件替换base字段，deep_merge后validate/reinitialize|[service_context.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/service_context.py:472):472–572|S2；WS switch-config；未证明事务回滚/中断旧turn|
|OB46|配置说明国际化|字段DESCRIPTIONS中英双语+notes；不是自动设置页已完成的证明|[i18n.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/config_manager/i18n.py:79):79–139|S2；模型get_field_description/get_field_options|
|OB47|MCP服务注册|读取command/args/env/cwd/timeout，探测npx/uvx/node|[server_registry.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/mcpp/server_registry.py:19):19–103|S2；_init_mcp_components；不代表已运行安全权限门|
|OB48|MCP工具发现/格式化|临时MCPClient list_tools，转换OpenAI/Claude schema；只用tool.name作key|[tool_adapter.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/mcpp/tool_adapter.py:18):18–83|S2；同名跨server覆盖风险；未启动服务器|
|OB49|MCP持久连接与关闭|AsyncExitStack+stdio server sessions；aclose释放所有连接|[mcp_client.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/mcpp/mcp_client.py:43):43–174|S2；ServiceContext.close有接口但断连未正确调用|
|OB50|MCP执行与状态|parse→running→call_tool→completed/error→最终results→再调用LLM|[tool_executor.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/mcpp/tool_executor.py:155):155–301|S2；BasicMemoryAgent工具循环；缺少循环总预算/权限策略|
|OB51|MCP Prompt JSON兼容|arguments示例object但parser json.loads期望string；有断路点|[tool_executor.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/mcpp/tool_executor.py:124):124–153|S3；mcp_prompt fallback模式；隔离 `prompt_tool_arguments_mismatch`|
|OB52|JSON增量探测|花括号计数无字符串/转义状态，不能完整解析任意合法JSON|[json_detector.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/mcpp/json_detector.py:90):90–121|S3；prompt-mode detector；隔离 `json_string_brace_not_supported`|
|OB53|WebSocket消息分派|message_handler先匹配回执再按type调用异步handler，TypedDict非输入校验|[websocket_handler.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/websocket_handler.py:204):204–260|S2；19类handler映射；非法JSON继续接收|
|OB54|心跳|heartbeat直接回heartbeat-ack；非任务恢复/音频重放协议|[websocket_handler.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/websocket_handler.py:605):605–612|S2；Proxy还有30秒心跳重连|
|OB55|会话JSON持久化|按conf/history保存文字，读→append→全文件w覆盖；无原子替换/锁|[chat_history_manager.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/chat_history_manager.py:93):93–146|S2；single user/assistant保存；不是可靠长期记忆|
|OB56|历史加载与删除|fetch-and-set重载working memory；delete文件仅清history_uid，不清agent._memory|[websocket_handler.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/websocket_handler.py:404):404–476|S2；会话删除不等于从当前LLM上下文删除|
|OB57|群聊轮转|每人TTS manager、共享历史差量游标、循环append speaker；默认无自然终止预算|[group_conversation.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/conversations/group_conversation.py:53):53–153|S2；member turn 305–306 重新入队；一期后置|
|OB58|群聊中断|取消/await group task，更新所有成员memory/history并广播中断|[conversation_handler.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/conversations/conversation_handler.py:146):146–213|S2；不同于单聊无await；未集成运行|
|OB59|代理排队与重连|多个外部客户端共用后端连接，文字排队；30秒heartbeat/5秒重试|[proxy_handler.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/proxy_handler.py:39):39–145|S2；ProxyMessageQueue消费按conversation_active；一期后置|
|OB60|调试ASR/TTS路由|/asr上传WAV; /tts-ws按英文句点分文件返回partial/complete|[routes.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/routes.py:141):141–252|S2；不同于产品分句器；中文/格式兼容仍需改|
|OB61|日志输出|debug文件保留30天，代码打印配置/消息/系统prompt；可含文本图像/配置敏感值|[run_server.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/run_server.py:28):28–47|S2；源码风险，仅读代码，没有读取真实日志/密钥|
|OB62|模型元数据|model_dict→模型URL/表情映射；本类不渲染模型|[live2d_model.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/live2d_model.py:35):35–53|S2；ServiceContext.init_live2d → frontend set-model-and-conf|
|OB63|配置升级辅助|对比/同步YAML字段、注释与版本；迁移代码与运行入口相连|[config_sync.py](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/upgrade_codes/config_sync.py:22):22–120|S1；只做AST/符号索引，未执行升级|

## 本轮证据与替代关系

本报告补齐 10 月 13 日后端分支缺口，并收窄 10 月 12 日“Mem0 已移除”等过宽概括；原前端与深度评估保留，前端 main 与 pinned build 的来源差异仍明确记录。它不取代实际模型/设备或安装验收。

- [63 项机器清单](2026-10-14-拆解接续证据/open-llm-vtuber/backend-capabilities.json) 与 [107 个模块符号](2026-10-14-拆解接续证据/open-llm-vtuber/backend-symbol-index.md)
- [阅读范围](2026-10-14-拆解接续证据/open-llm-vtuber/reading-scope.json)、[来源指纹](2026-10-14-拆解接续证据/open-llm-vtuber/source-manifest.json)、[核验](2026-10-14-拆解接续证据/open-llm-vtuber/audit-qa.json)
- [隔离脚本](2026-10-14-拆解接续证据/open-llm-vtuber/offline_checks.py) 与 [14 项结果](2026-10-14-拆解接续证据/open-llm-vtuber/offline-checks.json)
- [统一 AIRI 清单](2026-10-14-AIRI现状能力清单.md) 与 [六项目复用裁决](2026-10-14-六项目复用裁决汇总.md)
