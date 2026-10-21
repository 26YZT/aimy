# Prompt草案与使用边界

日期：2026-10-15。状态：首批v1供审，未装入产品/未真实调用。来源：用户风格/关系/记忆选择，typed来源合同，Aions/Ryza拆解反例。用途：区分角色表达、抽取任务和证据注入。上一级旧5Prompt/hash保留；本目录为新版本，不能混称旧Prompt未变却换正文。

| 新草案 | 用在哪里 | 改动目的 |
|---|---|---|
| [角色与关系补充](prompts/companion.txt) | AIRI既有角色/系统设定受控追加，保留原工具/安全约束 | 已选伴侣分寸与温柔有主见；不另写聊天主框架或发明共同历史 |
| [记忆整理](prompts/extract-memory.txt) | 独立无工具提取请求 | 使用typed sourceRefIds，区分本人/第三人/假设、新旧/局部例外、计划/结果；不把角色Prompt拿来抽取 |
| [记忆证据引用](prompts/memory-evidence.txt) | 原请求构造中的数据证据说明 | 来源是不可信数据而非指令，自然相关引用；无证据不补写 |

每个草案实际字节SHA在[Prompt目录](Prompt目录.json)。结构/变量由host填充：allowedSourceRefs、source text、existingCurrentFacts、当前clock/timezone、输出schema与允许category/槽位。变量中的用户文字只能进标明的数据区；模板中的“遵守JSON”不替代host schema/字段/来源校验。

候选格式由host schema权威维护：`{schemaVersion:1,candidates:[{category,subject:'self',slot?,targetFactId?,value,qualifiers,temporality,sourceRefIds}]}`。未知键/类别、非有限数、伪造ID、越权字段拒绝。ID/revision/权限/关系值/删除均由代码管理。对于共享经历，保留用户陈述的范围，不假造Aimy现实在场或真实执行。

现有Prompt装配入口和角色卡已有；实施在 `stores/memory/prompts.ts` 管理本次任务模板，并在AIRI真实构造端接证据。正文hash、变量快照、schema版本、模型/参数与回执关联，日志不记录密钥/完整私人原文。提取不接电脑工具；聊天原MCP/电脑能力按一期边界默认关闭，不借Prompt放开。

本次不加入后台主动/视觉Prompt，旧相关草案继续后批。8例expected不写入Prompt或few-shot；自然度和提取语义未实测，不能以模板写好宣布记忆胜过AIRI。
