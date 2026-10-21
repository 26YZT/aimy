# 只读复核：召回两臂/Q07补注与主汇总草稿

日期：2026-10-14。范围：`/tmp/aimy-20261014-memory-ab-recall/README.md`、`comparison.md`、派生 `results.json` 的两臂/来源/日期/Q07裁定；相应原 raw 观察、装配脚本及相关当前源码；root `report-draft.md` 的 §§1–4、6–7。没有重跑召回/浏览器/core/LM，也没有修改冻结 raw。

**结论：本次范围未发现 P0/P1 阻断问题，原结果、接口不等价与结论限制一致，可用于正式汇总。** proactive §5 与最终链接仍是明确待补的草稿占位，不在本次通过范围，不把草稿视为全部已交付。

## LM08 修正已闭合

`results.json` 的 LM08 comparison.limits 和 `run.py` 对应文本已精确改为：

> 主任务manual来源事实删后，新U1候选改topic被提交；自动private:U1同源副探针只在内存新建、未SQL commit。

不再把 manual 主序列与自动同源纯函数副探针合并为“同 source 实际持久重建”。原 `aions-results.json`、`airi-results.json` 未改；派生 results 中每例 arms 对象与两份原结果逐对象相等。按 root 后续明确授权，已同步 `source-manifest.json` 中 `run.py` 的新 SHA256，并记录“review文字收窄、无重跑/raw未变”；来源与原结果的指纹未改。

run.py 新 SHA256：`0dfa19f96c2d2886b951f7e8420cc2975655aed6ed2f1315e115171171af2060`。

## 召回复核要点

1. **两臂/时间字段分开正确。** AH 原文臂把完整问题放入原命令，Q01/Q02 requests.date_text 为空；控制臂才分别填写“昨天”/“2026-10-12”。Ryza 接原文或 fixture keyword/date 的字面 cue，没有 harness 帮它把相对日期转 ISO，也没有真实模型路由。文档没有把控制命令正确当中文解析正确。
2. **原日期政策描述准确。** 当前 AH `rank_memory_rows` 允许 date_matched 成为可靠候选，含同日非主题背景；控制 Q01 真输出 R01/R06/R11/R16/R24/R32 六项，Q02 真输出 R02/R07/R17/R25。必含目标与严格主题纯度分列，不以该背景政策泛称算法错误或整体更准。Ryza 原 score 的 ISO 命中 +4、RECENT_CUE 对各 live 条目 +1，不是日期窗口过滤，报告一致。
3. **source/历史 fallback 没有被误判删除复活。** Q07 控制臂 native_result_id=`private:U-R09`，原 SQL 先查 active 摘要，随后原 history SQL 查到“灯塔散步计划已经取消，不应当作当前约定”，原回执明确标“以下仅为历史证据”并保留同原文 source。没有 active 写入或模型答案发生。
4. **Q07补注正确且 raw 原字节不变。** 人工 gold 把 R09 区分为相关历史取消证据、不得升级的当前约定；派生结果保留 original_frozen_gold 与原 fail，另记录控制臂 required evidence/strict topical pass、语义和 active promotion inconclusive。原文臂没有 R09，仍 fail。comparison/README/root §4 均按这一层次写；没有通过改 fixture/raw 来凑结果。
5. **Q03/Q09没有语义得分偷换。** 旧咖啡若标历史不自动是当前事实错误；小说/本人否定原文被选到不等于模型理解通过。所有 answer_semantics 仍 inconclusive，本轮没有真实答案评分。
6. **参数/预算限制没有被填平。** AH 原 MAX_RESULTS=10，无 per-call5；Ryza `_select(cue,5)` 可调，但原 promptBlock 仍12。AH短输出92–494、Ryza411字符只是本样本，原接口没有1200预算参数；AIRI约1344是整 history/runtime prompt，未拿来与 memory-only block 判费用胜负。
7. **无关、同义、异常观察一致。** AH Q06为空、Q05未命中海边；Ryza Q05/Q06原 selector 返回背景。AH 控制 Q10 ValueError、原文 Q10只是普通词法命中；资料明确上层 route 有搜索失败处理但本包未启动，没有泛称整个服务崩溃。Ryza没有同日期解析合同，不把其背景返回叫合法日期验证。
8. **AIRI基线不冒造检索器。** 10条 AIRI 原 query contract 保持 unsupported，selected IDs=null；32历史包含 gold 只是诊断。相邻 task-memory 保留 R23–R32且不随 query 变；notebook能存 notes但不自动注入已核默认链。原组装片段、主 agent 更完整 core 实跑和真实浏览器存取是不同证据列，限制均保留。
9. **固定输入和来源指纹一致。** fixture仍 SHA `61b8c0…14b61`，gold补注为 `47c98f…7c4b8`。results 中三份 raw_result_integrity 当前 hash 均匹配；source-manifest 是51装配/静态单元、23唯一来源路径，23文件当前 hash 均匹配，未把装配数当全文或产品能力数。

## root 草稿 §§1–4、6–7

- 正确保留 AIRI 聊天持久化、同 session 历史、去重/旧轮次和主动基础；缺口限定持久当前事实/逐条来源/管理闭环，没有称 AIRI 无 memory 或聊天丢失。
- LM07/08 主任务 manual 与自动来源副探针、LM09固定错误模型、LM10硬拒绝而非压缩均已写清，与本批原结果一致。
- “机制更完整”限定已核具体模块，后文保留删除绕过/语义错误，不外推整体产品更强。Q07历史取消证据、同日未来时间合成限制、memory-only与整prompt口径均有说明。
- 原 core 的新 session 无旧事实被明确限定为合成 session port/空额外context/未附memory provider，不推广全仓/全配置无跨会话能力；structured compaction也没有冒充默认事实摘要。
- 分阶段顺序先既有生命周期/本地边界，再事实权威/来源/删除、证据召回、持久主动、真实模型体验；是未来建议与门槛，不是本轮实施或已过端到端验收。没有扩大一期 API/任务数量或增加第二运行时。

无需为了本次只读复核重跑或改冻结原结果。待 proactive 和正式链接闭合后，由 root 对完整最终包再作状态/导航检查。
