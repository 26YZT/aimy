# REVIEW-PLAN-C 修复复核

2026-10-14（Asia/Shanghai）。只读复核修订后的正式包，未改仓库/产品、未调用浏览器/模型。原 `review-formal.md` 保留不变。

**结论：原6项意见全部关闭；本次修复范围未发现新增P0/P1。** 这是文档一致性与任务边界复核，不是代码实施或真实体验验收。

|原意见|状态|当前证据|
|---|---|---|
|P1-01 BASE about/onboarding路径|关闭|[08:22](/Users/mima1234/Documents/aimy/docs/05-实施手册/2026-10-14-Aimy增量开发交接包/08-开发任务与交接.md:22)已指实际renderer的about.vue/onboarding.vue；追溯矩阵BASE-01同步，两文件存在|
|P1-02 记忆来源ID与禁止ID冲突|关闭|[提取Prompt:7](/Users/mima1234/Documents/aimy/docs/05-实施手册/2026-10-14-Aimy增量开发交接包/prompts/03-自动记忆提取.txt:7)明确不得生成fact/database ID，但必须保留合法sourceMessageIds|
|P2-01 OLV可沉默归因|关闭|[01:17](/Users/mima1234/Documents/aimy/docs/05-实施手册/2026-10-14-Aimy增量开发交接包/01-能力选择与分期.md:17)改为候选提供触发来源分离等规则、Aimy另补可沉默策略|
|P2-02 emotion对象/白名单|关闭|[主动Prompt:2](/Users/mima1234/Documents/aimy/docs/05-实施手册/2026-10-14-Aimy增量开发交接包/prompts/04-主动陪伴决策.txt:2)加入allowedEmotionNames；第6行明确null或{name,intensity}、有限0..1、空白名单必须null；[06:12](/Users/mima1234/Documents/aimy/docs/05-实施手册/2026-10-14-Aimy增量开发交接包/06-Prompt与角色体验.md:12)与[04:84](/Users/mima1234/Documents/aimy/docs/05-实施手册/2026-10-14-Aimy增量开发交接包/04-API与事件契约.md:84)同步|
|P2-03 resolveRequest字段漂移|关闭|[04:50](/Users/mima1234/Documents/aimy/docs/05-实施手册/2026-10-14-Aimy增量开发交接包/04-API与事件契约.md:50)与接口目录同时返回projection、memoryRevision、memoryEpoch、validUntil、guardToken、factIds、sourceIds，明确Repo revision转换；末阶段guard重验和native上下文失效也标为拟定|
|P2-04 PRO实际路径|关闭|[08:132](/Users/mima1234/Documents/aimy/docs/05-实施手册/2026-10-14-Aimy增量开发交接包/08-开发任务与交接.md:132)列agent.ts/types.ts/plugins/reaction.ts及stage-ui host；JSON拆为4条完整实际路径，逐项存在；新增schema/测试保持拟新增|

补充核验：

- Prompt目录5项hash全部匹配当前正文；没有遗留旧hash。
- 接口目录17项、operation名称无重复；新增 `operation.get` 是只读回执查询，模型不可调用，scope核验、operationId或mutationId二选一，在[04:39](/Users/mima1234/Documents/aimy/docs/05-实施手册/2026-10-14-Aimy增量开发交接包/04-API与事件契约.md:39)与JSON同步，追溯矩阵已有引用。
- vision/proactive配置写命令补mutationId/expectedRevision及明确configurationRevision/policyRevision；幂等重试说明先查mutation身份再检查首提交revision，未制造新的来源权限。
- Spark完整决策后呈现、system不冒充user、取消不回滚外部副作用、正式角色/模型/预算待定、评测目标卡待确认的原边界仍保留。

建议状态：本次文档审查意见已消除，可以交付为**可评审的实施提案**；不能标记新能力已实现或真实模型/设备验收通过。
