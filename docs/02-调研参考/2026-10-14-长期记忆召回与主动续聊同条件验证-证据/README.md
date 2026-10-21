# 长期记忆、召回与续聊的同条件离线证据

日期：2026-10-14。状态：原模块/SQL/真实浏览器存储研究交付；未实施产品、未调用真实模型、未验真实体验优胜。用户已选择“先完成离线同条件对照”。所有数据是合成数据。

入口：[大白话裁决与开发顺序](../2026-10-14-长期记忆召回与主动续聊同条件验证.md)、[机器裁决](../2026-10-14-长期记忆召回与主动续聊同条件验证.json)。

| 证据组 | 输入与原结果 | 范围 |
|---|---|---|
| 共同协议 | [协议](protocol/fixture-spec.md)、[冻结输入](protocol/fixtures.json)、[人工gold补注](protocol/gold-adjudication.json) | 10记忆、同32记录/10查询、10续聊场景；固定时钟/模型输出、无embedding。补注不改原输入或raw结果 |
| 长期记忆 | [README](memory/README.md)、[10合同双臂](memory/results.json)、[脚本](memory/run.py) | 原任务/SQL、新Python进程、原AIRI manager/新Node进程；unsupported不打零分，manual主序列与自动同源叶子分开 |
| 召回 | [README](recall/README.md)、[逐查询表](recall/comparison.md)、[原输出与裁定](recall/results.json) | 原文与受控路由两臂；真实SQL和原排序，AIRI原生query unsupported；未评分模型理解 |
| 主动续聊 | [README](proactive/README.md)、[10合同双臂](proactive/results.json)、[背景生产补证](proactive/PR09-surfacing-supplement.json) | 到原保存/广播或character/Speech记录边缘；原PR09仍inconclusive，背景producer/组装不等于后台发言 |
| 真实浏览器存储 | [README](browser/README.md)、[核验](browser/verification.json)、[迟到复活反例](browser/ryza-fact-counterexamples.json) | 真实IndexedDB/localStorage；同浏览器进程新页面realm，不是Electron或浏览器OS重启 |
| 默认请求与压缩 | [原core实跑结果](protocol/airi-default-context-results.json)、[脚本](protocol/airi-default-context.ts) | 实际orchestrator/序列化+合成session/空额外context；历史包含答案不是召回；结构化计数摘要不是事实仓 |

[原字节映射](原字节映射.json)保留每份来源脚本、结果、日志与合成库副本的SHA256；[交付核验](交付核验.json)检查冻结输入、复制字节、来源指纹、当前55条/14需求/15任务/17API/5Prompt、入口链接、旧证据、产品文件和Git暂存。

重跑遵循各原README，所有绝对tmp路径是初次执行环境，不能替换为用户库/真实配置/已有浏览器origin。先复制初次raw字节再重跑；新PID/随机ID可变，不期待整份结果字节相同。浏览器空间53与本实验server均已关闭。这里保留的PR09 SQLite只含32条冻结合成记录。

旧阶段的38份相邻证据、39份功能证据、28份Claude恢复/原报告均保留原字节；原Q07 gold、原PR09 inconclusive和复核发现的LM08摘要问题都有单独修正/补注，不重写旧raw制造历史通过。

独立复核：[记忆/召回/浏览器与报告](recall/review-formal.md)、[主动续聊与背景补证](proactive/review-formal.md)。前者附closure保留发现与修正过程；无未关闭的本审事实问题。两个review中读取时的62项映射是当时快照；后增合成库、review与[交付核验脚本](protocol/delivery-qa.py)的最终数量和SHA以交付核验为准。
