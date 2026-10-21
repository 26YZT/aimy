# 同条件主动续聊：AIRI 与 AionsHome

日期：2026-10-14。状态：源码隔离实验完成，可独立复核；未实施产品代码、未接真实模型、用户数据、设备、外发或音频。所有输出只在本目录。原项目源码未改。

冻结输入：`/tmp/aimy-20261014-memory-ab/fixtures.json`，SHA-256 `61b8c0b87067f9d349876f11217adcb82d321df795ddfec6e330e0f9caa14b61`。固定北京时间2026-10-14 10:00:00，epoch1791943200；两方固定生成文本均为“刚才的话题还想听你说说。”，idle固定JSON选择private_chat。fixture未包含具体生成句，因此句子为本实验共享控制变量，不声称fixture逐字给出。没有自然时机、回答质量或自然度优胜判断。

`results.json`保留10个PR案例两方逐项原观察、合同结果、阶段支持、转换与真假边界。`source-manifest.json`保留14份源码绝对路径/哈希、抽取函数原行号、脚本哈希。AIRI父仓HEAD为b851ef3334320d13dd86cb8cafb449a70d154c9b，具体当前文件哈希优先；Aions本地发行源码没有.git，不能编造commit。

## 结论

AIRI已经有主动通知运行链：原notebook task→原orchestrator tick→原Spark agent/plugins→原character reaction→Speech边缘。本轮实际执行上述工厂与函数体；只把Vue/Pinia基础状态、固定模型和Speech设为替身。不能说AIRI“没有主动”。所缺的是本轮要求的持久计划、自动NEXT_CHAT协议、单次领取/提交以及返回/关闭的统一取消合同。

AionsHome原NEXT_CHAT链确有可复用的有界机制：原parser接受2分钟、原SQL持久计划、原DELETE+rowcount领取、用户新消息经原ws.broadcast hook撤销未领取计划、原调度恢复后产生一次回复。这些经原_tick/_fire_monitor/stream safety/_save_to_private/ws.broadcast执行，并真正写入隔离SQLite、送达假WebSocket记录器。不是只测claim。PR05使用两个不同的新OS进程读同隔离SQLite，计划恢复后首次发送一次，重复原fire领取失败。

它的完整caller没有补上所有保护：NEXT_CHAT开关关闭后旧pending仍被_fire_monitor执行；生成await期间用户回归或关闭仍提交；私聊计划未记录conv_id，触发时选择最新会话，会发往新conv-B。普通用户chat的generation_control不能据此推断后台已取消：本轮执行原generation_event，原背景caller未建立generation scope。这里的fail是本轮Aimy合成合同不满足，不是给上游项目虚构设计承诺。

idle是另一条机制/开关，原minimum为5分钟，不能改成2分钟再称同条件NEXT_CHAT。补充实际跑原IdleAutonomyManager→原select_action→原private_chat→原save→原broadcast：领取前disabled拦截、领取前新用户刷新timer也拦截；固定JSON生成await中disabled/用户回归则仍保存+送记录器。原manager有领取前和领取后enabled检查，旧“helper能claim就代表完整caller失效”的归纳应撤回。

## 逐案例对照

| 案例 | AIRI本轮合同结果 | Aions NEXT_CHAT本轮合同结果 |
|---|---|---|
| PR01 两分钟自动计划/触发 | unsupported：可映射原scheduleTask，但没有NEXT_CHAT自动规划协议；原提醒正常运行 | pass：原协议、SQL、调度、生成、提交闭合 |
| PR02 单领取/提交 | fail：原提醒任务成功后不自动done，可重复提醒 | pass：原删除领取仅一次 |
| PR03 新用户撤销pending | unsupported：原notebook/orchestrator没有新用户取消入口；同事件仅记录，不自建逻辑 | pass：原broadcast hook删pending |
| PR04 关闭后不提交 | unsupported：无同等主动toggle；补充映射dispose在生成前能停ticker，队列保留 | fail：原开关关闭后旧pending仍生成/提交 |
| PR05 新OS进程恢复且不重复 | fail：原内存ref新进程空；不补落盘 | pass：两个独立新进程同SQLite；只提交一次 |
| PR06 旧计划不发新会话 | fail：原task无绑定；character构造Speech时使用当前conv-B | fail：原fire选择最新conv-B |
| PR07 生成中用户回归 | unsupported：缺取消控制；原reaction/Speech边缘仍产生结果 | fail：原SQL+原broadcast仍提交 |
| PR08 生成中关闭 | unsupported：无同等toggle；已有dispose的在飞实验仍产reaction/Speech边缘 | fail：关闭原toggle后仍提交 |
| PR09 背景记忆≠后台发言 | inconclusive：原focus/空计划阴性；未跑真实记忆producer | inconclusive：context-only/空计划阴性；未跑真实记忆producer |
| PR10 非法61 | unsupported：原无NEXT_CHAT parser，不以空队列假称已拒绝 | pass：原parser拒绝61，不建两分钟计划 |

不汇总为“几比几产品胜率”。unsupported保留接口不等价，不能按零分。反例复现的assert成功仍是合同fail。

## 默认提醒窗口与时序

AIRI输入严格记为原`scheduleTask({title:'稍后继续',details:'同一合成后续话题',dueAt:BASE+120000})`，不添加sourceSessionId，不伪造NEXT_CHAT解析。保持默认normal优先级、tick2000ms、taskNotifyWindow60000ms、requeue30000ms、soon delay10000ms。原getDueTasks在60秒时纳入两分钟任务，原soon队列在70秒产生首个固定生成，100秒再次生成；PR02继续到130秒出现第三次。原任务仍scheduled，未自动markDone。这是提醒窗口/重复提醒的实测语义，与本轮“严格两分钟后、只一次续聊”合同不同；不能直接称其为上游bug或更差的主动体验。

PR07/08按同一原默认ticker推进到120秒；生成在70秒已开始并挂在固定模型await。120秒输入回归/关闭后放行固定结果。精确时序记录在stages中，没有偷偷把原提醒window改成0。在飞生成窗口也由此与严格120秒才开始的Aions不同；不能拿两者计算时延/自然度排名。

Aions原30秒poll body在+30/+60/+90/+120秒调用，2分钟计划到+120原生成。没有启动原后台线程、真实等待或运行完整app；原_tick体及全部关键调用保留。AIRI为await原私有tick，仅在隔离转译副本return增加`__tick:tick`测试暴露，不改原调度/取消/提交体；原initialize/startTicker也执行，setInterval为固定记录器。

## 真实执行与替身边缘

- AIRI真代码：notebook全部工厂；orchestrator工厂/initialize/tick/enqueue/process/dispose；Spark agent、event-source、reaction plugin、builtin plugin；character原onDelta/onEnd/recordReaction。builtin工具构建器返回空工具，固定文本不调用工具。Vue/Pinia只提供ref/computed/proxy注入；会话store只提供真实消费字段activeSessionId；marker parser为literal透传，Speech为记录器。**没有执行真实VoiceKernel、真实UI显示或听到声音，因此只称character反应与Speech提交边缘，不能称真人可见/可听发言成功。**
- Aions真代码：NEXT_CHAT parser/toggle/event processor/claim；原schedule.tick/fire/resolve/private save；原schedule command parser（固定文本无命令）；完整stdlib stream_safety；原generation_event；原ws.broadcast及private sender映射；autonomy_state配置/时钟/领取/刷新；选定idle完整caller。SQL真正执行，SQLite真正持久。
- Aions替身：aiosqlite用stdlib SQLite异步外壳，方法立即执行，没有复现线程池/并发锁等待/崩溃；相同SQL领取用于拒绝重复，不能外推多进程所有竞争已验。模型是固定文本/JSON；camera回明确无图DTO；context/history、health/activity、导出、TTS、设备/家居/微信等副作用隔离；原ws.broadcast接假WebSocket，expressive/sync/post旁路是无IO替身。后台通用命令后处理器是identity边缘，不把该副作用链称已测试。
- 只跑aion私聊，未验Connor/群聊/手机/网络重连。关闭设置的save_settings为合成dict替身，PR05恢复计划使用实际SQLite；不能把设置落盘或崩溃恢复一起算通过。
- PR09没有执行真实记忆surfacing producer或模型理解；阴性表明空任务调度不产生提交，不能推断历史cancelled事实复活、最终误发或理解错误。历史取消原文可以作为历史证据。
- source-manifest的loaded_exact_bodies是载入原函数定义/范围，不等于每个helper/分支都执行。逐case原事件/最终库行/录制发送是运行证据。

## 当前源码定位

AIRI路径根为`/Users/mima1234/Documents/aimy/aimy-app/`：

- `packages/stage-ui/src/stores/character/notebook.ts:33–35`内存队列，`:65–88`计划，`:110–133`notified/due窗口。
- `packages/stage-ui/src/stores/character/orchestrator/store.ts:37–42`默认参数，`:92–116`排队，`:119–157`生成与指令发出，`:183–219`task通知，`:221–251`tick/重试，`:298–307`dispose仅退订/停ticker。
- `packages/core-agent/src/agents/spark-notify/agent.ts:179–281`原agent；`plugins/reaction.ts:16–35`反应消费。
- `packages/stage-ui/src/stores/character/index.ts:67–109`onDelta/end，`:77`生成时取activeSessionId，`:113–126`反应数组提交。

Aions路径根为`/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/`：

- `proactive_companionship.py:36–38`toggle，`:63–75`分钟校验，`:93–145`建/删计划，`:148–155`领取。
- `schedule.py:303–327`原poll，`:329–354`目标选择，`:396–459`最终私聊SQL+广播，`:865–920`领取/选最新会话，`:1094–1132`生成/流安全消费，`:1183–1226`保存/广播后续。
- `ws.py:236–318`原broadcast含NEXT_CHAT hook及原send_text；`generation_control.py:150–157`原scope标签/取消门。本背景scope为None。
- `autonomy_state.py:179–247`配置（disable清空idle倒计时），`:250–350`schedule/refresh/claim；`autonomy.py:595–699`选择，`:702–715`私聊动作，`:718–763`实际保存，`:892–931`目标路由，`:2173–2303`实际动作执行，`:2329–2388`manager caller门与finally续期。

精确源码哈希与AST提取行号以source-manifest为准；上述范围只作导读，不把未执行区域自动算通过。

## 重跑

在任何cwd执行（脚本全部输出限本目录；来源绝对路径不变）：

```sh
python3 /tmp/aimy-20261014-memory-ab-proactive/aions-proactive.py
node /tmp/aimy-20261014-memory-ab-proactive/airi-proactive.mjs
python3 /tmp/aimy-20261014-memory-ab-proactive/build-report.py
```

已运行退出码均0；所有正例/反例复现assert完成。Node发出`stripTypeScriptTypes`实验API警告，非执行失败。新OS进程PID和生成ID随重跑改变，不能期待结果字节相同；固定合成条件/合同与阶段观察应相同。`build-report.py`核10case同序、fixture SHA及所有被读源码现有字节哈希。

可保留/适配的增量是持久短期计划、原子单领取与领取前新用户撤销这三种有界机制；接入仍须在AIRI现有唯一authority里补session/epoch/enable/hidden/abort的最终提交门，不能照搬Aions第二套服务、摄像头或副作用体系。是否复制代码/许可与真实体验仍按主报告各自边界评审；本证据不授权接入。

## PR09独立生产者补证（原十案例结果不改）

新文件`PR09-surfacing-supplement.py/json`与`PR09-source-supplement-hashes.json`补了原`memory.py:427–529 build_surfacing_memories`及原`context_builder.py:329–502 build_memory_blocks`的真实函数体执行。使用同冻结32记录、同clock、真实隔离SQLite、get_embedding固定None，保持原max_total=8；保留原archive过滤、recent SQL顺序和去重检查，不补人工embedding或相关性排序。三个输入（空topic、Q08 Aimy记忆、Q07灯塔取消）均返回原IDs：R03/R05/R08/R10/R01/R06/R11/R16，并由原build_memory_blocks组装进time_block的[背景记忆]。每个producer实际执行2条SQL；Q08/Q07的embedding尝试返回None，所以本例是原近期补满，不能称相关性检索更强。

原producer排除archive_state=cold的R04/R09；这只说明背景浮现这一层的原过滤，不能把查询时取回取消历史证据误判为当前约定复活。共享数据没有unresolved字段，映射为原默认0；没有为了通过测试把R06推断成unresolved。输出ID唯一，但未强造跨tier重复输入；不称unresolved优先/跨tier正例全验。共享数据有晚于clock的同日时间，原SQL仅下界；没有新加上界或评价未来写入保护。

原build_memory_blocks执行时通过其原生digest_result参数给固定topic/keywords，health为无IO空边缘，instant_digest模型路由未执行；skip_digest=True阴性不调用producer。源码定向核：群聊`chatroom.py:1138–1150`调用builder并把time_block加到history；私聊`routes/chat.py:1407–1440、2063–2101`直接调用同producer并在history插入背景，**不是误称私聊通过这个共享builder**。这两处更上层caller仅源核，没有重写caller、启动完整app或实发。

冻结fixture与10案例raw before/after SHA完全相同，原PR09保持inconclusive。AIRI原focus/空队列阴性继续保留，其同类自动记忆producer在本次已核默认陪伴范围标unsupported，不自加producer。新补证只闭合“背景证据生产并装配存在”，没有自动调度/生成/最终发言，因此0send不是自动主动体验pass。

单独重跑：`python3 /tmp/aimy-20261014-memory-ab-proactive/PR09-surfacing-supplement.py`，已exit0；不会重写原10案例results或manifest。
