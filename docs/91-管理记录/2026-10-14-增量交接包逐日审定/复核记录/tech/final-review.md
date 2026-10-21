# 终核：首批A技术/API/验收提案修订

日期：2026-10-14。结论：**HT01–HT07的文档/契约问题已关闭，本审范围无剩余P1/P2；后续补出的post-commit措辞点也已关闭。** 这是文档修正通过，不是代码已实现、接口已就绪、真实删除/请求安全或产品验收通过。

唯一写入本文件。未重跑旧实验/测试，未启动app/模型或联网/安装，未改仓库与原review/findings。原两份review/findings与已复制版本逐字节一致，保留此前发现和提出时状态。

## 七项关闭依据

| Finding | 当前正式修订 | 关闭范围 |
|---|---|---|
| HT01 durable编辑/删除回执 | 03:111明确deleteMessage→setter→void persistSession，await并非IDB已删；SRC/MEM需同chat owner内带来源/会话版本的实际持久结果，失败/未知不得cleanup completed。04:10改为durable用户提交与现编辑/删入口；07:90和08 SRC/MEM验收跟进 | 删除/编辑回执的待实现合同已准确，未把原入口包装成已有durable删除 |
| HT02真实最终门与重投影 | 03:111/171、04:53及08 SRC/MEM允许区覆盖types/llm.ts、llm-service、runtime/chat-completions与responses；区别messages/chat-completions文件。实际传输前/逐步异步guard待实现；失效丢旧Conversation/body/request并过滤重建，native失配仍剔旧portable正文 | 没有虚构现安全hook，也不允许abort后复用旧body；验证要求覆盖两协议实际payload |
| HT03 renderer/main职责 | 03:10与04:12明确renderer stage-ui业务/IDB、pure core投影/协议、main系统窗口/权限/拟建secret桥；renderer MemoryService验principal/character/session，main验真正IPC sender/window | 不把记忆Repo搬main，不建HTTP服务，不把shared DTO当后台owner；secret桥仍提案 |
| HT04首批闭包 | MEM03承担普通聊天相关引用/REQ-MEM04；PRO01仅后批后台；INT只直接依MEM03，PRO/VIS/CHAR为条件后批；EXP按当批。10/账本与机器矩阵一致 | Day1 A范围可独立收口，不被未选后批阻断；整包未实现项不随首批门变已完成 |
| HT05 chat commit→enqueue崩溃gap | 03:175明确用持久SourceState/启用后游标或等效恢复协调找回未排队新消息；即使await post-commit也须覆盖两个持久点间进程中断，await不能替代恢复；同source版本幂等，不回放启用前全历史。10/08对应验收一致 | 有界恢复是必须覆盖的待实现合同，非“加async hook即耐久” |
| HT06数据字段与事实身份 | Envelope新增/明确policy.autoSave、cleanupJobs，recentMutations持久回执保留；03:175明确host稳定factKey/用户更正关系、含糊不盖旧，不假装kind/text/source已解决同义identity | 首批数据owner/恢复位置与有限语义保证写清；参数/schema仍提案，后台未被提前批准 |
| HT07 Node/profile前置 | 环境页仍登记Node24.20.0 vs声明26.7.0及无root engines最低约束；APP_USER_DATA_PATH源码存在但未启用/未迁数据。10共同前置和账本授权明确先验证，安装/升级/迁移/测试皆未授权 | 未误报环境已统一或profile已隔离；这不是本轮实际升级/迁移验收 |

HT05终核时发现的“await或恢复”简称已在本次正式03末段消歧，无需保留为当前问题。原review不重写，终核记录说明后续修正即可。

## 机器一致性与范围核验

- 17个接口、15个任务、14项需求、5个Prompt，unique API/task IDs各17/15；无数量扩张。
- SRC-01/MEM-03精确允许区均包含 `types/llm.ts`、`runtime/llm-service.ts`、`runtime/chat-completions.ts`、`runtime/responses.ts`、`runtime/request-context.ts`、`messages/chat-completions.ts`。
- REQ-MEM04映射MEM03/INT/EXP与memory.resolveRequest；接口目录保留REQ-MEM02主关联并显式related_requirements含REQ-MEM04。proactive.consider/configure归REQ-PRO01、review_batch后批。
- INT首批依赖闭包＝BASE/LIFE/LOCAL/SRC/MEM01/MEM02/MEM03/INT；EXP加自身，共9任务。无PRO/VIS/CHAR/VOICE优化节点被强制混入首批；受影响原能力仍需回归。
- 审定账本DAY01为 `confirmed_scope_only`、selected=A；DAY02–07 date/selected均null、not_asked；没有补造答案。只有planning_and_docs授权为true，代码/升级/迁移/真实测试/Git/发布均false。
- 账本不创建自动日程，calendar_schedule=null、automation_created=false；“逐日”只是审定主题，不是开发工期或自动提醒承诺。
- 选定03/04/06/07/08/10的本地Markdown链接静态核验无断链。
- 原review引用的19个aimy-app源文件指纹当前仍相同；这只是本审有界源清单，整体产品/暂存保护由主写者最终QA另核。
- 原 `/tmp/.../review.md` 与docs复制版本SHA同为 `e573cb6dc1b70d50b0fc7bd66b9abcf5da80b0170300034ba02513b564cc6392`；findings.json同为 `251d71e1f31199538ec5ba7f5343d138adfde8bd21b557ed5d86ea66458d8d18`。

## 完成边界

本次确认已有提案的责任、文件允许区、依赖和验收描述与Day1 A一致。API/MemoryRepo/guard/恢复字段均未因此变成当前可调用产品能力；具体记忆类型、历史补记、删除来源mode、界面/模型/预算和体验线仍待对应主题，不对尚未选择项全局冻结。

await/CAS/源码位置/最终发送门等由工程收敛，不再把它们作为无关架构选择交给用户。后续实施需另有明确指令，并针对实际diff补新的持久化/多窗口/取消/两协议请求证据；本终核没有运行这些验证，也不替代它们。
