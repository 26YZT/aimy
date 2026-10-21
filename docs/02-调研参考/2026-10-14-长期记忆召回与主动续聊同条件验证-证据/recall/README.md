# MEM-AB-RECALL：同条件证据选择与原上下文

2026-10-14。状态：固定合成语料下原代码/SQL/现有库离线执行完成，待独立复核；没有产品实施、真实模型答案或整体质量胜率结论。唯一写入 `/tmp/aimy-20261014-memory-ab-recall/`。不安装、不联网、不读真实模型配置/用户聊天/密钥、不启AIRI/候选服务、不调用设备；不重复存取/重启实验。

冻结输入：`/tmp/aimy-20261014-memory-ab/fixtures.json`，SHA256 `61b8c0b87067f9d349876f11217adcb82d321df795ddfec6e330e0f9caa14b61`。32同合成事实、10查询，Asia/Shanghai `2026-10-14T10:00:00+08:00`，无embedding。top5、1200字符为共同目标，但原接口不支持的参数保持unsupported。

后续人工gold补注：`/tmp/aimy-20261014-memory-ab/gold-adjudication.json`，SHA256 `47c98f5dfefbfaf2a7043d7ecd4afff3bf10d429b6c15c8c1333f9106c87c4b8`。**输入/原算法/三份raw结果不因裁定改写。** Q07询问约定是否有效，带“已取消”及历史来源的R09是相关证据，不能因原forbidden就说记忆复活/回答错误；Q03旧偏好若明确历史，也不自动等于当前事实错误。模型是否理解、历史是否被升级为active均未测试。部分同日记录12:00晚于clock10:00，本轮不评未来写入防护。

## 先看结果

- [comparison.md](comparison.md)：10查询两臂的原ID/顺序并列，AIRI不支持原生查询不造排行榜。
- [results.json](results.json)：50条观察（AH20、Ryza20、AIRI10），每项保留raw结果与原gold、并列裁定、配置unsupported、理解inconclusive；不是50功能或质量通过率。
- 原始结果：[aions-results.json](aions-results.json)、[ryza-results.json](ryza-results.json)、[airi-results.json](airi-results.json)。保留原ctx全文、ID/顺序、Unicode字符与UTF16单位、hit reasons/scores、无关/retired/forbidden及异常。
- [source-manifest.json](source-manifest.json)：原源码SHA、实际执行符号/行、只读caller锚点和装配范围；23个来源文件当前hash不变。

## 实际执行与公平条件

| 对象 | 真代码/库 | 假边界/转换 | 原生接口限制 |
|---|---|---|---|
| AionsHome | 原AST MemorySearchRequest/parser、actor_memory_query→真SQLite SELECT→search_actor_memories→rank→format；fallback历史SQL、原lineage resolver及源消息读取 | stdlib async SQLite协议shim连接独立合成文件；get_embedding恒None；chatroom显示名常量。32同content/keywords/源ID/epoch，importance除5单调转0.2–1.0；不预筛状态、排序或改rank | 固定MAX_RESULTS10，没有5参数；format固定2500/4000/8000上限，没有1200参数。原生不支持即unsupported，绝不后截断 |
| Ryza | 整个原longterm.js，原restore/normEntry/_score/_select/promptBlock | localStorage用Map，仅存取边界；固定原setClock。原1–5importance/date/status/keywords/summary不改；源消息ID不是原entry字段，丢失明确登记 | _select(cue,5)原生支持，promptBlock固定12不支持5；无1200参数。本批原prompt均411字符，不证明最坏预算保证 |
| AIRI默认链 | 原buildContext AST函数、runtime context追加原片段、原chatMessagesToTurns/conversationToChatMessages；原context store/registry/runtimePrompt，实际Vue/Pinia/nanoid | 同32facts表示为合成同session user history；合成system/runtime文案、fixed now、identity unwrap。仅原组装片段及实际序列化，不启动完整runtime/LLM或加载聊天库 | 已核节点无原生topK/关键词/日期查询，selected IDs=null、unsupported。全部history含目标不是召回成功或最终回答正确 |
| AIRI相邻task-memory/notebook | 原manager.update/toContextString和原notebook.addNote，实际Vue/Pinia | 相同32content；task source是整批turn，notebookmetadata保存fixture字段；不新增query/落盘/默认注入 | task-memory只保留尾部10条并全量格式化；notebook有32notes但无该store的查询/prompt方法。不是默认桌面事实组件 |

AH真实数据库里的32个原文消息只为fallback/来源读取：冷档记忆与其历史原文分别保留，不能在harness预删旧原文来帮助某方通过。`source_start_ts/end_ts/created_at`原epoch不变，所有文本与否定词不改。没有vector/gold编码向量。

两臂并列：

1. **原文臂**：AH原parser接 `[MEMORY_SEARCH:原查询文本]`；Ryza cue就是原query文本。没有暗加date参数。
2. **受控命令臂**：AH原parser接fixture给定keywords/date_text；Ryza接这些字段的字面cue（“昨天”仍是“昨天”，未替它转ISO）。这是控制路由输出/接口能力，不是实际模型能否从自然语言提条件的准确率实验。两方API本就不等价，不能合成公平优胜分。

AIRI没有可比query结构，只有同输入的原上下文与相邻保留规则观察；没有给它造一个空排名/零分检索器。

## 关键观察及裁决

1. **AH显式日期能力存在，但输出政策容许同日背景。** Q01控制命令取到R01，却另带R06/R11/R16/R24/R32共6项；Q02取到R02，又带R07/R17/R25。这些非主题项原回执标“关联背景”，是 `date_matched` 进入可靠候选的现政策，不能宣称严格topic召回更强，也不把这称违反其自身原合同。必含目标pass、严格主题纯度fail分开；Q01超共同5目标且原生不可配，不能偷偷截为5。
2. **原文日期不等于结构化date输入。** AH原文Q01/Q02没有date字段，原rank同时给面试R02/R01/R03；控制臂才使用原相对/ISO时间窗口。Ryza对ISO是score+4、相对cue给所有条目+1；不是时间过滤。
3. **无关/同义边界实际跑出。** AH Q06火星查询空；Q05海岸同义没有海边R07。Ryza Q05/Q06仍按importance给R06/R08/R02/R05/R10，没阈值拒回；这是补充背景选择器设计，不是严格问答检索器。不能从这批合成数据宣称真人体验优劣。
4. **Q07必须用补注解释。** AH控制关键词灯塔先经原SQL排除冷档R09，再fallback历史SQL取到带“已取消”的private:U-R09与原文来源；这对问题是相关的历史否定证据。原gold自动fail不适用于最终结论。没有active写入/复活，也没测模型是否答已取消。Ryza排retired但补了其他背景，旧forbidden通过不等于问题证据完整。
5. **小说来源只测取到证据。** Q09两边都能把R10提升到前列，原文含“小说人物/本人不叫张三”；不能由此给模型理解正例通过。
6. **非法日期保持原异常。** AH控制Q10原_parse_date抛ValueError，未默默归一化；来源route确有异常转搜索失败文本的caller，本包未运行整route，不称服务崩溃。Ryza没有该日期解析API，仍选择其他面试背景；理解/拒绝结果未测。
7. **预算不能借短样本外推。** AH本批成功回执92–494字符，Ryza原prompt411字符；都未改原参数。样本under1200不是保证1200。AIRI整history投影约1344字符是整prompt而非同一个memory-only block，不能拿这个不同口径当成本胜负。
8. **AIRI默认历史和相邻记忆必须分开。** 同32输入原task-memory只留R23–R32，对十查询格式不变；notebook存32notes但已核default chat context没有自动读notes。原默认组装片段保留32history；unsupported不计零分。

主agent独立补的更完整默认runtime佐证：`/tmp/aimy-20261014-memory-ab/airi-default-context-results.json`，SHA256 `58802d59ab74aa5189e59adbdb9c257a1def481d3226f7eabdbf70995f98e248`。实际orchestrator+conversationToChatMessages、合成session port/empty context/固定假LLM：同session含旧咖啡原文、新session未导入、同32history/Q06全部原文入请求。原compaction对32 RawMessage不变；显式structured history-block可以留5条+generic count summary，不能称默认桌面自动事实压缩。本包仅引用其原结果和范围，未重复该实验。

## 可采用到哪一层

可继续研究的是：AH原日期/词法/来源回执小规则，以及明确区分当前事实和历史证据的查询合同；Ryza active状态/关键词与日期加权规则可作可解释基线。不能原样复制任何一套作为“严格top5、1200字符、无关拒回且语义准确”的成品。AIRI原有history/context/typed merge限额与轮次guard继续优先，确实没有对应原生接口的部分再有界补充；不启computer-use服务。

还没验证：自然语言/模型路由、embedding语义召回、抽取/回答正确率、长期使用/自然主动、费用/延迟/真实界面体验。这个包不处理记忆写入/续聊调度和浏览器持久化；它们由主agent其他同条件分支负责。

## 重跑与证据状态

```sh
python3 -B /tmp/aimy-20261014-memory-ab-recall/aions-recall.py
node /tmp/aimy-20261014-memory-ab-recall/ryza-airi-recall.cjs
python3 -B /tmp/aimy-20261014-memory-ab-recall/adjudicate-and-package.py
```

前两条只写本tmp，AH会重建它自己的合成SQLite和raw结果；复核时先保存原字节，不对旧raw覆写后冒称初次结果。第三条只读取raw+人工gold生成并列裁定，不执行候选。实际Node24.20.0、TypeScript6.0.3、Vue3.5.41、Pinia4.0.3；Python/SQLite版本与来源细节在results。

原代码只AST抽取/TS转译和显式模块重导出绑定；没有用harness筛选候选、改常量、排序后装箱或造召回函数。脚本装配和产品合同通过分开：原始fail/unsupported保留，不能因为脚本exit0就说召回全部通过。
