# 首批增量：批准范围与实际实现对照

日期：2026-10-15。状态：**首批工程版对照快照，INT/EXP 尚未整体完成**。用途：把审定稿的 9 个任务、18 个逻辑操作、18 条复用记录、118 个文件边界逐项对应到当前代码与证据。唯一产品工程是 `aimy-app/`，桌面入口是 `aimy-app/apps/stage-tamagotchi/`。

用户已明确“好的开始开发”。审定前 JSON 中的 `not_started`、`proposed_not_implemented`、`product_implementation_authorized:false` 是原快照，不能据此否定本轮已有授权。文件拆分方式可以在同一批准功能内适配：现在沿用 AIRI 原桌面、聊天、Provider、Eventa、Pinia 与本地保存链，记忆业务集中到一个 owner。没有重新复刻一套 AIRI，也没有混入旧 Aimy 运行时。

**本文件不能证明“真实 8 例、AIRI 对照、用户试聊、分发全完成”，也不能证明记忆效果已胜过 AIRI。** 正式两臂 runner/adapter 仍缺失；8 例仅准备好输入与评分材料，当前无真实模型输出和分数。根集成任务继续负责最终 build、Electron 运行与证据归档。

## 1. 九个任务实际落在哪里

| 任务 | 当前工程结果 | 实际接点与剩余边界 |
|---|---|---|
| BASE-01 | 工程接点已落地；最终构建/桌面结果由集成报告收口 | [.tool-versions](</Users/mima1234/Documents/aimy/aimy-app/.tool-versions:1>)；[apps/stage-tamagotchi/src/main/windows/main/index.ts](</Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/main/windows/main/index.ts:1>)<br>最终构建、真实 Electron 启停及打包分发结论不由此映射代签。 |
| LIFE-01 | 工程实现和合成故障测试已有；真实设备体验另验 | [apps/stage-tamagotchi/src/main/services/aimy/resource-lifecycle.ts](</Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/main/services/aimy/resource-lifecycle.ts:77>)；[packages/stage-ui/src/services/resource-policy.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/services/resource-policy.ts:24>)<br>实际麦克风/屏幕权限、真实设备采集和连续语音体验不能由假设备或浏览器测试签收。；新进程退出恢复由根最终独立 Electron 脚本结果收口。 |
| LOCAL-01 | 实际持久/同步/模型错误出口已接；离线 canary 已验证 | [packages/stage-ui/src/services/local-data-policy.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/services/local-data-policy.ts:1>)；[packages/stage-ui/src/stores/providers/config.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/providers/config.ts:1>)<br>本批未读取真实密钥；safeStorage 自动化使用合成加密适配，真实系统安全存储可用性由实际桌面环境另验。 |
| SRC-01 | 同 AIRI 消息保存链与来源 journal 已接；故障回归已有 | [packages/stage-ui/src/types/chat-session.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/types/chat-session.ts:1>)；[packages/stage-ui/src/database/repos/chat-sessions.repo.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/database/repos/chat-sessions.repo.ts:1>)<br>真实模型能否把引用/第三人/假设与本人陈述分开，仍需正式模型案例。 |
| MEM-01 | 单 owner/单 key 仓库已实现；存储与晚提交回归通过 | [packages/stage-ui/src/stores/memory.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/memory.ts:1>)；[packages/stage-ui/src/database/repos/memory.repo.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/database/repos/memory.repo.ts:111>)<br>新 repository/store 测试不自动等于独立 Electron 进程恢复，后者由根最终运行证据确认。 |
| MEM-02 | 提取、模型路线与验收费用门已接；未证明真实整理效果 | [packages/stage-ui/src/stores/memory.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/memory.ts:743>)；[packages/stage-ui/src/stores/memory.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/memory.ts:729>)<br>目前无真实模型调用/语义成绩；官方模型/价表与真实预算资格由根和后续正式验收核对。；原 AIRI 两臂 adapter 尚未写，不能宣称其调用已经接同账本。 |
| MEM-03 | 资料、维护、窄召回和真实请求投影已接；体验待真实对照 | [packages/stage-ui/src/components/scenarios/settings/about-me.vue](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/components/scenarios/settings/about-me.vue:1>)；[packages/stage-ui/src/components/scenarios/dialogs/onboarding/step-user-profile.vue](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/components/scenarios/dialogs/onboarding/step-user-profile.vue:1>)<br>没有向量/RAG/embedding 语义检索；“布丁”“慢慢来”等隐含关联是否自然命中，只能由真实 8 例验证。；历史分页/cursor、独立诊断聚合和完整 v3 读写返回形状没有全部实施，详见操作映射。 |
| INT-01 | 工程集成进行中；不能标整体完成 | [THIRD_PARTY_NOTICES.md](</Users/mima1234/Documents/aimy/aimy-app/THIRD_PARTY_NOTICES.md:1>)；[licenses/AionsHome-MIT.txt](</Users/mima1234/Documents/aimy/aimy-app/licenses/AionsHome-MIT.txt:1>)<br>根最终构建和真实独立进程恢复结果仍需归档。；run-memory-acceptance.ts、airi-baseline-adapter.ts、acceptance-budget-adapter.test.ts 不存在。；分发安装包/签名/受邀用户环境回归未由本批映射证明。 |
| EXP-01 | 仅 prepared 素材；真实两臂与人验未执行 | [cases.json](</Users/mima1234/Documents/aimy/docs/04-验证记录/2026-10-15-首批增量开发/acceptance/cases.json>)<br>先冻结运行 manifest、补两臂 harness，再逐例采集来源/持久状态/最终 HTTP 与模型回应三层证据。；当前 0 真实调用、无生成回应、无评分；主观自然度/情绪理解标 NEED_REVIEW，由用户试聊签收。 |

前后端仍沿 AIRI 分工：主进程负责可信窗口、权限、加密密钥、退出协调与验收账本；renderer/Pinia 负责当前 scope 的唯一记忆 owner、资料维护和原聊天编排；IndexedDB 负责真实来源、事实修订、屏障和回执。最终模型 HTTP 沿 core-agent 原发送链，补检查与验收 gate。没有新增远端 Aimy 后端或第二数据库运行时。

## 2. 十八个逻辑操作与真实端口

这些是本地能力目录，不是 18 条 HTTP API，也不是“18/18 完成率”。当前许多能力由一个 Pinia owner、Repository 方法或 Eventa 事件共同承载。以下把形状差异和未实施项明确保留。

| 审定逻辑操作 | 当前端口/行为 | 合并、差异或待补 |
|---|---|---|
| `profile.read` | profileState + facts/revision 的当前 scope 投影，初始答案和后续事实同库。<br>[packages/stage-ui/src/stores/memory.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/memory.ts:71>) | 没有独立 readProfile()；原 initialProfile/raw answers 返回对象未暴露。 |
| `profile.submit` | submitProfile(InitialMemoryProfile)，稳定 profile:submissionId；真实 typed onboarding source 与事实/任务一次提交。<br>[packages/stage-ui/src/stores/memory.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/memory.ts:627>) | 已存 receipt，但 facade 返回 void；未按 v3 返回 typedSources/savedFields/pendingExtraction，expectedRevision 由 owner 读当前版本维护。 |
| `memory.list` | facts/revision 只读投影显示当前有效事实，维护区操作同库。<br>[packages/stage-ui/src/stores/memory.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/memory.ts:68>) | 没有 stateFilter/cursor/nextCursor 历史分页端口；历史修订留在 envelope，未当成已交付历史 UI。 |
| `memory.source` | readSource(factId) 查有效事实并按 source revision/hash 回到原文，UI 处理缺失。<br>[packages/stage-ui/src/stores/memory.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/memory.ts:713>) | 返回来源数组而非完整 v3 lineage + snapshotRevision 对象；不提供任意 sourceId 查询。 |
| `memory.correct` | correctFact({operationId,factId,expectedFactRevision,text})；真实用户纠正来源、当前版本、旧回放屏障。<br>[packages/stage-ui/src/stores/memory.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/memory.ts:675>) | 单事实 revision 由 UI 提交，envelope CAS 由 owner 执行；MemoryReceipt 为成功持久回执，不是所有 v3 状态的统一对象。 |
| `memory.remove` | removeFact({operationId,factId,expectedFactRevision})；host 求真实依赖闭包、原话保留、同源独立事实保留。<br>[packages/stage-ui/src/stores/memory.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/memory.ts:697>) | 当前一次原子 mutation，不单列 asynchronous cleanupOperationId；存储失败抛稳定错误，不假称 succeeded。 |
| `memory.setPolicy` | setEnabled(boolean)，新 activation + epoch，停止旧 job，再开只收新输入。<br>[packages/stage-ui/src/stores/memory.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/memory.ts:608>) | owner 自生 mutationId/读 CAS，facade 不暴露 v3 mutationId/expectedRevision/receipt 参数及返回。 |
| `memory.setModelPolicy` | setModelPolicy(follow-chat\|override)，路线 revision 与实际 provider config revision 检查。<br>[packages/stage-ui/src/stores/memory.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/memory.ts:618>) | owner 自生 mutationId/读 CAS；facade 不返回独立 v3 route receipt；完整采样策略不是额外模型选型实现。 |
| `memory.resolveContext` | resolveRequestContext(sessionId,history,query) -> safe history/supplement/contextRevision/assertCurrent，接真正 Conversation 和最终 HTTP。<br>[packages/stage-ui/src/stores/memory.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/memory.ts:897>) | 当前使用 Date.now()/host 时区；正式场景 clock 的双臂运行注入仍由缺失 harness 完成。；内部 pack 有 included/excluded IDs，facade 未返回完整 v3 reason 列表。 |
| `memory.enqueueSource` | 原 chat 保存 eligibility/journal 后 drainJournal -> enqueue-source -> ack；可重放且不重复。<br>[packages/stage-ui/src/stores/memory.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/memory.ts:303>) | 不是 UI/模型可调用命令；没有为它增加 HTTP。 |
| `memory.commitCandidates` | MemoryRepository.commitCandidates(scope,request,assertCurrent?)；parser + durable snapshots + 最终 updater 内 process guard。<br>[packages/stage-ui/src/database/repos/memory.repo.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/database/repos/memory.repo.ts:261>) | 断言闭包不进 JSON/数据库/同步状态；实际语义正确性不是 schema 校验能证明。 |
| `operation.get` | getOperation(operationId)->{receipt,revision}，synced action 路由 owner 当前 scope，缺失为 null/unknown。<br>[packages/stage-ui/src/stores/memory.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/memory.ts:594>) | 只提供已有成功 durable receipt；未建 v3 全部 queued/running/partial 状态的统一操作资源。 |
| `perception.start` | 主进程 resourceSetEnabled + snapshot，消费者 ResourcePolicy.acquire(kind) 拿本地 abort/epoch lease；原 OS 权限仍单独校验。<br>[packages/stage-ui/src/services/resource-policy.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/services/resource-policy.ts:76>) | 原逻辑名没有同名函数；主进程快照与 renderer lease 拆分承载同一能力，不新增采集 runtime。 |
| `perception.stop` | 禁用某类资源或撤 epoch 立即 abort 本窗 lease，晚到 stream 停 tracks；其他窗口独立关闭有区别。<br>[packages/stage-ui/src/services/resource-policy.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/services/resource-policy.ts:59>) | 普通 stop 没有独立持久化 stopReceipt；退出阶段另聚合 ShutdownReceipt。 |
| `perception.stopAll` | 主进程全应用撤权 + 全可信窗口 prepare；不等待 memory revision 才停采集。<br>[apps/stage-tamagotchi/src/main/services/aimy/resource-lifecycle.ts](</Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/main/services/aimy/resource-lifecycle.ts:182>) | 无公开 stopAll API；scope/window/application 由主进程发起与能力校验。 |
| `presentation.cancel` | 请求 AbortController、原 AIRI cancelTurn/cancelPendingSends 与 memory invalidation 共同取消输出和语音呈现。<br>[packages/stage-ui/src/stores/chat.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/chat.ts:913>) | 复用现有返回形状，不新增独立 cancelReceipt/generation 服务；语音真实体验仍待验。 |
| `shutdown.prepare` | 所有窗口 prepare 停止+drain+flush；全部成功后 Stage finalize owner 与预算写入，同 shutdownId/deadline。<br>[apps/stage-tamagotchi/src/main/services/aimy/resource-lifecycle.ts](</Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/main/services/aimy/resource-lifecycle.ts:182>) | 结果 {status,missingWindowIds,receipts}，不是原草案原样 pending/timedOut 对象；缺回执/失败保留 partial，根 watchdog 有界退出。 |
| `diagnostics.summary` | 可用信息散在 memory ready/error/revision/jobs、operation.get、预算 status/info 与退出 receipt。<br>[packages/stage-ui/src/stores/memory.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/memory.ts:73>) | 没有独立 diagnostics.summary 聚合入口或完整诊断 UI；不得标 18/18 API 已完成。 |

`MemoryReceipt` 当前只代表交易已完成的持久成功回执；失败用稳定 typed error，找不到操作回执保持 `null/unknown`。不能把缺失回执当失败后自动重放，也不能声称已交付草案中每种 queued/running/partial 状态资源。

## 3. 到底复用了什么

复用以可核查的有界规则为单位。AionsHome 的来源追溯、新旧偏好保护和计划状态，以及 Ryza 的字面相关筛选，被翻译/适配到 AIRI 的 TypeScript 状态与事务链。不是整项目复制。原源码完整文件与行段 SHA 在 JSON 中逐条复核，许可证原通知已保留。

| 记录 | 实际方式 | 当前代码/明确边界 |
|---|---|---|
| AH-L01 | `adapted_leaf` | 来源白名单、去重、真实来源时间被保留；typed source/version/hash/scope 是 Aimy 补充。<br>[packages/stage-ui/src/stores/memory/policy.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/memory/policy.ts:200>) |
| AH-L02 | `adapted_leaf` | 当前来源快照与原文读取合并在 worker/repo，来源缺失/变更拒绝。<br>[packages/stage-ui/src/stores/memory.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/memory.ts:259>) |
| AH-L03 | `adapted_leaf` | 稳定 host fact identity + 原本人 confirmationAt；旧源晚完成不能盖回新偏好，限定范围保留。<br>[packages/stage-ui/src/stores/memory/policy.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/memory/policy.ts:221>) |
| AH-L04 | `adapted_leaf` | 原 after-await 再查来源规则加上 route/config/lease/epoch 与最终 IDB updater 断言。<br>[packages/stage-ui/src/stores/memory/policy.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/memory/policy.ts:97>) |
| AH-L05 | `adapted_leaf` | 过时但未确认结果的计划显示 outcome-unknown，不自判完成/失败。<br>[packages/stage-ui/src/stores/memory/policy.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/memory/policy.ts:513>) |
| AH-L06 | `adapted_leaf` | 状态/过期是视图与召回资格，保留存储事实，不照搬物理清理。<br>[packages/stage-ui/src/stores/memory/policy.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/memory/policy.ts:513>) |
| AH-L07 | `adapted_subset` | 仅有效且正向命中的事实按分数/最新确认时间排序；不照搬无关重要性补位。<br>[packages/stage-ui/src/stores/memory/policy.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/memory/policy.ts:524>) |
| AH-L08 | `adapted_leaf` | 完整条目装箱，保留否定、限定、日期；先预留 history/system/output。<br>[packages/stage-ui/src/stores/memory/policy.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/memory/policy.ts:557>) |
| AH-L09 | `concept_only_narrow_replacement` | 没有移植 active_memory_search.py 日期解析器；用 host 传入时刻/时区、结构化 dueAt 和有界近期窗口窄适配。<br>[packages/stage-ui/src/stores/memory/policy.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/memory/policy.ts:593>) |
| AH-L10 | `adapted_concept_subset` | 字面关键词/有限时间条件的规则思想被收窄，未复制原 rank_memory_rows 全体评分代码。<br>[packages/stage-ui/src/stores/memory/policy.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/memory/policy.ts:524>) |
| AH-C01 | `concept_reference` | 查看来源用原 AIRI ChatSessionRecord + typed source，未搬原后端详情拼装器。<br>[packages/stage-ui/src/stores/memory.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/memory.ts:713>) |
| RY-L01 | `adapted_subset` | 选择关键词字面命中部分；当前每个匹配 +3、完全相同文本 +4，去掉无关最近/重要性补位。<br>[packages/stage-ui/src/stores/memory/policy.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/memory/policy.ts:524>) |
| RY-L02 | `adapted_leaf` | active 过滤/排序/cap 复用；新增零命中返回空和 limit0 正确语义。<br>[packages/stage-ui/src/stores/memory/policy.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/memory/policy.ts:490>) |
| RY-C01 | `concept_reference` | 重要事情不应被随意清掉的方向保留；不导入恋爱分类或模型重要性永久特权。<br>[packages/stage-ui/src/stores/memory/policy.ts](</Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/memory/policy.ts:513>) |
| AH-X01 | `rejected_not_imported` | 不采用 maintain() 的过期事实物理裁剪。 |
| AH-X02 | `rejected_not_imported` | 不导入整个 _apply_analysis；只适配已列叶子规则并补确定性授权与屏障。 |
| RY-X01 | `rejected_not_imported` | 不采用整库 mergeConsolidation，避免缺稳定版本身份/旧值复活。 |
| RY-X02 | `rejected_not_imported` | 不采用 LongTerm.consolidate/localStorage 单例/任意 JSON 截断。 |

AH-L09/10 尤其不能写成“逐行移植原日期解析器/完整排序器”。当前是结构化 `dueAt`、host 时刻/时区和有界近期计划选择；没有照搬原 05:00 日界线。当前召回是字面规则，不是向量库/RAG，不能先验保证隐含指代和自然情绪理解。

许可文件：[THIRD_PARTY_NOTICES.md](</Users/mima1234/Documents/aimy/aimy-app/THIRD_PARTY_NOTICES.md>)、[AionsHome-MIT.txt](</Users/mima1234/Documents/aimy/aimy-app/licenses/AionsHome-MIT.txt>)、[Ryza-MIT.txt](</Users/mima1234/Documents/aimy/aimy-app/licenses/Ryza-MIT.txt>)。不包含 Ryza 官方角色资源，也未引入 AionsHome 独立后端/数据库。

## 4. 原 118 个文件边界如何落地

原边界是 **65 个已有 + 53 个拟新增，共 118 行**。当前映射：47 个原已有路径已适配、18 个原已有路径保持原文件、25 个拟新增按原名落地、25 个拟文件合并/改名、3 个正式验收工具未实施。这个分布是文件去向，不能当作产品完成率。

| 原拆分 | 真实落点 | 原因 |
|---|---|---|
| `memory/store.ts`、`service.ts`、`sources.ts`、`source-journal.ts`、`model-policy.ts`、`extraction.ts`、`profile.ts` | `stores/memory.ts` + `services/memory-session.ts` + 原 chat repository/store | 保留一套 owner/队列/消息保存链，防重复状态与运行时。 |
| `source-policy.ts`、`fact-policy.ts`、`recall-policy.ts`、`context.ts`、`retrieval.ts`、`mutations.ts`、`validators.ts` | `memory/policy.ts`、`memory/schema.ts`、`memory.repo.ts` | 纯规则、形状校验、原子落盘职责分离。 |
| `projection.ts` | `memory.ts`、`chat.ts`、core `request-context.ts` / `request-guard.ts` | 必须挂真正 Conversation/native/portable/final HTTP，而不是只改诊断消息钩子。 |
| 主进程 `aimy/resource-policy.ts` | `resource-lifecycle.ts` + `trusted-windows.ts` | 实际主进程职责包含窗口授权、资源 authority 和两阶段退出。 |
| 独立 source/fact/recall/extraction/journal/projection/model/mutation 测试 | `policy.test.ts`、`memory.repo.browser.test.ts`、`memory-integration.browser.test.ts` 与实际 core 消费者测试 | 合并同条件故障测试；不等于所有原测试数据集已跑。 |
| `step-user-profile.browser.test.ts` | `about-me.browser.test.ts` + `onboarding-navigation.browser.test.ts` | 真实组件与首次配置顺序一起验证。 |

逐一 118 行、每行原用途/任务/原 SHA/实际文件与当前 SHA，见 [implementation-mapping.json](</Users/mima1234/Documents/aimy/docs/04-验证记录/2026-10-15-首批增量开发/implementation-mapping.json>) 的 `approved_file_mapping`。同文件还列出实际消费者扩展：Provider 保存/验证/模型列表、云 HTTP/WS、真实 SDK 错误出口、原采集消费者、退出持久 drain、验收模式 TTS/付费 ping 旁路、构建纯端口依赖和对应测试。这些是同批准功能的必要接线，不表示新需求或第二 runtime。

## 5. 证据能证明到哪一步

| 证据层 | 当前可支持的结论 | 不能替代 |
|---|---|---|
| 源码与哈希 | 9 任务/18 操作/18 复用条目/118 文件均可追溯；四个原来源文件及各叶子行段 SHA 一致。 | 实际运行、模型语义和用户认可。 |
| 纯规则与真实 IndexedDB/Pinia 浏览器测试 | 来源白名单、版本/CAS/lease、原子失败、同源独立事实、旧 journal 恢复、操作查询、异步撤销与最终提交 guard。 | 真实云模型抽取准确率、自然回应。 |
| 真 SDK + 假 HTTP/合成 key | 最终请求门、重试、协议 usage、稳定错误/canary、不泄露公开状态/广播/持久错误文本；共同预算账本未知 usage 关停。 | 真实提供商计费、真人秘密、两臂已接通。 |
| 真实 Vue 组件/原 App fixture | 初始资料顺序、跳过、维护/来源、保存失败、原 App 集成与退出 drain。 | 分发 UI 人验、真实设备采集。 |
| 独立 Electron 脚本 | 已实现受控 profile/账本/进程边界和 preflight；实际双进程恢复由根执行。 | 脚本存在即恢复 PASS。 |
| V2 素材 | 8 例、18 用户输入、58 source spans、42 逐字文本块，原文 SHA 未变；expected 与模型输入隔离。 | frozen 运行数据集、真实回答、评分/优于 AIRI 的结论。 |

已见日志按原批次单列，不相加：
- `root-core`：日志报告 6 文件125 测试通过；与其他列表不相加。[core-final-tests.log](</tmp/aimy-first-implementation-20261015/core-final-tests.log>)
- `root-app-browser`：日志报告 1 文件3 测试通过；含测试 teardown console 记录，不代表真 Electron。[app-browser-final.log](</tmp/aimy-first-implementation-20261015/app-browser-final.log>)
- `root-memory-network`：日志报告3文件20测试通过，早于最后 journal/commit guard 复测。[memory-network-browser-final.log](</tmp/aimy-first-implementation-20261015/memory-network-browser-final.log>)
- `root-ui`：日志报告2文件10测试通过；组件 fixture 有 warn，不代表分发 UI 人验。[ui-final.log](</tmp/aimy-first-implementation-20261015/ui-final.log>)
- `root-config-speech`：日志报告2文件7测试通过。[config-speech-final.log](</tmp/aimy-first-implementation-20261015/config-speech-final.log>)
- `root-acceptance-host`：日志报告2文件15测试通过；合成价/loopback。[acceptance-host-final-tests.log](</tmp/aimy-first-implementation-20261015/acceptance-host-final-tests.log>)
- `memory-final-44`：最后 journal+operation.get+digest/IDB guard，2文件44测试；24 integration+20 repo。[journal-commit-final-browser.log](</tmp/aimy-first-implementation-20261015/memory/journal-commit-final-browser.log>)

最后 memory 44 例为 24 个 integration + 20 个 repo 唯一测试，包含 journal/operation.get 与最后 digest→IDB 间隙撤销修复；它覆盖了较早的相关故障快照，不能与这些重跑次数累计。所有临时日志/交接 SHA 记录在 JSON，根最终归档可替代 `/tmp` 引用。

## 6. 剩余事项与交还

- **R-REAL-8**：8 个 V2 案例在 Aimy/原 AIRI 的同模型同输入真实对照；没有真实输出/评分，不能宣称优于 AIRI。
- **R-HARNESS**：两臂 runner、AIRI 原行为 adapter、共账本 adapter 测试三文件缺失。必须在原 AIRI 最终 HTTP 接 gate，不能只给 Aimy 记费用。
- **R-CLOCK-MANIFEST**：场景 clock 不改 OS，原 AIRI/Aimy 两臂 manifest/源版本/参数/提示词/价表/共享 campaign 冻结和逐例证据尚未实施。
- **R-HUMAN**：用户自然试聊、情绪理解/自然引用/昵称分寸等 NEED_REVIEW 与正式人验。
- **R-RUNTIME**：最终代码的 build/真实 Electron 两独立 PID 同 profile 恢复由根运行归档；此文只确认脚本和离线故障证据，不抢先标运行 PASS。
- **R-DISTRIBUTION**：分发安装包、签名/安装、真实受邀用户环境与真实麦克风/屏幕体验，未由此映射证明。
- **R-API-SHAPE**：逻辑能力多处合并；cursor/历史分页、独立 diagnostics.summary 未实施；v3 统一返回/状态对象未逐字落地。18 是目录条数，不能作完成率。
- **R-RECALL-SEMANTIC**：现为字面关键词+小型核心档案+有界计划窗口；非语义向量检索。AH-L09/10 是窄规则适配，不是原日期解析器全量移植；原固定32记录/10query完整新代码同输入复测未由现测试清单证明。

当前明确缺失的文件：

- `aimy-app/apps/stage-tamagotchi/scripts/acceptance/run-memory-acceptance.ts`
- `aimy-app/apps/stage-tamagotchi/scripts/acceptance/airi-baseline-adapter.ts`
- `aimy-app/apps/stage-tamagotchi/scripts/acceptance/acceptance-budget-adapter.test.ts`

本次对照仅写两个文档，无产品代码变更、真实模型调用或 Git 提交。文档快照结束后写区交还根集成任务；最终 late fixes/build/runtime 与后续 EXP 证据应带新快照或追加记录，不用本文件的旧 SHA 假称仍是最终版本。

