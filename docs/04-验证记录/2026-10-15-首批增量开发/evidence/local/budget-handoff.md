# 共享验收预算实现交接

2026-10-15。仅已授权¥10 campaign的host边界，不是普通产品日/月额度。不含真实价格/密钥/模型调用，测试价全部synthetic。

## 接线API

- stage-ui/stores/memory/budget.ts：AcceptanceCampaign、AcceptanceAttempt、BudgetReservation/Usage/Status、AcceptanceBudgetPort。configureAcceptanceBudget/get/require与beforeAcceptanceAttempt（reserve→started，失败时确认未fetch释放）。普通产品无campaign不配置port。此文件没有另一个存储或自发金额。
- main/services/aimy/acceptance-budget.ts：new AcceptanceBudgetLedger({filePath,campaign})，filePath由根显式验收配置给定，不能随userData变。registerAcceptanceBudget({context,ledger?,authorizeSender})→disposer；ledger.flush等队列。
- shared/eventa/aimy-acceptance.ts：reserve/started/release-not-sent/settle/status/info。
- renderer/bridges/acceptance-budget.ts：readAcceptanceCampaign(context)→campaign|null；无ledger明确null，bridge失败抛出。createAcceptanceBudgetBridge(context)给port。info无路径/密钥，不初始化账本文件。

## 合同

金额都是整数微元（1元=1,000,000微元），cap≤10,000,000；按百万token的价用BigInt乘除、总额向上取整。price id/provider/model/mode/sourceUrl/verifiedAt绑定campaign。缺cache usage时按uncached保守记账，cache单价不能高于uncached。原AIRI/Aimy/人工试聊/修复均带arm/case/run/request/attempt。每个HTTP attempt独立attemptId；有限maxOutputTokens必须由根实际payload发送门强制。

新reservation持久才回执。started持久后，根再次同步检查memory/resource/model guard并立刻原fetch。若确定未invoke fetch，可releaseNotSent({transportInvoked:false})；已发送但usage未知则settle(null)，保持预留并暂停。不得把abort当0费用。

单host实例串行队列+跨进程wx文件锁，0600临时文件/fsync/原子rename/目录sync。残留锁立即locked，不抢锁/重置。损坏schema、价格或campaign不同不覆盖。已退出进程未决attempt转unknown并暂停。账本存非敏感元数据，不存payload。实际usage超上界保留实际记账并暂停，不用cap截断证据。

stage-ui/libs/providers/validators/index+run包住原validateProvider；仅显式campaign期间，额外付费chat-ping与未知runtime probes报paid-validation-disabled。已知GET connectivity/model-list保留。覆盖onboarding/legacy/v2三类UI入口。原AIRI对照副本仍由harness关付费ping或装同门。

## 已跑

`node .../vitest.mjs run --config /tmp/aimy-first-implementation-20261015/local/vitest-budget.config.mts`：3文件13tests pass。真实子Node进程reserve/start后结束，父读同账本unknown暂停通过。另含双臂共账本、新owner恢复、锁竞态/残留锁、超额暂停、unknown不能退款、确定未发送释放、去重幂等、价格/campaign不符、坏文件保留、整数取整、超预留实际费用与UI probe闸门。

定向ESLint 0错误；一条provider.ts既有长注释warning。desktop完整typecheck正在根并行整合，最终结果由根统一核。

## 尚待根接线/验收

核心最终HTTP每attempt预算端口、真正两协议max输出参数、SSE/非流式完整usage解析和失败unknown，原AIRI adapter与价表官方核验由根负责。当前这些host tests不能证明实际模型收费已受控，也不是¥10已消费。main配置读取路径仍由根提供，agent没有读取/创建真实验收campaign。
