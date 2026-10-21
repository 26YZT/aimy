# DELTA-OLV：固定前端来源闭环与4项增量复核

2026-10-14（Asia/Shanghai）。状态：只读来源核验+离线功能比较；未改产品代码、未安装依赖、未读真实凭据、未调用真实模型/设备。仅分析Open-LLM-VTuber与AIRI；其他项目完全不作为本轮候选。不是整项目优胜结论。

## 1. 固定版本闭环

1. 本地后端 `/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber` HEAD仍为 `992309c0aa19845960228f880013d4685fde93b5`，工作树干净。
2. 后端 `git ls-tree HEAD frontend` 明确指向build commit `06a659b114fff788cf0daaa86e484576db4975bf`。
3. 使用agent-reach规定的GitHub CLI路由，只读取得[build commit](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber-Web/commit/06a659b114fff788cf0daaa86e484576db4975bf)元数据。message为 `Deploying to build from @ Open-LLM-VTuber/Open-LLM-VTuber-Web@3d57a9a0125a0ca13e5d096f7092e4e494ed389e`；build tree为 `c823f6b10338b33188b2382b8d70728d2b5b2b12`。
4. 另取[source commit](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber-Web/commit/3d57a9a0125a0ca13e5d096f7092e4e494ed389e)元数据；新目录 `/tmp/aimy-20261014-delta-olv/frontend-source/` 通过init→fetch depth1该完整SHA→detached checkout建立固定浅克隆。HEAD为 `3d57a9a0125a0ca13e5d096f7092e4e494ed389e`，source tree为 `1010df0aa3a7c927b2a1fbb980bb8e54b7a6565a`，工作树干净。未fetch/checkout修改既有clone。
5. 与旧main `d176e7df2366952e3bacbf12cf9a8b18a4315932`逐字比主动timer/trigger/interrupt/audio/taskqueue/WS/lappmodel/LICENSE共8个关键文件，**8/8相同**。因此这些具体机制原结论没有因版本差异翻转；以后引用仍应落当前正确pinned-source SHA，不能把main当对应源码。
6. **只闭合了GitHub发布提交声明→源commit的来源链；没有重新构建/证明编译产物字节一致。** 不把提交message视为可复现构建证明。

机器证据：`pinned-build-commit.json`、`pinned-source-commit.json`、`frontend-version-comparison.json`与`source-provenance.json`。agent-reach/conda主命令在当前shell不可用，但其dev.md规定的gh后端可用；没有安装或尝试登录。

## 2. 原后端证据复核

原63项能力清单条目完整，63/63路径与行号仍有效；253个后端tracked普通文件SHA与前轮manifest全部相同。前轮14项隔离结果与107个Python AST解析记录仍对应这份源码。这里是**现有记录与源版本复核**，不是把14项再次算成新增测试。

仍成立的关键限制：clear不逐一取消TTS子任务、单client任务覆盖、回执身份/超时缺口、共享默认agent、断连漏关context；Mem0是tracked空文件，Letta适配丢图且history/interrupt为空。它们禁止用整体runtime“可运行”概括替代Aimy可靠生命周期。

## 3. 四项功能比较

|候选|OLV固定实现|AIRI实际消费链|结论与建议|
|---|---|---|---|
|独立朗读翻译（OB42）|在TTS前仅翻译tts_text，display_text/历史原文不改；DeepLX/Tencent可选，默认关闭|当前speech.createOutput把request.text交SSML/语音provider，或原text stream交streamSpeech；在已读主对话语音链未见独立译播步骤|**有明确局部功能增量，源码接线+隔离正例成立**；只能列条件候选。未证明中文体验更好；有目标语言/音色需求才值得做|
|区域/权重点击动作|Live2D startTapMotion：命中区域优先；否则合并所有配置；按权重选动作组，force priority3|AIRI现有Model.vue已接body hit→tap_body；并非没有点击动作。该回调未提供head/按区域权重配置|**有局部表现配置增量，离线同点击验证成立**；仅最终选择Live2D且模型有对应hitArea/motions时考虑，不换renderer或SDK|
|叙事朗读过滤（OB27/OL04）|默认TTS预处理过滤ASCII括号/星号等；不影响显示/LLM memory|AIRI已有更细的processNarrative（全角/代码判定），但当前VoiceResponse默认segmenter没有启用stripNarrative；normal categorizer主要处理XML标签|**算法不更强，产品接线有差异**。优先修/接AIRI既有规则；先解决普通数学括号误删，不直接搬OLV粗过滤|
|system-trigger不写user记忆（OB09）|skip_memory/skip_history排除合成触发用户输入；assistant主动回复仍保存|AIRI已有独立Spark事件→临时provider conversation→character reaction sink；provider临时user role不等于用户history。长期事实记忆目前仍是Aimy待实现增量|**只是可借的来源语义/失败用例，非已证新增记忆能力**。未来统一origin校验，不造第二份agent memory或history|

这里“已证增量”只到局部代码行为/消费链与离线层，不等于真实产品比AIRI更好，也不代表本期必须采用。

### 3.1 独立译播：能显示中文、朗读另一语言，但失败链需重做

证据：[handle_sentence_output:84](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/conversations/conversation_utils.py:84)（84–113）、[ServiceContext:407](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/service_context.py:407)（407–432）、[TranslateFactory:6](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/translate/translate_factory.py:6)（6–26）、[中文模板:473](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/config_templates/conf.ZH.default.yaml:473)（473–491）。DeepLX同步httpx.post无显式timeout/signal，异常传播；不照抄成现有异步链的同步阻塞调用。

对照：[AIRI speech.ts:545](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/modules/speech.ts:545)（545–588）。它已有signal贯穿语音生成；应在现有owner内有界加可选text→speechLanguage投影，保留原display和source，而不是搬Python translator/service_context。

离线精确AST函数+假translator/TTS实验：中文 `你好，小米！` 的display/返回原文不变、TTS得到 `こんにちは、シャオミー！`；纯标点不调用translator；translator抛错时当前句没有进入TTS。**字典stub只证明职责分离，未证明真实翻译准确、语音自然、延迟/费用。** 另用精确init_translate的关闭分支验证：初次关闭保持None，但之前已有translate_engine时关闭配置后旧engine引用仍保留；handle_sentence_output又只判断engine是否存在，因此开→关缺少清理。若采用须修正开关状态/旧任务取消，并定义翻译失败保留文字、回退原语言或不发声的产品策略；不能静默吞整句。取消/预算/语言与音色适配也需单独验收。

### 3.2 点击表现：在AIRI已有body tap上增加声明式映射

证据：[pinned lappmodel.ts:1163](/tmp/aimy-20261014-delta-olv/frontend-source/src/renderer/WebSDK/src/lappmodel.ts:1163)（1163–1253）、[pinned use-live2d-model.ts:365](/tmp/aimy-20261014-delta-olv/frontend-source/src/renderer/src/hooks/canvas/use-live2d-model.ts:365)（365–377）、[AIRI Model.vue:363](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue:363)（363–366）。

实验运行**OLV精确方法body和AIRI精确on-hit回调**，注入假model/固定RNG：

|相同点击|OLV配置结果|AIRI当前回调|
|---|---|---|
|head、RNG=.1|head_wave|无motion调用|
|body、RNG=.1|tap_body|tap_body|
|unknown、RNG=.1|合并所有区域后head_wave|无motion调用|
|head、RNG=.9|按3:1权重选head_pat|该回调无head分支|
|head、全0权重|不发motion|不作比较|

这证明分派规则差异，**没有验证模型命中、实际动画播放、随机分布或用户体验**。unknown区域合并、priority3强制抢动作可能不适合Aimy；若采用只提规则/配置到AIRI现有motion owner，拒NaN/Infinity/负权重/未知动作组，遵循当前说话/中断优先级。正式格式仍待定。

### 3.3 过滤：必须比较“现有算法”和“当前默认接线”

证据：[OLV过滤:108](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/utils/tts_preprocessor.py:108)（108–196）、[AIRI processNarrative:313](/Users/mima1234/Documents/aimy/aimy-app/packages/pipelines-audio/src/processors/tts-chunker.ts:313)（313–397）、[AIRI segmenter:68](/Users/mima1234/Documents/aimy/aimy-app/packages/pipelines-audio/src/speech-pipeline.ts:68)/133（默认2参数调用，无strip选项）、[VoiceResponse:94](/Users/mima1234/Documents/aimy/aimy-app/packages/core-agent/src/voice/output/response.ts:94)（94–146）、[normal categorizer消费:768](/Users/mima1234/Documents/aimy/aimy-app/packages/core-agent/src/runtime/chat-orchestrator-runtime.ts:768)（768–800）。

同输入纯函数比较：OLV使用ignore_*全开、remove_special=false；AIRI分别测默认和可用的stripNarrative=true。没有把库的可选参数当当前产品已启用。

|输入|OLV|AIRI默认|AIRI已有算法启用后|
|---|---|---|---|
|*轻轻挥手*你好|你好|保留原文|你好|
|你好[轻声(深呼吸)]世界。|你好世界。|保留原文|你好世界。|
|你好（轻轻挥手）世界。|保留全角括号|保留原文|你好世界。|
|变量a<b>c。|变量ac。|保留原文|变量a<b>c。|
|需要 (2+3) 个|需要 个|保留原文|需要  个（数学也丢失）|
|你好[未闭合文字|你好（吞后文）|保留原文|保留原文（可能读出不完整旁白）|

7条输入含普通正文正例，具体完整输出在`frontend-delta-results.json`。不宣称任何一套通用“删括号”适合中文陪伴所有内容。可用源算法已有，建议先明确旁白语法/语音范围并写数学/代码/未闭合负例，再决定接线；不增加pysbd/第二播放队列。

### 3.4 主动输入隔离：来源规则，不是长期记忆插件

证据：[OLV trigger:49](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/conversations/conversation_handler.py:49)（49–55）、[BasicMemory:273](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/agent/agents/basic_memory_agent.py:273)（273–287/644–660）、[single_conversation:70](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/conversations/single_conversation.py:70)（70–82/151–160）。

重跑该离线sourceAST场景，synthetic trigger不进_memory，但assistant=`proactive reply`仍进入。不能把skip标志注释理解成“整轮主动发言都不入记忆”。

AIRI [Spark agent:205](/Users/mima1234/Documents/aimy/aimy-app/packages/core-agent/src/agents/spark-notify/agent.ts:205)构造独立system+user协议turns，user里是notify JSON；[orchestrator:49](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/character/orchestrator/store.ts:49)（49–69）把输出交character reaction sink。它不是chat.send伪造用户主动发言。未来记忆提取需看logical origin+真实持久消息来源，不能单看Provider的role=user；这一点应沿AIRI现有事件链适配，不复制OLV memory。

## 4. 本轮测试与局限

- `python3 /tmp/aimy-20261014-delta-olv/delta_checks.py`：真实AST函数配stub译播5分支（正常/标点/失败/初次关闭/启用后关闭）与主动记忆来源场景；7条过滤输入输出。
- `node /tmp/aimy-20261014-delta-olv/delta_checks.mjs`：AIRI真实processNarrative同输入默认/启用对照；OLV/AIRI真实点击方法/回调同点击比较与0权重负例。
- 两脚本断言全部通过；缺陷被重现不等于产品功能全通过。固定RNG/假translator/假model，无React挂载、真实图像/模型、声音或设备。
- 联网仅为GitHub公开commit元数据和新tmp固定commit浅克隆；没有外部模型/翻译服务调用或登录/凭据读取。
- 未验证：翻译质量/费用/取消、真实中文语音/回声/打断、真实模型hitArea/motions/动画协调、物理/外观/功耗、完整构建字节对应、所有Provider或长尾前端模块。原前端报告仍需标明main来源与pinned-source区别，本轮只核上述具体文件/链路。

## 5. 裁决交接

**已证局部功能增量（源码/隔离级）**：独立译播；按区域配置加权点击动作。均需用户场景/最终资产/语言需求和真实体验成立，当前仅条件候选。

**只是候选规则**：system-trigger与真实用户事实来源分离、显示/朗读/动作三责任；AIRI已有对应基础，不直接算新增功能。

**已有/不更强**：过滤算法应先用并修正AIRI已有版本；OLV的server/session/TTS queue/MCP/rendering/取消/历史不整体引入。没有任何“OLV整套比AIRI强”的裁决。

若主agent更新正式包，仅给被选择能力写技术边界/验收；不因为这个补查新建产品翻译功能、切角色格式或开始安装/集成。
