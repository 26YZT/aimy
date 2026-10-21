# 首批增量开发与验证记录

> **后续更新（2026-10-15）：** 用户解锁后已完成关键记忆操作的原生点按，暂停/恢复及移除后的重启也已检查；另修复了电脑操作默认开启问题。最新构建、154文件源码指纹和结果见[解锁后窗口复测](解锁后窗口复测.md)。下表保留前一轮检查的时间与范围，当前结果以这次更新为准。

日期：2026-10-15（Asia/Shanghai）。状态：**首个工程版本已实现，构建与本轮定向工程检查通过；完整 INT/EXP 验收尚未完成。** 授权来源：用户明确“好的开始开发”。用途：交付可继续调试的首版代码，并把实现、离线证据、真实模型和本人试聊分开。真实模型调用 **0次，费用¥0**。

唯一产品位置：`/Users/mima1234/Documents/aimy/aimy-app`。工作分支 `codex/aimy-first-increment`。在原 AIRI 代码上增加能力；没有重新搭桌面壳，没有混入旧 Aimy。未安装/升级依赖、迁移/清空旧资料、暂存、提交或推送。

## 这版已经能做什么

1. 先选择并保存聊天模型，再填写可跳过的“先认识你”资料。
2. 自动记忆默认开启，只整理启用后的新聊天；可暂停，恢复后不补暂停期间。整理模型默认跟随聊天，也可单独指定。
3. 在“关于我”查看事实和原话；展开资料维护后更正或移除。产品处理实际依赖，保留独立记忆及聊天原文。
4. 对新对话提供相关记忆和少量核心称呼/边界，沿原聊天模型链生成回复。当前是关键词和有界近期事项规则，真实语义效果尚未评定。
5. 本地保存、来源版本、旧结果拒收、退出保存、重启恢复及共同验收预算门已接入。密钥沿系统安全存储；本轮只使用合成密钥。

复用来源为 AionsHome 的来源关联、更新与依赖规则，以及 Ryza 的相关筛选规则，适配到 TypeScript；未导入它们的整套后端/存储/角色资源。来源、许可、前后端文件、18项逻辑接口及适配差异见[逐项实现映射](implementation-mapping.md)。全产品方向仍见[产品总纲](../../00-当前方向/产品总纲与当前路线.md)，后台主动续聊留在后批。

## 实际验证与边界

| 验证 | 结果与证据范围 |
|---|---|
| 最终桌面构建 | `pnpm build:tamagotchi` exit0；[构建日志](evidence/desktop-build-final.log)，[1379个构建产物指纹](evidence/final-build-manifest.json) |
| 消费闭包类型 | desktop、stage-ui、stage-pages、core-agent、electron-screen-capture均有通过记录；未改tsconfig隐藏问题 |
| 代码规范 | 本轮147个产品文件变化，其中141个TS/Vue/YAML文件做定向ESLint，0错误；保留既有注释等warning |
| 记忆最终回归 | 24项集成+20项仓库浏览器测试，共44个唯一用例；覆盖原生IndexedDB、真实Pinia、多窗、来源删改、回执、恢复、取消及提交最后间隙。[日志](evidence/memory/journal-commit-final-browser.log) |
| 原聊天与发送 | 原聊天契约48项、core-agent六文件125项通过；覆盖正常路径、重试、最终HTTP检查和稳定错误出口。不同批次不累加成总成绩 |
| UI与退出 | 资料/维护UI10项；最终导航与角色继承7项；App三项；两阶段退出16项Node+两项真实多窗边界有通过记录，详见evidence原日志 |
| 费用与本地边界 | shared Node47项、host15项，以及合成凭据、HTTP/WS、真实SDK错误canary等定向检查；没有用真实账号验证计费 |
| 最终真实Electron恢复 | **通过**。PID25970与26003分别启动、正常退出，同一个合成profile的1条初始资料记忆SHA一致；模型/Provider恢复正确，待处理和失败任务均0。[原始报告](evidence/electron-restart-verified/memory-restart-report.json) |
| 最终实机交互 | 首次设置已实际走过模型→资料→保存；原生点按被Mac锁屏阻挡。最终运行读取到主窗口`stage-bind/active:false`，请求门拒绝新生成；未绕过该保护。[状态](evidence/desktop-verified-state.txt) |
| 中间版本的合成聊天 | 曾用本机固定响应服务看到自动提取茶偏好、新会话召回与昵称联用。[观察](evidence/desktop-cross-session-observation.txt)。它发生于最终加固前，不能冒称最终版本的完整点按或真实模型效果验收 |

最终新进程恢复仅证明该合成初始资料和模型选择的持久性，不等于8例全部跨进程通过。浏览器假设备、固定响应、真实进程、真实模型、本人体验是不同证据。

全仓命令也已执行：`pnpm typecheck` 被未改动的 `model-driver-mediapipe` 缺失依赖/类型阻断；`pnpm lint` 被上游docs工作区缺失 `@radix-ui/colors` 阻断。见[类型日志](evidence/root-typecheck.log)、[lint日志](evidence/root-lint.log)。因此不写“全仓检查全绿”，也未扩大安装或改配置掩盖问题。

## 本轮发现并修正的问题

- 首次配置的异步步骤未锁完整，连续前进可能跳过模型/资料。
- 初次模型选择只保存在运行状态；重开后原角色设置把它清空。现通过 AIRI 原 `updateActiveCardConsciousness` 保存，再进入资料步骤。修复前后日志保留，最终双PID已复验。
- 旧来源的入队回执保存失败后，如果原话被删除/改写，会挡住后续记忆。现只终结已证实过期的来源；真正读盘失败仍保留待恢复。
- 取消/换模型恰好发生在最后摘要计算期间，旧结果仍可能写入。现提交事务内再次校验，旧结果不落库。
- 退出可能过早释放主窗口所有权。现先收齐各窗口保存，再释放；窗口关闭失败保留窗口和提示。

## 还需要完成的工作

1. **正式验收工具尚未补全**：两臂runner、原AIRI adapter和共账本adapter测试仍缺失；场景时间与运行manifest也需落实。不能只给Aimy限制预算而漏掉AIRI。
2. **部分技术接口仍有差异**：当前有效事实/资料用Pinia投影合并读取；历史分页/cursor、独立diagnostics聚合及完整v3返回形状尚未全部实现，详见[逐项映射](implementation-mapping.md#2-十八个逻辑操作与真实端口)。
3. **8例真实模型对照未运行**：已保留[8例原文材料](acceptance/cases.json)与[执行规则](acceptance/runbook.md)，状态prepared、未冻结、无模型回答或评分。预期答案只给评分侧，不进入模型输入。
4. **原AIRI候选已核源码**：565个关键文件与指定来源及本仓导入提交一致，但本轮受控基线启动、产物绑定与两臂联调未完成。[核验边界](baseline-comparison-status.json)
5. **真实配置与本人试聊仍待进行**：已定官方deepseek-flash、非思考模式、一次共享¥10上限不变；用户在应用内配置，密钥不要发进聊天。现在不能声称记忆效果优于原AIRI。
6. **全产品体验后续验**：正式角色/声音、真实麦克风/看屏、完整陪伴与分发签名没有被这批文字记忆工程测试替代。

## 隔离、复现与接续

本轮只用 `/tmp/aimy-first-implementation-20261015/` 下新建的合成profile。最终资料路径和PID见[运行记录](evidence/desktop-final-runtime.json)。未使用或声称清空 `Aimy-AIRI-Dev`，未读取旧Aimy配置/聊天/凭据。受保护的97份包清单、锁文件、builder及图标与开工快照一致；Git索引未变。

重启脚本位于 `aimy-app/apps/stage-tamagotchi/scripts/acceptance/memory-restart.electron-smoke.ts`，只接受明确标记的合成profile和零价本机模型。它会拒绝使用中的profile；原始拒绝记录保留。它禁止新模型推理，只读取投影、核验独立PID、正常退出和相同摘要。

下一轮按上面的未完项继续，不重问已确认产品选择，不重复R1，不升级依赖或迁移旧数据。关键记忆操作的原生点按已补充；浮窗设置入口的纯点按仍有自动化限制。正式模型运行前先补齐两臂工具和共享费用门。

[前一轮源码指纹](final-source-manifest.json)保留历史范围，最新指纹见解锁复测附件；[实现映射](implementation-mapping.json)中的较早SHA仅是相应时刻的对照快照。原始证据按字节归档，导入位置/摘要见[evidence-imports.json](evidence-imports.json)。开发中的失败记录也保留，不能删去失败只报通过。
