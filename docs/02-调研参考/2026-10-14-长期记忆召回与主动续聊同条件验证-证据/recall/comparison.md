# 同32条事实/10查询的证据选择对照

冻结fixture SHA256: `61b8c0b87067f9d349876f11217adcb82d321df795ddfec6e330e0f9caa14b61`。裁定补注SHA256: `47c98f5dfefbfaf2a7043d7ecd4afff3bf10d429b6c15c8c1333f9106c87c4b8`。raw结果原字节不变。

两臂必须分列；下表不是模型正确率或产品胜率。AH的结构化路由是fixture给定条件，不是验证语言理解。

| 查询 | 裁定相关 | AH原文命令输出 | AH控制命令输出 | Ryza原文top5 | Ryza控制cue top5 | AIRI原生查询 |
|---|---|---|---|---|---|---|
| Q01 昨天的面试问了什么 | R01 | R02,R01,R03 | R01,R06,R11,R16,R24,R32 | R02,R01,R03,R06,R08 | R02,R01,R03,R06,R08 | unsupported |
| Q02 2026-10-12 面试 | R02 | R02,R01,R03 | R02,R07,R17,R25 | R02,R01,R07,R17,R25 | R02,R01,R07,R17,R25 | unsupported |
| Q03 现在喜欢喝什么饮料 | R05 | R05 | R05 | R05,R06,R08,R02,R10 | R05,R06,R08,R02,R10 | unsupported |
| Q04 星露谷 游戏约定 | R06 | R06 | R06 | R06,R08,R02,R05,R10 | R06,R08,R02,R05,R10 | unsupported |
| Q05 去海岸走走时找到的东西 | R07 | 空 | 空 | R06,R08,R02,R05,R10 | R06,R08,R02,R05,R10 | unsupported |
| Q06 火星采矿基地地址 | 空 | 空 | 空 | R06,R08,R02,R05,R10 | R06,R08,R02,R05,R10 | unsupported |
| Q07 灯塔散步约定还有效吗 | R09 | R06,R07 | R09 | R06,R07,R08,R02,R05 | R06,R08,R02,R05,R10 | unsupported |
| Q08 Aimy的记忆项目 | R08 | R08 | R08 | R08,R06,R02,R05,R10 | R08,R06,R02,R05,R10 | unsupported |
| Q09 我本人叫张三吗 | R10 | R10 | R10 | R10,R06,R08,R02,R05 | R10,R06,R08,R02,R05 | unsupported |
| Q10 2月31日 面试 | 空 | R02,R01,R03 | ERROR ValueError | R02,R01,R03,R06,R08 | R02,R01,R03,R06,R08 | unsupported |

Q07控制命令回的R09是带“已取消”原文的历史证据，裁定为相关；这不是复活active事实。Ryza把retired条目排除，因此虽满足旧forbidden，却没有召回该取消证据。不能按原gold简单宣称谁更正确。

AH的Q01/Q02分别确含R01/R02，同时同日非主题记录按原政策标“关联背景”；满足必含相关，不满足严格主题纯度。Q01原生返回6项，top5不可配置；没有后截断。Ryza top5可以原生调用，但每个实际prompt固定12项，本批均411字符；不把under1200解释为预算保证。

AIRI相邻task-memory同32输入保留尾部R23–R32，格式对10查询不变；原notebook保存32notes但已核默认context链没有自动消费notes。原默认组装片段把32条合成history和当前query时间前缀全部带入（每次约1344字符），没有query/topK选择，故unsupported而非零分。history含全部答案也不算相关召回成功。
