# 长期记忆：冻结十案例、AionsHome / AIRI 原模块对照

日期：2026-10-14。状态：受控离线原函数/原 SQL 比较完成，等待主 agent 独立复核；产品代码未实施。来源只读；本批所有写入仅在本目录，数据库只含合成案例。没有读取配置/凭据/用户聊天库、安装依赖、联网、模型/设备调用或发信。

结论：**AionsHome 的持久当前事实、精确主题替换、逐条来源名单/原文复查、同 ref 删除拒迟到有局部实现和运行证据。AIRI 的独立 task-memory 已有精确去重与轮次防旧写，不把这些重复计新增。AionsHome 换主题重建和合法来源下错误语义仍失败，不能把其整个后置哨兵直接当可靠长期记忆/完整遗忘复用。** 没有真实模型抽取/召回质量或陪伴体验更强的结论。

## 固定条件和复跑

输入只读 `/tmp/aimy-20261014-memory-ab/fixtures.json`，SHA256 前后始终为：

```text
61b8c0b87067f9d349876f11217adcb82d321df795ddfec6e330e0f9caa14b61
```

共同初始时钟 `2026-10-14T10:00:00+08:00`、Asia/Shanghai；同一消息/固定候选；无 embedding。上下文目标 1200 字符。Aions 消息时间格式映射为 `clock_epoch + turn - 1` 秒；AIRI 用同 turn 映射原 `sourceTurnIndex`、壁钟为相同 epoch 毫秒。LM07 为经过原生 30 秒 retry，双方该案例仅将逻辑时钟推进 31 秒；不是等待真实时间。其他案例不推进时钟。

复跑（只覆盖本目录生成的合成库和结果，不写来源/产品）：

```text
python3 -B /tmp/aimy-20261014-memory-ab-lm/run.py
```

实际分臂执行命令为 `python3 -B .../aions-arm.py` 和 `node .../airi-arm.cjs`，均 exit 0；`run.py --assemble-only` 只装配已有原结果，不重跑。为补严 LM07/08 自动来源副探针，Aions 臂在该脚本新增后重新执行一次；结果不变，额外探针的层次明示如下。固定输入没有改动。

## 逐案例合同结果

`unsupported` 表示所测原模块没有相应输入/状态合同，保留真实观察但不由 harness 补实现；不打零分，不汇成排行榜。`fail` 包括被预期捕获的反例；不会把“反例断言成立”写成产品通过。

| 案例 / 产品期望 | AionsHome 原生观察 / contract_outcome | AIRI task-memory 原生观察 / contract_outcome |
|---|---|---|
| LM01 新进程恢复 | 原任务入 SQLite；真实新 Python OS 进程读取同库有 1 画像事实，来源 `private:U1`。**pass** | 当前进程有事实；真实新 Node OS 进程加载原类并 new manager，get 为 null。模块无恢复入口，未添落盘。**unsupported** |
| LM02 重复同条不重复当前事实 | 原 `INSERT OR IGNORE` 抑制同消息 job；同候选原 `_apply_analysis` 再执行也只保留 1 条。**pass** | 同 sourceTurnId/index、同字符串重复 update 仍 1 条。**pass** |
| LM03 新同主题偏好取代旧偏好 | 相同 category/topic 复用 key，只剩乌龙茶事实、来源 U2。**pass** | confirmedFacts 保留咖啡和乌龙茶两字符串，无 topic/current-fact 合同，未加主题识别。**unsupported** |
| LM04 旧轮次迟到不盖新结果 | 先 U2 后 U1，原 `source_ts` 拒旧同条目更新。**pass** | 先 turn 2 后 turn 1，原 manager 返回 ignored-stale。**pass** |
| LM05 不存在来源拒写 | 原 U 标签白名单拒 U999，无画像；job pending/error，待原生 retry。**pass** | 原 update 接受 caller 的 U999 标签，无逐事实消息登记/查验接口。**unsupported** |
| LM06 await 中原消息修改拒旧 | 真 SQLite 原文改为原文＋`（已编辑）`；原 after-context 比较令 job skipped、无画像。**pass** | 只在外部合成消息元数据模拟编辑；manager 没有原文/版本/抽取等待接口，给旧候选仍接受。**unsupported** |
| LM07 删后同 ref 旧抽取不复活 | 原 manual 单事实→await 中删除→revision 拒提交/重排→+31 秒原 retry→同 P1 被 deleted 拒绝；另自动 U1 来源副探针也拒同 P1。**pass（限定这些层次）** | 无逐事实 ref 删除/待处理 job；最近邻原 clear→同 turn late update 会重建，不能冒称桌面聊天删除失效。**unsupported** |
| LM08 删后改主题同义抽取也不得复活 | 原任务在手动事实删后接受新 topic 同正文；另自动 U1 来源的纯 `_apply_analysis` 重放也新建同来源事实。**fail** | 无 topic/ref/per-fact delete 合同；原 clear→再 update 重建，改 topic 无字段可映射。**unsupported** |
| LM09 小说人物不误记成本人姓名 | 固定故意错误候选、有效 U1，原任务接受“用户本人叫张三”。**fail** | 同错误字符串进入 confirmedFacts 被接受。**fail** |
| LM10 单长事实不超 1200 目标 | 同 1504 字原候选被原每条 600 字校验拒绝；画像 0、context 0、job pending/error；原 manual API 也 ValueError。**pass（靠拒绝，不是压缩）** | 同 1504 字原字符串保存；原 toContextString=1540 字，没有外加截断。**fail（原模块输出层）** |

这些是 10 个合同的两臂原观察，不把 Aions 的 8 pass / 2 fail 与 AIRI 的 2 pass / 2 fail / 6 unsupported 合成产品胜率。

## 真假、字段映射和不能偷换的层次

- **Aions 真执行**：当前 `post_sentinel.py` AST 提取的原类/函数体及原 SQL、原 `save_manual`、原策略模块；真实 stdlib SQLite 文件、事务和 asyncio。async DB 只作协议适配，未伪造 SQL 结果，亦未宣称运行第三方 aiosqlite 或完整 FastAPI。
- **Aions 外缘替身**：`_call_model` 返回固定候选 dict，不跑原模型网络/JSON解析器；配置仅合成 `user_name='用户'`，保持候选正文原字；通知是 noop。候选只补原合同要求的 `category='profile'` 和 `state=null`，topic/content/sources 不改。
- **AIRI 真执行**：原 `types.ts/merge.ts/manager.ts` 经现装 TypeScript 转译加载，原验证/列表去重/限额/轮次水位/clear/上下文函数。只换 `Date.now`；没给 manager 添存储、来源白名单、主题字段、删除 tombstone 或检索实现。
- **AIRI 字段映射**：候选正文原样进入 confirmedFacts；首个 source 标签映射 sourceTurnId，对应 fixture turn 映射 sourceTurnIndex。这个 caller 标签不是来源存在证明。topic/category/ref 没对应字段，明确 unsupported。LM09 只测试该字符串写入界面的确定性防线，不评价真实 LLM 抽取质量。
- **LM07/08 主任务基线**：为了不凭空新增 U2、伪造重复 job 投递或绕过原 source_id 幂等，初始 1 条相同事实由真 `save_manual` 建立，原生 sources 为 `['manual']`。LM07 在真实任务等待中删除，后经原 retry；LM08 在原待处理任务开始前删除，再给改 topic 固定候选。不得写成这一主任务的初始自动事实已带 `private:U1`。
- **LM07/08 自动来源副探针**：另一个隔离库先由原任务真存 `private:U1`，真 manual 删除保留该 tombstone 来源，再从原 `_context_for_job` 取同 U1 证据，执行原 `_apply_analysis` 的同 ref / 改 topic 重放。同 ref 无 active，改 topic 内存文档新建同 `private:U1`。**副探针没有重新入队已完成 job，也没有把删后纯函数结果提交 SQLite**；persisted_after_probe 仍为空。它证明同来源删除规则的叶子边界，不伪装成第二次完整自动任务复活。
- **LM10**：不加截断、摘要、预算器。Aions 以硬拒绝满足上限，同时没保存该长事实且 job 尚待重试；不能称其长文本总结/保留质量更好。AIRI 1540 是原 manager 上下文，不声称整个 provider 最终预算或默认桌面上下文超过限制。

## AIRI 既有能力与已确证增量

继续沿用 AIRI：字符串精确去重、列表数量限额、结构校验、sourceTurn 顺序拒旧、当前任务 get/clear/context。LM02/04 双方有能力，不再计成 Aions 首次引入。

值得在 AIRI 既有 owner/IndexedDB 上设计的增量是：持久当前事实的独立权威、同主题更新、逐事实来源/版本和 await 后源文复查、与来源删除/当前 revision 协调的拒晚到。这里的“更强”只可说 Aions 在这些窄机制有实现而该独立 manager 无对应；不能外推产品效果。

不能直接接入的边界：换 topic 能绕过仅按 ref/topic 的删除；合法 U1 可承载错误的本人语义；原 Python/SQLite 后置 worker 不是 AIRI 现有聊天 owner。移植要保留单一运行时与来源删除屏障，不先新增 SQLite sidecar，正式方案仍未实施/冻结。

**AIRI task-memory 新进程为空不等于聊天历史丢失。** 主 agent 的独立真实浏览器实验已验证原 chatSessionsRepo+unstorage IndexedDB 聊天和 Ryza localStorage 条目可在同浏览器进程新页面 realm 恢复。那是不同数据对象/重启层次，不能与本批新 OS 进程画像/manager 强行换成等价整应用恢复。

主 agent 的实际 core 消费实验还表明：在合成 session port、空额外 context、未附记忆 provider 的装配里，同 session 请求带旧咖啡原文，新 session 不带；这证明实际投影行为，**不证明全 AIRI 所有配置/集成没有跨会话记忆**。chat repo 的会话 tombstone/outbox 保护对象也不是逐事实遗忘，本批不把它们称缺失。

## 当前源码锚点与指纹

Aions：

- [原画像 schema/SQL](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/post_sentinel.py:44)、[原手动保存与删除](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/post_sentinel.py:142)、[原每条 600 字校验](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/post_sentinel.py:124)。
- [消息原文与 U 标签](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/post_sentinel.py:254)、[来源白名单/确认时间](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/post_sentinel.py:365)、[主题匹配/同 ref 删除/旧确认拒绝](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/post_sentinel.py:380)。
- [原任务领取/原文复查/revision 拒旧与 retry](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/post_sentinel.py:501)、[原 bounded renderer](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/user_profile_policy.py:159)。本批 LM10 只测输入拒绝，没有用长项补外部 renderer。

AIRI：

- [原任务字段和条数限额](/Users/mima1234/Documents/aimy/aimy-app/services/computer-use-mcp/src/task-memory/types.ts:1)、[原 merge](/Users/mima1234/Documents/aimy/aimy-app/services/computer-use-mcp/src/task-memory/merge.ts:1)、[原 manager.update 水位](/Users/mima1234/Documents/aimy/aimy-app/services/computer-use-mcp/src/task-memory/manager.ts:42)。
- [原 clear](/Users/mima1234/Documents/aimy/aimy-app/services/computer-use-mcp/src/task-memory/manager.ts:85)、[原上下文输出](/Users/mima1234/Documents/aimy/aimy-app/services/computer-use-mcp/src/task-memory/manager.ts:120)、[真实 MCP 注册入口（本批只读未启动）](/Users/mima1234/Documents/aimy/aimy-app/services/computer-use-mcp/src/server/register-task-memory.ts:16)。

| 文件 | SHA256 |
|---|---|
| post_sentinel.py | f9dc9c071a320be327d2cdbadf1966f4a3d0d92e751cde8bddce9c905e8a0da7 |
| user_profile_policy.py | e7e8d49edd9cdb1b5fa27b07889aac75c51cdf1cfa41df8493a83fff8b5f9b85 |
| AIRI manager.ts | 99ac0d163d6e154ea7b72b51abcea4ddd1cdc3d2921a2085bdc7b74778e39bf5 |
| AIRI merge.ts | 0f7632c172c9340c3d76b6a11a35ebb02151f10ab4a4eb6518a64839d289ef68 |
| AIRI types.ts | 497b40b242dc7716753aa8c33277ca8aa25bce96b4af46761652f5bc6ba439a7 |

输入与已加载来源前后 hash 一致。`source-manifest.json` 的 20 个装配单元不等于 20 个函数所有分支都实跑；例如 invalidate_pending 被装配但本批没有触发开关，不能算本批关闭开关验收。这里没有 Ryza 第三臂，其窄 browser 反例由主 agent 独立提供。

文件：`results.json` 含每例两臂原结果/合同状态/字段转换/限制；`aions-results.json` 和 `airi-results.json` 保留完整原输出，包括长候选不截断；`source-manifest.json` 存逐来源/符号/范围/哈希与装配/静态 caller 区分；`aions-arm.py`、`airi-arm.cjs`、`run.py` 可复跑。`cross-review-root.md` 是对主 agent 浏览器/core 证据限制的只读交叉复核。
