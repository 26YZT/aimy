# AionsHome 只读源码调查与 AIRI/Aimy 复用评估

> 文档状态：定向调研参考，绑定当时来源；不是选型决定或实施授权。
> 产物时期：2026-10-10，正文明确日期。精确初稿时间未记录时保持未知。
> 保留原因：保留项目aions-audit.md模块与缺陷可追踪证据。
> 上下文风险：不可把隔离函数复现/静态语法通过当完整服务、真实设备、模型、许可发行或AIRI集成通过；复现脚本是证据不是应用开发入口。
> 原位置：`digital-lover/docs/调研/2026-10-10-四项目复用证据/aions-audit.md`；归类整理：2026-10-11。
> 阅读入口：[文档中心](../../README.md)。历史正文中的“当前、唯一、已锁定、下一步”仅适用于原时期。

调查日期：2026-10-10。源码根目录：`/Users/mima1234/Documents/资料/AionsHome-main`。接入目标采用主控指定的 `/Users/mima1234/Documents/airi-main` 原版完整桌面，**不以历史 aimy-desktop 样机为接入目标**。本报告没有改动任何来源/Aimy 工程，没有安装依赖、启动服务或调用模型，没有读取 `data/`、个人聊天/世界书/配置/API Key 内容。仓库内及适用上级目录未发现 AGENTS.md。

## 结论

AionsHome 对 Aimy **有很高的产品机制参考价值，不能直接作为一组 AIRI 插件接入**。它是以 Python FastAPI、SQLite、原生 HTML/JS、Windows 主机和 Android WebView 为基础的陪伴应用集合；原仓导入会同时带入大量无关业务、摄像头、设备活动、定位、第三方发消息/购物、智能家居、Android 监督能力。最值得提取的是：

1. **有来源的长期记忆**：原子记忆、日常/长期分类、来源消息、时间检索、主动搜索原文、日/周/月压缩和冷档案追溯。
2. **自然续聊机制**：模型决定 `NEXT_CHAT`，按角色持久化计时，新用户消息撤销待续聊；可以移植成 AIRI 上层事件与调度逻辑。
3. **持久化闲时状态**：角色自己的下次唤醒时间、可选行为列表、状态卡/行动摘要，适合参考“持续存在感”，但应只保留休息/回忆/主动说话等本地行为。
4. **表现式短语音**：将台词与说话方向分开，第二阶段只加受控语音标签并验证台词没有变化，避免额外模型改变含义；可接 AIRI 现有 TTS，而非复制整条 Python 音频管线。

移植前必须修复/规避：压缩期间删除记忆后又生成活跃摘要、关闭主动陪伴仍触发既有定时器、旧 API 绕过新记忆来源/关联保护，以及默认对网络可达客户端缺乏主应用认证。**本次已用合成 SQLite 隔离复现前三类核心行为；不是通过启动真实应用推测。**

## 全局地图与规模

口径：递归清点，排除 `vendor/public/data/.git/node_modules/build/frames/strips/webp` 及 `*.min.js`；源码/脚本/HTML/CSS/SQL 计数包含测试、Android 内嵌页面和重复资源，不能当作纯业务代码规模。

| 目录 | 主要内容 | 可读源码文件 / 行数 | 测试文件 |
|---|---|---:|---:|
| `aion-chat` | FastAPI 路由、SQLite、模型路由、记忆、语音、监控、日程、聊天/群聊、活动、陪伴内容与多个小游戏 | 654 / 203,235 | 289 |
| `AionApp` | Java Android WebView、推送/后台TTS、录音/相机/投屏桥、BLE/健康、监督、Homecoming 本机兜底 | 284 / 48,151 | 114 |
| `AionsHome-Visitor-Lounge` | 独立访客会客室：visitor key/session、OAuth/MCP、配额/队列/留言板、Codex adapter | 86 / 26,931 | 22 |
| 根目录及 `scripts` | Windows 安装/启动/关闭/数据清理与端点迁移脚本 | 10 / 1,275 | 0 |
| `AionPet` | 14种透明像素精灵动作 manifest、WebP/PNG strips/frames | 资源包 | 0 |
| `Connor-Codex` | 仅 package.json；声明 start server.js / main auto-responder.js，但这两个文件不在本地包中 | 0 | 0 |

当前 main 的入口实际是 `aion-chat/main.py`。它导入约 50 个路由模块、配置/数据库、camera/voice/schedule 等单例，以及访客会客室的部分模块；lifespan 中启动记忆总结、日历压缩、人格反馈复盘、闲时自主、设备采集、智能家居事件、微信等后台任务。不是可以从 main 中挑开关即可成为小服务的结构。证据：`/Users/mima1234/Documents/资料/AionsHome-main/aion-chat/main.py:27`、`:143`、`:192`、`:255`、`:308`。

主要执行链：

- **对话**：FastAPI chat/chatroom → context_builder 合并时间线、相关/背景记忆和能力提示 → ai_providers 的 BYOK/API/CLI 路由 → 流式结果与数据库 → WebSocket/SSE、TTS与附带动作。
- **记忆**：消息 → 显式 MEMORY/自动总结 → memories/chatroom_memories → 向量/关键词/时间召回 → 来源消息/冷档案 → context。日历压缩另存批次及输入/输出关联，旧记录转 cold 并清向量。
- **续聊**：回复内 NEXT_CHAT → ws 广播前处理可见消息 → schedules(type=proactive) → ScheduleManager → `_fire_monitor`（会获取监控上下文）→ 模型回复。
- **闲时行为**：autonomy_state 持久化角色计时/状态 → IdleAutonomyManager 30秒检查 → 选择行为 → 行为产物和公开摘要 → 重排下次唤醒。
- **Android**：原生权限/服务/桥 + WebView 共享网页；Homecoming 是本机临时聊天/记忆/日程、加密备份与回传机制，不是 macOS 桌面基础。
- **访客会客室**：另有 visitor/session/OAuth/MCP 的授权与配额系统。这不等于主 aion-chat 全局拥有认证。

## README 宣称与实际实现的边界

| 能力 | 源码证据 | 实际判断与 Aimy 缺口 |
|---|---|---|
| 向量记忆、关键词、重要度 | `memory.py:279`，评分0.6/0.3/0.1；`active_memory_search.py:281`，支持关键词和聊天原文后备 | 有真实实现；普通 recall embedding失败直接返回空（:288-290），主动搜索有文本后备。仍需 embedding版本、删除语义、角色作用域、规模/质量评测。|
| 有来源的记忆、时间和主动原文检索 | `memory.py:123/333`；`active_memory_search.py:150/367/414/453/510` | 有命令解析、相对日期、latest/earliest、打开原文邻接消息、最多两轮补充检索和上下文预算。Aion/Connor 固定角色语义须改为 Aimy 的 persona/session scope。|
| 日/周/月压缩 | `memory_compression.py:25`、`:642`、`:796`；scheduler: `compress_target()` | 三层压缩实现存在，保留 lineage、检查输出膨胀、批次事务、失败维持原记忆；自动 scheduler 只跑 daily/weekly，monthly是手动能力，不能声称自动每月已接上。存在已复现删除竞态。|
| 自然主动陪伴 | `proactive_companionship.py:40/93`、`schedule.py:303/865` | 真正有1～60分钟模型决定、持久化timer、新消息撤销逻辑；不是纯UI。没有独立“关闭后取消”保证，现有timer借用监控管线，不适合无摄像头Aimy直接照搬。|
| AI 自主生活/心情 | `autonomy_state.py:84`、`autonomy.py:2173/2306`、`persona_evolution.py:1165` | 持久状态、闲时行为、日记/动态、反馈修改人设是真的；不是统一经过验证的情绪模型。人格复盘可自动改“身份/关系/边界/工具规则”等人设段（:23-33、:1240-1256），Aimy应参考“建议+diff/回滚”，不直接借用自动改核心边界。|
| 语音唤醒/半双工与语音合成 | `voice.py`、`asr.py:133`、`tts.py`、`expressive_voice.py:66/146/197` | ASR可走OpenAI兼容或DashScope；TTS有供应商、缓存与分段播放；表演短语音绑定ElevenLabs。没有本次真实延迟/音质/抢话验证；AIRI已有语音能力优先复用，仅补缺失的短语音导演/校验机制。|
| 桌宠动作 | `AionPet/README.md`、`static/pet.html`、`capabilities.py:672` | 14种 sprite动画，PET命令能切动作；不是Live2D/VRM渲染引擎，不会直接增强AIRI现有人物骨骼/表情。适合参考动作语义，资源是否采用待独立确认。|
| 授权看屏 | `camera.py:760`、`routes/cam.py:117`、`activity.py:169/976` | 有屏幕采集与活动采集，但PC tracker强Windows，主体与摄像头/监控混合；活动采集开关默认True。不是macOS单独、显式会话授权的看屏模块。Aimy保留AIRI/macOS授权采集路线，仅借鉴“画面新鲜度/来源/失败状态”。|
| 跨设备与访客 | `homecoming/`、Android `homecoming/`；Visitor-Lounge模块 | 有复杂实现，不属于当前macOS优先的最小增量；引入会增加身份、同步冲突、远程访问和维护负担。|

## 具体代码发现（严重性按导入 Aimy 后影响评估）

### P1-1：压缩模型调用期间删除记忆，返回后仍可生成含该事实的 active 摘要

- **触发**：开始日历压缩，候选记忆已取到；在模型请求/embedding准备尚未返回时，用户删除其中一条原子记忆；之后压缩继续提交。
- **位置**：`/Users/mima1234/Documents/资料/AionsHome-main/aion-chat/memory_compression.py:845` 到 `:854` 快照候选后 await 模型；`:922` 到 `:990` 开事务直接记输入、插输出、将仍存在输入转cold，没有重读/验证输入仍存在、active、内容版本不变。`:949-954`可记录不存在的输入ID；`:982-984` UPDATE影响0行也不阻止commit。
- **影响**：已删除事实进入新的active记忆并带向量（真实embedding成功时），之后还能召回；关联指向已删除ID，来源解释失效。用户删除与正在进行的整理不一致；这是Aimy“真正忘记”的阻断问题。
- **为什么现有锁不够**：`:796-810` 的进程内 `_RUN_LOCKS` 只串行不同压缩调用，CRUD API没有取得同一锁；长模型调用也没有数据库版本快照校验。
- **隔离复现结果**：对一个候选 `delete-during-call`，模型替身在await边界用合成库删除它后，真实 `_run_calendar_compression` 仍返回 `ok:true`，库内出现 `{"content":"deleted secret fact","archive_state":"active","source_memory_ids":"[\"delete-during-call\"]"}`。
- **建议**：事务开始后对全部输入重验 `id + revision/content_hash + archive_state + deletion_epoch`；任何输入删改即丢弃/重算整批。添加按persona存储的忘记tombstone；批次输出不得跨过删除epoch；同一批事务原子提交输出、原记录冷转与审计。

### P1-2：主应用默认监听全网卡，访问审计不是主应用认证

- **触发/条件**：按仓库直接 `python main.py` 启动，8080端口对其他设备可达，外层网络/反向代理没有另外的身份网关。
- **证据**：`/Users/mima1234/Documents/资料/AionsHome-main/aion-chat/main.py:640/642` 使用0.0.0.0；`:255` `FastAPI(lifespan=lifespan)`没有全局dependencies；`:290-292`只有NoCache/GZip/SecurityAccess中间件；`SecurityAccessMiddleware` (`security_access.py:948-993`)仅在 observation.blocked 时拒绝，陌生但未block的设备继续请求；文档注释也明确 fail-open access auditing。
- **敏感接口**：`/Users/mima1234/Documents/资料/AionsHome-main/aion-chat/routes/settings.py:124` 起 `/api/settings` 返回明文API key字段；掩码字段额外存在不抵消明文返回。`routes/cam.py:78/98/117`开放相机/监控/配置操作。`routes/security_access.py:23-42`允许访问者把“当前设备”设为trusted，没有主人的确认条件。
- **范围限定**：这是缺少访问边界的部署设计风险，**不是“绕过一个已实现登录系统”**。独立Visitor-Lounge确有授权实现，不能用它推定主应用被保护。本次未联网探测任何运行实例，也未读取任何真实Key。
- **建议**：Aimy不复用此main/路由/审计作为权限基础；复用最小能力时仅走Electron受控IPC或绑定loopback带每次启动token；Key只留主进程/系统钥匙串，不回给渲染端。

### P2-1：关闭主动陪伴后已有定时器仍能触发，且借用监控路径

- **触发**：已存在active `type=proactive` timer后，在能力页关掉该角色主动陪伴或全部取消。
- **证据链**：`static/capabilities.html:216-226`、`:322-327`前端只调用开关API，无额外cancel请求；`routes/capabilities.py:91-99` → `proactive_companionship.py:36-38`只存布尔，未清timer；`schedule.py:318-327`照样取出/分发；`:875-877`只claim，不复查enabled；`:895-899`获取监控上下文，之后生成回复。
- **隔离复现**：创建1分钟timer→`set_proactive_enabled('aion',False)`→enabled=false但pending=1→`claim_proactive_timer`返回true。用户发送新消息会删timer，但“关开关”本身不做。
- **影响**：关掉后仍可能主动发一句话、调用模型及获取已配置监控画面。无摄像头Aimy也不该让自然续聊依赖“获取监控”函数。
- **建议**：关闭时事务清掉该角色pending timer、使正在生成任务失效；claim和模型/发消息前均核对授权epoch。与看屏/摄像头完全解耦；仅在单独看屏授权仍有效时才加入画面。

### P2-2：旧删除API绕过新记忆库的关联确认与清理

- **位置**：`/Users/mima1234/Documents/资料/AionsHome-main/aion-chat/routes/memories.py:399-407`仅DELETE memories id。对照 `routes/memory_library.py:210-225`会查关联、要求confirm_related、去掉source_memory_ids中的父ID并删batch-input记录。
- **触发**：压缩摘要引用一个原子记忆时，调用仍注册的旧 `/api/memories/{id}` DELETE。
- **隔离复现**：parent被删，summary的 `source_memory_ids` 仍为 `["atom"]`，batch-input孤儿记录数仍为1。
- **影响**：两个并存API删除契约不同，来源图损坏；后续追溯 `resolve_source_memories()`跳过不存在源，摘要保持可用却来源缺失。
- **建议**：只保留一个记忆服务写入口，旧路由委托同一个事务删除实现。Aimy更要定义“删除一条记录”和“忘记事实/全部派生”的不同意图。
- **明确边界**：新library在确认后保留派生摘要内容是目前有意行为，`test_memory_library.py:94-98`还明确断言摘要保留。不能把这一点说成源码意外；但它**不满足Aimy彻底忘记事实**，需额外递归清除/重算派生摘要、向量和缓存。

### P2-3：旧来源编辑可以混入另一角色私聊，作用域规则与新API不一致

- **位置**：`/Users/mima1234/Documents/资料/AionsHome-main/aion-chat/routes/memories.py:634-654`只检查source namespace/id存在；它调用的 `_fetch_source_rows_by_ids` (`:135-170`附近，chatroom SQL按id取，未join room.type)。`memory.py:150-161`读取已绑定来源同样不限制房间类型。对照新 `memory_library.py:241-242/308-310`有当前库允许room类型校验。
- **隔离复现**：合成 `room.type=connor_1v1` 的 `chatroom:secret-connor`，旧main-memory来源读取helper返回该原文。
- **影响/限定**：管理所有资料的同一用户可以编辑自己的资料，这不是凭空断言存在不同用户间未授权泄露；问题是“主AI记忆不包含另一AI私聊”的角色隔离在不同入口不一致。编辑后主AI被动证据读取可看到该条来源，而新的主动搜索范围却不包含它，导致行为难以解释。
- **建议**：从命令解析、CRUD、压缩、来源关联到读取全部传入不可由模型覆盖的 owner/persona/conversation scope；禁用旧来源入口或复用新 `_source_rows` 校验。角色隔离应由数据层统一，不只在搜索SQL上做。

### P2-4：切换embedding模型后既有向量没有版本信息或自动失效

- **位置**：`/Users/mima1234/Documents/资料/AionsHome-main/aion-chat/routes/settings.py:254-259`可直接改embedding地址/model；`database.py:138-164`记忆向量只有BLOB，没有provider/model/dim/revision元数据；`memory.py:288-305`新查询向量与旧BLOB直接比较，`:187-195`维度不同时返回0。
- **触发**：已有记忆向量后切换embedding provider/model，未手动rebuild。
- **影响**：不同维度静默不召回；同维度不同模型可能给出没有意义的相似度。存在手动重建入口不等于切换时能保证一致性。此项由完整代码链确认，未调用真实embedding供应商。
- **建议**：embedding按 `(provider,model,dimensions,normalization_version,content_hash)`标记，变更后查询排除旧版本并可见地提示后台迁移；查询时文本后备保证可解释降级。

## 推荐复用单元与最小依赖边界

成本是相对工程量，非排期承诺；未做AIRI集成跑通，不能写“可直接接”。

| 优先 | 可取内容 | 最小来源文件/函数 | 接入AIRI方式 | 相对成本 |
|---|---|---|---|---|
| 1 | 来源可追溯记忆/管理与主动原文搜索 | `memory.py`的时间/来源/向量纯函数；`active_memory_search.py`解析、rank、format；`routes/memory_library.py`数据契约/来源校验；`memory_compression.py`日历分组/lineage/预算/批次；相关database schema | Aimy独立 MemoryService，消费AIRI已完成/已保存的消息；注入结构化记忆与证据；展示来源/编辑/忘记。模型/embedding/事件走AIRI已有接口。先做原子记忆和删除，再加压缩。 | 中高 |
| 2 | NEXT_CHAT自然续聊 | `proactive_companionship.py`解析/计时语义；`autonomy_state.py`持久唤醒/claim思想；`schedule.py`仅参考消费流程 | AIRI桌面后台调度，读取“最近用户交互+静默时段+用户开关+成本预算”；生成事件走原聊天链，禁止复制_fire_monitor。 | 中 |
| 3 | 持续存在感/闲时状态 | `autonomy_state.py`状态包/随机区间/事务claim；`autonomy_niches.py`状态卡；`autonomy.py`仅rest/private_chat/memory_browse的行为思想 | 只保留本地休息、回忆和一句轻量主动互动；状态驱动AIRI现有动画/表情，不接联网购物/社交/家居/摄像头。 | 中高 |
| 4 | 表现式短语音 | `expressive_voice.py:50-119`解析、受控标签、台词一致验证；保存附件/状态幂等参考`:197`以后 | 小型speech-director adapter把方向转换成AIRI现有供应商可支持的标签/参数；播放和取消使用AIRI管线。 | 低中（算法），中（完整体验） |
| 5 | 反馈→人设建议/diff | `persona_evolution.py`输入去重/窗口/反馈结构/变更差异 | 只产用户可审阅建议；核心身份/隐私/权限边界不可由模型自动改写。 | 中，后置 |
| 6 | Sprite动作/陪伴阅读/小游戏 | `AionPet`、`book.py/routes/book.py`或独立小游戏各自边界 | 动作名映射AIRI已有表现；阅读/小游戏仅在真实需求出现后独立内容模块。 | 动作语义低；整套资源/阅读中；非当前重点 |

**不要把原文件整份copy就叫最小闭包。** 实际import图显示：

- `memory.py`顶层依赖 `config, database, ws, reply_timing, model_json`，函数内又依赖chatroom；`config`导入会创建目录和读/写settings。`memory.py`的get_embedding/哨兵调用也绑定全局配置。
- `active_memory_search.py`顶层依赖 `memory,database,aiosqlite`；上下文来源读取依赖chatroom；应提取纯解析/rank/format，并把Repository/EmbeddingGateway/Names注入。
- `memory_compression.py`顶层依赖 `ai_providers,config,database`，内部依赖chatroom/persona、memory向量和ws通知；直接copy会引入模型/人物/配置/事件整个后端。应拆为纯 CalendarPlanner、LineageValidator、CompressionService，ModelGateway/MemoryRepository/EventSink注入。
- `routes/memory_library.py`依赖FastAPI/Pydantic与上述模块；借用的是契约和校验，应重做AIRI组件与本地主进程调用，不把原HTML整个iframe塞入桌面。
- `proactive_companionship.py`依赖 `config.DB_PATH/SETTINGS/save_settings`和固定aion/connor；其status再依赖chatroom。取决策解析+事务规则即可，别导入原schedule/camera。
- `autonomy_state.py`虽比autonomy.py独立，但固定两角色、schema和动作集，仍需做persona/event适配。`autonomy.py`是大型业务编排，不能当通用调度SDK。
- `expressive_voice.py`从config、generation_control、elevenlabs_tts、memory/capabilities/tts拉依赖；先取`extract/validate_directed_text/build_director_prompt`三组纯规则，供应商和声音状态由AIRI控制。

推荐实际顺序：**记忆契约/作用域/来源与忘记 → 原子写入和搜索 → 独立续聊调度 → 缺失的表现式语音 → 事务安全的日历压缩 → 可控闲时状态**。这比先复制整套backend可检验，也符合直接继承AIRI完整桌面的方向。

## 许可与打包

- 根 `LICENSE` 为 MIT，copyright (c) 2026 death34018-hue。复制/修改实质代码应保留其版权与许可证文本；不是需照搬品牌/人设/私有数据的理由。
- `Connor-Codex/package.json`单独声明ISC，同时依赖@openai/codex 0.144.1；包入口文件缺失，不能把该package当完整聊天服务。
- Python大多数依赖未锁定，仅edge-tts固定、websockets下界等；含pywin32硬Windows依赖，原requirements不适合作为macOS sidecar依赖清单。原生音频/ffmpeg/OpenCV、BLE、Android都各需环境验证。
- Android依赖AndroidX、OkHttp、BouncyCastle、JUnit，版本在app/build.gradle；Visitor-Lounge有独立pyproject和依赖范围。
- 第三方vendor/public未作为第一方代码深读；检索发现markdown-it带独立MIT文本，其他包需按实际选用清单重建NOTICE/SBOM，不继承上游全部vendor目录。
- AionPetREADME说明可复制资源格式，但未在该子目录找到独立素材来源/授权台账。public中的人物图、音效、壁纸、字体等也不应凭根MIT就认定所有第三方权利已经核清。Aimy优先保留原AIRI/自有角色资源，若选用具体资产再逐项确认来源。这里是证据不足的接入限制，不是指控侵权。

## 实际验证与未验证

**已完成**：

- 全仓目录、源码扩展名、入口/路由、依赖、测试/Android权限和许可证盘点；排除vendor/public/data等。
- 458个Python文件用 `ast.parse` 全量语法检查：0错误。179个JS/CJS/MJS文件用Node `--check`：0错误。未运行脚本正文。详细结果：`/tmp/aimy-four-projects-20261010/aions-static-checks.json`。
- 深读上述核心调用链、查调用方与前端动作，确认主app没有另外全局认证层，关主动陪伴没有前端额外取消联动。
- 四项合成数据隔离检查：关闭后timer仍可claim、旧来源helper接受另一角色私聊、旧DELETE留下lineage和batch-input、压缩期间删除事实又出现active摘要。脚本 `/tmp/aimy-four-projects-20261010/aions-isolated-check.py`，结果 `/tmp/aimy-four-projects-20261010/aions-isolated-results.jsonl`。

**隔离检查可信边界**：只用AST挑出指定函数体，去掉FastAPI decorator，在临时合成SQLite与stdlib异步薄封装上执行；没有import项目main/config，不触发原库/配置访问。压缩检查使用原 `_run_calendar_compression` 事务逻辑和 `_insert_output` SQL，后者唯一去掉内部 `from memory import _pack_embedding`并注入无网络helper；embedding替身返回None，所以该helper在这次路径不会执行，去掉import不改变被验证的删除/插入行为。模型替身只在await点删除合成候选，模拟并发用户删除。模型输出正规化/preview/候选/通知由确定性替身提供；这验证的是事务缺少重验输入的核心缺陷，**不是完整应用端到端测试通过**。

**未完成/不可声称通过**：没有安装或运行全部单测/Android构建、桌面/浏览器端到端、真实模型/向量/TTS、macOS打包、数据重启迁移、海量记忆性能、第三方资产和依赖全量许可审计；没有运行中实例的远程可达性/身份网关检查；没有AIRI实际插件集成。全仓静态语法覆盖与核心人工追踪也不意味着约28万行逐行人工审计。

上游版本校对由主控统一执行；主控报告本地可比源码与GitHub main `c0d4c2e190ead5713f61d09ac572a641a0f5e727`（2026-10-08）一致，本子Agent未独立联网重验。
