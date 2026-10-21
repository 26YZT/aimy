研究完成。以下为最终报告（全程只读，未写入任何文件）。

---

# AionsHome 拆解报告

**Base:** `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/`

---

## 0. 全局定位

单人（作者自称 Connor 的宿主）自用的**AI 伴侣/桌宠 OS**。核心是一台 Windows 机器上的 FastAPI 单体（`aion-chat/`，`0.0.0.0:8080`），同机跑 SQLite 存全部状态，通过 Cloudflare Tunnel 暴露到公网；客户端是 Chrome Kiosk（壁纸模式）+ 原生 Android Java App + PWA。**没有多用户概念，没有登录，没有租户隔离** —— 这决定了后面几乎所有的设计取舍。

---

# PART A — 后端

## Q1. 应用装配与后台任务清单

### FastAPI 装配

`aion-chat/main.py`（643 行）

- `app = FastAPI(lifespan=lifespan)` —— 没有 title/version/description，裸构造。
- **中间件 3 层**（顺序即执行顺序）：
  1. `NoCacheStaticMiddleware`（自定义 Starlette `BaseHTTPMiddleware`）—— 拦截 `/public/wallpaper/`，仅允许客户端 IP 前缀 `("127.","192.168.","::1","localhost")`；对 `/static/` 强制 `Cache-Control: public, max-age=0, must-revalidate, no-transform`；对 HTML 追加 `no-transform` 以防 Cloudflare 改写导致 Android 端 asset-manifest 哈希不匹配。
  2. `GZipMiddleware(minimum_size=1000, compresslevel=5)`
  3. `SecurityAccessMiddleware(service=security_access_service)` —— 纯 ASGI 包装，不是 `BaseHTTPMiddleware`
- **静态挂载 8 处**：`/static`、`/entertainment-assets`、`/uploads/album`（必须在 `/uploads` 之前注册）、`/uploads`、`/songs`、`/cr-uploads`、`/public`、`/screenshots`、`/aion-pet`（→ `BASE_DIR.parent / "AionPet"`）
- **路由器 ~75 个** `app.include_router(...)`。其中 `repair_router` 刻意放在中间件块之前；billiards 包在 try/except 里，失败不阻断启动。
- **页面路由 ~90 个** `@app.get`，全部 `FileResponse(..., headers={"Cache-Control": "no-cache, no-store, must-revalidate"})`。
- **唯一内联 WebSocket**：`@app.websocket("/ws")`（未拆到路由文件）
- 模块级副作用：`security_access_service = SecurityAccessService(DATA_DIR / "security_access")` 在 import 时构造；`_QuietCamFilter` 过滤 uvicorn access log 里的 `/api/cam/frame`、`/api/cam/status`，并把 `asyncio` logger 压到 `CRITICAL`。
- 启动：`uvicorn.run("main:app", host="0.0.0.0", port=8080, reload=("--reload" in sys.argv))`
- `main.py` 第 11 行把 `AionsHome-Visitor-Lounge/src` 插入 `sys.path`，直接 import `visitor_lounge.home_board` 与 `lounge_context_bridge` —— **访客服务不是独立进程的纯边界，主进程也吃它的模块**。

### 启动钩子执行顺序（`lifespan`，逐字顺序）

```
init_db() → post_sentinel.start() → init_music_station() → restore_active_windows()
→ migrate_legacy_daily_capsules() → cam 配置加载/open_camera/start_monitoring
→ voice.set_event_loop/set_ws_manager → schedule_mgr.start() → pc_tracker.start()
→ pc_display_tracker.start() → fund_scheduler.start()
→ 5 个 asyncio.create_task(...) → idle_autonomy_mgr.start() → board_patrol_mgr.start()
→ ha_event_listener.start() → wechat_mode_dispatcher.start()
→ openclaw_weixin_runtime.start() → security_access_service.start(manager.broadcast)
→ await billiards_service().start()
```

### 后台任务全量清单

**A. `threading.Thread(daemon=True)` —— 8 条**

| 线程 | 文件:行 | 函数 |
|---|---|---|
| PCActivity | `activity.py:178` | `pc_tracker.start()` |
| PCDisplay | `activity.py:316` | `pc_display_tracker.start()` |
| 语音主循环 | `voice.py:71` | `voice._main_loop` |
| 摄像头采集 | `camera.py:452` | `cam._capture_loop` |
| ESP32 采集 | `camera.py:532` | `cam._esp32_capture_loop` |
| 摄像头监控 | `camera.py:1138` | `cam._monitor_loop` |
| 日程轮询 | `schedule.py:278` | `schedule_mgr._check_loop` |
| 基金定时 | `fund.py:476` | `fund_scheduler._run_loop`（`class FundScheduler` @463） |

**B. asyncio 后台循环 —— 15 条**

main.py 直接创建的 5 个：

| Task | 函数 |
|---|---|
| `digest_task` | `_auto_digest_loop()` — 睡 30 min，比对 `messages` 最大 `created_at` 与 chatroom 群消息，空闲 ≥30 min 触发 `auto_digest()` |
| `cr_digest_task` | `_connor_1v1_auto_digest_loop()` |
| `compression_task` | `auto_calendar_compression_loop()`（`memory_compression_scheduler.py:137`） |
| `persona_evolution_task` | `main_ai_persona_evolution_loop()` |
| `connor_persona_evolution_task` | `connor_persona_evolution_loop()` |

各模块 `start()` 内部 `asyncio.create_task` 自行拉起：

| 服务 | 文件:行 | 拉起方式 |
|---|---|---|
| `post_sentinel` | `post_sentinel.py:677` start / `686` | `asyncio.create_task(_loop(), context=contextvars.Context())` |
| `security_access` | `security_access.py:848` | `_worker()` 消费 `asyncio.Queue(maxsize=512)` |
| `wechat_mode_dispatcher` | `wechat_mode_dispatcher.py:119`→`122` | `create_task(self._run())` |
| `openclaw_weixin_runtime` | `wechat_openclaw_runtime.py:155`→`159` | `create_task(self._run_loop())` |
| `home_assistant_events` | `home_assistant_events.py:37` start / `53` | `_run()`（`ha_event_listener` @496） |
| `IdleAutonomyManager` | `autonomy.py:2311`→`2313` | `create_task(self._loop())`（`idle_autonomy_mgr` @2394） |
| `BoardPatrolManager` | `AionsHome-Visitor-Lounge/src/visitor_lounge/board_patrol.py:105`→`107` | `create_task(self._loop())`；每个 actor 再 `create_task(self.run_due(actor))` @137 |
| billiards | `billiards/` | `await billiards_service().start()`（唯一被 await 的） |

注意 `init_music_station()` 与 `restore_active_windows()` **不是后台任务**，是启动期一次性 await（建表回填 / 从 `runtime_state` 恢复 last-active）。

---

## Q2. `ai_providers.py`（1843 行）—— LLM 抽象层

### 抽象形态：**不是类继承，是 if/elif 平面分派**

核心 `stream_ai(...)` @1769：

```python
async def stream_ai(messages, model_key, meta=None, temperature=None, max_tokens=None,
                    cancel_event=None, *, include_device_context=True, request_timeout=120):
    if include_device_context: messages = with_current_device_context(messages)
    model_key = resolve_model_key(model_key)
    # cam_user/cam_trigger -> user, cam_log -> assistant 角色归一化
    cfg = MODELS.get(model_key)
    if is_model_deprecated(model_key):
        yield f"[错误] 模型线路已停用: {model_key}"; return
    normalized = filter_audio_attachments_for_model(normalized, include_audio=bool(cfg.get("audio", False)))
    if not cfg.get("vision", True) and _messages_have_images(normalized):
        yield f"{CLI_STATUS_PREFIX}哨兵模型正在识别图片内容..."
        normalized = await _sentinel_describe_images(normalized)

    async def _raw_chunks():
        if   cfg["provider"] == "siliconflow":    ...
        elif cfg["provider"] == "gemini":         ...
        elif cfg["provider"] == "aipro":          ...
        elif cfg["provider"] == "custom_openai":  ...
        elif cfg["provider"] == "gemini_cli":     ...
        elif cfg["provider"] == "antigravity_cli":...
        elif cfg["provider"] == "codex_cli":      ...
        else: yield f"[閿欒] 鏈煡 provider: ..."    # 源码里就是乱码

    think_filter = ThinkTagReasoningFilter(meta)
    async for chunk in _raw_chunks():  # 可取消，StreamActivity / CLI_STATUS 直通，其余过 think_filter
```

**同一分派轴上还有第二条正交维度**：`transport_mode ∈ {"legacy","safe_live"}`（`MODEL_TRANSPORT_MODES`、`SAFE_LIVE_MODEL_DEFAULTS`），由 `realtime_stream_transport.consume_realtime_transport(mode=...)` 在 `safe_consumer` / `legacy_consumer` 间选路，附带 TTS「先回退再播音」逻辑。这是历史迁移留下的双轨。

### 支持的 Provider（7 条 + 1 条哨兵路径）

| provider | 函数 | 端点 |
|---|---|---|
| `siliconflow` | `call_siliconflow` @487 | `https://api.siliconflow.cn/v1/chat/completions` |
| `gemini` | `call_gemini` @540 | `generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse&key=` |
| `aipro` | `call_aipro` @586 | `https://shufulei.net/v1/chat/completions` |
| `custom_openai` | `call_custom_openai` @643 | 用户自填 base_url |
| `gemini_cli` | `call_gemini_cli` @953 | 本地 CLI 子进程（**已废弃** `DEPRECATED_MODEL_PROVIDERS`） |
| `antigravity_cli` | `call_antigravity_cli` @1108 | 本地 CLI 子进程 |
| `codex_cli` | `call_codex_cli` @1438 | Codex 子进程；另有 `call_codex_sentinel` @1494 |

全部是 `async def ... yield` 异步生成器。

### 流式 / 工具调用 / 重试

- **流式**：全部 SSE 或子进程 stdout 逐块 yield。非流式调用者走 `simple_ai_call` @1604 收集整段。
- **工具/函数调用**：**`ai_providers.py` 里没有**。唯一产出 OpenAI function schema 的是 `mcp_client.get_tools_for_ai()`（输出 `{"type":"function","function":{...}}`），即工具循环在 MCP 那侧，不在 provider 抽象里。
- **重试/回落**：**完全没有**。没有 try/retry，没有指数退避，没有跨 provider failover。provider 异常被直接当作中文字符串 yield 进流（客户端只能当正文渲染）。这是该文件最值得注意的结构性缺口。

### API Key 存放

`aion-chat/data/settings.json`（明文 JSON），经 `config.get_key(provider)` 取：`elevenlabs_tts_key`、`gemini_key`、`gemini_free_key`、`aipro_key`、`minimax_tts_key`、`siliconflow_key`。`load_settings()` 还能从 `所需要的API.txt` 里解析种子 key。

### Provider 特化 hack（全部实打实）

- `GEMINI_SAFETY_SETTINGS`：四类安全类别全设 `BLOCK_NONE`。
- `CLI_STATUS_PREFIX = "\x00CLI_STATUS:"` —— 用 NUL 字节前缀在正文流里夹带状态（含乱码那一行 `[閿欒]`）。
- `ThinkTagReasoningFilter` @68 —— 跨 chunk 流式状态机，把 `` 块搬到 `meta["reasoning_content"]`；`THINK_TAG_OPEN/CLOSE` 常量。
- `GeminiCliNoiseFilter` @226 —— 跨 chunk 状态机，`_NOISE_BLOCK_TRIGGERS = [('<image_description>','</image_description>'), ('<thought>','</thought>'), ('Footnote{','}'), ('Footnote {','}')]`，`_NOISE_LINE_PREFIXES = ('CRITICAL INSTRUCTION','Currently no further tools')`。
- `_ensure_gemini_accessible` —— 把文件从 `Connor-Codex/uploads/` 复制出去，因为 Gemini CLI 读不到该目录。
- Codex 专属机器一大堆：`_CODEX_SCRIPT`、`_CODEX_HOME`、`_CODEX_CHAT_HOME`、`_build_codex_chat_environment`、`_build_codex_chat_command`、`_codex_semaphore()/_CODEX_SEMAPHORE_LIMIT`（并发限流）、`_codex_reasoning_summary`、`_apply_codex_usage_meta`。
- **哨兵模型描述图片**：`_messages_have_images` / `_sentinel_describe_images` @1667 —— 非视觉模型收到图片时，先由一个视觉哨兵转写文本。
- 原始响应落盘：`MODEL_RAW_RESPONSE_DIR = DATA_DIR/"model_raw_responses"`，保留 `3*24*60*60` 秒，`_save_model_raw_response` / `_cleanup_model_raw_responses`。

---

## Q3. `database.py`（1051 行）

**是裸 `aiosqlite` + 手写 SQL。无 ORM，无迁移框架，无 Alembic/类似物。**

### 并发处理 —— 这是最弱的一环

```python
def get_db():
    return aiosqlite.connect(DB_PATH)
```

- **每次调用开新连接**，无池化、无 `threading.Lock`、无 `PRAGMA journal_mode=WAL`。
- 仅设 `PRAGMA foreign_keys = ON`。
- 8 条 daemon 线程 + 15 条 asyncio 循环共写同一个 `chat.db`，靠 SQLite 默认的 rollback-journal + busy 等待兜底。这是全项目最大的并发风险点。

### 迁移

`init_db()` 是一个长函数，通篇 `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`。唯二的"迁移"是 **ad-hoc 内联**：

- `book_annotations` 重建：`PRAGMA foreign_keys = OFF` → CREATE → 拷贝 → `PRAGMA foreign_keys = ON`
- cam 配置 `auto_interval` → min/max 拆分重构

另外 `config.py` 的 `_is_test_process()` 会把 `DB_PATH` 重定向到临时目录并 `atexit` 清理。

### 表清单：**98 张，49 张在 database.py，49 张散落在各功能模块**

> 这本身就是结论：**没有集中式 schema 注册表**，每个功能模块自己 bootstrap 自己的表。新功能 = 新表在你自己的模块里 `CREATE TABLE IF NOT EXISTS`。

**database.py 内的 49 张**

| 表 | 用途 |
|---|---|
| `book_annotations` | 电子书批注 |
| `book_chapters` | 电子书章节正文 |
| `book_highlights` | 电子书高亮 |
| `bookkeeping` | 记账流水 |
| `books` | 书库元数据 |
| `chatroom_digest_anchors` | 群聊摘要锚点 |
| `chatroom_memories` | 群聊长期记忆 |
| `chatroom_messages` | 群聊消息（`id, room_id, sender, content, attachments, created_at`） |
| `chatroom_rooms` | 群聊房间 |
| `conversations` | 私聊会话 |
| `daily_memory_compress_log` | 每日记忆压缩日志 |
| `daily_memory_compress_reviews` | 每日压缩复核 |
| `date_messages` | 约会模式消息 |
| `date_sessions` | 约会会话 |
| `diary_entries` | 日记 |
| `fund_holdings` | 基金持仓 |
| `gifts` | 礼物记录 |
| `health_heart_config` | 心率监测配置 |
| `health_heart_events` | 心率异常事件 |
| `health_heart_state` | 心率当前状态 |
| `health_miband_activity` | 小米手环活动 |
| `health_miband_commands` | 手环指令队列 |
| `health_period_entries` | 生理期记录 |
| `health_ring_heart_rates` | 戒指心率序列 |
| `health_ring_latest` | 戒指最新值 |
| `health_weight_entries` | 体重记录 |
| `heart_whispers` | 心声/低语 |
| `idle_events` | 空闲事件 |
| `life_trajectory` | 生活轨迹 |
| `memories` | 长期记忆（`id, content, type, created_at, source_conv, embedding`） |
| `memory_compression_batch_inputs` | 压缩批输入 |
| `memory_compression_batch_outputs` | 压缩批输出 |
| `memory_compression_batches` | 压缩批 |
| `memory_compression_jobs` | 压缩任务 |
| `messages` | 私聊消息（`id, conv_id, role, content, created_at`） |
| `moment_comments` | 朋友圈评论 |
| `moment_reactions` | 朋友圈表情 |
| `moment_read_anchor` | 朋友圈已读位点 |
| `moments` | 朋友圈动态 |
| `persona_evolution_items` | 人格演化条目 |
| `persona_evolution_runs` | 人格演化运行 |
| `playground_logs` | 试验场日志 |
| `private_memos` | 私密备忘录 |
| `runtime_state` | 通用 K/V 运行时状态（`key, value, updated_at`） |
| `schedules` | 日程 |
| `sync_events` | 跨设备事件日志（`seq, event_type, entity_type, entity_id, payload, created_at`） |
| `theater_conversations` | 剧场会话 |
| `theater_messages` | 剧场消息 |
| `wishes` | 愿望池 |

**散落模块内的 49 张**（表名 → 定义文件）

`app_supervision_commands` (app_supervision_ai.py)；`autonomy_actor_configs`、`autonomy_state_packets` (autonomy_state.py)；`autonomy_niche_cards` (autonomy_niches.py)；`candidates`、`settings`、`shopping_trips`、`wishlist` (taobao_shopping.py)；`chatroom_memory_source_edit_log` (chatroom.py)；`controls`、`events`、`files`、`jobs`、`runtime`、`tasks` (repair_store.py)；`english_learning_audio`、`english_learning_cards`、`english_learning_packs`、`english_learning_utterances`、`english_learning_vocabulary` (english_corner.py)；`family_user_events` (family_events.py)；`homecoming_devices`、`homecoming_snapshot_exports` (homecoming/devices.py)；`homecoming_import_results`、`homecoming_import_sessions`、`homecoming_return_operations`、`homecoming_return_packages`、`homecoming_summary_coverage` (homecoming/return_store.py)；`lounge_visit_messages`、`lounge_visits` (lounge_visit_repository.py)；`memory_compression_schedule` (memory_compression_scheduler.py)；`memory_source_edit_log` (routes/memories.py)；`message_ingress_dedupe` (message_dedup.py)；`music_station_ignored_requests`、`music_station_playlist_tracks`、`music_station_playlists`、`music_station_requests`、`music_station_tracks` (music_station.py)；`photo_views`、`photos` (album.py)；`post_sentinel_backups`、`post_sentinel_document`、`post_sentinel_jobs` (post_sentinel.py)；`seeky_config`、`seeky_memory_apply_log`、`seeky_memory_review_items`、`seeky_memory_reviews`、`seeky_messages` (routes/seeky.py)；`theater_studio` (theater_studio.py)。

> 注意 `settings` 与 `runtime` 这两个**通用名**直接被 taobao_shopping.py / repair_store.py 占用，而 `settings.json` 文件又是另一套配置体系 —— 命名是冲突的。

---

## Q4. `config.py`（545 行）

**存储：JSON 文件 + 模块级单例**，不是 DB、不是 env。

`SETTINGS = load_settings()` 在 import 时求值。

### 路径常量

`BASE_DIR`（=aion-chat）、`PUBLIC_DIR`（上级 `/public`）、`DATA_DIR`、`DB_PATH = DATA_DIR/"chat.db"`、`UPLOADS_DIR`、`ALBUM_IMAGES_DIR`、`SONGS_DIR`、`CODEX_UPLOADS_DIR = BASE_DIR.parent/"Connor-Codex"/"uploads"`、`SCREENSHOTS_DIR`、`MONITOR_LOGS_DIR`、`TTS_CACHE_DIR`（500MB 上限）、`THEATER_TTS_CACHE_DIR`、`DIARY_TTS_CACHE_DIR`。

### 配置文件

`SETTINGS_PATH`、`WORLDBOOK_PATH`、`CHAT_STATUS_PATH`、`CAM_CONFIG_PATH`、`DIGEST_ANCHOR_PATH`、`INDEX_PATH = CHATS_DIR/"_index.json"`。

### 模型注册表

`BUILTIN_MODELS`（绝大多数被注释掉）、`ANTIGRAVITY_ENABLED_MODELS`（一个 tuple，**靠注释项来开关**）、`refresh_custom_models()`、`MODELS`、`DEFAULT_MODEL = "Gemini-3.5-flash"`、`resolve_model_key`、`is_model_deprecated`、`DEPRECATED_MODEL_PROVIDERS = {"gemini_cli"}`、`DEPRECATED_MODEL_KEYS = {"CLI-3.1pro","AGY-3.1pro"}`、`MODEL_TRANSPORT_MODES = {"legacy","safe_live"}`、`SAFE_LIVE_MODEL_DEFAULTS`、`DEFAULT_CAM_CFG`、`ALLOWED_TYPES`。

### 设置 UI

**有**：`aion-chat/static/settings.html`（60,379 B）。端点集中在 `routes/settings.py`，约 35 个，覆盖 `/api/models`、`/api/settings`（GET/PUT）、`/api/settings/{temperature,video-call,image-gen,song-gen,wechat-bridge,gemini-cli-tools,pet,health-share}`、`/api/worldbook`、`/api/chat_status`、`/api/tts*`（含 ElevenLabs/Edge voice 列表）、`/api/home/layout`。

### Windows 路径假设

**比预期少，也控制得比较干净**：全是 `os.name == "nt"` 守卫的 subprocess flag，**没有 `os.startfile`、没有 `winreg`、没有 `wmic`**。

| 位置 | 内容 |
|---|---|
| `antigravity_cli.py:48` | `os.environ.get('LOCALAPPDATA')` |
| `antigravity_cli.py:80` | `{'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt'` |
| `ai_providers.py:1160` | `Path(os.environ.get("LOCALAPPDATA") or Path.home()/"AppData"/"Local")`（`_CODEX_CHAT_HOME`） |
| `generation_control.py:123` | `taskkill /PID x /T /F`，`creationflags=0x08000000`（CREATE_NO_WINDOW） |
| `asr.py:72` | `CREATE_NO_WINDOW` |
| `repair_worker.py:22,48` | `CREATE_NO_WINDOW \| CREATE_NEW_PROCESS_GROUP`，`os.name=="nt"` 守卫 |

真正的 Windows 绑定其实在 `.bat`/`.ps1`（见 PART B），Python 层已经基本可移植 —— 但 `taskkill` 那处没有非 Windows 分支。

---

## Q5. `ws.py`（305 行）+ WebSocket

### 连接管理器

`class ConnectionManager`，`manager = ConnectionManager()` 单例 @304。内部状态：

`active: list[WebSocket]`、`tts_clients`、`_tts_message_clients`、`_tts_generation_clients`（`WeakKeyDictionary`）、`_tts_fallback`、`client_ids`、`pet_clients`、`_aion_last_active` / `_connor_last_active`。

**`connect()` 只做 `ws.accept()`。零鉴权。**

`send_tts_event` 按 `active_at` 排序挑出**唯一一个** TTS 归属客户端（避免多端同时说话）。

### 客户端 → 服务端（内联在 `main.py` 的 `/ws`）

| type | 行为 |
|---|---|
| `ping` | 回 `{"type":"pong"}` |
| `tts_state` | `manager.set_tts_state(...)` |
| `register_client` | `manager.register_client_id(...)` |
| `pet_state` | `manager.set_pet_state(...)` |
| `step_diag` | `await manager.broadcast(msg, exclude=ws)` |

### `broadcast()` 扇出管线

依次执行：`generation_event(data)` → `expressive_voice.prepare_message` → `proactive_companionship.process_visible_message_event` → `autonomy_state.process_persona_message_event` → `_with_private_notification_sender` → 若类型属于 sync 白名单则 `sync_events.persist_sync_event` 并附 `sync_seq` → 交给微信镜像 → 逐个 `send` 给 `active` 中除 `exclude` 外的每个 socket，统计 `sent`/`failed`。

### 服务端 → 客户端事件类型（按出现频次，已剔除其它 JSON 噪声）

`msg_created`(46)、`chatroom_*`(17)、`done`(16)、`private`(15)、`music`(15)、`system_notice_order`(14)、`debug`(14)、`chatroom_msg_created`(12)、`chunk`(10)、`text`(9)、`memory_added`(8)、`system_model_context`(7)、`schedule_changed`(7)、`msg_updated`(7)、`chatroom_msg_updated`(7)、`wallet_update`(6)、`start`(6)、`monitor_log`(6)、`moment_new`(6)、`error`(6)、`cli_status`(6)、`toy_command`(5)、`memory_record`(5)、`esp32_bridge`(5)、`chatroom_msg_deleted`(5)、`pet_command`(4)、`msg_deleted`(4)、`image_url`(4)、`connor_done`(4)、`cam_check`(4)、`web_search`(3)、`theater_msg_created`(3)、`system_msg`(3)、`stream_error`(3)、`song_gen_start`(3)、`preparing`(3)、`poi_search`(3)、`monitor_alert`(3)、`moment_reaction`(3)、`memory_updated`(3)、`image_gen_start`(3)、`health_ring_heart_rates_updated`(3)、`health_heart_events_updated`(3)、`generated_song`(3)、`device_context_changed`(3)、`conv_created`(3)、`chatroom_room_created`(3)、`autonomy_state_changed`(3)、`activity_check`(3)。

1–2 次出现的：`wish_pulled`、`wish_fulfillment`、`wish_updated/deleted/created`、`video_call_ring`、`video_url`、`video`、`theater_conv_*`、`theater_msg_updated/deleted`、`taobao_trip`、`subscribe_events`、`stream_reset`、`state`、`stat`、`song_gen_done/failed`、`seeky_digest`、`seeky_compressed`、`security_alert`、`schedule_alarm`、`round_start`、`proactive_companionship_changed`、`pat`、`parsed`、`moment_comment`、`memory_deleted`、`lounge_visit_report`、`image_gen_failed`、`health_share_changed`、`health_ring_updated`、`health_heart_event_created`、`group`、`function`、`family_event`、`diary_new`、`date_stage`、`conv_updated`、`connor_wallet_update`、`connor_status`、`connor_start`、`chatroom_song_gen_failed`、`chatroom_settings_updated`、`chatroom_room_updated`、`chatroom_reply_failure`、`capability_config_changed`、`aion_done`、`activity_log`、`all`、`tts_merged`、`tts_done`、`tts_chunk`、`triple_single/triple_pair/triple`、`widget_state_changed`、`usage`、`unknown`、`status`、`stopped`、`single`、`string`、`object`、`rocket`、`straight`、`streamablehttp`（最后这批里有一部分是别处 JSON 的误命中，不建议当协议用）。

**类型名是自由字符串、无枚举、无 schema、无版本协商** —— 80+ 个魔法字符串散落在各业务模块里直接 `manager.broadcast({"type": "..."})`。

---

## Q6. `security_access.py`（994 行）—— 安全模型

模块 docstring 第一行自陈：`"""Independent, fail-open access auditing for AionsHome."""`

**结论：整个系统没有认证。**

它是**观测与审计**，不是门禁。`SecurityAccessMiddleware` 是纯 ASGI 包装，只旁路记录。信任判定完全基于**网络来源**：

- `classify_ip(ip, has_cloudflare_metadata)` → `cloudflare` / `localhost` / `tailscale` / `lan` / `public`
- 自动信任：`localhost`、任何已在 `_devices` 的 `device_id`、任何在 `_trusted_ips` 的 IP。**LAN 与 Tailscale 被视为默认可信来源。**
- 签名 Cookie `COOKIE_NAME = "aion_security_device"`（HMAC-SHA256，32 字节密钥 base64 存在 `state.json`）—— 只用于**给设备打指纹**，不是访问凭证。
- 封禁需要 `can_block_ip()` → `address.is_global`。**即 LAN/Tailscale 地址永远无法被封禁。**
- Tailscale 靠 CGNAT 段 `100.64.0.0/10` 识别；另检测 Cloudflare 头。
- 告警：`unknown_device`（warning）、`single_ip_rate`（180 req/min）、`distinct_ip_rate`（300s 内 10 个不同 IP），后两者标 "serious"，1800s 冷却。
- 地理查询 `https://ipwho.is/{ip}`，丢到 worker 线程，磁盘缓存 7 天 / 1 小时。
- 审计轨迹：append-only JSONL `data/security_access/{YYYY-MM-DD}.jsonl`。
- 单个 asyncio worker 消费 `asyncio.Queue(maxsize=512)`，满时 serious 事件挤掉 low-level，广播 `{"type":"security_alert","data":...}`。
- 路由 `routes/security_access.py`（`prefix="/api/security-access"`）：`GET /alerts/pending`、`POST /devices/trust`、`POST /alerts/{id}/ack`、`POST /alerts/{id}/trust-source`、`POST /alerts/{id}/block-24h`。

**风险直白说**：一个 `0.0.0.0:8080` 的服务，配一个「审计但放行」的中间件、一个能读全部聊天记录/摄像头/麦克风/智能家居/健康数据的 API，唯一的边界是 Cloudflare Tunnel 的 URL 隐蔽性。同 LAN 任何设备（含访客 WiFi、被入侵的 IoT）都是默认可信、不可封禁的。对于 LAN 暴露的服务，这**不能算安全模型，只能算事后取证**。

---

## Q7. 同步 / 多设备

### 机制：**自建 seq 事件日志 + 重连回放。不是 Tailscale 层、不是 LAN 发现、不是轮询。**

`sync_events.py`（128 行）docstring 说得很清楚：保留 legacy WS 事件名不动，只在同一 payload 上加单调 `sync_seq`，重连客户端通过 `/api/sync/changes` 回放。

- `_ENTITY_BY_EVENT` 把 **25 个** legacy 事件名映射到 10 类实体：`conv_created/updated/deleted`→conversation；`msg_created/updated/deleted`→message；`chatroom_msg_created/updated/deleted`→chatroom_message；`chatroom_room_created/updated/deleted`→chatroom_room；`memory_added/updated/deleted/memory_collection_changed`→memory；`moment_new/updated/deleted`→moment；`moment_comment/moment_comment_deleted`→moment_comment；`moment_reaction/moment_reaction_removed`→moment_reaction；`chatroom_settings_updated`→chatroom_settings。
- `persist_sync_event` 写 `sync_events`，每第 100 个 seq 执行 `DELETE WHERE seq <= MAX(seq) - 20000`（**保留窗口 2 万条**）。
- `sanitize_sync_event` 用 `autonomy_state.strip_autonomy_state` 从持久化 payload 里剥掉隐藏人格元数据 —— 一个刻意的「私有状态不跨设备」边界。
- `broadcast_synced(broadcaster, event, seq=None)`：广播一次，保留 legacy type，附加 durable cursor；表未就绪时 `seq=None` 降级，前台刷新兜底。

### 拉取端点

`routes/sync.py`（62 行）：`GET /api/sync/changes?after=<int>&limit=<1..500>` → `{events, latest_seq, has_more, reset_required}`。当客户端游标掉出保留窗口（`after < min_seq - 1` 或 `after > latest_seq`）时置 `reset_required=True`。

### 冲突处理

**没有 CRDT，没有向量时钟。** 语义就是「服务端单点写入 → 单调 seq → 客户端顺序重放」。冲突不存在，因为写入方只有服务端一个。跨设备配对/签名相关的字段（`public_key_spki_b64`、`signing_public_key_spki_b64`、`homecoming_return_packages` 的签名）在 `homecoming/devices.py` + `homecoming/return_store.py`，那是**设备身份与数据包回传**，属于另一套设施，不是通用同步层。`sync_events.py` 里也没有 Tailscale / LAN 发现的任何痕迹。

---

## Q8. MCP

**双向都有，但代码分成两个文件、互不相关。**

### 消费侧：`mcp_client.py`（421 行）—— 它是 **MCP client**

三种传输：Streamable HTTP、SSE、stdio。配置在 `DATA_DIR/"mcp_servers.json"`。默认服务器：`{"name":"AI小镇","type":"http","url":"https://aisay.top/chatroom/mcp","headers":{},"enabled":true}`。

`class MCPManager`（单例 `mcp_manager = MCPManager()`）持有 `_connections`，暴露 `connect`、`connect_ephemeral`、`disconnect`、`call_tool`、`call_tool_json`、`get_tools_for_ai`（产出 OpenAI `{"type":"function","function":{...}}`）、`add_server`、`upsert_server`、`remove_server`。

用 `mcp` Python SDK：`streamablehttp_client` / `sse_client` / `stdio_client` / `ClientSession`。

**值得注意的 hack**：SSE 分支用 `httpx.AsyncClient(verify=False, proxy=None)` —— **关掉 TLS 校验**。

### 暴露侧：`mcp_servers/home_assistant_server.py`（536 行）—— 它是 **FastMCP server**（stdio）

`mcp = FastMCP("Home Assistant")`。配置 `data/home_assistant_mcp.json`：

```python
DEFAULT_CONFIG = {"ha_url": "http://homeassistant.local:8123", "ha_token": "", "dry_run": True,
                  "allowed_domains": ["light","switch","fan","cover","climate","humidifier","scene","script"]}
```

12 个工具：`get_setup_status`、`check_home_assistant`、`list_entities`、`get_entity_state`、`list_aliases`、`get_alias_state`、`turn_on`、`turn_on_alias`、`turn_off`、`turn_off_alias`、`set_climate_alias`、`call_service`。有 `_assert_control_allowed` 域白名单、别名系统（`data/home_assistant_aliases.json`）、`HA_URL`/`HA_TOKEN` 环境变量覆盖。**默认 `dry_run: True`** —— 一个良好的默认值。

---

# PART B — 客户端

## `aion-chat/static/` —— 150 文件 / 4.1 MB，**无框架、无构建、无打包器**

47 HTML（26,682 行）+ 69 JS（31,042 行）+ 31 CSS（15,865 行）+ 1 JSON，另加 `vendor/` 与 `niche-assets/`。

**有共享层，但共享得不够**：

- `common.js`（14,722 B）、`common.css`（9,304 B）、`theme.css` / `theme.js`
- 大量小而碎的 per-feature 模块：`chat-font-size.js`、`chat-image-upload.js`、`generation-control.js`、`security-alert.js`、`system-notice-ui.js` 等
- 同时也存在整页 CSS+JS 三件套（`album.*` / `chatroom.*` / `diary.*` / `theater.*` / `seeky.*` / `xhs-lite.*`）

**是共享层 + 逐页重复的混合体**，不是纯复制粘贴，但页面级重复明显。

最大的几个文件：

| 文件 | 字节 |
|---|---|
| `static/three.min.js` | 669,884（vendored，须从 LOC 统计里剔除） |
| `static/chatroom.js` | 289,603 |
| `static/chat.js` | 241,987 |
| `static/chat.css` | 119,775 |
| `static/chatroom.css` | 111,047 |
| `static/health.html` | 105,781 |
| `static/ghost-forest.html` | 98,440 |
| `static/theater.html` | 83,011 |
| `static/reading.html` | 67,642 |
| `static/settings.html` | 60,379 |

PWA：`manifest.json` + `sw.js`（**仅 277 B**）—— `sw.js` 刻意从根路径提供，使其 scope 覆盖全部页面。

**代价评估**：`chatroom.js` 289 KB + `chat.js` 242 KB 的单文件规模，加上无构建管线，意味着无 tree-shaking、无模块边界、无类型检查。单页 HTML 最大 105 KB 意味着结构、样式、逻辑混在一个文件里。这是「一个功能一个页面」堆叠出来的形态，不是工程化的前端。

## `AionPet/`（19 MB）—— **不是应用，是精灵图素材包**

"Aion Animation Pack"。结构：`README.md`、`manifest.json`(7,280 B)、`frames/`(3.1M)、`strips/`(3.3M)、`webp/`(2.4M)、`source/`(6.9M)、`qa/`(3.3M)。

`manifest.json`：`schemaVersion 1`，`character.id "aion"`，`cellWidth 192`，`cellHeight 208`，`format "horizontal-strip"`，`anchor "bottom-center"`，`alpha true`。

14 个动画：`idle`、`running-right`、`running-left`、`waving`、`jumping`、`failed`、`waiting`、`running`、`review`、`happy`、`angry`、`tsundere`、`sleepy`、`sleep_prone`。

README 明说 `source/` 与 `qa/` "are not required at runtime" —— 即 10.2 MB / 19 MB 是开发期资产。由后端 `/aion-pet` 静态挂载服务。

**这个格式设计得不错**：横条精灵图 + 声明式 manifest + 锚点/单元格尺寸，客户端零解析逻辑。

## `AionApp/`（28 MB）—— **原生 Android Java，不是 Capacitor**

`rootProject.name = "AionChat"`，AGP 8.2.2，namespace/applicationId `com.aion.chat`，compileSdk 34 / minSdk 24 / targetSdk 34，versionCode 23 / versionName "1.22"。

依赖只有 4 个：

- `androidx.appcompat:appcompat:1.6.1`
- `androidx.webkit:webkit:1.8.0` ← 说明主体是 WebView 壳
- `com.squareup.okhttp3:okhttp:4.12.0`
- `org.bouncycastle:bcprov-jdk18on:1.78.1` ← 加密，配合 Visitor Lounge 的 `cryptography>=42`

**没有 Capacitor、没有 Cordova、没有 React Native。** 是自写的 WebView 容器 + 原生桥。

`app/src/main/java/com/aion/chat/` 下 164 个 .java/.kt（34,004 行）。关键类：`LauncherActivity`、`WebViewActivity`、`AionPushService`、`FloatingChatService`、BLE 桥（`AionRingBleBridge`、`AionMiBandBleBridge`、`BleBridge`、`SvakomProtocol`、`AnkniProtocol`）、`PhoneCamera*`、`TtsAudio*`、`DeviceContext*`、`CloudflareReauthState`、`ConnectionEndpoint`、`widget/CompanionWidgetProvider`。

`app/src/main/assets` 18 MB，`res` 7.3 MB。

**AndroidManifest 权限集极宽**：INTERNET、ACCESS_NETWORK_STATE、TRANSMIT_IR、RECORD_AUDIO、CAMERA、MODIFY_AUDIO_SETTINGS、WAKE_LOCK、VIBRATE、**8 种 FOREGROUND_SERVICE\***、POST_NOTIFICATIONS、DUMP、REQUEST_IGNORE_BATTERY_OPTIMIZATIONS、SCHEDULE_EXACT_ALARM、RECEIVE_BOOT_COMPLETED、ACCESS_WIFI_STATE/CHANGE_WIFI_STATE、ACCESS_FINE/COARSE/BACKGROUND_LOCATION、ACTIVITY_RECOGNITION、PACKAGE_USAGE_STATS、**WRITE_SECURE_SETTINGS**、SYSTEM_ALERT_WINDOW、BLUETOOTH/ADMIN/SCAN/CONNECT。

内部自用可以，**上架任何应用商店都会被拒**。

## `AionsHome-Visitor-Lounge/`（2.1 MB）—— 独立 FastAPI + Jinja2 + MCP 服务

Python 包 `visitor_lounge` 位于 `src/` 下，11,855 LOC / 36 文件。

`pyproject.toml`：name `aionshome-visitor-lounge`，requires-python `>=3.11`，deps：`cryptography>=42.0`、`fastapi>=0.135.0,<1`、`jinja2`、`mcp>=2.0.0,<3`、`tiktoken`、`tzdata`、`uvicorn`；dev/test extras 为 httpx + pytest。

**独立的 venv / DB / 进程 / 端口 / 日志 / Codex 工作目录**：访客 UI 在 8001，管理端 8002 **仅 loopback**，公网访客只能经既有 Cloudflare Tunnel 到 8001。

37 个源模块，包括 `board_mcp.py`、`oauth_provider.py`、`oauth_routes.py`、`mcp_auth.py`、`security.py`、`quota.py`、`content_safety.py`、`board_owner_auth.py`、`visitor_service.py`、`turn_coordinator.py`、`scheduler.py`、`background.py`、`schema.sql`。11 个 Jinja 模板（`admin_dashboard`、`admin_settings`、`admin_visitor`、`board_owner_login`、`home_board`、`oauth_consent`、`outbound_board`、`visitor_board`、`visitor_chat`、`visitor_claim`、`visitor_login`）与 11 个静态资源。

**这是全仓库唯一有真正 auth 的地方**：OAuth provider + `mcp_auth` + `board_owner_auth` + 配额 + 内容安全。讽刺的是，它服务的是陌生人，主应用服务的是主人自己。

`START-Visitor-Lounge.cmd` / `STOP-Visitor-Lounge.cmd` 走 PowerShell。

## 根目录 `.bat` / `install.bat`

全部 Windows-only（`chcp 65001`、`%~dp0`、`cd /d`、`pause`、`errorlevel`）。

| 文件 | 作用 |
|---|---|
| `一键启动.bat` | 若存在则激活 `.venv\Scripts\activate.bat`，`cd aion-chat`，`python -u main.py` |
| `一键关闭AionsHome.bat` | 转 `powershell -File scripts\stop-aionshome.ps1` |
| `启动壁纸.bat` | 两个硬编码 `C:\Program Files...` 找 Chrome，否则 `reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"`，然后 `start "" "%CHROME%" --app=http://localhost:8080/wallpaper --start-fullscreen`。**是 Chrome app-mode kiosk，不是壁纸引擎** |
| `一键安装环境.bat` / `install.bat`（中英孪生） | 检查 Python；检查 `venv` 模块（带 Microsoft Store Python 警告）；建 `.venv`（含 `findstr` 路径不匹配检测以重建被拷贝的 venv）；优先离线 `pip install --no-index --find-links vendor`，回落阿里云镜像 `-i https://mirrors.aliyun.com/pypi/simple/`；最后 import 验证 fastapi、cv2、numpy、pyncm、psutil、ebooklib、bs4、mcp |
| `离线安装环境.bat`（8,182 B） | 纯离线变体 |
| `清理个人数据.bat`（10,516 B） | 交互式（须手打 `Y`）个人数据擦除器，详见下 |

**没有任何注册表写入、计划任务、防火墙规则、开机自启** —— 值得一提的克制。

### `清理个人数据.bat` 的意义

它是一份**隐式的数据清单**，比任何文档都准确：删 `aion-chat/data/chat.db`、`chat_status`、`digest_anchor`、`cam_config`、`location_status`；删整个目录 `chats/`、`monitor_logs/`、`screenshots/`、`uploads/`、`activity_logs/`、`tts_cache/`、`english_corner_audio/`、`tmp/`、`ghost_forest/`、`books/`、`chatroom_images`、`homeassistant-config`、`cli_debug`；删 `theater_personas.json`、`chatroom_config.json`、`fund_config.json`、`fund_cache.json`、`mcp_servers.json`、`home_assistant_mcp.json`、`home_assistant_aliases.json`、`wallpaper_config.json`、`cert.pem`、`key.pem`、`*.log`、`lounge_friends.json`、`lounge-context-bridge.key`；擦 Visitor-Lounge 的 `.env/data/logs/.runtime/.rollback-quarantine/.codex-home/.pytest_cache/.venv`；清 `Connor-Codex/messages.jsonl`、截断 `persona.md`、删 `auto-responder-state.json`；把 `settings.json` 重置为 `{}`、`worldbook.json` 重置、`location_config.json` 重置（清高德 key 与家庭坐标）。

### `scripts/sanitize-network-endpoints.ps1`（4,659 B）

从 `LauncherActivity.java` 的 `URL_HOME`/`URL_OUTDOOR` 与 `ConnectionEndpoint.java` 的 `CLOUDFLARE_HOST`/`LEGACY_CLOUDFLARE_WS_HOST` 用正则读出作者真实域名，替换成 `192.168.1.100`、`100.64.0.1`、`chat.example.com`、`legacy-ws.example.com`，覆盖 `AionApp/app/src` 下所有 `.java/.kt/.xml/.json/.properties`，然后全树复扫（排除 `.git`、`.gradle`、`.venv`、`node_modules`、`vendor`、`cache`、`build`、`dist`、`__pycache__`）。脚本内注明"脚本自身不保存个人地址"。

**这反过来说明两件事**：(1) 发布前作者确实做过脱敏；(2) 真实部署形态就是 **Cloudflare Tunnel + Tailscale + LAN 三路并存**，`100.64.0.1` 直指 Tailscale。

### `scripts/stop-aionshome.ps1`（4,207 B）

针对端口 8080 / 8011，加命令行模式 `uvicorn\s+main:app`、`python(\.exe)?\s+-u\s+main\.py`、`aion-chat[\\/]+main\.py`、`aion-chat[\\/]+mcp_servers[\\/]+home_assistant_server\.py`、`desktop_pet\.py`、`一键启动\.bat`、`启动桌宠\.bat`、`--app=http://localhost:8080/wallpaper`。用 `Get-CimInstance Win32_Process` + `Get-NetTCPConnection`，走父子进程树，支持 `-DryRun`。

---

# 非 vendor 代码量（含/不含测试）

| 范围 | LOC | 文件 |
|---|---|---|
# 代码规模统计

| 范围 | 行数 | 文件数 |
|------|------|--------|
| `aion-chat/**/*.py`（排除 vendor/tests） | 80,124 | 200 |
| ├─ `aion-chat/*.py`（顶层） | 55,516 | 314（含测试） |
| ├─ `aion-chat/routes/*.py` | 24,608 | 54 |
| ├─ `aion-chat/homecoming/`、`billiards/`、`scripts/` | 其余 | 28 |
| `aion-chat/static/*.js`（排除 `vendor/`） | 31,042 | 69 |
| `aion-chat/static/*.html` | 26,746 | 50 |
| `aion-chat/static/*.css` | 15,969 | 31 |
| `AionsHome-Visitor-Lounge/src/visitor_lounge/**/*.py` | 11,855 | 36 |
| `AionApp/app/src/main/java/**/*.{java,kt}` | 34,004 | 164 |
| `.bat` + `.ps1`（根 + scripts） | ~1,800 | 9 |

**非 vendor 合计约 20 万行**（其中 ~9.2 万行 Python，~3.1 万行 JS，~3.4 万行 Java，~2.7 万行 HTML，~1.6 万行 CSS）。

注意 `aion-chat/` 下测试文件达 203 个（`find -path "*/test*"` 计数），说明作者后期确实在补测试；上表 Python 数字已剔除 `test_*.py` 与 `conftest.py`。

---

# 值得带走的结构性判断

**强的部分**

1. `sync_events` 的「不改 legacy 事件名、只加 `sync_seq`」是很克制、很清醒的向后兼容设计 —— 老客户端继续工作，新客户端拿到可回放游标，`reset_required` 处理保留窗口溢出。这种方案在真实系统里很难得。
2. `AionPet` 的声明式 manifest 资产格式干净利落，512 行 Python 里 `home_assistant_server.py` 还有域白名单 + `dry_run: True` 默认 + 别名层。
3. `post_sentinel` 的数据库备份机制、`_save_model_raw_response` 的 3 天原响应留存 —— 调试友好。
4. `.bat` 全套不做注册表/自启/防火墙改动，发布前有脱敏脚本。

**弱的部分**

1. **无认证**且 fail-open：`0.0.0.0:8080` + 审计而非拦截 + LAN/Tailscale 默认可信不可封禁。这是全项目最大的单点问题。
2. **98 张表、49 张散落在功能模块**、无迁移框架、`get_db()` 每次新连接、无 WAL、8 线程 + 15 异步循环写同一个 SQLite 文件。
3. **provider 层零重试零回落**，异常当正文 yield 进流。整个「LLM 抽象」是 1800 行里的一个 if/elif 链 + 两套 transport 模式并存。
4. **80+ 个 WS 事件类型是裸字符串**，无枚举无 schema。
5. 前端 `chatroom.js` 289 KB / `chat.js` 242 KB 单文件、无构建管线、页面级重复。
6. `mcp_client.py` 的 SSE 分支 `verify=False`。
7. AndroidManifest 权限集（`WRITE_SECURE_SETTINGS`、`DUMP`、`SYSTEM_ALERT_WINDOW`、8 种前台服务、后台定位）在自用语境下合理，但没有任何收敛余地。

**最值得学的一条设计**：AionsHome 把「AI 伴侣」拆成了 **记忆压缩、人格演化、空闲自主、朋友圈、群聊、剧场、日记、健康、基金、智能家居** 这一堆**各自有表、各自有后台循环、各自有 WS 事件**的拟人化子系统，再统一挂到同一个单例 `manager.broadcast` 和一个 `sync_events` 游标上。架构是「一个 SQLite + 一个事件总线 + N 个后台循环」，而非微服务。它粗糙，但**确实是"活着"的** —— 15 条常驻异步循环在无人交互时也在推进状态。这是 Aimy 若要继承该路线时最该复制的部分，也是最该重写（认证、schema 治理、provider 韧性）的部分。