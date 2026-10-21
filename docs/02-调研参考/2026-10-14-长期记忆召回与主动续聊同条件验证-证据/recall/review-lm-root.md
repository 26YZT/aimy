# 独立复核：LM两臂、主agent core与真实浏览器补证

2026-10-14。只读审阅，未重跑任何脚本、未改源代码/仓库/依赖/Git/冻结结果。唯一写入本文件。范围：LM results/两臂脚本/source-manifest、主agent default-context TS/结果、browser README/verification/四份结果/四个调用脚本，并定向核原source与browser build/entry/serve的装配。

**结论：原执行数据与大部分解释一致，未发现补造AIRI能力、伪造SQL结果或把页面realm误报为OS/Electron重启。存在1处P2机器比较摘要需收窄来源与提交层次；不需重跑或改原观察、case状态。**

## P2：LM08机器摘要把两种来源/执行层次压成“同source实际重建”

位置：[LM results.json:4964](/tmp/aimy-20261014-memory-ab-lm/results.json:4964)，`cases[case_id=LM08].comparison.limits` 当前为：

> Aions同正文/同source换topic实际重建；AIRI无per-fact delete/topic合同，unsupported；不能据此宣布一方完整删除更强。

单独读取这个机器摘要，会把主任务中的持久写回与副探针中的同自动来源内存重放混为一项“同自动来源持久任务复活”。实际证据分两层：

1. [aions-arm.py:145](/tmp/aimy-20261014-memory-ab-lm/aions-arm.py:145)主序列：初始事实通过原 `save_manual` 建立，来源是 `['manual']`；原删除后，待处理任务接受以U1为来源、换topic的候选并提交，最终来源为 `['private:U1']`。初始和最终来源**并不相同**。主任务确有提交，但不能写成初始自动private:U1事实被同源完整任务复活。
2. [aions-arm.py:91](/tmp/aimy-20261014-memory-ab-lm/aions-arm.py:91)自动同来源副探针：原任务先真存 `private:U1`，原manual删除保留tombstone原sources；原_context_for_job给U1，原_apply_analysis纯重放换topic后在**内存document**新建同 `private:U1`；`persisted_after_probe.snapshot.entries`仍为空，脚本没有重排已done的job，也没有将删后纯函数结果提交SQL。

建议派生比较摘要/最终正文明确两层，例如：

> 主序列中manual来源事实删后，原待处理U1任务按新topic提交相同正文；另自动private:U1来源副探针在纯_apply_analysis重放中允许同源新topic，但未提交SQL，持久快照仍为空。原删除规则有界缺口成立，不称完整自动同源任务已复活。

LM README第50–51行和观察内 `layer` 已正确披露这两层。这里需要补齐的是派生机器摘要的限定，不是撤销反例或调整原fail。若原结果已冻结，保留原字节并在最终报告/补注覆盖这条简称即可。

## 已核通过的重点边界

| 项目 | 复核结论 |
|---|---|
| 共同输入 | LM results逐case `fixture_input` 与冻结fixtures逐对象一致，SHA为`61b8c0b87067f9d349876f11217adcb82d321df795ddfec6e330e0f9caa14b61`。topic/content/sources未偷换。Aions补category=profile/state=null、U标签命名空间与秒时间，AIRI映射confirmedFacts/sourceTurnIndex，均明示。 |
| 不给AIRI补原生缺失 | airi-arm仅加载原types/merge/manager，相对import受限；没有持久库、来源登记、topic/current事实、per-fact delete、检索或tombstone注入。LM01/03/05/06/07/08均unsupported，未计零分；LM02精确去重和LM04轮次拒旧双方已有，不被算候选独有。 |
| Aions真实SQL与替身 | 原AST函数/SQL经stdlib async协议shim连接合成SQLite，原_call_model网络/JSON解析不运行，固定Analysis对象、配置/notify为替身。脚本未伪造SQL返回，未称原生FastAPI/aiosqlite服务启动。26项source/caller/script指纹当前全部匹配。 |
| LM01进程层次 | Aions child真实新Python PID读同库，无子进程seed/model写；AIRI真实新Node PID仅new原manager。结论是对应数据对象/原模块的恢复能力，不是等价整应用/Electron对照，也不代表聊天数据库丢失。 |
| LM07主序列 | baseline明确manual sources。原await中manual删除推进revision；原run_pending_once将旧结果pending，+31秒经原30秒retry后，同P1命中deleted拒写。自动同源副探针changed=false且无active，persisted_after为空。pass严格限定这些路径，没有扩成所有忘记。 |
| LM08副探针 | 自动初始private:U1与删除tombstone来源一致；同U1换topic纯_apply_analysis changed=true/内存active，持久快照仍空。说明纯规则按ref/topic保护不足，不能凭此外推已完成job如何重新进入生产调度。 |
| LM09错误语义 | 故意错误的固定候选有合法U1，两边写入接受。fail是确定性防线观察，不是实际LLM抽取精确率，也没有测试“小说否定会被模型正确理解”。 |
| LM10拒收不是摘要 | 原1504字候选在Aions原_entry每条600字校验被拒，job pending/error、事实0、context0；manual亦ValueError。pass仅上限靠拒绝，未验证保存价值/摘要质量。AIRI原manager输出1540字未被harness截短，fail限该模块输出，不外推provider最终预算。 |
| AIRI实际core范围 | TS真的导入createChatOrchestratorRuntime和conversationToChatMessages，session port为合成内存，context.snapshot为空，LLM只固定delta/finish。A/B原投影区别与C的32条history保留可从captures逐项核对。不能由该default-shaped装配推出全配置/插件无跨会话记忆；当前结果已明示。 |
| Compaction | 原函数对32 RawMessage不改；显式structured history-block保留5+`Compacted 27 older turns with paired reactions.`。这是generic count，不是事实摘要。当前生产源码定向搜索仅命中函数定义，无默认主chat调用证据；没有把此显式helper测试称桌面自动压缩。 |
| 真实browser driver | entry直接导出原chatSessionsRepo/storage，esbuild metafile含实际unstorage indexedb、idb-keyval；原storage把local/outbox挂真实IndexedDB driver。真实Ryza原JS被原字节复制。3原源码SHA与当前全部一致，无假Storage接口替代。 |
| 新page realm | write设置window marker，reload后marker不存在；同孤立origin的IDB/localStorage读到原数据。每次新Node控制进程不代表新浏览器OS进程；README/verification/results均明确false fullElectron/freshBrowserOS。 |
| browser删除对象 | deleteSession是整对话对象，LongTerm.remove是单条固定条目，原helper删除后索引未同步也已披露。新page仍为空只覆盖无在飞普通删除，不冒称逐事实遗忘同条件竞赛或完整UI删除通过。 |
| browser Ryza两反例 | LM03真consolidate接受固定更正后即时两条active；LM07在_llm Promise待返回时原remove成功，再原merge/persist写回，随后reload仍有1条。固定JSON不是模型语义，LM03后未另做独立fresh读取也没被误写成其fresh恢复证据；最终fresh属于LM07。 |
| origin/隔离 | 首次空数据断言，不通过清空真实库凑通过；server绑定127.0.0.1随机端口，CSP self/禁设备。模块只打包repo/storage及依赖，不装产品登录/同步/Provider/采集模块。TaskSpace和server关闭在verification记录，本次不重启或检查用户浏览器。 |

## 静态一致性核验结果

- fixtures hash冻结、全部10个LM fixture副本与原输入相同。
- LM source-manifest的20加载单元、3静态caller和3输出脚本，共26条SHA当前匹配；装配不等于所有函数分支实际执行，README亦明确invalidate_pending本批未触发。
- core结果5个来源SHA当前匹配；A/B/C providerMessages和compaction输出符合脚本原断言。
- browser manifest的3个原源SHA当前匹配；4份结果与各调用脚本写入字段/顺序一致。
- LM每项 `experience_stronger_proven=false`；未汇质量胜率。AIRI6 unsupported保留；观察层次不互换。

未重新执行LM、core、浏览器或数据库操作，未独立重验完整应用/设备/模型。本复核确认脚本和保存结果的可解释边界，不追加真实产品验收。
