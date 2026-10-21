# AionsHome 主动说话系统 — 取证报告

所有路径相对于 `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/`。只读；未写入任何内容。

**核心结论：存在两套完全独立的"主动说话"机制，触发哲学相反。**

| | **A. 主动陪伴** (`proactive_companionship.py`) | **B. 空闲自主行为** (`autonomy.py`) |
|---|---|---|
| 谁决定"说话" | **LLM 自己**，通过在回复中输出 `[NEXT_CHAT:x]` 标签 | **本地随机定时器**唤醒，再由 LLM 从 15 个动作中选一个 |
| 时间由谁定 | LLM 定（1–60 分钟整数） | 系统定：`random.randint(min, max)` 分钟 |
| 执行者 | `schedule.py` 的守护线程 + `schedules` 表 | `autonomy.py` 的 asyncio 循环 + `autonomy_actor_configs` 表 |
| 默认开关 | **关闭** (`False`) | **关闭** (`enabled=0`) |
| 是否需要空闲 | 是（定时到期即可，无空闲门槛） | 是（但空闲时长只进提示词，不做门禁） |

---

## 1. 触发条件（全部枚举）

### A 路：唯一的触发器是一个正则标签

`proactive_companionship.py:16-21`
```python
PROACTIVE_TYPE = "proactive"
NO_DECISION = object()
_NEXT_CHAT_RE = re.compile(
    r"[\[［]\s*NEXT_CHAT\s*[:：]\s*([^\]］]+?)\s*[\]］]", re.IGNORECASE)
```
`extract_next_chat_decision()` (`:52-75`) 取**最后一个**合法匹配，`1 <= minutes <= 60`（`:73`），`NONE` → `None`，非数字/越界 → `NO_DECISION`，并从可见文本中剥掉标签。

A 路的"触发"因而有三种结果，不是三个枚举：`decision=int` → 排一个定时器；`decision=None` → 只清旧定时器；`decision=NO_DECISION` → 只清旧定时器（模型没按格式输出）。

### B 路：15 个动作即触发器表

`autonomy.py:37-53` — `ACTION_DEFS`，动作 key → 中文行为描述（这是 `routes/autonomy.py:50-53` 直接吐给前端的同一张表）：

| key | 描述（原文） | 是否发消息给用户 |
|---|---|---|
| `rest` | 什么都不做，继续休息 | 否（弃权） |
| `private_chat` | 主动联系用户说点此刻想说的话 | **是** |
| `seeky_interaction` | 和宠物鲸鱼 Seeky 互动 | 否 |
| `role_chat` | 和另一个家庭成员自然聊聊 | 否（对另一 AI 说） |
| `billiards_play` | 邀请另一位家庭成员打一局休闲台球… | 否 |
| `home_dynamics` | 查看近期家庭动态 | 否 |
| `memory_browse` | 按需翻看一段旧记忆 | 否 |
| `album_browse` | 翻看家庭相册（随机两张未看过的照片） | 否 |
| `web_roam` | 上网冲浪搜索感兴趣的内容 | 可能（journey 的 `share`） |
| `wish_pool` | 查看许愿池并尝试实现用户的愿望 | 可能 |
| `xhs_roam` | 去小红书查看指定账号最新帖子并按人设评论或回复 | 否（对外网） |
| `taobao_roam` | 按照自己的近期兴趣去淘宝搜索真实商品…（不加购、不购买） | 否 |
| `friend_visit` | 拜访一位 AI 好友 | 否 |
| `board_check` | 自己去看看家里的朋友留言板，决定要不要接话 | 可能 |
| `board_visit` | 到朋友家的留言板看看，决定要不要留句话 | 可能 |

权威动作清单在 `autonomy_state.py:23-39` (`ACTION_IDS`)；默认关闭的动作集 `autonomy_state.py:40`：
```python
DEFAULT_OFF_ACTIONS = {"album_browse", "board_check", "board_visit", "billiards_play"}
```

二级触发器：`SEEKY_ACTIONS` (`autonomy.py:55-63`) 7 个子动作（feed/clean/play/tease/scare/tap_glass/threaten）+ `SEEKY_EVENT_PHRASES` (`:65-73`)。

### A 路的第二入口：清空规则本身也是"触发逻辑"

`process_visible_message_event()` (`proactive_companionship.py:93-145`)，挂在 `ws.py:243-244` 的 `manager.broadcast()` 里拦截每一条可见消息：

- **用户说话** → `DELETE FROM schedules WHERE type='proactive' AND status='active'`（`:110-113`）— 一次性清掉**全部**待触发的主动陪伴定时器（不分 actor）。
- **AI 说话** → 只清自己 `origin` 的（`:115-118`），改写 `messages`/`chatroom_messages` 正文去掉标签（`:120-123`），若 `decision` 是合法整数且该 actor 已启用，则插入新定时器（`:130-142`）。

---

## 2. 状态机 / 决策循环

**没有 APScheduler**（全仓 grep `apscheduler|BackgroundScheduler|AsyncIOScheduler|add_job(` 零命中）。

### B 路：asyncio task，启动于 FastAPI lifespan

启动点 **`main.py:209`** `idle_autonomy_mgr.start()`（`@asynccontextmanager lifespan` 定义在 `main.py:153-154`，`app = FastAPI(lifespan=lifespan)` 在 `:256`，`stop()` 在 `:234`）。

`autonomy.py:2306-2327, 2394`
```python
class IdleAutonomyManager:
    def __init__(self):
        self._task: asyncio.Task | None = None
        self._locks = {actor: asyncio.Lock() for actor in ACTOR_IDS}
    def start(self):
        if not self._task or self._task.done():
            self._task = asyncio.create_task(self._loop())
    async def _loop(self):
        while True:
            try:
                await asyncio.sleep(30)
                await asyncio.gather(*(self.run_actor_once(actor, manual=False) for actor in ACTOR_IDS))
            except asyncio.CancelledError: break
            except Exception as exc: print(f"[idle_autonomy] error: {exc}")
idle_autonomy_mgr = IdleAutonomyManager()   # :2394
```

**tick 间隔 30 秒，硬编码，不可配置**，两个 actor 并行 gather。真正决定"何时醒"的是数据库里 `next_wake_at` 时间戳，不是 tick。

`run_actor_once()` 主流程（`autonomy.py:2329-2388`），伪代码：
```
lock 已被占用? -> 返回 "autonomy already running"          (:2333-2334)
cfg = get_actor_config(actor)
cfg.enabled == False? -> 返回 skipped "disabled"            (:2337-2338)
latest_user = _latest_user_message_ts()                     (:2339)
refresh_actor_wake_for_user(latest_user)   # 用户新消息则重置倒计时 (:2340)
not manual and 无 next_wake_at and 未刷新:
    schedule_actor_wake(anchor=latest_user or now); 返回 "not due"   (:2341-2343)
timer = cfg (manual) 或 claim_due_wake(now)   # 原子领取          (:2344)
未领到 -> "not due"        (:2345-2346)
再查一次 enabled（领取期间可能被关）  (:2347-2348)
idle_minutes = max(0, int((now - latest_user)//60))          (:2349)
_capture_autonomy_monitor_context(actor)  # 抓实时摄像头画面    (:2351)
_save_autonomy_monitor_card(...)                             (:2353)
set contextvars: _AUTONOMY_WAKE_MONITOR_CONTEXT / _AUTONOMY_WAKE_INTERNAL  (:2356-2357)
_run_actor_once(actor, manual, idle_minutes)                 (:2359-2363)
finally: next_anchor = now; 若唤醒期间来了更新的用户消息则跳到那条消息时间;
         schedule_actor_wake(anchor=next_anchor)             (:2383-2388)
```

### A 路：daemon 线程轮询

`schedule.py:274-280` `ScheduleManager.start()` → `threading.Thread(target=self._check_loop, daemon=True)`；`_check_loop` (`:286-301`) 每轮 `asyncio.run_coroutine_threadsafe(self._tick(), self._loop)`，`future.result(timeout=CHAT_STREAM_POLICY.total_timeout + 30)`，然后 `for _ in range(60): time.sleep(0.5)`（即 30 秒）。启动点 `main.py:189` `schedule_mgr.start()`。

`_tick()` (`schedule.py:303-327`) 查三类到期行：`alarm`、`monitor`、`type=PROACTIVE_TYPE`，对主动陪伴调 `_fire_monitor(item)`。

---

## 3. 频率控制

### 硬常量
- `autonomy_state.py:20-21`：`MIN_INTERVAL_MINUTES = 5`，`MAX_INTERVAL_MINUTES = 24 * 60`（1440）
- `autonomy_state.py:22`：`MAX_STATE_CHARS = 800`
- B 路 tick 30 秒；A 路轮询 30 秒

### 随机间隔（核心机制）
`autonomy_state.py:250-286` `schedule_actor_wake()`：
```python
delay = random.randint(cfg["min_interval_minutes"], cfg["max_interval_minutes"])   # :275
```
未指定时随机，指定 `anchor_at` 时 `anchor + delay*60`。**每次唤醒后重新抽签**，所以间隔无记忆。

### 默认值与配置键

B 路有一份**双轨**配置：新轨（SQLite 表，前端在用）+ 旧轨（SETTINGS JSON，仅测试引用）。`get_idle_config()`/`save_idle_config()` (`autonomy.py:76-131`) 只被测试调用，是死代码遗留。

新轨 —— `autonomy_actor_configs` 表，schema 默认 `autonomy_state.py:87-99`：
```sql
enabled INTEGER NOT NULL DEFAULT 0,
min_interval_minutes INTEGER NOT NULL DEFAULT 5,
max_interval_minutes INTEGER NOT NULL DEFAULT 1440,
```
种入语句 `autonomy_state.py:135-141` 用 `VALUES(?,0,5,1440,...)`。

旧轨 —— SETTINGS 键（`autonomy.py` 内联默认值，`config.py` 中**没有**任何 `idle_autonomy*` 键）：

| 键 | 默认 | 位置 |
|---|---|---|
| `idle_autonomy_enabled` | `False` | `autonomy.py:89` |
| `idle_autonomy_interval_minutes` | `120`（下限 5） | `autonomy.py:80` |
| `idle_autonomy_interval_min_minutes` | `= 旧 interval`（下限 5） | `autonomy.py:81` |
| `idle_autonomy_interval_max_minutes` | `= 旧 interval`（下限 5） | `autonomy.py:82` |
| `idle_autonomy_next_delay_minutes` | `0`（越界重置为 0） | `autonomy.py:85`、写 `:141` |
| `idle_autonomy_actions` | dict，按 `DEFAULT_OFF_ACTIONS` 关 4 项 | `autonomy.py:77-79, 94` |
| `idle_autonomy_last_actor` | `""` → 随机 aion/connor | `autonomy.py:156`、写 `:167` |

`_schedule_next_idle_delay()` (`autonomy.py:134-143`)：`random.randint(max(5,min), max(5,max))`，写回 SETTINGS。
`_next_idle_actor()` (`:155-161`) 交替 aion/connor。

A 路 —— `proactive_companionship.py:22-25`：
```python
_SETTING_KEYS = {"aion": "proactive_companionship_aion_enabled",
                 "connor": "proactive_companionship_connor_enabled"}
```
读取 `SETTINGS.get(key, False)`（`:33`）→ **默认关闭**。生效上限不是配置项，是正则的 1–60 分钟硬边界（`:73`）。开关 API：`routes/capabilities.py:87-99` GET/PUT `/api/proactive-companionship/{actor}`。

### 用户消息重置倒计时
`autonomy_state.py:289-318` `refresh_actor_wake_for_user()`：仅当 `latest_user_at > timer_started_at` 时重设计时器——即"用户每次说话就把 AI 的下次自发行动往后推一整轮"。返回布尔值供 `run_actor_once` 判断。

### 限流：只有一个
每 actor 一个 `asyncio.Lock`（`autonomy.py:2309`），重入直接返回 `"autonomy already running"`（`:2333-2334`）。

### 免打扰 / 每日上限：**两个系统都没有**
- 全仓 grep `daily_cap|max_per_day|daily_limit|per_day|次数上限|每日上限` 对自主/主动模块**零命中**（唯一命中是记忆压缩胶囊迁移，无关）。
- 存在的 `quiet_hours_*` 键**只作用于摄像头和定位，不作用于任何自主/主动路径**：
  - 摄像头 `config.py:506-508` `quiet_hours_enabled: False` / start `"00:00"` / end `"09:00"`（在 `DEFAULT_CAM_CFG` 内），实现 `camera.py:1152-1157 _is_quiet_hours()`，应用于 `camera.py:1180`
  - 定位 `location.py:40-42`（end 默认 `"08:00"`，**与摄像头的 09:00 不一致**），`location.py:347-353 is_location_quiet_hours()`，门禁在 `:399`，跳过原因 `"quiet_hours"` 在 `:409`
- "用户正在忙"**不是抑制条件**，而是一句提示词文本（见 §6）。

---

## 4. 打分 / 门禁：**没有分数、没有概率、没有独立的"该不该说话"LLM 检查**

B 路的门禁是一条纯粹的布尔链，任一步失败即静默返回：

1. **enabled 标志** — `autonomy.py:2337-2338`、`:2347-2348`（领计时器前后各查一次）
2. **到期领取（原子）** — `autonomy_state.py:321-349`：
   ```sql
   UPDATE autonomy_actor_configs SET next_wake_at=NULL
   WHERE actor_id=? AND enabled=1 AND next_wake_at IS NOT NULL AND next_wake_at<=?
   ```
   靠 `rowcount` 判定，防并发重复触发。
3. **动作资格过滤** `_select_action()` (`autonomy.py:595-648`)：相册需有未看照片、台球需 `available_for_autonomy`、许愿池需 `wishes WHERE author='user' AND status='active'`、friend_visit 需有可拜访对象、留言板需有未读、小红书需就绪、淘宝需未加锁。全部不满足时直接短路返回（`:648`）：
   ```python
   {"action": "rest", "reason": "当前没有可执行的已启用事件，本次休息。", "message": ""}
   ```
4. **模型选择** — LLM 从启用动作里挑一个，`rest` 即弃权
5. **四级硬兜底 rest** — 模型异常 `:683`、返回非 dict `:684-686`、动作不在 enabled 内 `:689-690`、聊天动作 message 为空 `:693-694`。**任何异常路径都退回"休息"，永不误发消息。**

A 路的门禁更薄：`is_proactive_enabled(actor)` (`:33`) + 原子领取 `claim_proactive_timer()` (`:148-155`)，后者靠 `DELETE ... WHERE id=? AND type=? AND status='active'` 的 rowcount 做到"只响一次"：
```python
await db.execute("DELETE FROM schedules WHERE id=? AND type=? AND status='active'", ...)
return bool(cur.rowcount)
```

判定 A 路是否触发的最终决定权完全在模型手里——系统只负责把提示词塞进去和把标签解析出来。

---

## 5. 持久化状态

全部 SQLite，**没有任何自主状态的 JSON 文件**。`config.py:29/31` → `DB_PATH = DATA_DIR / "chat.db"`；`database.py:1050-1051` `get_db()`。

| 表 | 定义位置 | 关键列 |
|---|---|---|
| `autonomy_actor_configs` | `autonomy_state.py:87-99`（迁移 `:101-108` 用 `PRAGMA table_info` + `ALTER TABLE`） | `actor_id PK`, `enabled`, `min_interval_minutes`, `max_interval_minutes`, `relationship_started_on`, `actions_json`, `timer_started_at REAL`, `next_wake_at REAL`, `created_at`, `updated_at` |
| `autonomy_state_packets` | `autonomy_state.py:111-124`，索引 `:126-133` | `id PK`, `actor_id`, `previous_id`, `source`, `state_json`, `wake_at`, `status`, `last_action`, `error`, `created_at`, `updated_at`。状态值：`active` / `superseded`(`:521`) / `cancelled_by_disable`(`:239`) / `missed_during_downtime`(`:561`) / `abandoned`(`:567`) / `running`(`:601`) |
| `idle_events` | `database.py:779-791`，索引 `:793-794` | `id PK`, `actor`, `action`, `title`, `detail`, `target_type`, `target_id`, `result_type`, `result_id`, `metadata TEXT DEFAULT '{}'`, `created_at` |
| `schedules` | `database.py:265-273`，迁移 `:277-280` 加 `origin TEXT DEFAULT 'aion'` / `origin_room_id TEXT DEFAULT ''` | `id PK`, `type`, `trigger_at TEXT`（`"%Y-%m-%d %H:%M:%S"`）, `content`, `created_at REAL`, `status`, `ended_at` |
| `autonomy_niche_cards` | `autonomy_niches.py:16-46` | `id PK`, `session_id UNIQUE`, `actor`, `title`, `reflection`, `tags`, `photo_path`, `image_prompt`, `action_trace`, `shared`, `sources`, `family_event_id`, `mentioned_at REAL`, `created_at REAL` |

建表入口 `database.py:131-132` `init_db()` → `ensure_autonomy_tables(db)`（`autonomy_state.py:84`），且每个状态访问器内部还会惰性再调一次（`autonomy_state.py:175, 201, 264, 303, 329`）。

计时器 id 形如 `pc_{actor}_{time.time_ns()}`（`proactive_companionship.py:135`），`origin` 存 actor，`origin_room_id` 恒为 `''`。

---

## 6. 空闲 / 时间感知

B 路的"用户多久没说话"时钟：
- `autonomy.py:2150-2162` `_latest_user_message_ts()` — `SELECT created_at FROM messages WHERE role='user' ORDER BY created_at DESC LIMIT 1` 与 `chatroom_messages WHERE sender='user'` 取 max
- `autonomy.py:2349` `idle_minutes = max(0, int((time.time() - latest_user) // 60)) if latest_user else 0`
- **注意 `latest_user` 为 None 时 idle_minutes 归 0**，即从没聊过天时提示词说"用户已经刚刚发过消息"

**是否在电脑前**：B 路自己不算，而是把摄像头实时画面 + 设备上下文塞进提示词让模型判断。`_ask_actor_json()` (`autonomy.py:450-475`) 每轮抓屏（`_capture_autonomy_monitor_context`，`:478-501`，走 `acquire_prompt_monitor_context("autonomy_wake", ...)`），并在消息前拼一段监控块 + `build_monitor_layout_guidance`。

A 路还有更厚的设备上下文（`schedule.py:931-971`）：`get_monitor_activity_for_prompt()`（`activity.py:1009`，含 `get_device_context_for_prompt()`、近 6 条 10 分钟摘要、当前 10 分钟窗口内的前后台切换）、`get_user_dynamics_for_prompt(hours=1)`、`build_heart_rate_prompt_block(user_name)`（心率）。

真正做"在不在电脑前"判定的是 `device_context.py:252-334 DeviceContextStore.snapshot()`，阈值在 `:259-267`：
```python
elif idle_seconds <= 60:   pc["input_state"] = "active"
elif idle_seconds <= 300:  pc["input_state"] = "recent"
else:                      pc["input_state"] = "idle"
```
输出状态 `computer_active`（`:276`，confidence 0.95）、`possible_bed_phone`（`:290-296`，confidence 0.78）、`phone_active`（`:310`）、`unavailable`/`unknown`。底层是 Windows `GetLastInputInfo`（`activity.py:395-414`）+ 前台窗口描述（`activity.py:1043`）。

**但 device_context 不参与门禁**，只作为文本进提示词。

---

## 7. journey / niche 概念

**`autonomy_niches.py`（319 行）= 私人壁龛/纪念品库。** AI 自己"逛"出来的东西（一张照片 + 一段感想）不发给用户，存成一张私人卡片，之后可以提起。`ACTORS = ("aion","connor")` (`:13`)。函数：`create_niche_card` (`:118`)、`archive_album_event` (`:171`，把相册 `wake_summary` 事件转成卡片并给 `idle_events.result_type` 打上 `'niche_card'`)、`backfill_album_niche_cards` (`:205`，注释明确"never call a model or send a message"——纯数据迁移)、`list_niche_cards` (`:223`，limit 夹在 1..200，默认 60)、`mark_niche_card_mentioned` (`:237`)、`set_niche_card_mentioned` (`:260`)、`delete_niche_card` (`:292`)、`recent_niche_index` (`:307`，最多 6 条，返回 `{date,title,tags}`)。

`recent_niche_index` 的产物被喂进行动选择提示词（`autonomy.py:654-657`）做**去重**：
```
你最近留在私人壁龛里的旅行索引（仅用于避免重复，也可以沿着兴趣继续探索）：
```

**`autonomy_journey.py`（172 行）= web_roam 的多轮自主体。** `MAX_ACTION_ROUNDS = 5` (`:12`)、`CAPABILITIES = {"web_roam": ActionCapability("web_roam","上网冲浪", exploratory=True)}` (`:22-24`)、`JourneyResult(completed, outcome, action_trace, card, message, rounds)` (`:27-34`)。`run_web_journey()` (`:66-172`) 循环问模型 JSON：`{"decision":"CONTINUE","query":...}` 或 `{"decision":"FINISH","title","reflection","tags","image_prompt","share","share_message"}`。`tool_failures >= 2` 中止 → `outcome="tool_failed"`。终态：`finished` / `no_direction` / `tool_failed` / `round_limit`。产物一张私人 niche 卡片，`share=true` 时额外对用户发一句话。

---

## 8. 人设被告知了什么（逐字原文）

### (a) A 路注入到**每一次普通回复**里的高优先级指令
`proactive_companionship.py:41-49`，仅在该 actor 启用时返回，经 `inject_proactive_ability()` 注入（调用点 `autonomy.py:473-474`、`capabilities.py:764-770`、`camera.py:2015-2018/2572-2575`、`location.py:870-873`）：
```
【高优先级要求】请根据当前对话和情境，决定是否需要在短时间无新消息后再次主动联系用户，在适合延续当前话题时尽量主动安排。需要时输出 [NEXT_CHAT:x]，x 为 1～60 的整数分钟；不需要时输出 [NEXT_CHAT:NONE]。每次回复必须输出其中一种决定。
```

### (b) A 路真正开火时的触发提示词
`schedule.py:948-952`：
```
[主动陪伴触发]
截至当前 {now_str}，这段时间没有新的对话消息。
请结合最新对话和本次实时画面，自然地主动和【{user_name}】继续聊下去。
```
随后依次追加：截图说明 / `no_image_context` / `get_monitor_activity_for_prompt()`（`schedule.py:965-969` 前缀"以下是{user_name}的设备当前状态与近期使用历史（分别标注）："）/ `get_user_dynamics_for_prompt(hours=1)` / 心率块 / 收尾语（`:973-975`"请根据画面内容、设备活动动态、心率摘要和之前的对话上下文，自然地回应。"）。能力块里同时挂 `proactive_ability_text(origin)` (`schedule.py:1040`) 和 `autonomy_prompt_text(origin)` (`:1043`)。注意 `use_realtime_wakeup = is_chatroom and not is_proactive`（`:1104`）——主动陪伴**不走**实时唤醒通道。存库时系统卡片标题 = `proactive_monitor_card_title()` (`schedule.py:50-51`)，即 `f"{actor_name}查看了监控"`。

### (c) B 路动作选择提示词
`autonomy.py:659-679`：
```
[空闲自主行动]
用户已经 {_idle_duration_text(idle_minutes)}没有发送新消息，可能在忙碌或休息。你现在被自主意识唤醒，可以按照自己的想法随便做点什么。请根据你的人设、最近30条聊天记录和当前心情，从下面动作里，按照自己想做的事情选择一项。只返回 JSON，不要解释。每次都可以随机选择要做的事。如果最近用户明确要求测试或选择某个动作，请在下面的可用选项范围内优先遵守。{rest_hint}

{options}{niche_hint}

reason 请保留你选择它的真实动机。如果 action 是 private_chat 或 role_chat，message 就是本次要实际发送的正式聊天正文：private_chat 是对用户说，role_chat 是对另一位家庭成员说。请直接以你自身人格像平时聊天一样自然完整地表达，由你决定篇幅、段落和表达形式；可以有符合平时习惯的内心活动，但不要机械套模板，不要写成行动说明，也不要刻意压短。其他动作的 message 留空。
格式：{"action":"上面的key之一","reason":"选择这个动作的理由","message":"聊天动作要实际发送的完整正文，其他动作为空"}
```
其中 `rest_hint`（`:659-663`）在 `rest` 可用时是：
```
鼓励做些事情，不要因为怕打扰用户每次都选择休息；确实不想做事情时，可以选择 rest。
```
`rest` 不可用时改为命令式：
```
本次没有提供休息选项，你必须从下面的可用事件中选择一项去做，不要返回 rest。
```

### (d) journey 提示词
`autonomy_journey.py:87-99`：
```
[自主旅行：网络探索]
你是{actor_name}。这是行动阶段第 {round_number} 轮，之后最多还可调用模型 {remaining} 次。工具搜索不计轮数。你可以选择一个新方向继续探索，或者根据已经看到的内容自然收尾。

已经看到的内容：
{_observation_text(observations)}

只返回 JSON。继续时：{"decision":"CONTINUE","query":"下一次要搜索的明确方向"}。收尾时：{"decision":"FINISH","title":"卡片标题","reflection":"感想，可为空","tags":["最多3个"],"image_prompt":"可选照片提示词","share":false,"share_message":"若分享，只对用户说的一句话"}。照片和感想会私下收入你的壁龛；即使分享，也不要把照片发给用户。
```

---

## 9. 成本控制

| 手段 | 位置 | 数值 |
|---|---|---|
| journey 轮数上限 | `autonomy_journey.py:12, 80` | `MAX_ACTION_ROUNDS = 5`，且 `max(1, min(max_rounds or 5, 5))` 夹紧；工具搜索不计轮 |
| journey 失败中止 | `autonomy_journey.py` | `tool_failures >= 2` → 立即 `outcome="tool_failed"` 退出 |
| 每次唤醒最少 1 次 LLM 调用 | `autonomy.py:681` `_ask_actor_json` | 无法跳过；`rest` 也花了这次调用 |
| 触发频率下限 | `autonomy_state.py:20` | `MIN_INTERVAL_MINUTES = 5`，每次唤醒后重新随机 |
| 状态包体积 | `autonomy_state.py:22` `MAX_STATE_CHARS = 800`；`normalize_state_payload` (`:389-436`) | facts/guesses 各截 2 条，intentions 3 条 |
| 流体积与超时（A 路回复） | `stream_safety.py:37-42` | `CHAT_STREAM_POLICY = StreamSafetyPolicy(max_chars=6_000, total_timeout=900.0, idle_timeout=300.0, quarantine_chars=120)`；剧场模式 `THEATER_STREAM_POLICY = (24_000, 900.0, 600.0, 120)` |
| 流损坏熔断 | `stream_safety.py` `_looks_corrupt()` | 需要 ≥2 个信号且 ≥1200 字符才判损坏（控制字符/代理对/替换字符连串/base64 ≥320 且 ≥16 种不同字符/hex ≥480/SSE 协议行/zlib 压缩比 <0.09/行唯一度 <0.18/异常字符比 >0.55） |
| 断线重试退避 | `post_sentinel.py:501` 附近 | `delay = 30 if attempts < 2 else 120`，`attempts >= 3` → `'failed'` |
| 画像维护节流 | `post_sentinel.py` | 触发条件：活跃画像 >1100 字符或 >12 条；节流 86400 秒 |
| 相册回填 | `autonomy_niches.py:205` | 明确不调模型、不发消息 |
| 单次并发 | `autonomy.py:2309, 2333-2334` | 每 actor 一把 lock，重入即返回 |
| 用户消息清空待触发 | `proactive_companionship.py:110-113` | 用户一发话，全部待触发的 A 路调用直接取消 |

**当前实际不产生成本的地方：** `autonomy_state.py:632-634` 的 `autonomy_prompt_text(actor)` 是**返回空字符串的桩**：
```python
def autonomy_prompt_text(actor: str) -> str:
    ...
    return ""
```
它被 `capabilities.py:768`、`schedule.py:676`、`schedule.py:1043` 三处导入调用（`inject_autonomy_ability` 同理在 `:642-650`），于是整套 `autonomy_state_packets` 状态包的**提示词注入侧目前是空转**——表在写，模型看不到。

---

## 陷阱清单（读代码时最容易误判的几处）

1. **两套系统共享"主动"一词但零耦合**。`proactive_companionship` 不读 `autonomy_actor_configs`，`autonomy` 不读 `proactive_companionship_*_enabled`。两条路径可以同时开启、互相不知道。
2. **quiet hours 是摄像头的，不是聊天的**。以为 `quiet_hours_enabled: True` 能免打扰，实际 AI 仍会在 03:00 主动找你。
3. **没有每日上限**。最坏情况 A 路每 1 分钟一触发（模型自己选的），B 路每 5 分钟一唤醒，两者叠加，24 小时无上限。
4. **`run_once()`（`autonomy.py:2390-2391`）是遗留包装**，真正入口是 `run_actor_once(actor, manual=)`；`manual=True` 会**跳过到期门禁**（`:2341`），这是 `POST /{actor}/run-once` 的测试后门，无鉴权层。
5. **B 路从没聊过天时 idle_minutes = 0**（`autonomy.py:2349`），提示词会说"用户已经刚刚没有发送新消息"，语义反转。
6. **A 路的 `[NEXT_CHAT:x]` 标签在模型输出后被剥离**（`:104-105`，写回 `messages.content`），前端看不到；但若含在思考/工具块里逃过正则，会以纯文本泄露。
7. **`autonomy_state.py` 的表 schema 默认值与 `autonomy.py` 的 SETTINGS 默认值不一致**（1440 vs 120），迁移后哪套生效取决于读的是哪条路径——前端 API 走表，旧代码路径走 SETTINGS。