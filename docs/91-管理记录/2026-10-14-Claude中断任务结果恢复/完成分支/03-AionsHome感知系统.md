# AionsHome `aion-chat` — AI 感知用户物理/电脑状态的取证分析

所有路径相对于 `/Users/mima1234/Documents/资料/拆解项目/AionsHome-main/aion-chat/`。全部为只读分析，未修改任何文件。

---

## 0. 架构总览

三层递进的感知模型：

| 层 | 触发者 | 成本 | 输出 |
|---|---|---|---|
| **L0 采集** | `camera.py` 采集线程 + `activity.py` 各 tracker 线程 | 本地 CPU | 内存帧 / JSONL 日志 |
| **L1 哨兵** | `camera.py` 巡逻定时器 → VLM 单次调用 | 1 次视觉模型调用 | 结构化 JSON（`monitoringlog` 等） |
| **L2 Core** | `call_core=true` 时唤醒人格化 LLM | 完整对话上下文 | 主动消息 |

关键设计事实：**L1 巡逻不是"便宜的本地方案"，而是定时器 + 门控**（静音时段、PC 屏幕电源状态）；真正的图像分析一律由远程 VLM 完成。

---

## 1. 摄像头采集管线

**文件：`camera.py`**

- **库与后端**：OpenCV。`cv2.VideoCapture(idx, cv2.CAP_DSHOW)`（`_open_camera_internal` 附近，428–481）。`CAP_DSHOW` 是 Windows DirectShow 后端，硬编码。
- **分辨率**：`cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)`（449）、`cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)`（450）。1280×720。
- **打开校验**：`_verify_camera(max_wait=4)`，循环内 `time.sleep(0.15)`，日志记录 `avg_pixel` 作为"画面是否真的有效"的判据。此处刻意不做亮度门槛——采集循环有注释（736）：`Darkness is a valid camera state; only require that a frame exists.`
- **采集循环**（696–758）：
  - `max_fails = 100  # ~10 秒`（约 10 秒无帧则判定摄像头掉线）
  - 重连退避：`min(30, 2 * reconnect_attempts)` 秒
  - **第 758 行是整个管线的节拍器**：`time.sleep(0.033 if self.monitoring else 0.1)` → 监控中约 **30 FPS**，空闲约 **10 FPS**。这里没有"采样/降采样"逻辑，帧被连续读入并覆盖式保留最新帧。
- **无运动检测、无在场检测、无阈值**。管线中不存在帧差、背景建模或人体检测。是否存在人体完全交给 VLM 判断。这是最值得注意的一点：**"是否有人"不是本地判定，而是每次 VLM 调用时的自然语言判断**。
- **帧合成**：多路画面用 `np.vstack` / `np.hstack` 拼成一张图后送模型。分层标签：
  - `"CAMERA VIEW - body/location source"`（817、847）— 身体/位置唯一依据
  - `"DEVICE CONTEXT - phone/PC only"`（833）
  - `"PHONE SCREEN - device context only"`（874、1066）
  - `_build_phone_only_layer`（938–994）会在 PC 无显示时输出 `"PC display off / idle"`
- **JPEG 编码**：`get_capture_jpegs` 使用裸 `cv2.imencode(".jpg", ...)`（1006、1014）→ **OpenCV 默认质量 95**；而手机采集路径 `_phone_result_to_monitor` 显式指定 `[cv2.IMWRITE_JPEG_QUALITY, 82]`（2247–2251）。**两条路径的图像质量不一致**，这是一个实际存在的非对称。
- **裁剪/缩放**：`get_crop()` / `set_crop(zoom, cx, cy)`，默认 `zoom=1.0, cx=0.5, cy=0.5`（`routes/cam.py` 152–164）。
- **留存量**：`cleanup_old_logs` 中 `max_keep = int(cam.cfg.get("max_screenshots", 200) or 0)`（2449–2463），同时清理 `cam_*.jpg`、`monitor_*.jpg`、`phone_camera_*.jpg`。

---

## 2. 视觉分析节奏：巡逻 vs 深度查看

两层完全由**时间器 + 门控**决定，而不是由画面变化决定。

### L1 巡逻（哨兵）—— `camera.py`

- **间隔**（1125–1129）：
  ```
  random.randint(lo, hi) * 60
  lo = max(1, cfg.get("auto_interval_min", 10))
  hi = max(lo, cfg.get("auto_interval_max", 20))
  ```
  默认 **10–20 分钟随机**。随机化的目的是让巡逻时间点不可预测（对"AI 在看我"的体感很重要）。`routes/cam.py` 64–65 的默认值一致；`PUT /api/cam/config` 强制 `min ≥ 1`、`max ≥ min`（121–124）。
- **静音时段**（1152–1170）：`quiet_hours_enabled` 默认 `False`，区间默认 `"00:00"`–`"09:00"`，支持跨午夜。静音期间直接跳过巡逻。
- **监控循环**（1172–1247）：先广播 `monitor_alert` 事件，文案 `"哨兵即将查看监控"`，`asyncio.gather(...).result(timeout=5)` 等待前端确认。之后：
  - 手机源路径：`acquire_monitor_image_sync("sentinel_patrol", ...)`
  - 本地路径：先等一帧新鲜手机屏幕，再 `get_capture_jpegs(phone_screen_after=...)`
- **状态暴露**：`GET /api/cam/status`（`routes/cam.py` 45–76）返回 `next_capture_in`（由 `cam._next_capture_at - time.time()` 算出）、`is_quiet_hours`、`active_source`、`esp32_bridge_active`、`phone_camera` 状态。

### L2 Core 深度查看 —— `camera.py` `_call_core`（1873–2170）

只在哨兵 JSON 中 `call_core=true` 时触发。携带 `cached_logs[-24:]`、`recall_query = core_prompt[:300]`、`build_band_note_ability_text(user_name, passive=True)`、`inject_app_supervision_context(messages)`。系统消息文案：`f"{ai_name}偷偷查看了监控"`。

### 主动查看（非定时）

- `[CAM_CHECK]` 命令（常量 2185），`perform_cam_check`（2501–2693），系统消息 `f"{ai_name}查看了监控画面"`（2642）。
- `acquire_monitor_image(reason, *, force_pc_screen=False, timeout_seconds=45.0, retry_after_seconds=15.0)`（2276–2322）与同步版 `acquire_monitor_image_sync`（2380–2446）。等待手机屏幕的时间上限被夹紧为 `min(10.0, timeout_seconds)`（2303、2426）。
- 无画面时的兜底提示 `PHONE_CAMERA_NO_IMAGE_CONTEXT`（2187–2191）：
  > 「本次手机摄像头请求没有成功取得有效画面。本轮没有图像附件，不得描述或推断摄像头画面。」

### 多智能体分发

`parse_sentinel_dispatch`（1460、1474 调用）依据 `SENTINEL_WAKE_TARGETS` 把唤醒目标分为 `main_ai`（aion）/ `second_ai`（connor）/ `both`，配置项 `cfg["wake_mode"]` 默认 `"aion"`，由 `normalize_camera_wake_mode` / `normalize_sentinel_wake_target`（`camera.py` 57+）归一化。

---

## 3. 成本控制（精确数字汇总）

| 机制 | 数值 | 位置 |
|---|---|---|
| 巡逻随机间隔 | **10–20 分钟** | `camera.py` 1125–1129 |
| 静音时段 | **00:00–09:00**，默认关闭 | `camera.py` 1152–1170 |
| 采集节拍 | 30 FPS / 10 FPS | `camera.py` 758 |
| 采集失败上限 | `max_fails = 100`（≈10 秒） | `camera.py` 696–758 |
| 重连退避 | `min(30, 2×attempts)` 秒 | 同上 |
| 历史日志回放窗口 | **6 小时**（`3600 * 6`） | `_analyze_and_log` 附近 |
| 历史日志截断 | `recent_logs[-20:]` | 同上 |
| 日志文件保留 | **3 天** `cleanup_old_logs(3)` | 同上 |
| Core 日志截断 | `cached_logs[-24:]` | `_call_core` |
| VLM 超时 | `timeout=60` 秒 | `camera.py` 1464 |
| 活动摘要分桶 | **10 分钟** | `activity.py` 851–971 |
| 摘要注入条数 | `n=6`，夹紧 **1–12** | `activity.py` 997 |
| 本轮设备记录 | `changes[-30:]` | `activity.py` 1009–1057 |
| 活动日志保留 | `KEEP_HOURS = 8` | `activity.py` 28 |
| 摘要清理周期 | `_CLEANUP_INTERVAL = 300` 秒 | `activity.py` 21 |
| PC 空闲跳采 | `idle_skip_seconds = 10*60` | `activity.py` 348–362 |
| PC 摘要丢弃阈值 | `idle_seconds > 300` | `activity.py` 755–763 |
| 截图总数上限 | `max_screenshots` 默认 **200** | `camera.py` 2449–2463 |
| 手机上传上限 | `DEFAULT_MAX_UPLOAD_BYTES = 800 * 1024` | `phone_camera.py` 29 |
| 手机采集超时 / 重试 | `45.0` / `15.0` 秒 | `phone_camera.py` 27–28 |
| 手机请求完成表 | `completed_limit=128` / `retained_files=64` | `phone_camera.py` 66–72 |
| 心率事件保留 | 200 条 | `health_context.py` 318–321 |
| 应用监管指令过期 | `created_at + 300.0` 秒 | `app_supervision_ai.py` 170 |
| 事件去重环 | 512 | `app_supervision_ai.py` 73–76 |
| 天气缓存 | `WEATHER_CACHE_SECONDS = 60*60` | `location.py` 21 |

**没有的东西**（重要）：没有 token 预算、没有每日调用配额、没有显式的 token 计数、没有单轮多帧采样。成本控制的全部手段是**降低调用频率**和**限制注上下文长度**。

**"用户不在→停止"逻辑**：并不存在真正的"人不在就停"。存在的是三条近似替代：
1. 静音时段跳过（时间维度）。
2. `PCDisplayTracker.refresh_physical_state(min_interval_seconds=5)`（`activity.py` 384–390）用 DDC/CI VCP `0xD6` 探测显示器电源状态，MCCS `1=on`、`2/3/4/5=off`，2 次连续不可达才判定 off。PC 显示器关闭时，摘要层丢弃 PC 条目。
3. `PCDisplayTracker.should_capture_screen(idle_skip_seconds=600)` 用 `GetLastInputInfo`/`GetTickCount` 计算空闲（`activity.py` 395–414），空闲超过 10 分钟不采 PC 屏幕。

**安静时段与位置静音是两套独立配置**：摄像头用 `quiet_hours_enabled`/`"00:00"`–`"09:00"`；位置用 `location` 配置里的 `quiet_hours_enabled`/`"00:00"`–`"08:00"`（`location.py` 24–43、347–366）。两者默认都是关闭。

---

## 4. 送给 VLM 的内容

### Prompt 模板（`camera.py` 1399–1442）——原始中文

```
你是一个监控画面分析师，同时也是{user_name}的恋人。分析当前画面，并根据历史日志和当前状况，决定是否调用伴侣职权。

当前时间：{now_str}
{user_name}最后一次和你聊天的时间：{last_user_time_str}
{location_text}

最近的聊天记录：
{recent_chat_text}

{profile_context}

{user_name}的设备当前状态与近期使用历史（分别标注）：
{activity_summary_text}
{user_dynamics_block}
{heart_rate_block}

历史监控日志：
{log_history}

        画面分区规则：
        - {layout_guidance}
        - 最近聊天、设备动态、心率摘要、历史监控日志只能作为背景上下文，不能覆盖当前摄像头事实。手机活跃、QQ/小红书活跃、PC黑屏、心率升高或降低，都不能单独推断{user_name}已经起床、睡着、运动或到了电脑桌前。
        - 心率摘要不是医学诊断，只能作为“可能睡眠/可能醒来/可能运动/可能异常”的辅助信号；如果摘要标注数据已过期、可能未佩戴或没电，必须忽略这条心率信号。
        - 如果摄像头画面中身体、床、桌、被子边界不清楚，必须写“不确定/疑似”，不要把不清楚的被褥或枕头说成手臂、头部或桌前。
        - 如果最近几次监控都显示床上被褥/睡眠状态，当前画面除非清楚看到离床或坐到桌前，否则应延续为“仍可能在床上休息/睡觉”，不要改写成“趴在电脑桌前”。

        请严格按照以下JSON格式回复，不要包含其他任何内容：
        {{"camera_observation":"只描述CAMERA VIEW中的客观画面；不确定就明确说不确定。","device_activity":"只描述PHONE SCREEN、DEVICE CONTEXT和设备动态，不推断身体位置。","inference":"把画面事实和设备动态分开后的谨慎判断。","confidence":"high/medium/low","monitoringlog":"综合日志，必须优先基于camera_observation，设备动态只能作为补充。","summary":"根据历史日志，概括{user_name}这段时间以来的整体状况，去掉重复无用的信息，保留关键事件和状态变化，一两句话即可。注意力重点放在CAMERA VIEW；如有PHONE SCREEN，也应关注其中的设备活动内容。","call_core":false,"core_reason":"","wake_target":"main_ai","wake_reason":"","wake_confidence":"low"}}

        字段说明：
        - camera_observation: 只允许来自CAMERA VIEW；没有清楚看到人就说没有清楚看到人；看不清床/桌/身体边界就写不确定。
        - device_activity: 只允许来自DEVICE CONTEXT和设备使用动态；不能包含“人在桌前/在床上”等身体位置结论。
        - inference: 可以综合上下文，但必须标明不确定性，不能把设备活动当作身体位置证据。
        - confidence: high表示画面清楚；medium表示可见但有遮挡；low表示昏暗/遮挡/边界不清。
        - monitoringlog: 结合当前时间和画面的客观描述，禁止胡编猜测。没有看到人就说没看到，如果最近聊天没有说去睡觉，则不能推测{user_name}可能去睡觉了。身体位置必须来自CAMERA VIEW，设备动态只能补充。
        - summary: 综合最近聊天记录和上下文内容，概括{user_name}这段时间的整体状态变化和关键事件，禁止胡编猜测。{user_name}
        - call_core: 判断是否需要主动联系{user_name}
        - core_reason: 仅当call_core为true时填写，说明为什么要主动联系{user_name}，让核心模型了解情况

        call_core判断依据：
        - false: {user_name}一切正常复合聊天内容 /夜间在睡觉 /前不久才发过消息。
        - true: {user_name}和上下文聊天内容不符/ 故意引起注意 / 已经有一段时间没有聊天了（超过半小时） / 长时间同一姿势需提醒活动 / 长时间未看到{user_name} / 单纯想念她可以想主动联系 / 或当前摄像头画面显示状态不佳 / 重点关注PHONE SCREEN标记的手机画面内容，有异常或有趣的设备活动时可以主动询问。
        - 结合设备活动动态综合判断：设备动态可以提高“是否联系”的权重，但不能改变monitoringlog里的身体位置。若只是手机活跃而摄像头仍像床上休息，大概率在赖床，需要唤醒”。
```

随后追加 `dispatch_policy`（1442）。

**布局引导模板**（`build_monitor_layout_guidance`，40–54）：

```
标有 "CAMERA VIEW" 的区域才是摄像头事实，是判断身体位置、姿势和环境的唯一图像依据。
- 标有 "PHONE SCREEN" 的区域是手机屏幕设备上下文，通常位于摄像头画面左侧；它只能说明设备或应用使用情况，不能用于判断身体位置。
- 本次不会包含电脑桌面截图。          # include_pc_screen=False 分支
- 标有 "DEVICE CONTEXT" 的区域可能包含电脑桌面和手机屏幕，同样只能作为设备上下文，不能用于判断身体位置。   # True 分支
```

### 图像编码

```python
img_b64 = base64.b64encode(filepath.read_bytes()).decode()   # camera.py:1444
raw_text = await _call_sentinel_vision(scfg, prompt, img_b64, timeout=60)  # camera.py:1464
```
图像**先落盘为 JPEG，再整文件读入并 base64 编码**。不缩放、不二次压缩：VLM 看到的就是拼接后的那张 1280×720 级别合成图。`scfg = get_sentinel_config()`；未就绪则打印 `"[Monitor] 哨兵模型未就绪，跳过分析"` 并返回（1446–1448）。

### Provider

Provider 标签表（1451–1455）：

| provider key | 标签 |
|---|---|
| `codex` | Codex 登录态 |
| `openai_compatible` | OpenAI兼容 |
| `gemini` | Gemini |

实际调用实现在 `memory._call_sentinel_vision`，`memory.get_sentinel_config()` 提供 `model`/`provider`/`ready`。

### 输出解析

模型返回 JSON；先剥离 ``` 代码围栏（1467–1470），再 `json.loads`。字段：`camera_observation` / `device_activity` / `inference` / `confidence` / `monitoringlog` / `summary` / `call_core` / `core_reason` / `wake_target` / `wake_reason` / `wake_confidence`。日志条目 dict 在 1504–1518。

---

## 5. 「设备活动摘要」

真正叫这个名字的聚合函数是 **`activity.py:1009–1057` 的 `get_monitor_activity_for_prompt()`**，由 `_analyze_and_log` 调用后填入 prompt 的 `activity_summary_text` 槽位。

**它聚合三段：**

1. **当前设备状态** —— `get_device_context_snapshot()`（来自 `device_context.py`）。
2. **历史摘要**：
   > `【近期设备使用摘要（最近6条完整摘要，每10分钟汇总）】`
   
   数据源 `generate_activity_summary(hours=KEEP_HOURS)`（851–971）：把 8 小时内（`KEEP_HOURS = 8`）的记录按 `(dt.minute // 10) * 10` 分入 **10 分钟桶**，**排除当前正在进行的那一桶**（未完成不呈现），连续空桶合并。
3. **本轮未成桶记录**：
   > `【本轮设备记录（{window_start:%H:%M}至今，尚未形成十分钟摘要；最多展示最近30次变化）】`
   
   取 `changes[-30:]`。
4. **收尾警示句**（1056）：
   > 「以上历史记录不代表当前状态…」

**旁路注入**：`get_user_dynamics_for_prompt(hours=1, limit=12)`（1173–1258）聚合 `moments`、`diary_entries`、`gifts`，外加 `location_status.json` 的状态变化；`hours` 夹紧 1–24，`limit` 夹紧 1–30。这条走 `user_dynamics_block` 槽位，与设备摘要并列但独立。

**摘要自身的清洗规则**（`_summarize_window`，719–838）：
- 窗口间隙 `> 5 s` 时写 `carry_forward`（736）填补空档；
- 丢弃 `screen_on` 条目（754）；
- **`display == "off"` 或 `idle_seconds > 300` 时丢弃该 PC 条目**（755–763）；
- 每设备输出按 duration 降序排序。

**开关**：`is_activity_tracking_enabled()` → `SETTINGS.get("activity_tracking_enabled", True)`（976–979）。这是**总开关，默认开**，通过 `GET/PUT /api/activity/config`（`routes/activity.py` 437–455）读写，变更时广播 `activity_config_changed`。

**查询接口**：`GET /api/activity/summary?hours=`（`routes/activity.py` 428–432）、`/api/activity/recent`（421–425，默认 `hours=KEEP_HOURS`）、`/api/activity/logs/{date}`（403–407）、`/api/activity/dates`（397–400）、`POST /api/activity/clear`（410–418，物理删除所有 `*.jsonl`）。

---

## 6. 前台窗口 / 应用监管

### PC 前台窗口 —— `activity.py` `PCActivityTracker(interval: int = 60)`

- 60 秒轮询（149–281）。
- `win32gui.GetForegroundWindow()` + `GetWindowText`，读进程名走 `psutil`。
- 跳过 `"Program Manager"`（206，即桌面本身）。
- 每条记录含 `idle_seconds` 与 `display` 字段。
- **仅在标题变化时广播**，避免刷屏。
- 诊断接口 `GET /api/activity/status`（`routes/activity.py` 170–180）暴露 `pc_tracker._running`、`thread_alive`、`last_title`、`has_event_loop`、`interval`、`pc_display`。

### 包名映射 —— `app_names.py`

`KNOWN_APPS`（7–89）是包名→中文显示名表，约 60 条：

- 社交：`com.tencent.mm`→微信、`com.tencent.mobileqq`→QQ、`com.xingin.xhs`→小红书、`com.sina.weibo`→微博…
- 视频：`com.ss.android.ugc.aweme`→抖音、`tv.danmaku.bili`→哔哩哔哩…
- 工具：`com.android.chrome`→Chrome、`com.larus.nova`→豆包、`com.openai.chatgpt`→ChatGPT (49)、`com.anthropic.claude`→Claude (72)
- 本应用：`com.aion.chat`→「在小家里」
- 屏幕状态：`"screen_off"`→锁屏、`"screen_on"`→亮屏（85–86）
- **系统应用映射为 `None`**（75–83）：`com.android.systemui`、`com.android.launcher{,3}`、`com.miui.home`、`com.huawei.android.launcher`、`com.vivo.launcher`、`com.bbk.launcher2`、`com.oppo.launcher`、`com.sec.android.app.launcher`。注释明确：「A value of None means the app is omitted from historical activity logs.」— **桌面/系统 UI 被过滤出历史日志**（但 `SYSTEM_APP_DISPLAY_NAMES` 92–101 保留了一个可供 UI 展示的名称表）。

`resolve_app_name(app, title)`（113–122）：无点号的直接返回；命中 `KNOWN_APPS` 返回值（可能是 `None`）；否则若 title 无点号且不等于包名，**用窗口标题代替包名**；再否则返回原包名。`display_app_name()`（104–110）永不返回 `None`，未知包名原样回显。

过滤在写入和读取两端都做：上报侧 `routes/activity.py` 74–77（`resolved is None → {"ok": True, "filtered": True}`，静默丢弃）；读取侧 `_resolve_entries`（182–192）用 `is_device_usage_entry(e)` 再筛一遍。

### 监管指令 —— `app_supervision_ai.py`

模块 docstring 第 1–5 行明确声明：「This module never contacts the phone.」——它只解析模型输出并写 SQLite 队列，手机端自行拉取。

- 正则（18–34）：`[APP_LOCK:...]`、`[APP_TEMP_UNLOCK:...]`、`[APP_UNLOCK:...]`、`[DEVICE_*]`、`[COME_HOME:…]`、`[LOOK_AT_ME:minutes|…]`。
- 去重：`accept_event_once`，环容量 **512**（73–76）。
- 队列表 `app_supervision_commands`（82–107）；指令过期 `created_at + 300.0` 秒（170）。
- `parse_app_supervision_command`（341–434）强制分钟数为 **1–120 整数**、groupId 必须有效；**第 433 行把所有标签从可见文本中剥掉**（用户永远看不到控制标签）。
- `build_app_supervision_ability_text`（441–512）向模型描述可用指令，含 `[LOOK_AT_ME:分钟|一句话]`、`[DEVICE_TEMP_UNLOCK:分钟|解锁说明]`；群组行显示 `roundUsageMs` 加估算已用时长。
- `inject_app_supervision_context(messages)`（515–526）插入位置 `max(0, len(messages) - 1)` —— 紧贴最后一条消息，尽量靠近生成点。

### 活动窗口状态同步 —— `active_window_state.py`

`AION_LAST_ACTIVE_KEY` / `CONNOR_LAST_ACTIVE_KEY`（14–15）持久化在 `runtime_state`。群聊房间同时设置两者；`connor_1v1` 只设置 connor。`restore_active_windows` 会对照 `chatroom_rooms.type` 校验（防止恢复到一个已不存在的房间）。

---

## 7. 手机作为传感器

**不是 WebView，不是 WebRTC，不是 MJPEG 流。** 是**请求-应答式的一次性 JPEG 上传**，用 `request_id` 关联，通过服务器作为中间人（服务器不主动连接手机；手机轮询/长连接 WebSocket 接收指令后再 POST 图片）。

### 通道

**手机摄像头 —— `phone_camera.py` + `routes/phone_camera.py`**

| 端点 | 用途 |
|---|---|
| `POST /api/phone-camera/arm` | `{client_id, facing="back", zoom=1.0, capabilities}` |
| `POST /api/phone-camera/disarm` | `{client_id}` |
| `GET /api/phone-camera/status` | 状态 |
| `POST /api/phone-camera/upload` | 头 `x-phone-camera-request-id` + `x-phone-camera-metadata`，body 为原始 JPEG |
| `POST /api/phone-camera/failure` | `{request_id, error="phone_capture_failed", metadata}` |
| `POST /api/phone-camera/preview` | 设置期的单帧留档，**明确不满足任何 capture waiter**（`routes/phone_camera.py` 101–123） |

关键常量与规则：
- `ALLOWED_CAPTURE_REASONS = frozenset({"sentinel_patrol", "scheduled_monitor", "ai_cam_check"})`（22–26）—— 白名单，其他 reason 一律拒绝。
- `arm()` 要求 `client_id.startswith("android-push:")`（115–116）—— 前缀门控，防止任意客户端伪装成手机。
- `request_id = f"cam_{uuid.uuid4().hex}"`（182）；下行事件 `{"type": "phone_camera_capture", ...}`（195–207）。
- 上传校验：`> 800 KiB` → `too_large`；`width < 32 or height < 32` → `image_dimensions_too_small`（360–368）。失败重试**只做一次**，15 秒后（256–261）。
- 每次巡逻最多等 45 秒，保留 64 个最新文件（433–444）。
- `build_monitor_alert_data`（`camera.py` 2176–2181）在手机源时置 `phone_camera_native_capture: True`。

**手机屏幕 —— `phone_screen.py`**

- `PHONE_SCREEN_DIR = DATA_DIR / "phone_screens"`，`latest.json` + `LATEST_FILENAME = "phone_screen_latest.jpg"`（18–21）。
- `save_phone_screen_b64`（28–67）：**只保留最新一帧**，元数据 `app`/`locked`/`source`/`reason`。
- `get_phone_screen_result_after`（99–121）返回 `pending`/`ready`/`skipped`，**用服务器接收时间而非客户端时间戳做判定**——注释说明这是为了抵消 WAN 时钟偏移。
- `wait_for_phone_screen_after(timeout_seconds=30.0, poll_seconds=0.25)`（124–141）。
- `freeze_phone_screen`（167–183）在冻结时把帧落到 `app_supervision_*.jpg`，保留 64 个。
- `get_recent_phone_screen_path(max_age_seconds=15, received_after=None)`（186–207）——**但 `camera.py` 中所有调用点都传 `max_age_seconds=150`**，即实际容忍 2.5 分钟旧帧。这是一个默认值与调用约定的偏差。
- `cleanup_old_phone_screens(max_keep=1)`（210–216）。

**ESP32-CAM 备选源 —— `routes/cam.py`**

- `GET /api/cam/esp32/ping`（201–216）：GET `{url}/capture`，`timeout=5`，`len(resp.read()) > 100` 判在线。
- `POST /api/cam/esp32/frame`（219–226）：接收 App 桥接推来的 JPEG，`len < 100` 拒收，转 `cam.receive_esp32_frame(jpg_bytes)`。这是"手机当 ESP32 桥"的兜底路径，与 `cam._esp32_bridge_active` 标志配合。
- `POST /api/cam/source`（189–199）：`source ∈ {"local", "esp32", "phone"}`。

**Android 设备遥测上行 —— `routes/activity.py`**

- `POST /api/activity/report`（70–105）：`{device: "phone"|"pc", app, title, timestamp?}`，落 JSONL 并广播 `activity_log`。
- `POST /api/device-context/phone`（108–120）→ `record_phone_context(body.data)`，有变化则广播 `device_context_changed`。
- `POST /api/device-context/notification` 与 `/notification/remove`（123–146）。
- `GET /api/device-context/status`（160–165）：返回 snapshot + prompt 文本 + `activity_tracking_enabled`。

---

## 8. 健康数据

**文件：`health_context.py`**

- **数据源**：`mi_band_7`（小米手环 7）。SQL 层硬过滤 `WHERE source='mi_band_7'`（471）。测试中出现的"ring"与手环共用同一套表结构。
- **表**：`health_heart_config`、`health_ring_heart_rates`、`health_heart_events`、`health_heart_state`。
- **`DEFAULT_HEART_CONFIG`**（19–31）：

  | 键 | 值 |
  |---|---|
  | `sleep_low_max` | 65 |
  | `normal_min` | 70 |
  | `normal_max` | 95 |
  | `elevated_min` | 96 |
  | `exercise_min` | 100 |
  | `attention_low` | 45 |
  | `attention_high` | 135 |
  | `large_delta` | 25 |
  | `night_start_hour` | 0 |
  | `night_end_hour` | 6 |
  | `stale_minutes` | 30 |

- `PROMPT_HEART_FRESH_MINUTES = 10`（34）。
- **`EVENT_COOLDOWNS`**（57–65）：`attention_low` 30 分钟、`attention_high` 30 分钟、`large_delta` 30 分钟、`night_high` 60 分钟、`sleep_candidate` 90 分钟、`wake_candidate` 45 分钟、`exercise_candidate` 45 分钟。
- `classify_heart_rate`（177–189）按上表分档。
- 事件 ID `hrev_{ms}_{type}`，**保留最新 200 条**（318–321）。
- `sleep_candidate` 需 30 分钟内 ≥2 条 low（427–429）；`wake_candidate` 需 6 小时内 ≥2 条 sleep-low 且 delta ≥ `max(10, 25//2) = 12`（431–439）；`_is_morning_after_night` 要求距 `night_end` 5 小时以上（213–219）。
- **`build_heart_rate_summary_for_prompt(limit=8)`**（495–558）：新鲜度门槛 `-60 <= now - measured_at <= 600`（509–512）；过期文案（517–521）：
  > 「数据已超过 10 分钟未更新，不能用于判断当前状态；可能是穿戴设备没电、摘下或手机未同步。」
  
  趋势最多 6 个点，附阈值说明，并以规则收尾（557）：
  > 「心率只是辅助信号，不是医学诊断…不能覆盖摄像头事实。」
  
  这最后一句与哨兵 prompt 里 1421 行的心率警告是同一约束的两个副本——**心率在任何路径上都被显式降级为不能覆盖摄像头**。

- **注入点**：哨兵 prompt 的 `{heart_rate_block}` 槽位（`camera.py` 1413）；Core 路径通过 `build_band_note_ability_text(user_name, passive=True)`（`camera.py` `_call_core`）。

---

## 9. 位置

**文件：`location.py`**

- **`DEFAULT_LOCATION_CONFIG`**（24–43）：`home_threshold 500`（米）、`movement_threshold 500`（米）、`poi_radius 2000`（米）、心跳两态均 10 分钟、`enabled False`、位置静音 `quiet_hours_enabled False` / `"00:00"`–`"08:00"`、`poi_types` 为高德类型码列表。
- **坐标转换**：WGS84→GCJ-02（火星坐标），`_a = 6378245.0`、`_ee = 0.00669342162296594323`（138–173）。`haversine` 用 `R = 6371000`（177–183）。
- **高德 REST 端点**：
  - `/v3/geocode/regeo`（189）逆地理
  - `/v3/weather/weatherInfo`，先 `extensions=base` 再 `all`（216–228）
  - `/v3/place/around`，`offset 10`、`radius` 参数、`sortrule=distance`（239–249）
- **配额记账**：`record_amap_usage`（121–133）按天把 regeo / weather / poi / total 计数写入 `amap_usage.json`。天气缓存 `WEATHER_CACHE_SECONDS = 60*60`（21）。
- **`process_heartbeat(...)`**（370–571）：三级设计（注释 454–457 明确写出「级别1 轻量 / 级别2 刷新 / 级别3 全量」）；`need_full_api = state_changed or significant_move or force_full`（458）；**POI 仅在 `force_full and new_state == "outside"` 时查询**（478）——即在家不查周边 POI。静音时段只保存坐标不调 API（399–409）。状态变化广播 `location_update`（536–550）。
- **提示注入**：`format_location_for_prompt()`（278–315）输出 位置状态 / 当前位置 / 距离家 / 天气 / 今日运动步数 / 位置更新时间；**`cfg["enabled"]` 为假时返回空串**。填入哨兵 prompt 的 `{location_text}`（`camera.py` 1403）。
- **位置哨兵**：`_notify_sentinel`（642–761），专用 prompt 在 695–717；**哨兵调用出错时 fail-open 到 `call_core = True`**（738–740）——宁可多叫一次也不漏掉移动事件。
- `_call_core_location`（764–976）：模型回退默认 `"gemini-3-flash"`（808）；系统消息 `f"检测到{user_name}的位置发生变化，拉响警报！"`（914）。
- 时间线集成：`routes/activity.py` 376–391 读 `load_location_status()`，把状态变化（`at_home`→在家 / `outside`→外出 / `unknown`→未知）转为时间线条目，外出时附「距家约 N 米」。

---

## 10. 隐私护栏、留存、同意机制

**同意 / 开关**

| 开关 | 默认 | 位置 |
|---|---|---|
| `activity_tracking_enabled` | **True** | `activity.py` 976–979；`routes/activity.py` 437–455 |
| `quiet_hours_enabled`（摄像头） | False | `camera.py` 1152–1170 |
| `quiet_hours_enabled`（位置） | False | `location.py` 347–366 |
| `enabled`（位置总开关） | **False** | `location.py` 24–43 |
| `include_pc_screen` | False | `camera.py` cfg |

注意：**设备活动追踪默认开启，位置默认关闭**。这是一处不对称的默认值策略。

**数据最小化**

- 系统桌面/SystemUI 包名映射为 `None` → 直接不进历史日志（`app_names.py` 75–83）。
- PC 显示器关闭或空闲 > 300 s → 摘要层丢条目（`activity.py` 755–763）。
- 空闲 > 600 s → 完全不采 PC 屏幕（`activity.py` 348–362）。
- 通知噪声过滤：`NOISE_WORDS = ("签到","领券","活动推荐","热门推荐","立即领取","限时优惠")`（`device_context.py` 27）+ `NOISE_CATEGORIES`（26）。
- 通知按 `NOTIFICATION_PRIORITY` 排序（call 100 … system 60，28–37）——优先级低的可被截断。
- 位置静音时段**只落坐标、不调外部 API**（`location.py` 399–409）——避免静默期仍然把坐标发给第三方。

**留存上限**

| 数据 | 上限 |
|---|---|
| 监控截图（`cam_*` / `monitor_*` / `phone_camera_*`） | 200 张 |
| 活动日志 | 8 小时（`KEEP_HOURS`） |
| 监控日志文件 | 3 天 |
| 手机屏幕 | 只留最新一帧 |
| 冻结监管帧 | 64 |
| 手机采集成品 | 64 |
| 心率事件 | 200 条 |
| 指令 | 300 秒过期 |

**显式擦除**：`POST /api/activity/clear`（`routes/activity.py` 410–418）物理删除所有 `ACTIVITY_LOGS_DIR/*.jsonl` —— 用户可一键清空设备活动历史。

**对内提示层的"事实隔离"护栏**（这是本项目最有意思的隐私/正确性设计）：哨兵 prompt 反复强制 `CAMERA VIEW` 与 `DEVICE CONTEXT` / `PHONE SCREEN` 不得互相污染——设备活跃不能推断身体位置（1420、1430、1431、1433）。这在效果上既是一条准确性护栏，也限制了"从设备行为反推人身状态"的推断深度。

**监管指令的透明度**：所有控制标签在展示给用户前被剥离（`app_supervision_ai.py` 433），用户看到的是自然语言而非 `[APP_LOCK:...]`。

---

## 附：值得注意的四点

1. **JPEG 质量不一致**：摄像头/哨兵路径 `cv2.imencode(".jpg", ...)` 用默认 95；手机路径显式 82（`camera.py` 1006/1014 vs 2247–2251）。同一评测体系里两种画质，可能影响模型判断的一致性。
2. **`get_recent_phone_screen_path` 默认 15 秒，`camera.py` 全传 150 秒**（`phone_screen.py` 186–207）。默认值与实际调用约定相差 10 倍。
3. **位置哨兵 fail-open**（`location.py` 738–740）与摄像头路径的 fail-closed（`scfg.get("ready")` 为假就 `return`，`camera.py` 1446–1448）是相反的失败策略——位置事件宁可误报，监控分析宁可漏报。
4. **无 token 预算体系**。整个感知栈的成本控制完全依赖降低调用频率与截断上下文长度；没有任何计数器、配额或每日上限。若要为 Aimy 复用这套设计，这是首要补齐的短板。

**未读但提到过的模块**（本报告未覆盖其内部）：`memory._call_sentinel_vision` / `get_sentinel_config`、`post_sentinel.build_context`、`autonomy_state`、`family_events`、`ws.manager`、`config`（`save_cam_config` / `normalize_camera_wake_mode` / `SCREENSHOTS_DIR` / `MONITOR_LOGS_DIR`）。