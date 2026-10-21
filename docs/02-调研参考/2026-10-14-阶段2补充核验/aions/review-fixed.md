# REVIEW-PLAN-A 修复复核

日期：2026-10-14。只读复核正式交接包03/04/07/08及接口目录/追溯矩阵；保留原review-formal.md，不改repo。

**结论：原1项P1、2项P2均已在规划文档层闭合；本次未发现新的P1。可作为技术提案交付，不代表对应产品实现或真实验收已经完成。**

| 原问题 | 当前修复证据 | 结论 |
|---|---|---|
| P1 native continuation遗漏 | 03:106明确本地native continuation/providerTranscript/generationTranscript失效、opaque未知lineage保守作废、contextEpoch=memoryEpoch与portable回退；04:50给memoryEpoch/validUntil/guardToken并在最终发送前重验；07 ENG-10与08:237、243加入Chat Completions/Responses实际payload负例和真实允许路径；JSON同步 | 已闭合 |
| P2 PARTIAL_DELETE幂等/恢复协议缺失 | 03:104及04:29明确不可变barrierReceipt+可变cleanupState、先幂等后expectedRevision、同mutation仅恢复同cleanup job；04:39与接口JSON新增operation.get；07 ENG-11/08:243加入最终状态可查询且屏障不重复提交 | 已闭合 |
| P2 所有任务被VOICE-02条件阻塞 | 追溯JSON其他14任务为等待自身依赖，仅VOICE-02有condition和条件实验状态；08保留VOICE-02非基本整合阻断节点 | 已闭合 |

补充原非阻断建议：memory.resolveRequest现在显式返回memoryRevision、memoryEpoch、validUntil、guardToken，与03的实际调用前guard方向一致。CAS冲突返回旧对象并由外层返回CONFLICT的设计仍可成立；本轮无需改成与离线脚本相同的throw实现。

机器核对：17个接口、17唯一名称；15任务、仅1条件字段（VOICE-02）；SRC-01/MEM-03允许区含request-context.ts与对应native处理验收。JSON解析成功，接口/任务修复相互对应。

本次审阅版本SHA256：

- 03-技术设计.md：adce0a112df1b9f4ab4119db5074157935f807b71c0d278371fc50207e36081b
- 04-API与事件契约.md：228d9ee65f1459625cf1d99bf84085e52069e556dc0c3b5a1626583e76fdd2d4
- 07-验证与AI评测计划.md：6d7c9df95b85fd0d17170a22f58da0ec2de6465eb170a7385b6666b304263975
- 08-开发任务与交接.md：6a4c3c0467e38afdeb7cb8ba48c6bd299d624865947df7accd7082b1c79d216b
- 接口目录.json：fe14d1ad44331c0b877bd59c749405a80afab5038297e3bcf0bf745543e2050a
- 追溯矩阵.json：3bb8200d44e0e06ffd9b315cf5f9d0babca7d1a8926b00ba7bc272ebc71d18b4

没有重新运行真实IndexedDB/模型/设备，没有产品源码修改。这里关闭的是规划交接缺口，后续工程仍须按新列的负例提供证据。
