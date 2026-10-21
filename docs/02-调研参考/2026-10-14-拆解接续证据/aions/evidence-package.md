# AionsHome 当前源码补齐证据包

日期：2026-10-14（Asia/Shanghai）。状态：只读发现与复用建议。用途：供主 agent 撰写正式总报告和横向复用裁决。来源为本地解包快照，未联网确认远端版本。不是实施手册、依赖选择或新 Aimy 数据模型冻结。

基线：Aimy 继承 AIRI，做 1–100；保留 AIRI 的桌面、会话、provider、音频、角色与授权链。当前自用、不外传不消除技术边界。macOS、本地优先、主要单角色、无摄像头、一期无成人功能；本轮不改产品代码。

## 1. 来源、范围与读完的内容

- 本地来源：`/Users/mima1234/Documents/资料/拆解项目/AionsHome-main`。未包含 `.git`，无法据此称某个 Git 提交已经核验。1555 个普通文件，共 465036303 bytes（约443.5 MiB）。
- 安全选取的第一方源码/文档文本：1109 文件，291622 行，覆盖指纹 `d7dd126c08884b5ea5d41027069da4c4b7de7b212d2bd75f46c667f6155a04af`。口径见 snapshot-summary.json；这个指纹不包括被排除的媒体、vendor、runtime/凭证数据，不是完整二进制树指纹。
- 458 个 Python 文件仅 AST parse，0 语法错误。没有 import 原项目 main/config；没有装依赖、起服务、调用模型、登录账号或打开摄像头/麦克风。语法通过不等于可运行。
- 主对话可读记录 + AionsHome 完成分支01–07 + 未完成01/05/06 共11份恢复文档完整读完，历史结论按当前源码核实。
- 当前源码人工定向通读/分段共 65 文件、9634 行，28 文件覆盖1至EOF。每文件SHA256、已读范围在 read-coverage.json；原始读取记录 read-log.jsonl。
- 另自动提取 aion-chat 592 个路由声明、199 个非 test_/tests 路径模块符号、35 项 CapabilityDef；见 api-page-routes.json、production-module-symbols.json、capability-registry.json。这是源码声明清点，含可选路由/嵌套工厂，不是592个接口全部已运行。
- 全仓文件名/大小已盘点；完整读完若干核心叶子模块不等于29万行逐行审查。其余文本只做哈希或AST清点；没有据此声称全仓语义审计。未读/排除清单由 snapshot-manifest.json 对照 read-coverage.json 可精确导出。
- 排除真实 data/DB、settings/worldbook、所需要的API.txt、env、auth、keys、用户聊天/录音/截图、依赖vendor/node_modules/venv/build。只阅读声明字段和路径的源码，没有读取真实凭证值。
- 恢复资料与旧四项目证据仅作线索；本轮四项旧缺陷已在“拆解项目”当前来源重新执行，不能拿“资料/AionsHome-main”旧路径的历史结果冒充当前。

## 2. 55 项功能的入口—机制—数据—副作用—限制

下列每项仅声称源码存在与当前静态链路；隔离实际执行范围见第7节。

| ID / 功能 | 入口与机制 | 数据与副作用 | 限制 | 当前源码 |
|---|---|---|---|---|
| AH-M01 增量自动总结 | FastAPI lifespan 的 _auto_digest_loop → 用户沉默至少 30 分钟再 auto_digest；auto_digest 至少40条未总结消息 | messages/chatroom_messages；digest_anchor → 模型提取 daily/important 并写 memories | 手动总结没有40条下限；不是每条聊天都生成向量记忆 | [main.py:124](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/main.py:124)；[memory.py:1554](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/memory.py:1554) |
| AH-M02 摘要输出归一化 | _do_digest → _normalize_digest_memory_items → 最多16项；daily重要度 .1–.7，important需>=.75；有效源消息最多8；自动 unresolved=0 | source_message_ids/source_start_ts/source_end_ts/keywords → 写入可追溯原子摘要 | 无源ID时退回时间范围；阈值是启发式，未经真实质量评测 | [memory.py:935](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/memory.py:935) |
| AH-M03 向量召回 | context_builder.build_memory_blocks → recall_memories → 纯Python全表扫描；cosine*.6+keyword*.3+importance*.1；阈值 .45/top5 | SQLite embedding float32 BLOB；active行 → 给主聊天注入相关记忆 | 无ANN与embedding版本；embedding失败直接空结果 | [memory.py:178](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/memory.py:178)；[memory.py:280](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/memory.py:280) |
| AH-M04 本地即时路由 | instant_digest → 中文正则识别历史指代与细节；当前用户文本前200字作topic；keywords=[] | recent_messages；topic/first_responder → 无需前置LLM，驱动来源原文是否展开 | 不能以哨兵配置推定每轮instant_digest都调用模型 | [memory.py:641](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/memory.py:641) |
| AH-M05 背景浮现 | build_surfacing_memories → 未完成最多2，语义>=.50最多3，最近3天补足8 | memories active；source时间 → 模型可自然主动提及近期事项 | 浮现不等于后台主动发消息；自动摘要强制unresolved=0 | [memory.py:426](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/memory.py:426) |
| AH-M06 记忆上下文分层 | build_memory_blocks → 并行背景/向量/聊天室召回；主候选优先，正文前100去重；细节请求加来源原文 | time_block/memory_block/debug_digest → 返回模型提示与调试候选 | gather异常逐项continue，静默退化；skip_digest会跳过记忆 | [context_builder.py:328](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/context_builder.py:328) |
| AH-M07 主动记忆搜索 | [MEMORY_SEARCH] → search_actor_memories → 关键词稀有度/正文命中/语义/时间评分；5查询、10结果；来源回执分级字符预算 | MemorySearchRequest/MemorySearchResult → 把证据带回下一轮模型 | 独立于普通向量评分；不是BM25完整实现 | [active_memory_search.py:20](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/active_memory_search.py:20)；[active_memory_search.py:150](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/active_memory_search.py:150)；[active_memory_search.py:539](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/active_memory_search.py:539) |
| AH-M08 角色记忆作用域 | actor_memory_query + _source_rows → Aion memories；Connor chatroom_memories(scope=connor)；原文允许各私聊+共同群聊 | 两张记忆表/room.type/source namespace → 限制正常搜索与新来源编辑范围 | 旧source API缺相同room.type检查；共享画像另是一条跨角色机制 | [active_memory_search.py:260](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/active_memory_search.py:260)；[memory_library.py:230](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/routes/memory_library.py:230) |
| AH-M09 统一记忆管理 | GET /api/memory-library/{store} → memories/atoms、active/cold、kind、关键词、日期、分页 | memories/chatroom_memories；20项默认/最多100 → 读取管理列表 | store固定两个字面角色，不是通用多租户数据模型 | [memory_library.py:104](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/routes/memory_library.py:104) |
| AH-M10 编辑记忆与向量失效 | PUT /api/memory-library/{store}/{id} → 内容变化重算向量；失败置NULL，不保留旧正文的向量 | content/embedding/type/date/evidence_summary → 更新正文并广播 | 未定义事实revision/历史更正链；不会自动改所有压缩后代 | [memory_library.py:181](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/routes/memory_library.py:181) |
| AH-M11 精确来源/候选来源管理 | memory_sources/save_sources → 原子记忆手动选原文；严格校验归属；压缩摘要通过originals；explicit []不复活日期候选 | source_msg_id；lineage_exact → 保存来源关联并跳回对应对话 | 新save_sources无旧source_edit_log式before/after日志；非原子禁止直接改来源 | [memory_library.py:266](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/routes/memory_library.py:266)；[memory-library.js:20](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/static/memory-library.js:20) |
| AH-M12 关联删除确认 | DELETE /api/memory-library/{store}/{id} → BEGIN IMMEDIATE；有关联且未确认409；移除子source_memory_ids及batch_input | 原子/派生记忆图 → 物理删目标，保留聊天原文与派生正文 | 明确不是彻底忘记事实；前端也明确写关联正文不会自动修改 | [memory_library.py:210](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/routes/memory_library.py:210)；[memory-library.js:256](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/static/memory-library.js:256) |
| AH-M13 旧记忆CRUD兼容 | /api/memories/{id} → 旧update重算向量，旧delete仅DELETE memories | memories与sync_events → 旧入口仍注册并广播 | 绕过新关联确认/清理；已隔离复现孤儿batch_input | [memories.py:336](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/routes/memories.py:336)；[main.py:320](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/main.py:320) |
| AH-M14 多层日历压缩 | run_calendar_compression → 05:00逻辑日；daily/weekly/monthly按7/90/365天老化；输出预算/短M引用校验 | 压缩jobs/batches/input/output；active→cold → 生成摘要，旧embedding=NULL；保留lineage | 自动scheduler仅daily/weekly，且两个target均读取Connor配置模型；候选快照commit前未重验 | [memory_compression.py:25](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/memory_compression.py:25)；[memory_compression.py:241](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/memory_compression.py:241)；[memory_compression.py:813](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/memory_compression.py:813)；[memory_compression_scheduler.py:48](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/memory_compression_scheduler.py:48) |
| AH-M15 压缩来源图追溯 | resolve_source_memories/resolve_source_message_ids → 最多500节点BFS；modern parents精确，legacy批次近似 | source_memory_ids/compression_batch_inputs → 找到原始记忆及namespaced消息ID | 不存在源被skip；lineage_exact不证明原文事实正确 | [memory_compression.py:642](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/memory_compression.py:642) |
| AH-M16 重建向量的内容保护 | POST maintenance/rebuild → 重算时UPDATE id AND content匹配 | id/content/embedding → 旧正文已改时不附旧向量 | 对全部含冷行取id/content；重建不是自动版本迁移 | [memory_library.py:355](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/routes/memory_library.py:355) |
| AH-F01 后置共享画像自动保存 | ws.broadcast → observe_message_event/enqueue_event → 只接受非重复用户msg_created；背景独立context的enqueue；source_id唯一 | post_sentinel_document/revision/epoch；post_sentinel_jobs → 写持久队列，独立模型维护画像和状态 | 包括private及chatroom用户表达，跨两AI共享；不是两张向量表的一层 | [ws.py:284](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/ws.py:284)；[post_sentinel.py:44](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/post_sentinel.py:44)；[post_sentinel.py:212](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/post_sentinel.py:212) |
| AH-F02 画像源消息保护 | _context_for_job + run_pending_once → 触发原文须仍存在且内容相同；前12条上下文仅用户分U标签；模型后重新核对完整sources/messages | private:id/chatroom:id；source_ts → 拒绝删除/编辑前取到的源消息结果 | 最后一次源读取与写事务之间仍有很短窗口；没有全局source revision冻结 | [post_sentinel.py:254](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/post_sentinel.py:254)；[post_sentinel.py:520](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/post_sentinel.py:520) |
| AH-F03 画像较新事实胜出 | _apply_analysis.lineage → 合法U标签→真实source ID；confirmed=max(source ts)；旧source_ts>confirmed则忽略 | entries/sources/source_ts → 阻止旧排队消息推翻新进展 | 这是确定性时间比较，不保证模型正确理解纠正句 | [post_sentinel.py:358](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/post_sentinel.py:358) |
| AH-F04 画像手动纠正/删除 | PUT /api/user-profile → save_manual → 传revision；事务比对；遗漏旧key标deleted=true/locked=true；模型跳deleted | JSON entries；revision++；current_state清空时间 → 更新画像、保存删除屏障 | 按key/topic屏障，原聊天还在；可换topic新建的同义事实未证明永不重建；手填可被较新本人表述更新 | [user_profile.py:41](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/routes/user_profile.py:41)；[post_sentinel.py:142](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/post_sentinel.py:142)；[post_sentinel.py:391](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/post_sentinel.py:391) |
| AH-F05 画像撤权与陈旧结果隔离 | invalidate_pending + run_pending_once最终事务 → 关闭epoch++，pending/running置skipped；提交前enabled/epoch/revision检查；revision改则重排 | epoch/revision/jobs attempts/status → 抑制关闭→再打开期间旧模型结果提交 | 这条机制不保护旧向量压缩/主动timer；应分别迁移 | [post_sentinel.py:204](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/post_sentinel.py:204)；[post_sentinel.py:501](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/post_sentinel.py:501) |
| AH-F06 画像待办与活动过期 | user_profile_policy.lifecycle → 待办过截止变unknown，不伪造done；项目14/30天或持续项目60/180天变stale/retired；普通近况默认3天 | kind/status/due_at/available_at/expires_at/sustained → 维护并从提示淡出过期背景 | 规则来自该项目产品语义，不自动成为Aimy需求 | [user_profile_policy.py:96](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/user_profile_policy.py:96) |
| AH-F07 画像注入预算 | post_sentinel.build_context → render_context → 总<=1200字符；profile500/recent600软分配；待办优先；不切断单条事实 | entries/current_state → 共享上下文进入build_ability_block | 有deadline不等于提醒任务自动调度；字符预算不是token预算 | [user_profile_policy.py:159](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/user_profile_policy.py:159)；[context_builder.py:262](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/context_builder.py:262) |
| AH-F08 画像恢复与节流整理 | post_sentinel.start/_loop/consolidate_once → 启动running→pending；处理队列，60秒检查；条目>12或正文>1100触发整理、24h节流 | jobs/backups/document → 恢复未完成画像任务及有界整理 | 没有本次fresh-process真实持久化运行验收；未读凭证/用户DB | [post_sentinel.py:607](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/post_sentinel.py:607)；[post_sentinel.py:659](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/post_sentinel.py:659) |
| AH-P01 模型决定自然续聊 | proactive_ability_text/extract_next_chat_decision → [NEXT_CHAT:1..60]或NONE；取最后合法决定，剥文本标签 | SETTINGS中的每actor开关 → 向回复注入续聊决策能力 | 默认关闭；无每日总预算/DND门；非法最后标签不必覆盖前一个合法决定 | [proactive_companionship.py:32](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/proactive_companionship.py:32) |
| AH-P02 续聊持久timer/新消息取消 | process_visible_message_event → BEGIN IMMEDIATE；用户消息删除全部active proactive；AI消息重排自身timer | schedules(type=proactive,origin,trigger_at) → 消息写回clean正文，插新timer | 取消的是尚未claim的timer，不能据此推断in-flight生成也取消 | [proactive_companionship.py:93](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/proactive_companionship.py:93) |
| AH-P03 续聊到期消费 | ScheduleManager._tick/_fire_monitor → 30秒poll；DELETE rowcount单次领取，再走监控上下文与对话生成 | schedules/最新活动会话 → 获取图像、调用模型、存消息并可TTS | claim后不复查proactive开关/用户消息generation；关开关不删已存timer | [schedule.py:274](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/schedule.py:274)；[schedule.py:865](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/schedule.py:865)；[schedule.py:1123](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/schedule.py:1123) |
| AH-P04 闲时actor持久唤醒 | schedule_actor_wake/claim_due_wake → 每actor随机5–1440min；用户新消息重新计时；到期UPDATE置NULL原子领取 | autonomy_actor_configs/timer_started_at/next_wake_at → 各actor独立重排 | SQLite新轨默认5–1440，不是旧SETTINGS默认120min | [autonomy_state.py:250](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/autonomy_state.py:250) |
| AH-P05 闲时动作选择/休息兜底 | IdleAutonomyManager → _select_action → 30秒循环+actor lock；15动作资格过滤；一次模型返回受限JSON，异常rest | actions_json/idle_events → 选择local/private/social/external动作 | 模型返回期间关闭后无最终门检；没有所有分支永不误发保证 | [autonomy.py:595](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/autonomy.py:595)；[autonomy.py:2173](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/autonomy.py:2173) |
| AH-P06 记忆反刍后主动提 | _run_memory_browse → 抽6个有摘要日期→模型选择日期→读当天摘要→post_moment/write_diary/private_message | 记忆/日记/动态/idle_events → 可能主动私聊提起旧事 | 一次wake+选日期+读后反应可能至少3模型步骤；不含原文且未做语义质量验证 | [autonomy.py:1370](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/autonomy.py:1370) |
| AH-P07 私人壁龛/行动卡 | create_niche_card → session唯一；感想或图片至少一项；title120/tags3/trace3，保存来源 | autonomy_niche_cards → 保存自主旅程卡供后续使用 | 不是长期事实权威；不能把AI生成感想升为用户事实 | [autonomy_niches.py:118](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/autonomy_niches.py:118) |
| AH-P08 取消闲时未来计时 | update_actor_config(enabled=false) → next_wake_at清空；状态包active/running→cancelled_by_disable | actor_configs/state_packets → 停未来wake | 不等于取消正在执行的action；autonomy_prompt_text现返回空 | [autonomy_state.py:198](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/autonomy_state.py:198)；[autonomy_state.py:632](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/autonomy_state.py:632) |
| AH-C01 双AI配置/分模型音色 | load_chatroom_config/get_chatroom_names → 固定aion/connor两个id；名字可配置，TTS音色与model各独立 | worldbook + chatroom_config → 单一FastAPI内管理双角色 | 不是通用角色注册平台；Connor默认Codex但可选统一provider | [chatroom.py:29](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/chatroom.py:29)；[chatroom.py:2035](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/routes/chatroom.py:2035) |
| AH-C02 群聊顺序轮次 | _generate_group_replies → 本地指名/优先词判断first responder；显式顺序覆盖；否则random；第二AI重新载入首AI输出 | chatroom_messages/room → 双AI按顺序都回复 | 不是独立概率决定每个AI是否回复；manual另有触发路径 | [chatroom.py:3862](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/routes/chatroom.py:3862)；[memory.py:703](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/memory.py:703) |
| AH-C03 反馈人格复盘 | persona_evolution_loop/run_persona_evolution → 每日北京05:00或手动；带原因like/dislike反馈+daily摘要；fingerprint去重；自动应用section更新 | persona_evolution_runs/items；worldbook/chatroom_config → 改identity/relationship/style/boundaries等9节，写before/after/diff | section_locks只进prompt未在_apply_section_updates强制；不适合让模型改Aimy权限/危机兜底 | [persona_evolution.py:23](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/persona_evolution.py:23)；[persona_evolution.py:817](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/persona_evolution.py:817)；[persona_evolution.py:1165](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/persona_evolution.py:1165)；[persona_evolution.py:1432](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/persona_evolution.py:1432) |
| AH-C04 快捷备忘录 | /api/private-memos → active/completed CRUD、客户端updated_at较新胜；默认不注入模型 | private_memos表 → 保存小组件和App共用便笺 | 不是用户与特定角色间秘密：无actor owner，docstring明确不注入 | [private_memos.py:1](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/routes/private_memos.py:1) |
| AH-C05 Connor外部包边界 | Connor-Codex/package.json → mobile-inbox/ISC，依赖@openai/codex0.144.1；main和start指文件 | package.json → 配置可为Python CLI子进程路线提供线索 | server.js/auto-responder.js本包缺失，不能称完整8787服务随源码可启动 | [package.json:1](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/Connor-Codex/package.json:1)；[chatroom.py:2056](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/routes/chatroom.py:2056) |
| AH-V01 桌面语音唤醒 | POST /api/voice/toggle → VoiceWakeup.start → sounddevice16k mono/int16；WebRTC VAD mode2；8帧240ms；ASR文本含wake_word进入call | in_call/ai_speaking/thread event → 实时采音，片段ASR，自HTTP发送聊天 | Python路径半双工：AI说话持续读但丢音；不是本地keyword spotting | [voice.py:18](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/voice.py:18)；[voice.py:141](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/voice.py:141)；[voice.py:262](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/voice.py:262) |
| AH-V02 上传转写双provider | POST /api/voice/transcribe/remote-asr → transcribe_audio → OpenAI兼容multipart/SenseVoiceSmall；DashScope paraformer-realtime-v2；WAV/FFmpeg转mono PCM再3200byte分发 | audio bytes/transcript → 远程API/WS转写后返回整段文本 | DashScope网络传输duplex不等于麦克风帧流→持续partial UI；入口仍上传完整录音 | [asr.py:16](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/asr.py:16)；[asr.py:57](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/asr.py:57)；[voice.py:55](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/routes/voice.py:55) |
| AH-V03 多TTS供应商 | _request_tts_audio → prefix选ElevenLabs/Edge/MiniMax；默认CosyVoice2-0.5B；MiniMax四模型、stream=false | voice/model/settings → 外部请求得到整段MP3 bytes | 文本分片流式，不是所有供应商都首byte音频流；真实音色另定 | [tts.py:30](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/tts.py:30)；[tts.py:262](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/tts.py:262)；[elevenlabs_tts.py:10](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/elevenlabs_tts.py:10) |
| AH-V04 句子切分与首包 | TTSStreamer.feed_async/_find_cut_position → 普通100–200char，low-latency首段12–24后60–100；跳过标签/元数据/markdown；句末、逗号、硬切 | buffer/seq → 增量送合成队列 | 短语音体验需要真实语料A/B；阈值不能照搬为Aimy确定值 | [tts.py:175](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/tts.py:175)；[tts.py:479](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/tts.py:479)；[tts.py:670](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/tts.py:670) |
| AH-V05 TTS背压有界并发 | _ensure_workers/_enqueue_segment/_worker → 默认2 workers/queue6/40segments；feed_async等待queue.put | queue/deferred/segment seq → 并行合成，tts_chunk带seq推送 | 网络并发结果可乱序；客户端必须seq排序；没有实时延迟验收 | [tts.py:494](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/tts.py:494)；[tts.py:724](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/tts.py:724) |
| AH-V06 TTS任务取消 | TTSStreamer.cancel + Generation.stop → 清buffer/队列、cancelworkers；合成后再次检查cancel；删除owned音频；generation作用域持任务树 | message_ids/tasks/streams/segment paths → 抑制后续通知/撤销缓存 | 不是所有后台wake都有user generation scope；to_thread写文件仍需生命周期实测 | [tts.py:599](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/tts.py:599)；[tts.py:875](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/tts.py:875)；[generation_control.py:36](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/generation_control.py:36) |
| AH-V07 TTS缓存/合并重播 | _synthesize/_finalize_merged_audio → safe_message_id_sN.mp3；所有分片存在才顺序concat；.tmp原子replace；最旧mtime淘汰至500MiB | TTS_CACHE_DIR/mp3 segment paths → 磁盘落音频、推URL、可合并重播 | 按message/seq缓存，不是text+voice hash跨消息去重；Aimy默认原录音不长期保存需另定音频策略 | [tts.py:68](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/tts.py:68)；[tts.py:822](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/tts.py:822)；[config.py:47](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/config.py:47) |
| AH-V08 表演短语音导演 | saved message含[语音|方向=|内容=] → prepare_message/start_message → 每消息最多1 clip；额外director只加受控标签，去标点空格后台词必须完全一致；<=200字 | expressive_voice attachment pending/working/ready/cancelled → ElevenLabs合成附件，领取幂等不重扣；可等普通TTS结束后播 | 额外LLM+TTS成本；标签表有成人候选，Aimy一期需受限白名单，不整体复制 | [expressive_voice.py:50](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/expressive_voice.py:50)；[expressive_voice.py:146](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/expressive_voice.py:146)；[expressive_voice.py:243](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/expressive_voice.py:243) |
| AH-V09 独立角色音色与选线稳定 | ElevenLabs.voice_for/TTSVoices.populate → elevenlabs_{sender}_voice_id；前端暂时列表失效保留当前voice；Edge移出收藏不会切付费 | settings/chatroom voices → 角色分声、稳定音色选择 | Aimy单主要角色无需引入第二套配置权威；供应商model字面量仅本地源码事实 | [elevenlabs_tts.py:21](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/elevenlabs_tts.py:21)；[tts-voices.js:13](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/static/tts-voices.js:13)；[chatroom.py:33](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/chatroom.py:33) |
| AH-V10 语音消息附件 | chatroom.js _crVoiceSend → 先上传音频、再转写最多2次、构造type=voice/url/duration/transcript，SSE send | chatroom_messages.attachments/voice_attachments → 保存录音URL及转写并在聊天重播 | 语音消息不是仅base64 WS；本轮没有操作真实录音设备 | [chatroom.js:6642](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/static/chatroom.js:6642) |
| AH-V11 浏览器通话停顿/打断叶子 | VoiceCallPolicy → 短<2s停顿800ms，否则1200ms；active+speaking+adapter时interruptTTS(msgId) | 传入布尔/adapter/msgId → 发前端TTS打断请求 | 该16行纯JS存在，不等于Python半双工已能全双工抢话；不证明执行链端到端 | [voice-call-policy.js:1](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/static/voice-call-policy.js:1) |
| AH-S01 电脑看屏与活动来源 | camera._capture_screen/PCActivityTracker → PIL ImageGrab主屏；include_pc_screen默认false；win32gui前台窗口，GetLastInputInfo键鼠idle | 截图/frame/活动JSONL → 采集设备上下文送监控 | 看屏与camera组合；pc activity强Windows；pywin32无平台guard依赖 | [camera.py:760](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/camera.py:760)；[activity.py:149](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/activity.py:149)；[activity.py:395](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/activity.py:395)；[requirements.txt:18](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/requirements.txt:18) |
| AH-S02 Windows摄像头 | camera.open_camera → OpenCV CAP_DSHOW，1280x720，采集线程 | cam.frame/cfg/screenshots → 真实设备采集入口 | 一期Aimy无摄像头；语言可改写，平台/产品边界是拒绝整体引入原因 | [camera.py:428](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/camera.py:428) |
| AH-I01 基础装配/后台生命期 | main.lifespan → 单FastAPI起digest/persona/autonomy/schedule/activity/camera/外部集成；finally分模块stop | SQLite+文件配置+WS singleton → 启动常驻线程/async任务 | 不是插件SDK；import config也mkdir/读取凭证/可能写配置，故测试不得直接import | [main.py:153](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/main.py:153)；[config.py:8](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/config.py:8) |
| AH-I02 主应用访问边界 | SecurityAccessMiddleware → HTTP/WS旁路观察；已block源403/1008；观察失败放行 | IP/device audit状态 → 阻断已标block来源，记审计 | 没有统一主人登录认证；不能说中间件绝不阻断或整个仓库没有auth | [security_access.py:948](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/security_access.py:948)；[main.py:256](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/main.py:256) |
| AH-I03 跨设备事件回放 | sync_events append/persist/broadcast → legacy event附单调sync_seq；20000条保留窗、每100seq清理 | sync_events表 → 可重连回放 | 原子调用append_sync_event本身不做保留窗清理；不保证多写冲突自动解决 | [sync_events.py:70](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/sync_events.py:70) |
| AH-I04 能力文本协议与MCP schema并存 | format_ability_block + MCPManager.get_tools_for_ai → 常用动作由文本标签处理；MCP可产OpenAI function schema | CapabilityDef/metaprompt/input_schema → 执行动作或工具 | 不能全仓概括为从来没有schema；SSE MCP verify=False应拒绝继承 | [capabilities.py:455](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/capabilities.py:455)；[mcp_client.py:324](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/mcp_client.py:324)；[mcp_client.py:200](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/mcp_client.py:200) |
| AH-I05 前端入口真实接线 | main include_router + memory/capabilities pages → 主路由同时装旧memories和新memory_library；UI脚本调用相应API | HTML/原生JS/WS events → 记忆编辑/删除/开关操作可到后端 | 源码接线成立，未启动浏览器验收；整套页面不宜iframe进AIRI | [main.py:320](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/main.py:320)；[main.py:449](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/main.py:449)；[memory-library.js:12](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/static/memory-library.js:12)；[capabilities.html:216](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/static/capabilities.html:216) |

## 3. 记忆不是一条链：三种数据权威必须区分

**A. 向量事件记忆与摘要。** `memory.py`/`chatroom.py` 的 memories/chatroom_memories 保存事件摘要、重要事实、源消息、时间与embedding，context_builder按相关性召回。聊天原文仍在 messages/chatroom_messages。日历压缩另建批次和父子图，active原子转cold并清embedding。普通向量分数没有时间衰减，且默认instant_digest不产生keywords，关键词权重在该路径失效。维度不等明确返回0，避免越界但会静默漏召回。[memory.py:187](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/memory.py:187)、[memory.py:308](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/memory.py:308)、[memory_compression.py:981](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/memory_compression.py:981)

**B. 后置共享用户画像/当前活动。** 这是七份恢复结果中的重要缺项。post_sentinel并不写向量memories，它维护一份JSON document与持久jobs；用户每条有效新消息可自动入队，独立整理模型提取本人明确表达。Aion和Connor共用这份画像，不应与“各自事件记忆表隔离”混为一谈。能力上下文实际调用build_profile_context，进入两角色的通用提示面。[post_sentinel.py:212](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/post_sentinel.py:212)、[context_builder.py:262](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/context_builder.py:262)

**C. AI人格演化。** persona_evolution依据角色收到的带理由赞/踩、当天摘要修改AI自身9节人设，存before/after/diff。它修改的是角色身份、表达乃至边界/工具规则，不能用它来代表“确定性关系值”或用户事实记忆。其section_locks只在prompt中传入；应用函数按允许section key写入，没有硬编码尊重锁。[persona_evolution.py:23](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/persona_evolution.py:23)、[persona_evolution.py:817](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/persona_evolution.py:817)、[persona_evolution.py:906](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/persona_evolution.py:906)

### 后置画像值得带走的具体保护

- `source_id`以private:id/chatroom:id持久去重；只对本人用户消息建U标签，AI语句仅协助消歧；触发原文不存在或内容改变即不分析，模型后重查整段sources/messages。
- `source_ts`来自真实源消息，旧排队结果不能推翻较新确认；不同待办即使topic相同也不随便合并；任务完成/取消须有本人来源，不能凭时间过去断言。
- 手动PUT带`revision`：冲突409；条目从提交列表遗漏即保存deleted屏障。手动填入的可见事实并不永久锁死，较新本人表达仍可纠正。当前状态手动清空也有state_cleared_at。
- `epoch`在关闭时增加，pending/running作废；模型提交事务重新核验enabled、epoch、revision。关闭再打开也不能让旧结果越过epoch。revision变更会重排消息，而不是简单丢掉用户事实。
- lifecycle确定性计算：已过截止的task是unknown；普通近况默认3天、临时项目14/30天、持续项目60/180天淡出；1200字符预算保持整条事实，不把截止日期截断。
- 启动running→pending恢复、24h整理节流、原始失败输出7天清空是工程规则的有价值来源；这里的代码存在尚不等于本轮fresh-process验收通过。

上述字段是来源工程的实现事实和未来候选规则，不是本轮新冻结的 Aimy 数据结构。

### 删除/纠正必须分“删记录”与“忘记事实”

新memory_library会确认关联、去掉parents并删batch-input，却保留派生正文与聊天原文，前端明确告知。旧/api/memories DELETE仍只删行，留下来源图悬空。压缩在模型await期间取到候选快照，commit前不重验存在/内容版本，能把已删事实写回新的active摘要。本轮合成SQLite复现成立。[memory_library.py:210](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/routes/memory_library.py:210)、[memory-library.js:262](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/static/memory-library.js:262)、[memories.py:399](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/routes/memories.py:399)、[memory_compression.py:845](/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/memory_compression.py:845)

post_sentinel的deleted/revision/epoch明显强于旧向量压缩，但仍不是全局语义遗忘：删除屏障针对key/同topic匹配，源聊天还在；另topic同义提取、已写入向量表/日记/摘要/缓存的副本并无统一清除证明。源消息最终重查与写画像事务之间也非统一源revision锁。本轮只验证它的局部确定性保护，不能称全产品“删除无复活”通过。

## 4. 主动陪伴：两套调度，不能混为一套

1. **自然续聊**：模型输出NEXT_CHAT → ws广播前清文本与入schedules → ScheduleManager30秒轮询 → DELETE单次claim → `_fire_monitor`获取监控上下文、调用模型、发消息。用户新消息撤销全部待领timer，但关闭proactive仅写布尔，不删timer；claim后没有授权/用户交互epoch的最终重验。也没有独立DND/日预算。
2. **闲时自主**：actor config持久随机5–1440分钟 → 用户发话重设计时 → 30秒检查+actor lock+claim → 15个动作中选一项，异常默认rest。关闭会清未来计时与标cancelled状态包，但模型动作选择返回后仍可进入private_chat保存。finally重排下次计时不等于撤回刚生成的话。
3. **主动提起记忆**：memory_browse至少包含唤醒选动作、选日期、读后反应几个阶段；它确实有私聊提旧事路径，且会用摘要而不是原文。这比“只保存等检索”更接近用户目标，但生成质量、来源真实性、自然程度与打扰成本尚未验收。
4. **持续状态包现状**：autonomy_prompt_text直接返回空；数据库状态表写入不代表模型每轮都看到状态包。不能凭表/类型存在称完整自主心理系统可继承。

因此最可取的是“持久计时+领取+新交互作废+行为记录”的设计；Aimy应保留AIRI已有notify/chat/voice链，补一个受界定的本地调度增量，不能直接复制_fire_monitor或15个外部生活动作。

## 5. 多角色、语音、Windows 与入口补齐

- 两个主要人格id固定aion/connor。名字、persona、model、TTS voice各可配置；主体同一FastAPI/SQLite，会话分表/room type。Connor既有旧8787健康/SSE接口也有直接CLI路径，当前选择非Codex时复用统一stream_ai。Connor-Codex本地仅package.json，所指server.js与auto-responder.js缺失，不能当作完整可启动子服务。
- 群聊不是每个AI独立概率判断要不要说；正常自动群聊顺序执行两人，指名/先回复规则只决定谁先。第二人重新读取第一人消息与工具结果；manual需另触发。
- private_memos是用户备忘，不自动进AI上下文，没有actor字段；不等于某个角色私密记忆。共享画像、共同群聊与各自私聊是三种不同共享边界。
- Python桌面voice是真WebRTC VAD+整段ASR的半双工；AI在说话时读而丢音。浏览器VoiceCallPolicy则有interruptTTS adapter guard；不能把任何一侧单独等同于完整连续抢话已验证。
- TTS为文本分段并行合成，默认2worker/6pending/40段；通常100–200字符，low-latency首段12–24。每段保存MP3后推带seq的URL，供应商有整段返回并非全是byte streaming；缓存按消息/段号而非text+voice hash。取消有worker cancel和合成后复查，可参考但不得替换AIRI音频owner。
- 短语音导演的有效叶子是“原台词不变、只加白名单tag、<=200字符、幂等claim、已保存附件重播”；额外模型+ElevenLabs成本明确。源码tag表含成人候选，不进入一期。
- 看屏在camera内合成，activity的win32gui/GetLastInputInfo、OpenCV CAP_DSHOW、requirements pywin32均为真实Windows耦合；ASR的CREATE_NO_WINDOW通过getattr守卫、generation_control的taskkill有os.name守卫及process.kill后续，并不是所有Python都不能迁移。
- main实际同时注册新旧记忆路由；memory.html加载memory-library.js，UI的GET/PUT/DELETE对应真实后端。主动开关UI只有PUT enabled，无额外cancel请求。本轮只读接线，没有浏览器验收。
- Visitor Lounge当前config：chat_enabled=false、board_enabled=true、visitor8001/admin8002 loopback；桥接只接受Connor且校验Bearer。独立访客包已有密钥/会话/OAuth模块，主应用却没有统一主人身份认证。SecurityAccessMiddleware确实能阻断已block IP，不能说它从不拦截。

## 6. AIRI 当前对照与15项可汇总裁决

对照只针对实际读到的aimy-app文件；完整AIRI基线指纹由主agent统一。以下不把AIRI已有能力重新立项。

| 能力 | 当前 AIRI 证据 | AionsHome 真正新增的价值 |
|---|---|---|
| 长期事实记忆 | [memory-long-term.vue:2](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-pages/src/pages/settings/modules/memory-long-term.vue:2) 为WIP；[index.ts:15](/Users/mima1234/Documents/aimy/aimy-app/packages/memory-pgvector/src/index.ts:15) configure空事件 | 可来源追溯的事件摘要/画像、纠正/删除保护；不等于现成能接 |
| 聊天持久化 | [session-store.ts:285](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/chat/session-store.ts:285) queued persist；[session-store.ts:340](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/chat/session-store.ts:340) 用户消息稳定ID与generation检查 | 可消费现有持久化消息，不再建一套chat DB权威 |
| note/diary/task | [notebook.ts:33](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/character/notebook.ts:33) entries/tasks为内存ref；scheduleTask和getDueTasks已有 | 补持久化/到期恢复/来源，不能声称AIRI完全没有任务概念 |
| 主动notify | [store.ts:26](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/character/orchestrator/store.ts:26) pending/scheduled与[store.ts:39](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/character/orchestrator/store.ts:39) 2秒tick/3次attempt | 具体续聊政策与持久timer增量，不复制Aions全部主动runtime |
| VAD/语音输入 | [vad.ts:107](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/ai/models/vad.ts:107) createVAD；[voice-controller.ts:22](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/composables/audio/voice-controller.ts:22) core-agent VoiceController | 停顿阈值/边界案例作对比；Aions半双工不能当升级包 |
| 语音打断 | [speech-output-control.ts:39](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/speech-output-control.ts:39) 按turn/session interrupt | 只补导演/校验/幂等等有证据缺口；保留AIRI播放/取消 |
| 视觉推理 | [use-vision-inference.ts:81](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/composables/vision/use-vision-inference.ts:81) timeout+abort；[orchestrator.ts:92](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/modules/vision/orchestrator.ts:92) ReplaceSelf/capturedAt | 借鉴来源/新鲜度/无图失败规则，不接摄像头和Windows tracker |
| session summary | [summary.ts:25](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/composables/use-chat-session/summary.ts:25) 聚合reasoning/speech元数据 | 不能把函数名summary当已完成跨会话事实提取 |

成本口径：低=纯规则或一个叶子；中=需已有AIRI链适配和有限UI/状态；中高/高=涉及持久化、删除/取消并发、进程/多端或真实模型体验。尚未工程试接，不提供伪精确排期；每行有具体依赖与最小验收。

| ID | 候选/裁决 | 优先/成本 | 最小依赖边界 | 未来最小验收 |
|---|---|---|---|---|
| R01 | 后置共享画像的来源/版本/撤权规则：适配叶子 + 借鉴设计 | 高/中高 | 消费AIRI已持久化消息；Repository/ModelGateway/EventSink均需AIRI适配；不用原config/ws/FastAPI | 原文改删、关闭再开、手动revision变更时旧模型结果不能写；新进程恢复队列；输出只据本人证据 |
| R02 | 原子记忆+源消息管理：借鉴设计 | 高/高 | AIRI现有聊天session/message ID作来源；原子写入、主进程持久化、管理UI共三层 | 自动写→重启召回；纠正只留新事实；删后原文/向量/派生的预期范围明示并验证 |
| R03 | 主动搜索/时间解析/证据预算：适配叶子 | 高/中 | 提取纯parse/rank/format规则到TS，输入Repository与EmbeddingGateway；保留AIRI工具循环 | 日期/否定/同事件重复/embedding失败文本后备；回执有source ID；注入攻击当历史证据 |
| R04 | 彻底忘记的派生清理契约：借鉴失败经验；不直接复用删除实现 | 高/高 | 先明确删除一条记录与忘记事实范围，再设计统一写入口；源记录、画像、压缩、缓存需同epoch语义 | 正在总结/压缩时删除；旧API兼容；同义重抽取；派生摘要不得复活已忘记事实 |
| R05 | 日历压缩与lineage：适配叶子 + 借鉴设计，后置 | 中/高 | CalendarPlanner/LineageValidator可叶子化；模型/事务/索引适配量高，需源revision检查 | 候选在model await期间删改即拒写；冷档来源可追溯；无膨胀；失败输入保持active |
| R06 | 自然续聊NEXT_CHAT语义：借鉴设计 | 高/中 | AIRI已有spark notify/内存task；只增持久调度/开关/静默与预算策略，生成仍走AIRI聊天 | 关开关、新用户消息、切会话、隐藏/退出后pending及in-flight均不得错发；重启过期策略 |
| R07 | 闲时回忆/休息/轻主动：借鉴设计，缩范围 | 中/中高 | 仅本地rest/memory_browse/private_chat思想，依赖记忆和R06；不接购物/外发/摄像头 | idle中用户回来即使结果失效；DND/每日期望预算；不凭AI感想更新用户事实 |
| R08 | 受控语音导演/台词一致校验：适配叶子 | 中/中 | 解析与validate规则小；AIRI现有speech output/取消/voice provider；需确定音色所支持tag | 导演不能改词义/加字；取消拒晚结果；错误不重复扣费；口型/表现与语音一体实测 |
| R09 | TTS队列/缓存/半双工唤醒：不引入本期；保留AIRI链 | 无新增/整体替换高 | AIRI已VAD/ASR/provider/speech bus/interrupt，复制带第二音频生命周期 | 只对比具体首包/背压缺口后再定；真实中文延迟、顺序、抢话验证 |
| R10 | VoiceCallPolicy纯JS阈值/打断guard：可直接复用叶子，采用待选 | 低/低 | 17行无依赖UMD；AIRI已有silence/VAD参数，优先行为对照，非新pipeline | 短长停顿语料A/B；打断仅指向当前turn；不会因背景噪音打断 |
| R11 | 图像来源/新鲜度/失败上下文规则：适配叶子 | 中/中 | 沿用AIRI屏幕采集与Vision推理/ReplaceSelf上下文，不拷camera/activity链 | 只在独立看屏授权有效时采；陈旧/失败不得编造；撤权拒晚结果；原图不长期留存 |
| R12 | 反馈复盘before/after/diff：借鉴设计，后置 | 低/中 | AIRI已有角色卡/会话；只记录建议和可回退差异；关键安全边界仍代码固定 | 反馈可追溯；重复反馈不重复改；身份/权限/未成年人/危机规则不能被模型改 |
| R13 | 多角色群聊/Visitor Lounge：不纳入本期 | 无新增/高 | 一期主要单角色；双角色表和Codex/访客OAuth/多端增加运行时与身份面 | 若以后立项须单列角色/访客scope、独立身份和模型预算，不能悄悄扩一期 |
| R14 | 生活功能/设备/外部社交/成人模块：不纳入本期；只登记 | 无新增/高 | 基金、定位、家居、购物、微信/小红书、Android、成人外设均超当前边界；无来源选择 | 未来真实需求另立项；不得把调研功能表变成需求表 |
| R15 | 整套FastAPI/原生JS/Windows采集/配置：不复用整体运行时 | 无新增/高 | 不是Python法律禁用：技术上可sidecar，但部署、进程、DB、音频、权限和版本成本高，当前未定 | 未来若考虑sidecar先固定IPC/schema/生命周期/凭证边界与macOS包验收；当前仍AIRI唯一owner |

Python与TypeScript的差异是构建、运行时和维护成本，不是法律禁止。可做TS改写，也可技术上设计本地sidecar；但当前用户选择是“先拆完再定”，没有授权把Python服务变成第二套产品核心。根LICENSE本地证据为MIT，Connor-Codex package单独ISC；复制实质源码须保留对应通知。未做所有第三方依赖/资产授权全面审计，也不声称AGPL禁止商用。

## 7. 实际执行的隔离核验（共10项）

脚本只在本tmp目录创建合成SQLite、AST抽出指定源码函数体，不import工程main/config，不联网、不启动设备。目标函数执行与边界stub分开：

| 检查 | 真正执行的来源代码 | 结果/局限 |
|---|---|---|
| 关闭已有proactive timer | proactive_companionship 的7个函数（解析/可见消息事务/开关/claim） | 关闭后pending=1，claim=true；save_settings为无写stub，真实SQL在合成库 |
| 旧来源scope | routes/memories._fetch_source_rows_by_ids | 返回Connor私聊合成行；只证明该helper缺room-type限制 |
| 旧DELETE孤儿lineage | routes/memories.delete_memory | parent删掉，summary仍引用，batch_input孤儿=1；WS/sync为stub |
| 压缩期间删除复活 | memory_compression._run_calendar_compression + _insert_output真实SQL | model替身在await边界删源，原事务写出含已删事实的active摘要；正规化/preview/embedding/notify为stub，_insert_output仅去内部memory import |
| 闲时动作期间关闭 | IdleAutonomyManager、_select_action、_run_actor_once、_run_private_chat | 模型返回时fixture把enabled=false，真实编排仍调用保存；配置/摄像头/模型/持久化边界为stub，非整机E2E |
| 不同向量维度 | memory.cosine_similarity | 返回0.0；纠正历史“IndexError/垃圾分数”的误读 |
| 较旧画像确认 | post_sentinel._entry/_profile_refs/_apply_analysis + 纯policy | 旧source_ts结果changed=false，新正文保留 |
| deleted画像屏障 | 同上 | 已deleted entry不复活；不证明任意同义topic无法另建 |
| 过截止待办 | user_profile_policy.lifecycle | 返回unknown，未捏造done |
| 模型期间epoch变更 | post_sentinel._read/run_pending_once真实最终SQLite事务 | epoch从0→1后job=skipped、payload不写candidate；model/context/apply为stub，明确仅检最终版本栅栏 |

结果原字节：isolated-results.jsonl / isolated-more-results.jsonl / isolated-policy-results.jsonl。脚本：isolate_current.py / isolate_more.py / isolate_policy.py。没有真实供应商、延迟、自然语音、向量质量、重启迁移、人物体验或UI验收；不能叫整个AionsHome运行通过。

## 8. 恢复报告的具体纠偏

| 历史表述/容易误读 | 当前核验结论 |
|---|---|
| Python项目只能抄设计、无法复用代码 | 语言无关prompt/规则可复用，纯JS可叶子复用；Python代码可改写/sidecar，技术代价不是法律禁止。整套双runtime不适合本期 |
| 不同embedding维度会IndexError或垃圾分数 | cosine_similarity首行len不等就0.0；静默漏召回与同维不同模型版本问题依然成立 |
| 删除只在memory_library等两个入口 | 仍注册旧/api/memories/{id} DELETE，仅删行。新删除也只删目标，不彻底抹派生事实 |
| 只要“各自表”就完全角色记忆隔离 | event记忆分表；共享post_sentinel另有跨角色用户画像；旧source helper还允许Connor私聊来源 |
| 整个记忆没有时间/生命周期规则 | 普通vector无时间衰减；共享画像有project/context/task生命周期和source_ts较新事实保护 |
| 自动日/周/月都执行 | LEVELS有3层，但自动scheduler只for daily,weekly；两个target都读chatroom Connor模型配置 |
| 没有空闲30分钟总结 | main._auto_digest_loop实际有用户沉默30min门；它还需要40条未总结消息 |
| 动作错误永远rest，因此永不误发 | 仅选择解析异常rest；关闭during-model之后缺重验，隔离真实编排仍保存 |
| autonomy默认120min | 旧SETTINGS120min；前端当前DB轨是5–1440min随机且默认disabled |
| 注册40项能力 | 当前 CAPABILITY_DEFS AST计数35项；注册表不是全部产品功能，更不是35项均运行验收 |
| 只有album默认关 | 当前DEFAULT_OFF_ACTIONS还含board_check/board_visit/billiards_play四项 |
| config路径是DATA_DIR/data/settings.json | 实际config.py:56为DATA_DIR/settings.json |
| repo-wide无env/TOML | Visitor Lounge有pyproject.toml、visitor-lounge.toml、.env.example；未读真实.env |
| 主安全中间件从不阻断/全仓没有auth | observation.blocked时403或WS1008；主通用路由无统一主人auth；特定internal bridge有Bearer，Visitor模块有独立auth |
| Python基本跨平台/只有bat Windows | activity win32gui/GetLastInputInfo、CAP_DSHOW和pywin32依赖是明确Windows能力耦合；ASR/generation subprocess flags有guard应单独判 |
| generation_control taskkill无非Windows分支 | os.name==nt才taskkill，随后process.kill适用于其它平台；不能据此说macOS没有取消路径 |
| 从来没有tool/function schema | 常用动作是文本协议；MCPManager.get_tools_for_ai明确输出function schema |
| 多角色私密memos/Connor完整Node服务 | memos无actor不注入AI；Connor包仅manifest入口缺失，Python直接CLI另有实现 |
| AIRI没有主动/任务/语音打断 | 当前AIRI notebook/notify/orchestrator/VAD/voice interrupt均已有代码；差距应落在持久策略和具体体验验收 |

## 9. 交付索引与建议收敛

- `api-page-routes.json` / `production-module-symbols.json` / `capability-registry.json`：当前声明路由/模块/能力35项自动盘点，不能代替语义深读。
- `features.json`：55项机器可读取的入口/机制/数据/副作用/限制/绝对路径行号。
- `reuse-candidates.json`：15行裁决、成本、依赖和未来最小验收，可直接并入横向总表。
- `read-coverage.json` / `read-log.jsonl`：11份恢复文档完整阅读及当前源码已读范围、SHA256。
- `snapshot-manifest.json` / `snapshot-summary.json` / `parsed-python-paths.json`：全仓1555项元数据、安全文本指纹和458AST路径。
- `isolated-*.jsonl` + `isolate_*.py`：10项真实目标函数/事务执行及替身边界。

建议优先带走：**post_sentinel来源/版本/撤权保护 → 有来源原子记忆与纠正忘记契约 → AIRI现有链上的持久续聊 → 受控语音导演叶子**。日历压缩、人格复盘、闲时丰富生活在前述正确性和真实体验通过后再选择。该顺序为研究建议，未新增或冻结产品需求。

最终来源复核：安全文本树指纹与初始一致；没有对来源仓库/产品/Git或真实用户数据写入。
