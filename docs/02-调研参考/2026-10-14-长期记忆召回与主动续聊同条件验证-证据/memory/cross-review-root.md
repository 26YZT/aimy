# 只读交叉复核：主 agent 的真实浏览器 / AIRI core 证据

日期：2026-10-14。只读取既有 JSON、README、装配和控制脚本；没有重跑浏览器/core、修改其他目录或读取用户数据库。

**结论：未发现需要阻断汇总的事实歪曲。当前材料对数据对象、执行层次和替身的限制是准确的。** 以下边界须随正式汇总保留。

已读：`/tmp/aimy-20261014-memory-ab-browser/` 的 write-immediate-read、fresh-page-read、delete-fresh-page-read、ryza-fact-counterexamples 四 JSON，README/entry/source-manifest/verification、browser-reload 和 browser-ryza-facts 脚本；`/tmp/aimy-20261014-memory-ab/airi-default-context.ts` 与结果中的 A/B 请求、observations、真假边界、sourceHashes。较大 C corpus/capture/compaction 数组用程序核数量、内容及结构，并未把打印或遍历数组称源码全文阅读。原 core 结果列出的 5 份来源 SHA256 与当前文件一致。

1. **恢复层次正确。** 原 chatSessionsRepo+原 unstorage IndexedDB driver 与真实 Ryza localStorage 经页面 reload 能读回相同记录；脚本检查旧 realm marker 不存在。它是同 origin、同浏览器进程内新页面 JS realm，不是新浏览器 OS 进程或 Electron 完整重启。每次新的 Node 控制进程也不能偷换为新浏览器进程。
2. **LM01 对象不同。** 浏览器 AIRI 项是用户聊天原文；Ryza 项是固定候选形成的长期条目。本 LM 包的新 Python 进程画像和新 Node manager 是另两个数据对象/启动层次。AIRI manager 空不能否定 IndexedDB 聊天恢复成功；聊天恢复也不能代替自动当前事实/逐条来源/纠正删除闭环。
3. **无并发 helper 删除只证明相应记录删除。** `delete-fresh-page-read.json` 的聊天 null、Ryza [] 与新 realm 一致；已标明 session index metadata 没一起改，不能称完整 UI 会话删除验收。此案没有在飞生成，也不证明 per-fact semantic delete barrier。
4. **Ryza 反例是真 native path、不是持久层 mock。** 脚本调用原 LongTerm.add/note/consolidate/remove，固定 LLM Promise 在删除后才 resolve；原条目重新出现且 reload 后仍有 1 条。LM03 两个 active 偏好也有原输出。它们证明所测 native merge/异步删除边界失败，不证明真实模型一定输出旧事实或抽取质量差；正式结果的 `semantic_model_tested=false` 正确。
5. **实际 core 投影边界正确。** A 有旧咖啡原文，B 没有；装配明确是合成 in-memory session port、空 context、没有额外 memory provider、固定 LLM stream，原 orchestrator 与 provider projection 真执行。CTX02 只能写该装配/已核默认形态不跨 session 引入，不能由此证明所有 AIRI 配置/集成无跨会话能力，也不能称真实生成回答正确或错误。
6. **C 历史不是检索分数。** 32 条历史在实际 C 请求里出现，证明 history inclusion；不能把其中含 gold 内容当相关事实 top5 召回，更不能拿无关历史存在直接记模型答错。CTX03 标 unsupported 和假 LLM 未理解限制准确。
7. **compaction 不等于事实保留。** 原函数不处理普通 raw entries、对显式 history-block 保留 5 turns + 通用计数摘要，是该函数的合同；没有供应领域摘要 formatter，不能推广为默认桌面持续摘要或长期事实质量。CAP01/02 已保留对应范围限制。

不要求补跑或修改已冻结原结果。正式汇总可把真实存储、core 消费、新 OS 进程与纯规则分别作为证据列，避免合成单一“重启通过率”或产品优胜榜。
