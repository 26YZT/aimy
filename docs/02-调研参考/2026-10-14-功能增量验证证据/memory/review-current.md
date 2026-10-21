# 当前功能增量裁决终核（记忆/续聊范围）

日期：2026-10-14。只读核对新正式五项目裁决MD/JSON、05包01选择MD及能力选择JSON，并对照正式保存的memory/checks.py/results.json；未再运行测试，未改repo。

**结论：MEM-F01、MEM-F02、PRO-F01的来源/测试结论没有实质歪曲，合并与工程排除成立；没有新的P0/P1。剩一处P2旧集成措辞建议在两份JSON同步收窄。**

## 已核成立

- 正式证据是24观察：10 positive、9 negative_blocked、5 counterexample。三切片的DM-*引用集合恰好覆盖这24项且各一次；没有合并成通过率。
- MEM-F01合并AH-R01/R02，未把每个来源/版本/删除护栏另算功能；正文承认post_sentinel共享画像和旧事件库不是可直接搬入的可靠成品，错误归因/同义topic/派生正文反例均保留。
- MEM-F02只称时间/词法/有效状态与整条画像预算的确定性行为；没有以合成命中声称真实语义召回或自然主动提起领先。非法日期反例明确。
- PRO-F01只称持久NEXT_CHAT计划、重连claim与新消息取消；禁用后仍claim及未测完整fire/generate/playback已明确。正式保存的这版DM-P08是重新连接claim；正文没有误写成完整进程重启自动唤醒。
- 新Python进程读取画像合成SQLite成立，代码使用真实post_sentinel.snapshot读取；报告明确stdlib async shim连接真实合成SQLite，同时模型/config/notify是假的，不把它当FastAPI/AIRI IndexedDB产品运行。
- memory_library CRUD的DTO/embedding/WS是假边界，正式DM-P09.observed.limits以及checks.py有明示；报告没有声称真实embedding或HTTP端点验收。
- AH-R04/11/12和KI01均为工程参考，product_increment_eligible=false、functional_slices=[]、requirements=[]，必要工程需求转reference_requirements；不占新增功能数。
- 两份决策JSON均55条，55唯一candidate ID；Chromatic不在decisions；AH1/AH2同映射MEM-F01；05包01明确55审核记录/8相关记录/5去重切片不是独立新增功能数。
- “没有一项真实体验已比AIRI更强”与无真实模型/设备/用户A/B口径一致。源码/隔离机制与真实效果分开。

## [P2] AH-R02仍沿用“主进程持久化”，与当前IndexedDB/leader方案不同

位置：

- `docs/02-调研参考/2026-10-14-五项目功能增量与验证裁决.json:247`
- `docs/05-实施手册/2026-10-14-Aimy增量开发交接包/能力选择.json:102`

当前integration_boundary仍是“原子写入、主进程持久化、管理UI共三层”。当前03技术选择是在stage-ui既有IndexedDB local挂载、leader-owned MemoryService/Repo及单key CAS内增量，并未选择Electron main数据库持久化。继续保留旧句可能使执行AI另造main存储或第二数据权威。

建议同步改为：“AIRI现有session/message ID作来源；在既有IndexedDB local挂载和leader-owned MemoryRepo中实现原子事实写入/来源管理，UI消费回执；不搬候选SQLite/FastAPI或新主进程数据库。”这不是新增源功能或架构重选，只是让审核边界与正式技术提案一致。

## 证据版本说明

正式memory/results.json为先前24项run的原证据快照，含当时生成的synthetic fact UUID。它与我tmp目录稍后增强source_evidence/新进程timer检查的版本字节不同，并非自动判定原证据被改坏。当前正文使用的画像新进程/续聊重连层级都与正式保存版本相符，不要求覆盖已有原字节。

本次只作阅读与JSON引用/计数核对，没有重跑模型、SQLite用例或设备测试。上面的P2不影响已保存24观察的正确解释。
