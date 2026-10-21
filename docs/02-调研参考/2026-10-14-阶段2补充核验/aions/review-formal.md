# REVIEW-PLAN-A 正式交接包复核

日期：2026-10-14。范围：02 PRD记忆部分、03技术全文、04API全文与接口目录JSON、08任务全文与追溯矩阵JSON；为确认验收引用定向读07。只写本临时文件，未改repo。没有P0；有1项P1及2项P2建议交付前补齐。

## [P1] 删除历史的契约未明确覆盖native continuation回放

**位置**：03-技术设计.md:98、104–108；04-API与事件契约.md:49；08-开发任务与交接.md:64–76、109–121；07:ENG-10。

03已正确要求过滤原文/相关回合/未知lineage摘要，但全文和API/任务中都没有native continuation、providerTranscript、generationTranscript的具体失效规则。02:58把模型外部记忆排除在保证外，是合理的远端限制，不能据此排除**AIRI本地持久化的provider-native重放数据**。

当前真实源码：

- `aimy-app/packages/core-agent/src/runtime/chat-orchestrator-runtime.ts:572–577` 优先恢复assistant.generationTranscript，其次用providerTranscript重建turn，不能只过滤message.content。
- `packages/core-agent/src/messages/chat-completions.ts:178–188` 与 `runtime/responses.ts:83–87` 在scope相同时直接重放continuation.data，绕过普通portable投影。
- `runtime/request-context.ts:47–48` scope只有providerId/baseURL/model/conversationId，**当前memoryEpoch或删除屏障不会使它失效**。

**可执行修正**：SRC-01/MEM-03明确：受忘记/更正影响的turn及无法证明lineage的native continuation、providerTranscript/generationTranscript必须在真正provider请求中清除或重建；不能只清UI和memory context。可在平台请求投影中剥离相关continuation并走过滤后的portable内容，或加入经证明的contextEpoch使旧scope不匹配；不要求供应商远端日志删除。API投影应返回`memoryEpoch/contextEpoch + validUntil或guardToken`，并明确guard在最后一个async准备阶段后、网络发送前检查。

**最小验收**：分别合成Chat Completions与Responses的matching-scope native payload，含已知被忘记来源的旧事实；忘记→重启→retry/import/下一轮请求，拦截实际provider payload，确认原文、旧assistant转述、opaque/native items均不重放；未知lineage数据保守作废。不能只断言memory.list为空。

## [P2] PARTIAL_DELETE的幂等回执与继续清理之间缺少可执行协议

**位置**：03:104、110；04:29、38–43、102；接口目录.json的memory.forget；08:MEM-03/ENG-11。

04:29要求相同mutationId+payload“返回原回执”；但03:104又要求屏障成功、chat删除失败后重试/重启继续清理，04:102要求UI超时“先查原回执”。当前16操作目录没有mutation/operation状态查询或resumeCleanup；也未说明原PARTIAL_DELETE如何在保持同一mutation身份时转成清理完成。严格按原回执幂等实现会一直返回原partial而不能发起/观察后续清理；随便重跑forget则可能再次推进epoch或重复删除。

**可执行修正**：明确mutation处理顺序为先查幂等operation，再检查expectedRevision。把屏障提交的不可变receipt与可变cleanup状态分开：同mutation只提交一次屏障；同ID重试只恢复/查询同一cleanup job，返回当前cleanup状态；payload不同仍IDEMPOTENCY_MISMATCH。补`operation.get`/`memory.mutationStatus`，或明确现memory.forget重复调用的resume/status语义。成功/partial/unknown都要能由operationId回查，不能将“返回原回执”当永久冻结partial。

**最小验收**：屏障提交→合成chat删除失败→UI超时→同mutation重试/新进程恢复；barrierRevision不重复推进，只有未完成清理被重试，最终状态可查询为完成，屏障一直有效。

## [P2] JSON把所有任务误写成等待VOICE-02条件，和Markdown实施顺序矛盾

**位置**：追溯矩阵.json:25及其余14个tasks.status；08:7、184、255。

JSON全部15任务，包括BASE/LIFE/LOCAL/SRC/MEM/INT，status均为“未实施；VOICE-02条件成立后才启动”。Markdown则明确VOICE-02是条件实验且不阻断基本整合；VOICE-02反而依赖VOICE-01及其P0链。执行AI依据JSON状态会把前置主链也挂到尚不存在的EOT缺口上，造成流程停滞。

**修正**：只有VOICE-02保留条件状态；其他任务status为未实施/等待自身dependencies。推荐独立`condition`字段只出现在VOICE-02，不把条件混入所有任务status模板。保持15节点依赖闭包核验。

## 已成立、不需返工的部分

- 单key/CAS/物理key/身份编码/MemoryRepo独占、unstorage非CAS、同步事务回调与模型事务外执行已正确区分。03:85“冲突返回原对象”只要外层result仍为CONFLICT且事务完成后才回执即可成立，不需要为了与我的模拟脚本throw方式一致而改写。
- leader选举不是写授权、持久token约束旧owner、旧snapshot不全量合并、失权不得读新epoch自授权，在03与ENG-07一致。
- 来源版本/逻辑血缘覆盖durable user、语音最终转写、retry/import；system-trigger不伪装user；先持久屏障后chat删除；未知同义/外部模型擦除不夸口，均已写明。
- 03开头明确CAS来自离线模拟，08:239–243把原130测试、新真实browser IDB、新进程与设备证据分层；没有把本轮模拟说成真实IndexedDB/模型验收。
- 召回不全局污染registry、hook显示副本不是provider payload、在飞引用失效需取消，方向正确。

## 非阻断的补充措辞

04:49文字承诺有效时间，接口目录memory.resolveRequest.result_fields却只有projection/revision/factIds/sourceIds。建议随P1修正统一显式epoch/expiry/guard字段；若它们嵌套在projection，应给出projection类型，不能留给执行者猜测。02:56要求过期事项“状态未知”，03 MemoryFact.status目前只有active/superseded；可明确计算型viewStatus=unknown/stale与持久status分工，避免把到期事项错误等同已完成或仅隐藏。

复核方式：全文人工阅读上述四份Markdown与JSON记录，定向当前源码校验native回放链；未重新运行模型/设备或改产品代码。root统一决定并同步正式文件。
