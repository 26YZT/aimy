# API与事件契约 v1

> 逐项审定：用户第1项已选择A（首批自动记忆/管理/相关召回，后台主动续聊下批）。只确认范围；其余行为/参数/技术方案仍待审，本轮不改产品代码。详见[逐项审定](10-逐项审定与确认.md)。


日期：2026-10-14。状态：拟新增本地契约，未实现/冻结。来源：[技术设计](03-技术设计.md)与实际AIRI Eventa/Pinia/core-agent消费链。用途：前后端、存储与模型输出之间的可评审边界。风险：下列名称不是已经可调用的产品端点，不应据此启动新HTTP/WS服务。

## 1. 现有接口与新增接口的关系

沿用`chatStore.send/cancelTurn`、chatSession的durable用户提交与现有编辑/删除入口、语音TurnRef/interrupt/静音回执、Vision推理signal、synced leader和Eventa。新增的是本地MemoryService、资源策略、主动资格与UI适配。公共包的现有IPC和命名空间不重命名。

UI通过已有跨窗口动作转到owner。renderer内的MemoryService核对principal/character/session来源与命令范围；涉及系统权限/凭据的跨Electron IPC由main核对sender/window与产品权限。传一个scope本身不授予权限。模型不直接调用这些管理接口。AbortSignal、Electron对象、音频句柄不可跨IPC序列化；跨进程传operationId并通过cancel控制事件定位本地AbortController。

## 2. 公共类型与限制

```ts
type Scope = { principalId: string; characterId: string; sessionId: string }
type TurnRef = { sessionId: string; turnId: string } // reuse existing AIRI type
type ErrorCode = 'INVALID_ARGUMENT'|'SCOPE_MISMATCH'|'NOT_FOUND'|'CONFLICT'
 |'CURSOR_EXPIRED'|'IDEMPOTENCY_MISMATCH'|'STORAGE_FAILED'|'PARTIAL_DELETE'
 |'SOURCE_CHANGED'|'SOURCE_SUPPRESSED'|'STALE'|'CANCELLED'|'INVALID_OUTPUT'
 |'PERMISSION_DENIED'|'APP_PAUSED'|'SOURCE_LOST'|'DEVICE_FAILED'
 |'LOCAL_CLEANUP_FAILED'|'BUDGET_EXCEEDED'
type Result<T> = {ok:true;operationId:string;data:T}
 | {ok:false;operationId:string;error:{code:ErrorCode;message:string;retryable:boolean};partial?:unknown}
```

scope从现有登录/本地principal、角色和会话元数据核验，非任意字符串拼接。跨会话长期记忆仍属同principal/character；sessionId用于本次来源/请求，不成为唯一的记忆分区。ID为host生成的非空有限字符串（≤128）；时间为UTC整数ms；revision/epoch为非负安全整数；所有数字拒NaN/Infinity；文本按Unicode码点计数。

建议约束：fact.text 1–300码点、query≤128、单页limit 1–50、每批sources≤20、candidates≤8。正常长度失败不能静默截断；数组成员也校验。ID/schema未知/额外高权限字段拒绝。限制为实施初值，变更需同步接口版本与评测。

所有命令有operationId；写入另有mutationId与expectedRevision。幂等记录保留至相应重试窗口/任务清理完成，不凭时间戳去重。先查mutation身份再检查expectedRevision。相同mutationId且payload相同不重复提交；普通写返回原提交回执，forget返回不可变barrierReceipt和当前cleanupState并只恢复尚未完成的同一清理job；payload不同报IDEMPOTENCY_MISMATCH。expectedRevision只在第一次提交时比较，重试沿原身份不因revision已推进而误报冲突。owner换代不允许旧lease继续写。

## 3. 记忆读取与管理

| 操作 | 输入 | 成功输出与副作用 | 关键失败 |
|---|---|---|---|
| memory.list | scope、query?、cursor?、limit? | items、当前revision、nextCursor；只返回active/未过期条目 | scope不符拒绝；cursor绑定scope/filter/revision，失效需重刷 |
| memory.source | scope、factId | 来源的session/message/日期/可见文字；找不到源逐项标unavailable | 源不存在不虚构；不跨principal查消息 |
| memory.correct | scope、mutationId、expectedRevision、factId、text | 新fact与revision；旧版本替代、受影响投影/任务失效 | CONFLICT保留用户编辑输入；事务失败不报保存成功 |
| memory.forget | 同上、mode | barrierRevision、memoryEpoch、sourcesDeleted、pendingCleanup | 屏障未落盘=失败；后续清理失败=PARTIAL_DELETE并给已生效范围 |
| operation.get | scope、operationId或mutationId（二选一） | 已提交回执、当前pending/running/partial/completed/failed/unknown状态；只读不重交屏障 | 无权访问拒绝；未有证据的UI超时状态保持unknown |
| memory.policy | scope、mutationId、expectedRevision、autoSave:boolean | 已持久policy/revision/epoch；关闭取消未提交提取 | 不删除已有记忆；重新开启只处理新有效来源，旧屏障不撤销 |

mode仅`memory-only`或`memory-and-known-sources`。第一种保留聊天正文、阻断已知来源重抽取；第二种再调用原chat删除并等待可证实的持久删除回执，跨key部分失败需恢复。当前deleteMessage返回前未await内部persist，不能把await该入口当cleanup完成；需在原owner补可等待的编辑/删除结果，失败或无法确认保持pending/partial/unknown。不存在可承诺擦除所有未知同义记录/外部模型数据的forget-everywhere。

纠正输入是用户明确更正，与原事实关联并形成手动来源记录；LLM不能伪造此权限。删除回执不得携带被删正文，诊断也不记录该正文。

## 4. 内部记忆任务与每请求投影

`memory.enqueueSource`只能由持久用户消息事件/受控补抽取触发，origin必须真实user，最终ASR有来源revision。synthetic system/assistant/tool均不排事实提取。job按scope+source集合+sourceRevision+promptVersion去重。

`memory.resolveRequest({scope,turnRef,sessionGeneration,operationId,query,signal})`返回`{projection, memoryRevision, memoryEpoch, validUntil, guardToken, factIds, sourceIds}`。Repo内部revision映射为对外memoryRevision；validUntil为UTC整数ms，guardToken为host生成的不透明请求/来源有效性令牌。它是拟加的request context port；不能在无session参数的全局runtimeContextProviders里读activeSession。失败/超时返回空投影并可诊断，不能阻塞普通聊天无限等待。guard贯穿llm-service异步内容/工具准备、两协议每轮prepareStep/resolveStep，并在实际Provider传输前重验；忘记/更正取消依赖该投影的在飞回复，并失效本地native continuation/providerTranscript/generationTranscript。拟定contextEpoch=memoryEpoch加入native scope，未知lineage旧native items不得重放；Chat Completions和Responses实际payload分别回归。

`memory.commitCandidates`是可信worker边界：候选本身无写权限；Repo重新核对lease、epoch、sourceRevision、scope和引用有效性，再CAS提交。结果给accepted/rejected原因，所有拒绝记录无敏感全文。模型不提供数据库ID/owner/epoch/relationDelta。

示例候选协议：

```json
{"schemaVersion":1,"facts":[{"kind":"preference","text":"用户最近喜欢玩星露谷物语","sourceMessageIds":["msg_example_1"],"currentness":"recent","importance":"normal"}],"noFactsReason":null}
```

sourceMessageIds必须是本次输入白名单中本人消息；text不等于证据，代码校验可确定的格式/引用/时间/版本和敏感字面片段；否定、引用和含义蕴含还需模型质量验证，模糊语义拒写或澄清，不能保证程序完全理解，不以LLM自打的confidence作确定性证明。

## 5. 资源与视觉

`perception.start`输入resource=`microphone|screen`、expectedAppEpoch、operationId和合法sourceSelection（仅screen）。先main资格，后系统授权/来源选择；授权成功也不能跳过本代次复查。输出permission=`unknown|granted|denied`与captureState=`selecting|active|paused|failed`及resourceEpoch。授权中stop导致旧start返回STALE并释放流。

`perception.stop`带expectedResourceEpoch与operationId，只撤本代次。重复停止同代次幂等，过时停止不能关闭后来新开的一代。`stopAll`由UI/main明确动作撤当前所有资源；reason是有限枚举，不含窗口标题/内容。应用生命周期撤权不依赖普通UI仍可响应。

本地StopReceipt：resource、appEpoch/resourceEpoch、activeTracks、activeRequests、status、pendingCleanup。activeRequests=0仅指本地不再持有/接受交付，不能据此报告供应商已经停止计费。失败显示LOCAL_CLEANUP_FAILED并保持deny，不能自动重启。

`vision.configure`是持久写命令，带scope、mutationId、expectedRevision（当前configurationRevision），返回configurationRevision，冲突保留UI输入；重试遵循同一幂等协议。建议intervalMs∈{30000,60000,180000}；maxCallsPerHour为1–120整数，建议默认20（待实测，滚动1小时上限）；sourceSelection必须来自当前窗口的已选来源。单owner、忙跳过、不堆帧；每次推理前预留预算，成功/失败/取消都有调用记录。预算耗尽返回/推送BUDGET_EXCEEDED并暂停自动推理。

视觉投影绑定scope/source/epoch/capturedAt，过期或停止立即清；stale回包不写上下文、**当前epoch结果展示计数**、错误toast或新UI状态；已started请求仍计入持久预算/低敏审计，不能借stop/start或迟到退款绕额度。未发网络的reservation取消可释放，started即使失败/取消/迟到不退次数；窗口为滚动1小时/24小时，重启不重置，UI显示最早额度释放时间。手动上传图片独立，不混同持续录屏权限。

## 6. 主动与呈现

`proactive.configure`带scope、mutationId、expectedRevision（当前policyRevision），返回policyRevision；旧窗口保存报CONFLICT，不覆盖新的quiet意图。包含enabled、quiet、cooldownMs、maxCallsPerDay。建议初值enabled=false、quiet=false、cooldown=15分钟、maxCalls=12/滚动24小时；仅用于小规模体验，未获效果证明。quiet开启禁止系统发起文字/语音并暂停自动Vision推理，用户主动对话可用。

`proactive.consider`仅内部typed event：scope、eventId/version、sessionGeneration、memoryRevision、trigger、signal。资格门先于模型调用；全输出验证后才呈现，不能先流一段文本再最终silence。模型候选：

```json
{"decision":"say","text":"你上次说想看的那部电影，后来挑好了吗？","evidenceIds":["fact_example_1"],"emotion":null}
```

或`{"decision":"silence","text":"","evidenceIds":[],"emotion":null}`。text建议≤120码点；evidenceIds只允许本次有效事实/观察ID；emotion类型精确为`null | {name:string,intensity:number}`，name必须在host注入的allowedEmotionNames中，intensity为有限0..1；资产不支持时白名单为空且必须null。禁止command/tool/权限/关系字段。say无依据或条件失效拒绝，silence是正常结果，不算错误。

system事件不添加user history；通过已有聊天/角色链提交assistant origin=proactive，记录eventId/version和presented/completed/interrupted/failed。发声前durable presenting，崩溃unknown不自动重播，接受轻主动可能漏一次。不能声称跨扬声器与数据恰好一次。

`presentation.cancel`绑定TurnRef/operationId，先撤交付资格、abort producer、停playback/动作、等待本地静音回执。remoteCancellation=`requested|unsupported|unknown`如实显示；取消无法撤回已执行的外部工具副作用，本期不开放电脑自动操作/外发/支付。

## 7. 事件与错误恢复

拟增`aimy:*:v1`控制/状态事件通过已有Eventa或内部bus，具体注册保持命名冲突检查。事件只给ID/版本/低敏摘要：

| 事件 | producer → consumer | 必须关联 |
|---|---|---|
| memory.changed / memory.invalidated | MemoryService → UI/request owners/proactive | scope、revision、factIds、reason；无正文用于取消通知 |
| perception.policyChanged | main → 所有采集消费者 | appEpoch、resourceEpoch、enabled、reason |
| perception.stopped | renderer → main/UI | operationId、资源代次、StopReceipt |
| vision.stateChanged | Vision owner → UI | sourceId、epoch、state、次数/耗时，不含帧 |
| proactive.stateChanged | event owner → UI/diagnostics | eventId/version、状态、reason |
| presentation.settled | voice/文本sink → event owner | turnRef、operationId、实际呈现终态 |

Eventa发起者验证、onlySameWindow能力、leader动作转发不能因为新接口而扩大。断连重试复用operation/mutation身份；状态订阅先读快照再按revision补，不靠每窗口自开ticker。UI超时不一定等于任务未提交，重试先查原回执。

诊断只记录可复现错误码与版本；错误字符串需脱敏，不能直接把Provider响应/请求头/原图地址打印给UI或日志。[接口目录JSON](接口目录.json)共17个操作，与任务追溯矩阵核对。

## 首批A的接口范围

17项仍是整包拟定本地接口，不是17个已存在端点，也不是全部进入首批。首批评审记忆8项+operation.get/diagnostics.summary；perception.start/stop/stopAll与presentation.cancel是共同基线保护适配。proactive.configure/consider、vision.configure为后批。具体参数、删除mode支持范围和实现方式仍按逐项审定与任务验证收窄。

删除粒度补注：memory-and-known-sources若后续获选，仅针对已知sourceMessageIds对应的具体消息，不默认删除整段会话。UI先显示将影响的消息数/其他依赖；第1项 A没有批准该扩大清理方式。memory-only仍需阻断已知来源重抽取，被删源相关的其他事实/派生需失效或重建并明确结果；实际支持的mode待删除主题审定。
