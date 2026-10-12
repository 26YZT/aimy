# Ryza AI Revive：Aimy / AIRI 复用调查与代码审查

> 文档状态：定向调研参考，绑定当时来源；不是选型决定或实施授权。
> 产物时期：2026-10-10，正文明确日期。精确初稿时间未记录时保持未知。
> 保留原因：保留项目ryza-audit.md模块与缺陷可追踪证据。
> 上下文风险：不可把隔离函数复现/静态语法通过当完整服务、真实设备、模型、许可发行或AIRI集成通过；复现脚本是证据不是应用开发入口。
> 原位置：`digital-lover/docs/调研/2026-10-10-四项目复用证据/ryza-audit.md`；归类整理：2026-10-11。
> 阅读入口：[文档中心](../../README.md)。历史正文中的“当前、唯一、已锁定、下一步”仅适用于原时期。

审查日期：2026-10-10。只读来源：`/Users/mima1234/Documents/资料/ryza-ai-revive-master`。接入目标：`/Users/mima1234/Documents/airi-main` 原版完整桌面，非 aimy/digital-lover 历史样机。未修改来源或 Aimy 工程。没有发现适用于该源码目录的 AGENTS.md。

**结论：值得提取“轻量分层记忆策略”和“表现调度的产品规则”，不适合作为第二个运行内核整包嵌入 AIRI。** 它的记忆已经有真正调用、持久化、检索和管理入口，超过单纯 README；但长期层存在确定的数据丢失与清理缺陷，语音采集路径存在严重截断。AIRI 已有的语音流水线、provider 注册表、Spine ZIP 导入不能再被它较简单的同类实现替换。官方角色、皮肤、声音和数据的许可也不随根目录 MIT 自动获得。

主 Agent 在线核验：GitHub 当前 master `45e75ad6f6f0eb7952676b1bf24a674256082941`（2026-10-05），87 个可比源码、脚本、样式与 HTML 的 Git blob SHA 与本地一致。本报告的具体代码检查基于本地副本；在线结果由主 Agent 统一提供。

## 1. 项目地图与规模

这是静态 HTML + 原生 JavaScript 的本地角色对话客户端。30 个 web/js 模块靠 index.html 的 script 顺序装配，IIFE 暴露全局对象，跨层功能通过注入函数连接。没有 npm 前端构建器、Python 推理后端或自带模型。

- 全树 1,764 个文件、21,726,781 字节；其中 web/assets 1,643 个文件，主要是结构 JSON、atlas、SVG。
- 应用源码：web/js 30 文件；desktop 4 个 JS；Android 8 个 Java 文件；合计 20,338 行（不含第三方 Spine runtime、CSS、HTML、测试脚本）。
- 脚本目录 41 文件，其中 15 个 `*regression*` 脚本，另有 boot_smoke、layering_check、expression_coverage、i18n_coverage、浏览器探针与打包检查。
- 扫描到 66 个 JS、7 个 Python、1,356 个 JSON；其余包括 207 个 atlas、86 个 SVG。
- 本地只有 2 个 PNG（宿主图标）；**0 个 .skel、0 个 jpg、0 个 wav/m4a/mp3**。因此这个源代码副本不能独立还原 README 展示的角色舞台和声音，需补齐有权使用的素材。
- desktop/package.json：Electron 33.2.0、electron-builder 25.1.8，构建目标仅 Windows NSIS；无现成 macOS 打包配置。
- Android：框架 Activity + WebView + 手写本地 AssetServer，compile/target SDK 34、min SDK 24；没有 androidx 依赖。

| 区域 | 真实职责与入口 |
|---|---|
| web/index.html → app.js | 启动、UI、聊天、端口装配；app.js 2,833 行，是主要集成点 |
| api.js（1,742 行） | OpenAI-compatible 非流式聊天、模型信息/上下文估算、标签协议、TTS/STT HTTP 传输、回复代际令牌 |
| memory.js / longterm.js | 会话卡 → 总结卡；日期事实 + digest + 字面相关度检索 |
| turn.js / voice.js / stt.js / echo.js | 播放意图队列、打断、识别引擎切换、PCM/WAV、能量门、文本回声过滤 |
| avatar.js（3,299 行） | Spine 4.2 人物和场景同一 WebGL 上下文；视角、坐姿、表情、手势、注视、点击命中、口型 |
| game.js / quests.js / daily.js | 体力、经验、金钱、背包、任务、每日奖励；LLM `<state>` 可触发数值变化 |
| world.js / worldmap.js / npc.js | 地图/时间/NPC 位置，文本多说话人、旁白和译文分段 |
| crfstore.js / voicecache.js | IndexedDB 存服装 ZIP 与语音 Blob，语音重播/收藏/预算逐出 |
| desktop/main.js / preload.js / web-storage.js | ryza://app 固定原点、代理、窗口控制、localStorage 镜像到明文 JSON |
| Android Alarm* | 原生闹钟、开机重排、锁屏响铃、贪睡；桌面没有对应系统级实现 |
| config/layers.json / scripts | 分层守卫、代理契约和版本检查；不是完备的行为或安全证明 |

## 2. 实际能力、缺口及与 AIRI 的重叠

### 2.1 记忆确实接上了聊天，但分成两套

`app.js:237-247` 把 Api.complete 注入 Memory 与 LongTerm；`app.js:1770-1771,1815-1816` 在聊天过程中记录长期 pending；`api.js:1327-1340` 每轮把 Memory.promptBlock 和 LongTerm.promptBlock 加入提示词。

- memory.js：默认 8 轮变一张会话卡、8 张卡变一张总结、8 张总结再压缩；备份 `.bak`、坏数据 `.corrupt`、保存结果标记；UI 可新增/编辑/删除卡片（app.js:2422-2463）。
- longterm.js：日期/分类/重要度/关键词/active-retired 条目；默认 40 条，受保护类别或重要度 5 可突破上限；每轮最多取 12 条，digest 常驻最多 800 字。检索仅是字面关键词、日期和重要度打分；不是 embedding、知识图谱、语义检索或严格事实验证。
- **日期事实这一层没有对应的完整管理 UI**：当前 renderMemory 只列 Memory 卡片和原始对白，不列 LongTerm 条目；LongTerm.remove 等 API 没接用户界面。删除可见卡片不能推断“所有关联记忆都删除”。
- `memory.enabled` 的 UI 文案是“启用会话总结”，只控制 memory.js。LongTerm.note / consolidate / promptBlock 不读这个开关；不能作为 Aimy 的“关闭所有记忆”开关使用。
- 长期 layer 的归纳不是可靠事务；具体丢失见 R2。摘要的模型结果只做有限 JSON 解析和字段裁剪，未保存来源 message id、置信度、用户确认、矛盾关系、版本或可追溯原文。

### 2.2 语音有真实实现，但不是可直接复用的成熟全双工层

- TTS：OpenAI-compatible、Qwen、Fish，加本机 VOICEVOX / Aivis；四个语言槽分别控制 UI、预录声音、LLM 输出、TTS，输出和朗读语言不一致会额外走翻译请求。
- 输入：浏览器 SpeechRecognition 与 getUserMedia→AudioWorklet PCM→WAV→OpenAI-compatible transcriptions 两条路径；真实音频设备、AEC 和模型效果本轮未运行。
- 端点判断是能量/基线/最短语音/静音时长，不含 Silero VAD 或 Smart Turn 语义端点。Barge-in 默认关闭，开启后也不能可靠区分自己的扬声器与用户。
- turn.js 意图/中止可以停止播放、使旧聊天响应失效；**TTS 和翻译请求仍继续执行收费**（app.js 的 synth 端口丢掉 signal）。
- 没有 token 流式聊天，也没有句子流式 TTS；必须等整条模型回复和完整音频。
- PCM 截断与关麦后迟到转写是确定缺陷（R1、R3）。

### 2.3 自然持续陪伴和授权看屏尚未实现

`config/layers.json` 把 proactive / vision / vad / endpoint 标记为 planned；源码树没有对应实现。现有定时行为是世界时段推进、日奖励、闹钟和待机动作，不能等同“主动观察后自然发起对话”。`Api.setScreenState` 的 screen 只是角色当前表情与态度，不是屏幕截图或视觉感知。不存在 desktopCapturer、摄像头、电脑自动操作；正好无需把这些边界外功能带到 Aimy。

### 2.4 舞台表现细致，但深度绑定 Ryza 素材

手势去重、说话/空闲不同节奏、LLM 指定动作后短暂让位、表情/视线/口型分层有参考价值。参数在 `avatar.js:140-156` 清楚标成调度习惯；绝大部分运行逻辑依赖特定骨骼、EmotionProfilesV4、DriverDefs、SittingSets 与官方 gesture JSON。不能把 avatar.js 复制到 Aimy 的 Live2D/VRM 后就获得同等表现。

### 2.5 不采纳项目内旧 AIRI 对比结论

本地 Ryza 文档曾断言 AIRI 无相关能力，部分已经与本次 AIRI 树不符。当前 AIRI 实际有：

- `/Users/mima1234/Documents/airi-main/packages/pipelines-audio/src/speech-pipeline.ts`：signal、intent、优先级、流式分段和并发合成。
- `/Users/mima1234/Documents/airi-main/packages/provider-inference/src/providers/`：完整 provider 层，包含本地 Sherpa STT、VOICEVOX、MiMo 克隆等。
- `/Users/mima1234/Documents/airi-main/packages/stage-ui-spine/src/utils/spine-zip-loader.ts`：JSZip 的 Spine ZIP/多变体探测；还有 validator/runtime/version。
- `/Users/mima1234/Documents/airi-main/packages/stage-ui/src/stores/character/notebook.ts`：笔记和计划任务的数据模型；当前这份 store 用 ref，没有持久化实现。
- 长期事实记忆仍有增量空间：memory-long-term.vue 是 WIP；memory-pgvector/src/index.ts 只是配置事件/Client 壳。不能把现有聊天记录持久化与完整长期事实记忆混为一谈。

## 3. 建议复用单元、接入方式与相对成本

| 单元 | 对 Aimy 的增量 | 接法与边界 | 成本/建议 |
|---|---|---|---|
| **分层记忆的数据与策略**（memory.js + longterm.js） | 让 Aimy 记住重要约定、偏好与关系变化；可编辑近期会话摘要 | 抽成独立 TS 领域模块，替换 localStorage 全局与日文 persona；使用 AIRI chat 的 `onChatTurnComplete` 记录已完成回合，依 session/character/user 分区；通过 useChatContextStore.ingestContextMessage 注入本轮检索上下文。归纳调用 AIRI provider，不带 Api/App/旧UI。先修事务/并发/恢复/删除问题；事实保留源消息 id，用户能查看修改和彻底删除 | **中；第一优先，但复用策略和部分纯函数，不原样复制后上线** |
| **表现调度规则**（avatar.js 的节奏/去重/语义动作让位） | 减少随机乱动，让说话与安静陪伴更自然 | 做与渲染器无关的 PresentationPolicy，映射到 AIRI 已有 Live2D/VRM/Spine 适配器；输入说话开始结束/情绪/用户明确互动，输出低频动作意图。不拿 Ryza 骨骼名和官方数值表 | **中；第二优先** |
| **语音重播/收藏的缓存产品规则**（voicecache.js） | 收藏一句话、回听陪伴片段 | 接 AIRI 音频完成事件，生成稳定 clip id；用现有本地持久化方案存 Blob/文件；保留8MB/40条预算思路，但收藏也须可删，并纳入全量清除和隐私控制。当前 App key 是运行时序号+前40字，不适合长期身份 | **低到中；用户确认需要时再做** |
| **文本回声抑制思路**（echo.js） | 帮助抑制扬声器转写回流 | 保留短时间文本比对思路，作为 AIRI 已有音频输入的可选末级过滤，验证中日英短句与真实播放；不可替代 AEC/VAD。该文件注释提到 N.E.K.O. Apache-2.0，复制前核对来源通知 | **低的代码、中等实机验证；可选** |
| **多说话人/旁白/译文文本分段**（npc.js） | 未来剧情或角色场景里区分显示文本与真正朗读文本 | 可以借用纯解析与“只读主角色台词”的规则；去掉 Ryza/NPC 岛屿实体，服从 AIRI 当前消息/语音结构。Aimy 当前单角色陪伴不需要引入 NPC 系统 | **低到中；后置，不作为当前新能力** |
| 模式化语音风格（chat/story/ASMR） | 情境改变朗读语气，语言矩阵可独立配置 | 只提炼 mode→风格/语速/音量的配置层，走 AIRI speech pipeline/provider；无需引入 Ryza turn/API | **低；可并入表现策略** |
| RPG、世界地图、任务/日签到/数值经济 | 增加游戏化，但不直接解决当前记忆和陪伴重点 | 与 Aimy 当前目标偏离，且大量世界/角色/资源绑定与许可问题 | **不建议当前接入** |
| 整个 Web UI、Electron/Android 宿主、/_proxy、Turn/provider/STT/皮肤 ZIP | 重复既有底座，并增加第二套状态权威、凭证和生命周期 | 保持 AIRI 唯一应用/音频/provider 权威；不要 iframe 套另一个客户端。Android 原生闹钟不是 macOS 可搬功能 | **不采用** |

推荐顺序：先原生接入可审阅的分层记忆并通过“停止/重启/编辑/删除/离线失败”验收；再做跨渲染器表现策略；语音缓存和回声规则按真实使用需要追加。授权看屏与主动陪伴应继续用 AIRI 自己的上下文与调度能力实现，Ryza 这两个模块仍是计划项。

## 4. 代码发现（按严重性，绝对路径与一基行号）

### R1 [P1] PCM 以音频块数当作时间，转写只收到句末极短片段

- 主定位：`/Users/mima1234/Documents/资料/ryza-ai-revive-master/web/js/stt.js:190-191`；环形缓冲 `:217-224`；真实 AudioWorklet 每块直接送入 `:231-239,301-310`。
- 代码以 FRAME_MS=50 假定每个 `_pcm` 块都是50ms，缓存最多38块，关闭话段只取最后22块；实际工作线程直接发送 render quantum（常见128样本），未按50ms聚合，且在 onFrame 的节流前每块都进环。
- 隔离验证已审阅的 pushFrame/closeUtterance：128样本、16kHz输入，发送22块=2,816样本=**176ms**，连末尾300ms静音都可能尚未跨完；即使按测试桩800样本/50ms，仍只送最后**1,100ms**，整句前部不存。
- 触发：任何超过约1秒的正常语音；影响：ASR 获得截短尾音/静音，语音功能表面有WAV但内容缺失。
- 现有回归 `scripts/stt_regression.js:113-127` 人工送50ms块，`:153-173` 仅检查WAV头/非空/小于4秒，没有确认起始语音保留，因而漏检。
- 复用前置：按样本数/时间管理 pre-roll，单独累积整段已确认语音，按最大话段长度限制；测试真实128/2048样本块与多秒句子。AIRI 已有采集路径，应优先继续使用。

### R2 [P1] 长期归纳在返回时清空当前 pending，会删除请求之后的新对话

- 定位：`/Users/mima1234/Documents/资料/ryza-ai-revive-master/web/js/longterm.js:279-291`；自动触发 `:264-269,307-309`。
- 请求 body 先序列化 pending；LLM 返回时才 `var pending = state.pending.slice(); state.pending = []`。等待期间新增的用户/助手内容不在原请求，却被一起清空；无 single-flight 或串行锁，满20条后每次 note 还可能启动另一轮归纳。
- 隔离验证：请求只有 old fact，等待期间追加 new fact；返回合法 JSON 后 `pendingAfter=[]`，新事实没有发送给模型，也不再在 pending。
- 影响：在慢模型/连续语音下丢长期事实；并发结果乱序还会用旧 digest 覆盖新 digest。
- 复用前置：启动请求时冻结带 id 的批次；提交后只确认该批次；新增项保留；single-flight、版本检查和持久化原子提交；包括请求失败、取消、重启后恢复测试。

### R3 [P1] 关麦不能使在飞的转写失效，迟到结果仍可能变成用户消息

- 定位：`/Users/mima1234/Documents/资料/ryza-ai-revive-master/web/js/stt.js:202-208,313-327,374-378`；后续 gate `/Users/mima1234/Documents/资料/ryza-ai-revive-master/web/js/voice.js:79-86`。
- stop/teardown 关闭硬件并把 `_busy` 重置，但转写 promise 的 then 无 `_want` / session epoch / signal 检查，仍 emit；Voice.accept 同样不检查 `_want`。
- 已隔离验证 closeUtterance 的转写回调：请求在飞时模拟 teardown 的状态重置，随后返回，结果仍 delivered，want=false。
- 影响：用户关闭麦克风后，先前音频的迟到转写仍可能走自动发送 sink；重启麦克风还可能让旧请求和新请求相互污染 busy。
- 复用前置：每次启停递增采集代际，异步回调检查代际；转写支持 AbortSignal，Voice gate 检查用户关麦意图。

### R4 [P2] “抹除全部本地数据”只删 localStorage，语音与导入服装的 IndexedDB 仍保留

- 定位：`/Users/mima1234/Documents/资料/ryza-ai-revive-master/web/js/config.js:350-360`；UI立即 reload `/Users/mima1234/Documents/资料/ryza-ai-revive-master/web/js/settings.js:506-522`。
- 实际数据库 `/Users/mima1234/Documents/资料/ryza-ai-revive-master/web/js/voicecache.js:18-24`（ryza_voice），`web/js/crfstore.js:29-31`（ryza_crf）；eraseAll 不调用 VoiceCache.clear(true) 或 indexedDB.deleteDatabase。
- UI中文 `web/js/i18n.js:260-262` 明确称“抹除全部本地数据”“所有信息都会消失”，实际语音 Blob、相关文本和服装二进制仍在磁盘数据库。收藏/元数据删除后反而隐藏了残留。
- 复用前置：一个统一数据清单；终止异步写者；删除所有存储并等待事务完成；重启后核验；清除失败需告诉用户。

### R5 [P2] 会话记忆的 flush 在模型完成前持久化删除原 pending，崩溃可丢整批原文

- 定位：`/Users/mima1234/Documents/资料/ryza-ai-revive-master/web/js/memory.js:210-217`。
- 先复制 batch，然后清空 state.pending 并 persist，再调用模型。若摘要在途时关闭/崩溃，重启时主记录是空 pending，摘要尚未落盘。`.bak` 只有主键损坏才使用，主记录“合法但少了数据”不会恢复备份。
- 同文件 `:174-185` 的 runQueue 在 busy 时只 `busy.then(fn)`，不把这个结果更新为尾链；多个等待者会一起执行 fn，不是严格串行队列。promoteSessions `:188-197` 的快照返回后直接清空当前 sessions，对并发新增/用户编辑也不安全。
- 复用前置：pending/inflight/committed 三阶段或可靠任务日志，先保留原始来源，再确认摘要提交；队列使用真正持续更新的 promise 尾链；旧任务不能写回已 reset/restore 的记忆版本。

### R6 [P2] “合并更新记忆”的实现只追加/按文本前缀去重，模型删除与改写不等于旧事实撤回

- 定位：`/Users/mima1234/Documents/资料/ryza-ai-revive-master/web/js/longterm.js:193-201,213-243`。
- 系统提示要求合并旧记忆、更新同一事件、删除寒暄/过期条目，但 merger 不用稳定事实 id 对账；仅日期+摘要去标点前14字相同才更新，未返回的旧条目仍保留。新表述/更正前14字会新增，旧“active”事实继续可检索。
- 触发：模型以新的说法纠正偏好/已完成约定，或按提示省略过时条目；影响：Aimy 仍可能提起旧事实，与用户的更正冲突。protected/importance5 更可能持续保留。
- 复用前置：稳定事实 id、明确 upsert/retire/delete 操作、来源与版本；拒绝把模型整份列表当作已完成去重；提供真实长期条目的修改界面。

### R7 [P2] ZIP 解压的输入长度误用未压缩长度，输出缺少实际大小上限

- 定位：`/Users/mima1234/Documents/资料/ryza-ai-revive-master/web/js/crfstore.js:97,104,117-124,224-230`。
- ZIP中心目录 offset24 是未压缩长度，却用来 slice压缩数据；没有保存 offset20 的 compressed size。高压缩比会读入后续条目，deflate膨胀的正常包可能被截断；流输出经 arrayBuffer 无上限地整体收集，64MB门槛只检查可伪造的头部声明，没有按实际展开字节数验证。
- 静态代码证据，未执行未知ZIP或浏览器解压器验证；因此具体各宿主对尾随字节的容忍度未定，不宣称已复现浏览器崩溃。
- 复用前置：现有 AIRI JSZip loader 上补大小/条数/路径/解压预算测试，勿移植这个自写 ZIP 解码器。

### 已知局限，单独列出以免当成已完成

- `/Users/mima1234/Documents/资料/ryza-ai-revive-master/web/js/app.js:333-351` synth 无第三个 signal 参数，Api.translate/speak 也无取消接线：打断会继续翻译/合成，音频到达后丢弃，产生额外请求/费用。这是源码 turn.js 开头主动承认的局限，非本次新发现。
- `/Users/mima1234/Documents/资料/ryza-ai-revive-master/web/js/longterm.js:284` 按字符截断整个 JSON 请求，较多受保护事实/长对话时可能切断 JSON 或把新对话裁掉；受保护事实超过40条是设计允许的，不能视为天然有界。
- longterm 的 snapshot/export（`:368-378`）不含 pending，restore（`:379-387`）也不清当前 pending；载入旧存档时可能把现时未归纳对话混进旧时间点。这与“完整时间点存档”的注释不一致。
- API key、个人档案、记忆以 localStorage/明文 JSON 保存在本地（Config.save与desktop/web-storage.js），不是钥匙串加密。作为 Aimy 接入策略应沿用 AIRI 的凭证边界，避免再创建第二份钥匙存储。没有读取任何实际个人配置或凭证。

## 5. 许可证与资源边界

1. `/Users/mima1234/Documents/资料/ryza-ai-revive-master/LICENSE:1-21` 是 MIT，Copyright(c)2026 zeroa234。可复用其具有授权的代码，保留版权与许可。
2. **根目录 MIT 不是 Ryza IP、角色图、声音、官方动作表和台词的再授权证明。** docs/official/README.md:3、15-22 说明来源是官方APK/CDN/运行时缓存；:38-39明确仅本地自用、不得打进安装包分发。docs/official/PROVENANCE.md也写运行时数据不得再分发。因此 Aimy 不带这些素材、人物名、声音克隆样本和官方文本；用自有或获得明确授权的素材。
3. 本地 `web/vendor/spine-webgl.js` 是 Spine runtime 构建产物（代码注释含 spine-core/spine-webgl 来源）；本树未见对应独立许可/版权头或通知文件。不能只凭 Ryza MIT 认定 third-party runtime 无额外条件；由主 Agent 联网核对 Spine Runtimes 许可，或直接继续使用 AIRI 已有 runtime/许可证配置。
4. echo.js:12-17 明示参考 N.E.K.O. Apache-2.0 机制；如果接入时采用实质代码，应做来源与 NOTICE 核对，不把注释写了参考来源当作许可证核验已完成。
5. docs/official/REFERENCES.md:118、140 分别承认 AgentAtelierR / Coagula 未见仓库许可，只取做法。avatar.js、longterm.js、crfstore.js 注释也描述做法来源；没有据此断言它们抄了未授权代码，但对明确来自这些来源的数字/资产/实现应保留隔离和追溯，不作一揽子无争议保证。

## 6. 本轮检查结果与未验证

已做：全仓文件/类型/规模枚举；入口与模块边界；聊天、记忆注入/归纳/存储/恢复/删除、语音采集/分段/识别/打断、TTS取消、代理、桌面持久化、Android/闹钟结构、皮肤ZIP和语音缓存、官方来源/许可文件的静态阅读；针对高风险并发和音频路径深入逐行检查。

静态结果：**66/66 JavaScript `node --check` 通过；7/7 Python AST 解析通过；1,356/1,356 JSON 解析通过。** 这些只证明语法/结构，不证明行为正确。

隔离结果：只从已经逐行审阅的 stt.js 和 longterm.js 提取 pushFrame、closeUtterance、consolidate 函数，放进无IO/网络/模型的受控环境，未执行来源模块顶层代码。复现脚本 `/tmp/aimy-four-projects-20261010/ryza-isolated-checks.js` 的结果：

```text
STT 128-sample input: retainedFrames=38, frames=22, samples=2816, durationMs=176
STT 800-sample input: frames=22, samples=17600, durationMs=1100
STT stale response: want=false, delivered="returned after mic was stopped"
LONGTERM delayed response: sent=[old fact], pendingAfter=[]
```

未做：安装依赖、运行来源回归脚本、启动客户端/服务/真实模型、播放或恢复官方素材、真机麦克风/AEC/语音识别、macOS构建和重启产品验收、Android锁屏/开机闹钟、第三方provider线上契约、Electron依赖漏洞库查询、完整安全渗透或商用授权确认。`privacy_check.py` 会读取个人 marker 文件，所以只审查其源码，没有执行。完整仓库“检查一遍”意味着全局覆盖和关键路径深入审查，不能据此称所有20k行已穷尽证明无缺陷。
