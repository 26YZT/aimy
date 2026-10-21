# PLAN-A 自动记忆与持久续聊的 AIRI 增量规划

2026-10-14（Asia/Shanghai）。状态：技术建议与离线契约证据；不是已实施功能或未经审阅的架构冻结。只读来源，所有输出与合成数据在本临时目录。未改产品代码、装依赖、调用模型或设备。

## 结论

**不需要先引入 SQLite、Python sidecar 或独立记忆服务进程。** 现有 AIRI 已有浏览器 IndexedDB、chat session repository、持久 outbox/tombstone、synced leader actions、用户消息保存回执和 provider/语音链。先增量实现独占 key 的 MemoryRepository、leader-owned MemoryRuntime 和 per-session 请求投影，能避免第二聊天/音频/配置权威。

单 key envelope 合理，但“原子替换一条值”不等于“get→set 原子更新”，现有session-store队列也不能自动解决跨leader写入。建议使用**已有直接依赖 idb-keyval 6.3.0 的 update，同步事务回调做 revision/epoch 比较与新值计算**，并保留显式leader失权/关开关/删源的生命周期栅栏。

## 当前代码的精确接入点

路径均相对于 `/Users/mima1234/Documents/aimy/aimy-app/`；完整绝对路径与读取范围见read-coverage.json。

| 触点 | 当前源码 | 规划增量与注意 |
|---|---|---|
| 本地持久存储 | `packages/stage-ui/src/database/storage.ts:6–11` | unstorage默认memory driver，local挂载IndexedDB，outbox另挂载；不是聊天localforage |
| 现有聊天repo | `database/repos/chat-sessions.repo.ts:29–52、65–109` | 按user保存index、session、tombstone/outbox；新增MemoryRepo只拥有新key，不改聊天权威 |
| 写串行队列 | `stores/chat/session-store.ts:96、162–173` | persistQueue是store私有，不是可直接import的通用锁；若复用需提取明确write coordinator或增加消息变更端口 |
| 用户消息可靠来源 | `session-store.ts:340–366`；`core-agent/src/runtime/chat-orchestrator-runtime.ts:741–759` | 用户消息await保存且generation不变才返回receipt；随后onUserMessageAppended，可异步enqueue记忆job，不等待LLM |
| 当前聊天装配 | `stores/chat.ts:542–630` | 保留onUserMessageAppended现有analytics/cloud逻辑，附加非阻断MemoryRuntime入队；不覆盖现有callbacks |
| 语音转写晚到 | `stores/chat.ts:699–731` | 文字/录音先提交，transcript随后settle；不能只监听第一条消息事件；只从已完成的本人转写提事实，不留原始音频副本 |
| 重试与来源血缘 | `stores/chat.ts:892–945` | retry移除旧段并生成新messageId；不能把重试当新本人表达重复记忆或绕过forget barrier；需原始source logical ID/provenance |
| 编辑/删除/导入/云merge | `session-store.ts:321–397、584–701、771–783、1737–1757` | 不能仅挂onChatTurnComplete；所有本人消息的改删与恢复须统一触发source invalidation。现deleteMessage返回前不await落盘，应提供可等待barrier+聊天写回执 |
| 请求投影 | `stores/chat.ts:748–816`；`runtime/chat-orchestrator-runtime.ts:862–908` | prepareSend按session取事实；更稳的是加request-scoped memory context端口，进runtime-context的低信任证据块，不把数据升级为系统指令 |
| hook显示投影不是请求 | `runtime/chat-orchestrator-runtime.ts:890–908` | composedMessage明确never provider request；不能在onBeforeSend里改显示副本当作已注入/删去模型上下文 |
| 不宜全局注册记忆 | `runtime/chat-orchestrator-runtime.ts:290、552–557`；`runtime/context-registry.ts:104–137` | runtimeContextProviders是无session参数Array<() => ContextMessage>；registry按source而非contextId分桶。同source的另一session会替换/混入，不能给所有会话注入同一memory全局bucket |
| 主动消息输出 | `stores/chat.ts:819–865`；`character/orchestrator/store.ts:119–156` | 不能调用chatStore.send('主动说点什么')伪造user消息。使用typed内部事件→既有Agent/LLM/voice链→assistant-only保存回执；必要时增加有界submitEvent端口 |
| 失权与退出 | `stores/chat.ts:246–266`；`renderer/App.vue:300–327、377–382` | MemoryRuntime显式订阅leadership变化、卸载、开关与权限策略；旧Spark dispose未在App卸载接线，不能将它当已通过的生命期样板 |

## 真实 IndexedDB 路径与 CAS 的边界

本地已安装版本：unstorage 1.17.5、idb-keyval 6.3.0。stage-ui/package.json:149已经直接声明idb-keyval，无需增加依赖。锁定源码指纹见dependency-fingerprints.json。

- AIRI配置`indexedDbDriver({base:'airi-local'})`：**airi-local是物理key前缀，并非数据库名**。
- 当前idb-keyval默认DB=`keyval-store`，objectStore=`keyval`，ESM `dist/index.js:29–32`，CJS`:31–34`。
- 逻辑key建议：`local:aimy/memory/v1/{encodeURIComponent(principalId)}/{encodeURIComponent(characterId)}`。
- unstorage先把`/`和`\\`转成`:`、合并冒号并去`?`后的内容，再去掉mount的`local:`；driver再加`airi-local:`。因此物理key为：`airi-local:aimy:memory:v1:{encodedPrincipal}:{encodedCharacter}`。
- **必须编码身份段**，否则principal中的斜杠、冒号、问号会碰撞。key-check.cjs执行了真实unstorage normalizer/mount与真实indexedb-driver前缀；底层idb.set为捕获stub，没有打开真实数据库。
- driver `setItemRaw`→idb-keyval.set→单readwrite transaction的put→await transaction完成。只证明单次值写入原子，不证明get+set原子、聊天key+记忆key原子、OS硬断电不丢数据。
- idb-keyval.update的同步callback在**同一readwrite transaction**读旧值、算新值、put；适合检查expectedRevision/expectedEpoch。不能在callback里await模型/读其他repo/做网络/做异步hash。

### update异常不会变成无限pending的条件

当前ESM `idb-keyval/dist/index.js:86–103`：req.onsuccess里有try/catch包住`updater(req.result)`及put，catch→reject；req.onerror→reject；put成功后`promisifyRequest(transaction)`挂oncomplete/onabort/onerror。CJS对应`:88–105`。

MemoryRepo外层必须await update，再返回committed；不能在callback内先更新Pinia或发UI成功通知。callback只用同步纯函数校验/克隆新envelope。冲突抛typed Conflict，外层catch转稳定`{status:'conflict',revision,epoch}`；QuotaExceeded/Abort/DataClone/Open错误转storage_error，不能用catch后返回ok。异常的局部receipt即使已计算也不代表事务已提交。

cas-check.cjs实际调用已安装update/get，在确定性ObjectStore事件模拟器上验证：两个相同revision并发只有一个commit；callback冲突异常100ms内回传；模拟事务abort没有成功回执；forget epoch变更拒绝旧模型snapshot。**这是已安装helper与拟议wrapper契约验证，不是真浏览器IndexedDB验收。** 若浏览器根本不发完成/失败事件，仍需UI超时“状态未知”与operationId回查，不能把超时说成事务回滚。

### MemoryRepo必须独占对应key

建议接口：loadSnapshot、mutateEnvelope、claimJob、commitExtraction、forget、correct、claimFollowUp、markDelivery、exportScope、clearScope；所有写最后统一到同步CAS mutation。禁止其他模块用storage.setItemRaw/getItemRaw直接读写该reserved key，不使用两套镜像缓存做权威。

unstorage当前getItemRaw是直接路由driver读取，未见值缓存，但直接idb.update不会触发unstorage的onChange/watch。MemoryStore只能在**提交回执后**更新只读UI镜像/广播带revision的失效事件；leader接续或收到更高revision后从MemoryRepo重新load。不得让storage.watch成为唯一更新源。MemoryRepo始终用同一个key helper、同一个显式DB/objectStore引用；导入/导出/重置也通过它。

leader路由负责正常时一写者，CAS负责旧revision拒绝；**CAS并不自动授权旧leader**。每个worker保存启动时的owner epoch，失权立即abort并禁止新claim；接任者通过CAS推进epoch再恢复。旧worker不可通过“重新读取最新epoch”给自己重新授权。与userId/characterId切换、禁用/重启的epoch策略须一致。

## 数据契约建议（待root统一确认）

仅内部持久结构，不新增一期外部业务实体。`principalId`沿现有AIRI userId/local分区，`characterId`沿角色卡。匿名local到登录账号的迁移不是默认自动行为，需要独立可解释迁移规则。

| 结构 | 最小字段 | 确定性约束 |
|---|---|---|
| Envelope | schemaVersion, scope, revision, epoch, facts, sources refs, jobs, tombstones, followUps；关系只留本轮既定minimal部分 | 单key CAS替换；未知schema/损坏不能自动清空，否则删除屏障丢失；量大前测整值clone/写成本 |
| SourceRef | scope、sessionId、messageId、logicalSourceId、contentHash、occurredAtMs、kind=user_text/user_transcript/user_memory_edit、retry/import血缘；手动编辑用可信operationId而非伪造chat messageId | 只信已持久化本人消息；ID/hash由代码算；AI台词、网页、工具结果、图片推断、原始音频不能自动当本人事实 |
| Fact | id、scope、category=profile/recent、slot/key、text、sourceRefs、confirmedAtMs、revision、status、optional expiresAtMs | 模型只能提候选text/有效source标签；ID、版本、删除、时间、状态、关系值由代码写。纠正有来源且不受旧结果覆盖 |
| ExtractionJob | idempotencyKey(sourceLogicalId+contentHash)、sourceRefs、capturedEpoch、candidateFactVersions、status/attempts/runId/leaseUntilMs | 先存pending再模型；不持久原录音/截图/完整重复聊天或无界模型raw output；关开关/删改源作废 |
| Tombstone | scope、operationId、sourceLogicalIds/blockedFactKeyHashes、barrierEpoch、createdAtMs；不留忘记正文 | 先落屏障再改聊天；不得因清队列或一般GC删除屏障；源血缘的retry/import不能更换ID绕过 |
| FollowUp | id、scope、targetSessionId、anchorInteractionId/generation、dueAtMs、expiresAtMs、capturedEpoch、claim/delivery state、assistantMessageId | 模型提建议，代码定合法时间/预算/门禁；到期只领一次；最终发出前再次核验用户新交互/epoch/生命周期 |
| Receipt | status=committed/conflict/rejected/storage_error/partial、operationId、revision、epoch、reasonCode | committed只能事务完成后；partial列已完成屏障与未完成聊天删除；错误不记录敏感原文 |

slots/中文关键词先作为本地召回基线，无embedding/FTS/vector必需依赖。slot映射和同义归一化是待评测规则，不宣称能辨认任意语义等价事实。

## 端到端顺序与失败行为

### 自动事实保存

1. AIRI用户消息保存成功后，以稳定SourceRef幂等enqueue。只落job、立即让聊天继续，不阻塞等待模型。若job写失败，聊天可继续但记忆状态不能显示“已记住”；恢复扫描补漏依据source refs/watermark与本地开关epoch，不能全库无条件回补已忘记的来源。
2. leader CAS领取job；取已存本人文字/完成转写，最多有限上下文用于消歧。模型输出严格JSON候选，引用短source标签；不执行候选中夹带的指令。
3. 模型在事务外运行，给AbortSignal、超时和单次/每期预算。完成后重读源哈希、校验scope/epoch/blocked source和候选目标事实版本，再同步CAS应用。
4. **不要无条件用模型开始时的整个envelope revision。** timer/其他fact并发也会推进revision；最保守实现冲突后重排并有界重试，可能增加费用。更好的增量是保留candidateFactVersions与source barrier，在读最新envelope后仍检查候选依赖，再CAS最新revision。不能“读最新revision→绕过所有旧依赖检查→照写旧候选”。
5. 记忆投影必须在真正Conversation组合/模型调用前重验；prepareSend之后还会排队/await视觉与ASR，不能把较早snapshot视为一直有效。忘记同时取消依赖该来源的在飞turn与voice，成功撤销后才显示操作完成；已发给供应商/已播放音频无法收回，不声称远端删除。
6. 替换事实必须按source_ts/明确纠正语义处理；摘要是证据不是本人事实。成功记录写回receipt，刷新每次请求的有效事实投影。用户无需逐条确认，这是既定产品方向；置信度不足可以不写/标unconfirmed，不等于让用户每条手动批准。

### 纠正与删除

- 纠正：同步CAS改目标有效事实与来源、advance revision/epoch或目标fact revision，作废相关pending/running候选，再生成新投影；旧模型候选必须不能恢复旧值。
- 忘记：同一CAS先移除目标正文与所有已知派生facts/索引、写最小tombstone、作废相关jobs/followUps，返回屏障已落回执。被删除正文不得只换成cold继续召回。
- 删除原聊天：**先await durable memory barrier，后await聊天删除/保存**。聊天失败返回partial，保留屏障可重试；屏障失败则不能声称“记忆已忘记”，也不先物理删原文导致来源空洞。
- 当前聊天deleteMessage只触发void persist，应改造为可等待保存回执；append/assistant streaming不应每chunk触发记忆整理。所有修改user消息的低层入口、语音transcript、retry、import/restore/cloud merge都要被来源版本服务覆盖。
- 重启：先load schema与屏障，再回收过期running lease为pending/重新验证；屏障不可被迁移覆盖；禁止在load屏障前先启动模型或重放timer。

### 主动回忆与持久续聊

- 复用现有角色/聊天/语音provider；只新增policy→timer/job→typed event，不新增第二消息bus/第二播放器。
- 新本人交互会推进interaction generation并撤销pending follow-up；已claim的生成也要由epoch/generation在最终assistant提交和播放前拒绝。
- 陪伴收起聊天、隐藏主舞台、退出分别对齐；只有策略明确允许的状态可继续生成。麦克风/看屏不得被follow-up自动打开；没有看屏授权时不加入画面。
- timer持久化不代表应用退出后能唤醒：首版仅进程运行时执行；重启未来timer继续，过期timer按明确的expiry政策丢弃或重评估，禁止补发积压。建议过期不补发作为最小策略，root需在PRD中明确。
- 发送应有稳定assistantMessageId和delivery operationId。先assistant-only持久提交，再由既有voice输出；崩溃窗口必须区分“保存了未播放”和“播放了未标记”，首版建议不重播已提交的过期主动消息，不能承诺跨设备音频exactly-once。

## 不能承诺的“彻底忘记”范围

1. 墓碑factKeyHash只能挡已识别key，不能保证模型换一个同义slot/换措辞仍识别为同一事实。可确定性挡原sourceLogicalId及其retry/import血缘，代价是同一消息的其他事实可能一起不再抽取。新本人重新表达是否允许记住必须明确语义，不能默认为“永久主题禁记”已实现。
2. 只删memory envelope并不能让主模型忘记仍在当前历史里的原文、旧assistant转述、缓存providerTranscript/generationTranscript或工具结果；事实投影必须有针对来源的request-time过滤/重建，或者开启经证明不带旧上下文的新session。不是靠prompt一句“请忘记”。
3. AIRI现有compaction默认仅产生“Compacted N older turns...”计数，不应谎称它已自动生成含秘密的摘要；但支持domain formatter，而且compacted=true会直接保留。离线实测用有敏感摘要的合成formatter说明：换formatter再compact不会重建旧summary。因此未来若引入摘要，要有source provenance/epoch并失效重算；无lineage旧摘要只能保守不注入。
4. provider原生续写上下文/远端日志、既有云聊天副本与截图/原录音副本也不是本地MemoryRepo能抹去。先验证调用不复用旧native continuation，不声称供应商已删除。当前Provider/chat自动云同步面是已有事实，须作为本地优先前置保护而非新feature。

## 推荐最小实施顺序

1. **M0 来源与权限基线**：owner/leader生命周期、匿名/登录云边界、SourceRef逻辑ID与语音/retry/import/手动编辑血缘、scope、request-time投影端口；先写验收脚本。
2. **M1 MemoryRepo与删除屏障**：单key+CAS+schema/receipt；写/重启/纠正/删除/存储失败/leader交接；中文关键词和slots，无模型即可验证。
3. **M2 自动抽取队列**：消息已保存入队、源哈希与epoch保护、strict输出、超时/费用/幂等；先stub模型契约，真实模型仅单独批准的预算内验证。
4. **M3 主动回忆投影**：按当前session/persona查询，相关性/时效/已忘记过滤；加入对话而不新增user事实；离线质量集先行。
5. **P1 持久续聊**：内部事件assistant-only提交、单领/expiry/新用户话取消/隐藏退出/重启不补发；沿原voice输出，模型策略后验。
6. 数据与真实体验证据通过后才评估压缩、向量、FTS或SQLite。仅在量级/跨进程需求使浏览器存储验收失败时，再做有数据依据的替换评审。

## 本轮实际执行与限制

- offline-check.cjs真实转译并执行当前chatSessionsRepo/context-registry/compaction函数，IO用克隆内存边界；5项：roundtrip/tombstone幂等、原repo并发RMW丢更新复现、串行保存两次更新、contextId不隔离source bucket、compacted摘要保留行为。不是全App发生竞态的证明。
- cas-check.cjs真实执行已安装idb-keyval.update/get，ObjectStore事件模拟器+拟议wrapper；4项CAS/异常/事务abort/forget barrier通过。
- key-check.cjs真实unstorage normalization/mount与driver前缀，idb.set捕获stub；物理key编码映射1项通过。
- 共10项安全离线检查，0断言失败。没有fake-indexeddb依赖，没有启动浏览器真实IDB，也没有声称fresh-process浏览器恢复/真实模型/多窗口分裂脑/音频exactly-once通过。后续必须在已有Vitest Browser链的独立临时origin/name下测真实IndexedDB，不访问用户现有storage。

证据：offline-results.json、cas-results.json、key-result.json、dependency-fingerprints.json、read-coverage.json。所有源码与第三方依赖只读。
