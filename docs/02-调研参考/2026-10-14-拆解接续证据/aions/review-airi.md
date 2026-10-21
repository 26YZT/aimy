# REVIEW-AIRI 独立只读复核

日期：2026-10-14（Asia/Shanghai）。对象：`docs/02-调研参考/2026-10-14-AIRI现状能力清单.md` 与 `.json`。本复核只写此临时文件，未修改仓库或产品代码，未读取真实设置/凭证/用户数据库，未操作设备或网络。

结论：统一基线的主要判断成立。建议交付前补充下述两处实质边界；它们不推翻“AIRI保留为唯一主链”，但会影响隐私保护与主动调度的复用成本。不需返工其余82项结构。

## 1. [P1] Provider与聊天的登录后自动云同步已接线，不宜仅写“其他云路径分别验收”

受影响报告位置：Markdown第134–135行（I04/I05），JSON的I04/I05；I05“角色卡默认关闭”本身正确，但完整基线遗漏了另一条**不受角色卡开关控制**的自动云路径。I04目前只写localStorage，容易让后续执行者把登录后的BYOK配置仍当纯本地。

当前代码证据：

- `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/providers/config.ts:38` 区分用户provider与authentication provider；`:404–424` 的pushProviders在已登录后筛选用户configured且dirty配置，向服务层传**完整provider.config**；`:460–462` 在onAuthenticated自动sync并启动periodicSync。`:26–28` 为1秒push debounce与5分钟pull。
- `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/services/inference-service-providers.ts:83–93` 原样PUT `config: provider.config`至`api.v1.providers[':id']`。这不是只有provider名称目录的元数据同步。供应商配置本来就含apiKey，例如`packages/provider-inference/src/providers/cloud/openai/index.ts:64`使用`config.apiKey`。这里只阅读字段声明，没有读取或发送真实值。
- `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/chat.ts:590–617` 在用户与assistant消息追加时调用pushMessageToCloud；`stores/chat/session-store.ts:1209–1239` 对`userId !== 'local'`写outbox并尝试WS送消息正文。匿名local路径明确跳过，不能描述为所有用户默认上云。
- `packages/stage-ui/src/libs/feature-flags.ts:33–38` 的defaultEnabled=false仅是character-card-sync；上述provider/chat源码不以这个flag作为门禁。

具体修正文案建议：

> Provider配置存localStorage；账号登录后，用户配置且已通过配置状态的dirty Provider会自动同步完整config至服务端，当前调用路径未见独立opt-in开关；聊天正文也有非local用户的自动outbox/WS同步链。角色卡同步默认关闭不代表这些路径关闭。匿名local使用与登录使用分别验收；本轮未检查用户当前登录态，也未验证远端存储/加密策略。

建议保留“需安全专项验收”的状态，将这条已知源码事实纳入Aimy本地优先/BYOK边界与后续任务的成本；不是本轮授权修改或关闭云同步。

## 2. [P2] Spark初始化成立，但App卸载未装配orchestrator.dispose；dispose也不是完整取消

受影响报告位置：Markdown第104行附近G01，以及第152行“主动性”控制链；JSON G01/G03/G07。当前“已有接线”用于初始化是正确的，但应给出生命期限制，避免后续误以为直接增加持久timer就能完整继承停止/退出保护。

当前代码证据：

- `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/renderer/App.vue:300–307` 在full runtime路径初始化channel/context bridge，且非widgets时初始化characterOrchestratorStore。`:323–327` 的fullRuntime.dispose只清auth hooks与contextBridge；`:377–382` 卸载调用chatStore.dispose与fullRuntime.dispose，**没有characterOrchestratorStore.dispose调用**。
- `/Users/mima1234/Documents/aimy/aimy-app/apps/stage-web/src/App.vue:190–195` 卸载同样只清auth/chat/context bridge。
- `/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/character/orchestrator/store.ts:298–307` 确实提供dispose，内容是stopTicker、unsubscribe、initialized=false；未清pending/scheduledNotifies，未abort正在进行的Agent请求。
- 同文件`:119–156` 的processSparkNotify在模型返回后会继续发送spark:command；`:49–62` runner的stream选项没有该store持有的abortSignal/生命周期代次。其当前源码无法证明dispose后旧结果拒发。
- 定向检索stage-tamagotchi/stage-web/stage-ui生产TS/Vue未见orchestrator.dispose消费者。`app.browser.test.ts:287–288`由测试Host手动装dispose，不是产品App的消费者。

具体修正文案建议：

> Spark在full runtime的非widgets路径已初始化并订阅事件；orchestrator虽提供dispose，当前App卸载未见调用。现有dispose只停ticker/退订，不清队列或取消在飞模型结果。主动增量需补App生命期清理、关闭后generation/授权检查及陈旧结果拒发证据，不能以存在dispose API视为退出保护完成。

范围限定：这是源码清理接线与在飞结果保护缺口；没有证明操作系统进程真正销毁后JS定时器仍运行，也没有通过真实用户会话复现错发。

## 3. 非阻断的小处：F04“增删改API”描述略过实

`packages/stage-ui/src/stores/character/notebook.ts:136–149`导出addNote/addDiaryEntry/addFocusEntry/scheduleTask/markTaskDone/requeueTask/markTaskNotified/getDueTasks；本文件没有删除note/diary入口。建议F04的observed从“增删改调度API”收窄为“创建条目、修改任务状态和到期查询API”。其“仅内存、非事实记忆”主结论正确。

## 已通过的关键复核

- **语音打断与echo门控**：`voice.ts:418–421`只在不说话或实际source.echoCancellation成立时允许自动barge-in，目标带当前session的activeTurns；`packages/audio/src/browser/sources.ts:106–107`取的是已打开track.getSettings而非仅“请求了回声消除”。`core-agent/src/voice/input/attempt.ts:240–270`先保留speech-onset前卷、interrupt并等待silence receipts；`voice/output/response.ts:351–356`stop group/abort producer/cancel streams。报告没有把它夸大为真机自然抢话验收。
- **Vision普通页面vsdevtools**：正常`stage-pages/.../modules/vision.vue:35、380–388`确有captureIntervalMs与统计；完整start/stop/source选择在`stage-tamagotchi/.../devtools/vision.vue:202–235`。`processing-store.ts:140–145`只清ticker，晚结果风险已在报告D05/D08承认。
- **notebook/聊天持久化/事实记忆区分**：notebook ref数组且无存储消费者，memory-pgvector空configure、记忆设置WIP；现有session存储与history compaction不被报告当作事实闭环。
- **正式角色待定**：报告E02/E09/后续增量未擅定VRM或音色，符合本轮产品边界。
- **Provider数字**：当前cloud40/local8/speech页面21/transcription页面9，与报告吻合，且正文明确它们是目录/页面而非可用模型/供应商数量。

## 机器与链接复核

- JSON解析成功：82核验点、82唯一ID、9维度。
- JSON全部82条源码路径与1-based行号有效；对应file_sha256与当前源码逐字节一致。
- Markdown全部82个绝对源码链接存在且行号未越界；机器清单相对链接目标存在。
- 12文件130测试计数与三个已保存日志一致：core-agent 6/77、pipelines-audio 3/33、stage-ui Node 3/20。此次复核没有重复运行测试，没有把这些日志变成真实设备验收。

交付建议：主writer同步补充上述云同步事实和Spark生命期限制到Markdown与JSON；不改产品代码。除这两项实质遗漏外，未发现本次重点范围内会反转复用方向的源码事实错误。
