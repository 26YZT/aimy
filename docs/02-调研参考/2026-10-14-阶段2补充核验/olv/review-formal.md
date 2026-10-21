# REVIEW-PLAN-C：正式增量交接包只读独立审查

2026-10-14（Asia/Shanghai）。范围：01/02/04/06/07/08/09、4份JSON、5份Prompt正文；为核对Spark约束另读03的相关章节。未改仓库、未运行产品/浏览器/模型。以下按P0/P1/P2给具体意见；当前发现0项P0、2项P1、4项P2。

## P1：交接执行前需要修正

### P1-01 · BASE-01 的 about / onboarding 允许路径不存在

位置：[08:22](/Users/mima1234/Documents/aimy/docs/05-实施手册/2026-10-14-Aimy增量开发交接包/08-开发任务与交接.md:22)（22–23）及追溯矩阵 `tasks[BASE-01].allowed_future_paths`。

写的是 `packages/stage-pages/src/pages/about/`、`packages/stage-pages/src/pages/onboarding/`。当前两个目录都不存在；真正页面为 [about.vue](/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/renderer/pages/about.vue:1) 和 [onboarding.vue](/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/renderer/pages/onboarding.vue:1)。执行AI遵守allowlist时无法收尾页面字符串，或会误建第二套页面。

建议：替换成两条真实renderer路径，同步JSON；`main/windows/`可以保留。memory拟新增目录不存在属于已标明/依赖前序创建的正常情况，不应与此混为缺陷。

### P1-02 · 记忆Prompt要求来源IDs，同时又禁止输出ID

位置：[prompts/03:6](/Users/mima1234/Documents/aimy/docs/05-实施手册/2026-10-14-Aimy增量开发交接包/prompts/03-自动记忆提取.txt:6)（6–7）。

第6/7行要求 `sourceMessageIds`，第7行末又说“不输出…ID…”。这会让模型把必须保留的来源ID也当成禁输字段，造成来源校验失败、漏写记忆或执行AI放宽来源校验。

建议明确为：“sourceMessageIds必须保留输入中的原ID；不得生成factId/databaseId、owner、epoch、权限字段或数据库命令。”与 [04:51](/Users/mima1234/Documents/aimy/docs/05-实施手册/2026-10-14-Aimy增量开发交接包/04-API与事件契约.md:51)一致。修改后更新Prompt目录hash，并用一条有合法source ID的离线schema样例检查，不需调用真实模型。

## P2：建议同步消歧

### P2-01 · OLV比较行把“可沉默”归因给了候选实际能力

位置：[01:17](/Users/mima1234/Documents/aimy/docs/05-实施手册/2026-10-14-Aimy增量开发交接包/01-能力选择与分期.md:17)的Open-LLM-VTuber比较行。

OLV固定版本主动Prompt只要求说合适内容，缺失时回退“Please say something.”，没有say/silence决策协议；“允许沉默”是Aimy规划和AIRI Spark现有基础上的策略要求。当前写法“候选更值得借的地方：主动消息可以沉默”会被误读成OLV已提供此实现。

建议改为“系统触发与真实用户消息分离；显示/朗读/动作分工与模块Prompt；Aimy主动策略另补可沉默”。证据：[OLV proactive Prompt:1](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/prompts/utils/proactive_speak_prompt.txt:1)、[conversation_handler.py:35](/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/src/open_llm_vtuber/conversations/conversation_handler.py:35)（35–55）。

### P2-02 · 主动emotion的对象形状与白名单输入仍需写成精确协议

位置：[prompts/04:6](/Users/mima1234/Documents/aimy/docs/05-实施手册/2026-10-14-Aimy增量开发交接包/prompts/04-主动陪伴决策.txt:6)、[04:83](/Users/mima1234/Documents/aimy/docs/05-实施手册/2026-10-14-Aimy增量开发交接包/04-API与事件契约.md:83)、[06:12](/Users/mima1234/Documents/aimy/docs/05-实施手册/2026-10-14-Aimy增量开发交接包/06-Prompt与角色体验.md:12)。

当前say示例只有emotion=null，文字说“合法标签与强度”，没有明确`name/intensity`字段结构与模型如何拿到白名单；Prompt列的变量仅authorizedContext/memorySnapshot。执行AI可能实现成字符串、`label/strength`等不一致结构。

建议在04/Prompt写死`emotion=null | {name:<host-provided allowedEmotionNames>,intensity:<finite 0..1>}`，增加明确白名单变量或说明沿用AIRI runtimePrompt情绪清单注入位置。无法支持动作的资产可用空白名单/强制null。不能让模型自行推断任意renderer能力。更新Prompt hash。

### P2-03 · memory.resolveRequest返回字段名在文字与机器目录不同

位置：[04:49](/Users/mima1234/Documents/aimy/docs/05-实施手册/2026-10-14-Aimy增量开发交接包/04-API与事件契约.md:49)与[接口目录:178](/Users/mima1234/Documents/aimy/docs/05-实施手册/2026-10-14-Aimy增量开发交接包/接口目录.json:178) `operations[memory.resolveRequest].result_fields`。

文字返回 `memoryRevision`，JSON返回 `revision`。同一文档其它上下文也以memoryRevision绑定失效。未来前后端按不同规范实现会读到undefined并错判版本。

建议选一个公共DTO字段名并同时同步文字/JSON/示例/任务验收；内部Repo revision与对外memoryRevision可不同，但必须明确转换，不能靠读者推测。

### P2-04 · PRO-01路径主目录正确，但policy/sink占位描述宜收成真实文件

位置：[08:132](/Users/mima1234/Documents/aimy/docs/05-实施手册/2026-10-14-Aimy增量开发交接包/08-开发任务与交接.md:132)及JSON同条。

现在`packages/core-agent/src/agents/spark-notify/`是正确实际路径；但后缀“实际agent/types/policy/sink”不是文件，现有policy就在agent.ts，实际reaction插件在plugins/reaction.ts，host sink另在stage-ui。为“一读就能开工”的交接精度，建议列`agent.ts`、`types.ts`、`plugins/reaction.ts`与 [stage-ui host sink](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/mods/api/spark-notify-reaction.ts:1)，新策略/schema/test注明拟新增；不要误建第二套policy/sink目录。

## 已确认无需改动的关键点

- 原裁决JSON57个ID与能力选择57项**集合完全一致、无重复**；每项都有选择理由/边界/验收，implementation_status全部“未实施”，未把候选接入当事实。
- 选择统计4沿用/21本期适配/7条件实验/11后置/14不纳入，合计57；本期不整体搬候选runtime，Charakuru只作生产侧条件候选、Chromatic沿用现有依赖，kirara后置IM/工作流理由成立。
- 任务15、需求14、API操作16；任务依赖、task→requirement、requirement→API引用均无悬空。VOICE-02为条件节点，不阻塞INT-01，主整合入口唯一。
- 5份Prompt SHA与Prompt目录一致；真实user/assistant/system-trigger来源区分明确，自动保存不新增逐条确认；记忆候选不得自定owner/epoch/关系值。
- 03/04/06/08均明确Spark先资格、完整say/silence验证后呈现，禁止command/tool并贯穿signal；没有把forceTextResponse当沉默策略，没有忽略先text后no-response的sink问题。
- 04明确取消不能撤回已执行外部工具副作用，本期不开放电脑操作/外发/支付；远端取消/计费状态如实记录。
- 正式角色格式、模型/ASR/TTS/音色、预算和主观阈值保留未决；标准Charakuru结构通过不当丰富面部能力验收；没有新增VRM唯一路线结论。
- 07/09明确当前真实模型/设备0调用、目标卡待确认、cases/rubric/排名未冻结；130原回归与隔离缺陷复现不算新产品通过。阶段约束与文档完成不混淆。

本审查不替代未来真实模型、设备、权限/删除/恢复与用户体验验收。建议先修两个P1和协议消歧，再将该包作为可评审实施提案交付。
