Here is the forensic map. All paths absolute; read-only, nothing written.

## 1. Where the autonomy / proactive background loop is STARTED

**Primary start site — FastAPI lifespan, not `@app.on_event`.** The app uses a `lifespan` asynccontextmanager.

- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/main.py:153-154` — `@asynccontextmanager async def lifespan(app: FastAPI)`
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/main.py:256` — `app = FastAPI(lifespan=lifespan)`
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/main.py:209` — **`idle_autonomy_mgr.start()`** ← the autonomy loop starts here
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/main.py:234` — `idle_autonomy_mgr.stop()` in the `finally` teardown
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/main.py:100` — `from autonomy import idle_autonomy_mgr`

**The engine itself — `IdleAutonomyManager`** (singleton, not a class named `AutonomyEngine`):

- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/autonomy.py:2306` — `class IdleAutonomyManager:`
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/autonomy.py:2311-2313` — `start()` → `self._task = asyncio.create_task(self._loop())`
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/autonomy.py:2319-2327` — `_loop()`: `while True: await asyncio.sleep(30)` then `asyncio.gather(*(self.run_actor_once(actor, manual=False) for actor in ACTOR_IDS))`
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/autonomy.py:2336-2338` — per-actor `enabled` gate (DB flag, not the settings flag)
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/autonomy.py:2394` — `idle_autonomy_mgr = IdleAutonomyManager()`

**Two distinct cadences — this is the key nuance:**
- **Poll tick = 30 s** (`autonomy.py:2322`, hard-coded, not configurable).
- **Actual wake interval = random per-actor delay** drawn fresh each cycle. Default anchor is 120 min; clamp is 5 min … 1440 min:
  - `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/autonomy.py:80-82` — `idle_autonomy_interval_minutes` default **120**, min default `old_interval`, max default `old_interval`, each floored at 5
  - `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/autonomy_state.py:275` — `delay = random.randint(cfg["min_interval_minutes"], cfg["max_interval_minutes"])`
  - `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/autonomy_state.py:20-21` — `MIN_INTERVAL_MINUTES = 5`, `MAX_INTERVAL_MINUTES = 24 * 60`
  - `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/autonomy_state.py:90-91` — **DB schema defaults differ from the code defaults**: `min_interval_minutes INTEGER NOT NULL DEFAULT 5`, `max_interval_minutes INTEGER NOT NULL DEFAULT 1440`

**Manual trigger (bypasses the wake timer):**
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/routes/autonomy.py:117-119` — `POST /{actor}/run-once` → `idle_autonomy_mgr.run_actor_once(..., manual=True)`
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/autonomy.py:2341` — `if not manual and not cfg.get("next_wake_at") and not refreshed:` — manual runs skip the "not due" gate

**Proactive companionship is event-driven, not a loop.** There is no `start_proactive`/`proactive_loop` anywhere. It piggybacks on message events and the schedules table:
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/ws.py:243` — `process_visible_message_event(event)` on WebSocket message
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/proactive_companionship.py:63-75` — `extract_next_chat_decision()`, window `1 <= minutes <= 60` (line 73)
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/proactive_companionship.py:125-134` — inserts a `schedules` row of type `proactive` at `created_at + decision*60`
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/proactive_companionship.py:16` — `PROACTIVE_TYPE = "proactive"`
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/proactive_companionship.py:148-155` — `claim_proactive_timer()` deletes the row (fires once)
- Consumed by the schedule thread: `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/schedule.py:274-279` (`ScheduleManager.start()` → `threading.Thread(target=self._check_loop, daemon=True)`), tick `time.sleep(0.5)` at `schedule.py:301`; claim sites at `schedule.py:541` and `schedule.py:876`

**No APScheduler anywhere.** Grep for `BackgroundScheduler|AsyncIOScheduler|apscheduler|add_job(` returns zero hits repo-wide. There is a project-local `fund.py` "scheduler" that is a plain thread:
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/fund.py:472-477` — `start()` → `threading.Thread(target=self._run_loop, daemon=True)`
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/main.py:201-202` — `fund_scheduler.set_event_loop(loop); fund_scheduler.start()`

**Other background loops started in the same lifespan block** (for completeness):
- `main.py:204-208` — five `asyncio.create_task` loops: `_auto_digest_loop()`, `_connor_1v1_auto_digest_loop()`, `auto_calendar_compression_loop()`, `main_ai_persona_evolution_loop()`, `connor_persona_evolution_loop()`
- `main.py:189` — `schedule_mgr.start()`
- `main.py:193` — `pc_tracker.start()`; `main.py:197` — `pc_display_tracker.start()`
- `main.py:210-214` — `board_patrol_mgr.start()`, `ha_event_listener.start()`, `wechat_mode_dispatcher.start()`, `openclaw_weixin_runtime.start()`, `security_access_service.start(...)`
- `main.py:141` — the auto-digest loop's own threshold: skips if `elapsed < 30 * 60` (30 min of user silence)

## 2. Config layer

`SETTINGS` is a flat JSON dict, not a schema with declared defaults — `config.py` has **no** `DEFAULT_SETTINGS` block, so every autonomy key's default lives at its read site via `.get(...)`.

- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/config.py:56` — `SETTINGS_PATH = DATA_DIR / "data/settings.json"`; `config.py:64` `load_settings()` (returns `{}`-ish seed if absent — only 4 API keys, `config.py:68`); `config.py:84` `SETTINGS = load_settings()`
- **Note:** `data/settings.json` does **not** exist in this checkout. `data/` contains only `uploads/`, `activity_logs/`, `chats/`, `tts_cache/` (all just `.gitkeep`). No `.env`, `.env.example`, YAML, or TOML files exist repo-wide.

**Autonomy keys (all read in `autonomy.py`):**

| Key | Default | Line |
|---|---|---|
| `idle_autonomy_enabled` | `False` | `autonomy.py:89` (write: `:107`) |
| `idle_autonomy_interval_minutes` | `120` (floor 5) | `autonomy.py:80` (writes: `:110`, `:120`) |
| `idle_autonomy_interval_min_minutes` | = `old_interval` (floor 5) | `autonomy.py:81` (writes: `:111`, `:121`) |
| `idle_autonomy_interval_max_minutes` | = `old_interval` (floor 5) | `autonomy.py:82` (writes: `:112`, `:122`) |
| `idle_autonomy_next_delay_minutes` | `0` (reset to 0 if outside min…max) | `autonomy.py:85`; popped at `:113`, `:123`; written `:141` |
| `idle_autonomy_actions` | dict; `album_browse` off, rest on | `autonomy.py:77-79`, `:94` |
| `idle_autonomy_last_actor` | `""` → random `aion`/`connor` | `autonomy.py:156` (write `:167`) |

Actions-off default set: `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/autonomy_state.py:40` — `DEFAULT_OFF_ACTIONS = {"album_browse", "board_check", "board_visit", "billiards_play"}`; full action list `autonomy_state.py:23-39` (15 actions); human-readable `ACTION_DEFS` at `autonomy.py:37-53`.

**Proactive-companionship keys:**
- `proactive_companionship_aion_enabled` — default `False` — `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/proactive_companionship.py:23` (read `:33`, write `:37`)
- `proactive_companionship_connor_enabled` — default `False` — `proactive_companionship.py:24`
- Effective ceiling is not a setting: `1 … 60` minutes, `proactive_companionship.py:73`

**Quiet hours / 免打扰 / DND — exists, but for camera and location, NOT autonomy.** The autonomy loop has **no** quiet-hours gate; only `_latest_user_message_ts` idleness and the per-actor `enabled` flag gate it.

- Camera: `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/config.py:506` `quiet_hours_enabled: False`, `:507` `quiet_hours_start: "00:00"`, `:508` `quiet_hours_end: "09:00"` (inside `DEFAULT_CAM_CFG`, `config.py:497-510`); also `config.py:501-502` `auto_interval_min: 10`, `auto_interval_max: 20`; `:503` `max_screenshots: 200`
- Camera implementation: `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/camera.py:1152-1157` `_is_quiet_hours()`, applied at `camera.py:1180`; interval clamp `camera.py:1127-1128`
- Location: `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/location.py:40-42` (`quiet_hours_enabled False`, start `"00:00"`, end `"08:00"` — note: differs from camera's `09:00`); `location.py:347-353` `is_location_quiet_hours()`; gate at `location.py:399`, skip reason `"quiet_hours"` at `location.py:409`
- API surface: `routes/cam.py:30-32`, `routes/location.py:191-193`, setters `routes/location.py:231-236`

**Daily cap / frequency limit: none.** No `daily_cap`, `max_per_day`, `daily_limit`, or equivalent exists for autonomy. The only rate controls are the random min/max interval and the per-actor `asyncio.Lock` (`autonomy.py:2309`, re-entrancy guard at `autonomy.py:2333-2334`).

**Related cadence/cooldown constants (other subsystems):**
- `ambient_voice_cooldown_seconds: 180` — `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/chatroom.py:52`
- `CHAT_STATUS_PATH`, `CAM_CONFIG_PATH`, `DIGEST_ANCHOR_PATH` — `config.py:58-60`

**Enable/开关 API surface:**
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/routes/autonomy.py:102-110` — `PUT /{actor}/config` with `enabled`, `min_interval_minutes`, `max_interval_minutes`, `actions`
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/routes/autonomy.py:83-86` — `GET /{actor}/config`; `:88-95` relationship date
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/routes/capabilities.py:86-99` — `GET/PUT /api/proactive-companionship[/{actor}]`, broadcasts `proactive_companionship_changed`

## 3. Persistence

**Everything autonomy-related is SQLite — no autonomy JSON state file.** DB path resolution:

- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/config.py:29` — `DB_PATH = _TEST_DB_DIR / "chat.db"` (test mode)
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/config.py:31` — `DB_PATH = DATA_DIR / "chat.db"` (normal) → `data/chat.db`
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/database.py:7` — `from config import DB_PATH`; `:1050-1051` `def get_db(): return aiosqlite.connect(DB_PATH)`

**`autonomy_actor_configs`** — `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/autonomy_state.py:87-99`
Columns: `actor_id TEXT PRIMARY KEY`, `enabled INTEGER NOT NULL DEFAULT 0`, `min_interval_minutes INTEGER NOT NULL DEFAULT 5`, `max_interval_minutes INTEGER NOT NULL DEFAULT 1440`, `relationship_started_on TEXT`, `actions_json TEXT NOT NULL DEFAULT '{}'`, `timer_started_at REAL`, `next_wake_at REAL`, `created_at REAL NOT NULL`, `updated_at REAL NOT NULL`
- Live migrations via `PRAGMA table_info` + `ALTER TABLE ADD COLUMN`: `autonomy_state.py:101-108` (`timer_started_at`, `next_wake_at`, `relationship_started_on`)

**`autonomy_state_packets`** — `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/autonomy_state.py:111-124`
Columns: `id TEXT PRIMARY KEY`, `actor_id TEXT NOT NULL`, `previous_id TEXT DEFAULT ''`, `source TEXT NOT NULL`, `state_json TEXT NOT NULL DEFAULT '{}'`, `wake_at REAL`, `status TEXT NOT NULL`, `last_action TEXT DEFAULT ''`, `error TEXT DEFAULT ''`, `created_at REAL NOT NULL`, `updated_at REAL NOT NULL`
- Indexes: `autonomy_state.py:126-133` — `idx_autonomy_packets_actor_created`, `idx_autonomy_packets_due`
- Status values observed: `active`, `superseded` (`:521`), `cancelled_by_disable` (`:239`), `missed_during_downtime` (`:561`), `abandoned` (`:567`), `running` (`:601`)

**`idle_events`** — owned by the main DB module, `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/database.py:779-791`
Columns: `id TEXT PRIMARY KEY`, `actor TEXT NOT NULL`, `action TEXT NOT NULL`, `title TEXT NOT NULL`, `detail TEXT DEFAULT ''`, `target_type TEXT DEFAULT ''`, `target_id TEXT DEFAULT ''`, `result_type TEXT DEFAULT ''`, `result_id TEXT DEFAULT ''`, `metadata TEXT DEFAULT '{}'`, `created_at REAL NOT NULL`
- Indexes `database.py:793-794`. Writer: `autonomy.py:325` (`INSERT INTO idle_events` in `append_idle_event`, defined `autonomy.py:287`). Readers: `autonomy.py:1489`, `:1561`, `:2168`, `autonomy_niches.py:209`, `routes/activity.py:351`, `monthly_chat_archive.py:276`

**`schedules`** (proactive timers live here) — `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/database.py:265`; rows inserted `proactive_companionship.py:130-134` with `type='proactive'`

**Table creation entry point:** `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/database.py:131-132` — `init_db()` imports and calls `ensure_autonomy_tables(db)`; `ensure_autonomy_tables` defined at `autonomy_state.py:84`; called lazily inside every state accessor (`autonomy_state.py:175`, `:201`, `:264`, `:303`, `:329`)

## 4. Idle time / last-interaction / "user busy" / foreground window

**Idle-minutes computation for autonomy (the "is the user around" signal):**
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/autonomy.py:2150-2162` — `async def _latest_user_message_ts()`; takes the max `created_at` from `messages WHERE role='user'` and `chatroom_messages WHERE sender='user'`
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/autonomy.py:2349` — `idle_minutes = max(0, int((time.time() - latest_user) // 60)) if latest_user else 0`
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/autonomy.py:666` — the prompt line injected into the model: `"用户已经 {_idle_duration_text(idle_minutes)}没有发送新消息，可能在忙碌或休息。"` ← this is where "user might be busy" is literally decided
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/autonomy.py:585` — `_idle_duration_text(minutes)`
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/autonomy.py:2165-2170` — `_latest_idle_event_ts()`

**OS-level keyboard/mouse idle (Windows `GetLastInputInfo`):**
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/activity.py:395-414` — `PCActivityTracker.get_idle_seconds()`; host read at `:343`
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/activity.py:348-359` — `should_capture_screen(idle_skip_seconds=10*60, probe_physical=True)`
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/activity.py:1100-1105` — `_probe_display_status()`-style helper returning `{"display": ..., "idle_seconds": ...}`
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/activity.py:1034-1043` — foreground-window description: `"前台窗口：" + _describe_current_pc_app(app, entry.get("title",""))`
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/activity.py:162-186` — `PCActivityTracker.start()` → daemon thread; `:308-317` — `PCDisplayTracker.start()` → daemon thread

**Device-context interpretation (input_state: active / idle / unavailable):**
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/device_context.py:92` — `class DeviceContextStore`
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/device_context.py:252-334` — `snapshot(self, pc, now)`; thresholds at `:259-267` (`idle_seconds <= 60` → `active`; `<= 300` → intermediate; else `idle`), produces states `computer_active` (`:276`), `phone_active` (`:310`), and `foreground_app` handling at `:254-256`, `:287-294`
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/device_context.py:346-358` — `_pc_observation_line()`, renders `"约N分钟前"`
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/device_context.py:23` — `"foreground_app"` field name

**Last-active chat target (which window/room the AI is "in"), distinct from idle time:**
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/active_window_state.py:14-15` — keys `aion_last_active`, `connor_last_active`
- `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/active_window_state.py:122-156` — `async def restore_active_windows()`; called from `main.py:163`
- Consumers in autonomy: `autonomy.py:368`, `:515-517`, `:902`, `:922`, `:1020`, `:1042` (via `manager.get_aion_last_active()` / `get_connor_last_active()`)

**Note on `proactive_companionship.py`:** it does no idle/activity computation of its own — it keys purely off visible message events (`process_visible_message_event`, `:93`) and the persisted `schedules` row.