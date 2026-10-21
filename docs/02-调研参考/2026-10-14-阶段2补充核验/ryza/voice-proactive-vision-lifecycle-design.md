# AIRI 增量：语音、主动陪伴、间隔看屏与生命周期审查初稿

日期：2026-10-14（Asia/Shanghai）。状态：可开发规划输入，尚未实施/产品验收。主 Agent 统一裁决与正式写作；本稿不冻结数据库/模型/角色格式。写入仅 /tmp/aimy-20261014-ryza-planning/；不改产品代码，不装依赖，不调用凭据、模型或设备。

## 1. 应立即改正的旧方案

1. R4 §3 目前把「Smart Turn 判断用户已经说完」作为「现在才中断角色」的条件，这是两个时序任务混用了。有效用户插话要在**确认用户开始说话**后尽快停旧播放/生成；**说完判断**仅决定何时结束这次用户录音、送最终转写/提交新回合。等说完才停她，会让两个人从用户开口到说完一直重叠。
2. AIRI 已有 onset → interruption → silence receipt → ASR → submit。代码：`packages/stage-ui/src/libs/voice/voice-activity-plugin.ts:58–94`；`core-agent/src/voice/input/attempt.ts:240–270`；`voice/output/response.ts:342–356`。本批是提高确认与撤权可靠性，不是重造 Turn/Voice/Audio 引擎。
3. AIRI **已有 EOT 插件接缝**：`core-agent/src/voice/input/attempt.ts:126–201 detectEnd`。检测结果落地前核对 transcript.revision / speechRevision / conversationContext.revision（167–173），并等有序活动证据覆盖相应帧（176–177）。Smart Turn 候选应接这里；不放在 before-interrupt gate。
4. R4 §4 的「间隔看一眼/变化汇总待用户选择」过期：2026-10-13 决策已选**间隔取一帧**。不要再列为未答；现有3000ms是上游默认值，不是用户确认的产品费用档位。
5. R4 §2 的「确认方式待答」过期：已选自动保存。schema里的 confirmed 可以代表确定性验证后的状态，不能变成每条记忆弹确认。SQLite/Orama/sqlite-vec 仍是旧初稿，不因本次规划自动冻结。

## 2. 当前实现的真实优势与增量缺口

| 源码锚点（均相对 /Users/mima1234/Documents/aimy/aimy-app/） | 已有事实 | 本批增量 |
|---|---|---|
| `packages/stage-ui/src/stores/voice.ts:407–428` | Silero观察、source实际AEC能力门、当前session的activeTurns为打断目标 | 增加短附和/噪声确认策略，保持唯一输入/输出owner；不搬Ryza能量录音器 |
| `packages/core-agent/src/voice/input/attempt.ts:245–265,318–349` | onset先reserve pre-roll，再打断并等静音；capture/ASR统一AbortSignal | 确认延迟若加长，必须同时验证历史窗足够，防首字被裁。默认历史360ms在audio-device.ts:14，不可无脑再加240ms门后仍声称有360ms预录 |
| `packages/audio/src/browser/sources.ts:109–127` | getUserMedia迟到后先注册track cleanup，再throwIfAborted；优于Ryza | 不替换底层，测试产品撤权是否真的触发相应subscription取消 |
| `packages/stage-ui/src/stores/settings/audio-device.ts:29–48` | enabled本身持有一个独立音频subscription；关闭监听不一定关硬件 | 暂停/撤权要释放hold、VAD、手动录音和电平观察所有消费者。voice.stopListening:441只能停止一个观察器与current input |
| `apps/stage-tamagotchi/src/renderer/utils/voice-input-lifecycle.ts:28–78` | start/stop串行与去重的工具函数 | 检索暂无当前主链生产调用证据，不能把存在当已启用。若使用，撤权要先同步置deny/epoch++，不等未完成permission/startPromise才能生效 |
| `apps/stage-tamagotchi/src/renderer/composables/use-vision-screen-capture.ts:120–143` | 选源+getDisplayMedia+停已有track | await返回没有source/代次/关闭后的复查，晚到stream仍可赋回；新增cancel epoch与迟到stream立即stop |
| `packages/stage-ui/src/stores/modules/vision/processing-store.ts:93–145` | single-flight、跳过重叠tick、默认3秒 | stopTicker只clearInterval，未取消handler；stop后在飞任务仍能写指标/结果；跨窗口各有ticker |
| `packages/stage-ui/src/composables/vision/use-vision-inference.ts:91,114–148` | 已支持abortSignal，按provider并发队列，60秒timeout | capture orchestrator没把signal传进来；成功await后也需再判stale。provider不理AbortSignal时不能接受迟到结果 |
| `packages/stage-ui/src/stores/modules/vision/orchestrator.ts:18–29,61–106` | processCapture与ReplaceSelf上下文 | 扩展payload绑定ownership/signal；结果发布前核对session/source/epoch；观察帧不直接进入持久聊天/记忆 |
| `packages/stage-ui/src/composables/vision/vision-read-queue.ts:39–46` | 只在单renderer内共享provider semaphore | 不声称全应用串行；产品观察只设一个owner，devtools不能同时绕过产品权限/预算。是否以后移到main排队是独立决定 |
| `packages/stage-ui/src/stores/character/orchestrator/store.ts:39–44,95–116,119–156` | 2秒任务tick、去重pending、重排机制、spark模型调用 | scheduled数组并未相同ID去重；processing在await provider之后才true；dispose未取消模型；需要确定性机会门/取消令牌/发布复查 |
| `packages/stage-ui/src/stores/character/notebook.ts:33–35` | notes/tasks仅ref | 不作为可靠重启后的提醒/已说话记录；记忆/事件持久化归Aimy统一状态层，不能再引第二个数据库owner |
| `apps/stage-tamagotchi/src/main/windows/main/index.ts:106–109,155–162` | 主角色窗口close默认hide，quit hook才允许真正close | “收起聊天”不能错绑成主角色窗口hide；按窗口角色和明确产品动作定义事件 |
| `apps/stage-tamagotchi/src/main/index.ts:418–469` | before-quit已有异步bootkit/injeca清理 | 增加先deny再取消/停止/持久化已提交数据的有限退出握手；不等待模型返回才能退出 |

Ryza 的 vad/endpoint/proactive/vision/state_read 都是 planned、没有创建。只借其确认窗口/用户优先/去重思路；它的队列、ASR、明文存储和native闹钟不进入 Aimy。

## 3. 同一套运行时中的状态机

### 3.1 采集权限和“想开”分开

建议产品策略状态（新增有界policy层，不替换AIRI设备/播放实现）：

`effective(resource) = appVisible && !stageMinimized && !quitting && userIntent(resource) && osPermission(resource) && resourceLeaseCurrent`。

- resource 为 `microphone` 或 `screen`，独立开关与代次；关麦不关看屏，关看屏不关麦。
- `appEpoch` 只因应用隐藏/角色最小化/退出/恢复初始化等全局边界变化；`micEpoch`、`screenEpoch` 因对应撤权/换源变化。会话采用已有 sessionGeneration，回复采用已有 `{sessionId,turnId}`，不新增第二套chat epoch。
- 首次/未授权/已撤权默认OFF。**跨重启是否恢复“想开”、重新显示是否自动恢复采集仍须主 Agent 明确标为默认方案或待答**；本稿推荐恢复为暂停、用户明确恢复后才采集，不能把OS已授权当产品持续同意。

### 3.2 输入与输出可同时存在，别压成一个扁平idle/listening/speaking

保留 AIRI 的输入attempt状态：`pending(source|silence) → capturing → finalizing → settled(committed|drafted|cancelled|failed)`；输出保留 VoiceResponse/PlaybackGroup 的 `generating → speaking/draining → finished|interrupted|cancelled|failed`。

在语音活动插件内只增加**onset候选状态**：

`none → candidate(firstFrame, speechMs, echoDecision) → accepted`，或任何否决/静音/换源/撤权 → `none`。

- candidate尚未确认时不创建打断、不提交输入、不写聊天；保留有界PCM历史。短「嗯」、键盘、游戏音、扬声器回流属于负例。
- confirmed后调用现有 `controls.beginInput`，明确interruptTurns仅当前session的activeTurns；AIRI保留捕获→中断→静音回执顺序。先确认用户说话不是等用户说完。
- 候选门只是可调参数/分类器，240ms来自Ryza经验，不是已获效果验证的数字。它会增加停止延迟，必须与现有无确认基线对照。
- 若确认门用240ms、还要求真实360ms onset前录音，AudioInput.historyMs至少覆盖 `确认延迟 + 目标preRoll + 最大调度延迟`；测试必须比对实际首尾样本坐标，不能只检查WAV非空。也可明确缩小preRoll并记录取舍；不得静默裁剪。

### 3.3 EOT只决定结束当前输入

`capturing → candidateSilence → detectorRunning(evidenceRevision) → continue | end`。

- 先保留现有静音基线；Smart Turn是可选EOT adapter实验。候选静音出现后才调用，输入≤8秒的有效当前输入PCM与固定Whisper预处理；不得把随机/零mel当正向验证。
- 返回`end`只通过attempt.detectEnd的revision/speech/activity检查调用attempt.end；**没有权限停其他输出、开新对话或持久化关系/记忆**。
- **终点只能一个决策者**：当前voice-activity-plugin.ts:90–94会在静音阈值直接input.end。启用语义EOT时必须把这一路改成candidate-silence证据/回退计时，交统一end coordinator裁决；不能让静音定时器和SmartTurn各自竞争封口，否则模型continue也会被旧1200ms定时器截断。默认关闭EOT时保留原行为。
- 人工显式停止/按住录音走现有manual路径，不等待SmartTurn或onset候选。附和短音负例不等于把所有短词一律丢弃，真实意图由样本标注与对照评测确认。
- 新用户音频、新转写revision、新会话上下文、换源、cancel发生时旧end失效。推理失败/超时回退到基线终点，并暴露有限错误；不能无限等模型。
- 模型文件revision/SHA/预处理/SIMD/runtime能力/中英文停顿表现必须实验后固定，模型不可因文档写v3.2就当作已接入。

### 3.4 主动陪伴是机会判断，不是每2秒让模型找话

在已有character orchestrator增加确定性机会门：

`disabled|paused → idle → candidate → eligible → generating → ready → presenting → cooldown → idle`。

- candidate只来自本产品已有事实/承诺的合适时机、经授权的新观察、明确计划事件；不引入Ryza经济/NPC/签到/岛屿。
- 进入generating前：用户没有在说/输入/等回复；角色可见；安静开关未开；scope有效；候选未过期/未被删除更正；冷却与预算允许。未通过直接quiet，不必调用LLM。
- `eventId`去重必须覆盖scheduled、inflight、presented；每个“事件版本”最多一次用户可感知呈现。模型生成失败可有限重排；取消/过期/用户说话不无限重试。
- 等LLM返回后**再次**核对机会门与scope。生成期间用户开始输入时取消；即使供应商晚到，也不能开口、写“已提醒”、或触发关系/记忆副作用。
- 正常主动发言不打断用户/助手正常回复；只在空闲机会开现有AIRI speech producer。不因模型输出`priority:critical`获得抢占权限。用户插话仍走现有interrupt链，并取消当前主动生成与排队发言。
- 记录“已提起”应在真正呈现开始/成功回执处；生成完成不等于用户听到。失败播放不能永久吞掉待提醒事项。
- 冷却/安静时段/每天预算是待评测参数，不在本稿替用户拍死。第一版固定本地可解释规则，可查看/关闭主动行为；不要先上独立Agent服务。

### 3.5 间隔看屏只保留一条最新有效理解

`off → selecting → ready → waiting → capturing → interpreting → waiting`；任何撤权/隐藏/最小化/退出 → `stopping → off|paused`。

- 一个产品owner负责ticker，沿用single-flight与skip-busy；不累计待截图队列。间隔必须有限正数并限制到产品允许范围，不能传0/NaN/负数让计时器忙转。
- 捕获、理解、发言分开：每帧理解成功不会自动开口。理解只更新本会话本source的**临时最新**上下文；是否发言交机会门。
- 显示“正在看/暂停/失败”、当前选择和下次节奏；原始帧只在内存完成该轮、随后释放，不默默写日志/聊天/记忆。主动观察描述也不默认转长期事实。
- 请求发起前和每次await返回后都核对`appEpoch/screenEpoch/sessionGeneration/sourceId/operationId`，并传abortSignal到已有runVisionInference；stale返回只清理资源，不更新lastResult、context、metrics或错误toast。
- 停止时先置deny+epoch++，停timer、abort在飞推理/排队读、清video.srcObject、停所有track、清原始帧和旧视觉context。晚到stream立即stop，晚到结果直接丢弃。取消动作不能等模型settle才返回。
- 产品看屏owner与ambient-light/devtools/WithScreenCapture等已有消费者都须进入统一产品权限/生命周期门，不能只管新按钮。OSpermission与选源mutex只解决部分问题，不能当作Aimy产品授权门。

## 4. 事件契约（增量规划，非已存在API）

事件穿过现有Eventa/voice bus/mods context，禁止另造WS后端。主进程拥有窗口生命周期与产品资源授予；渲染层持有AIRI实际设备/stream/controller，受main授予与实时撤销约束。

```ts
// Proposed contract. Reuse AIRI TurnRef/sessionGeneration/AudioRange types.
type Resource = 'microphone' | 'screen'
type Ownership = {
  appEpoch: number
  resourceEpoch: number
  sessionId: string
  sessionGeneration: number
  operationId: string
  sourceId?: string
  turn?: { sessionId: string; turnId: string }
}
type PerceptionPolicyChanged = {
  appEpoch: number
  microphone: { enabled: boolean; epoch: number }
  screen: { enabled: boolean; epoch: number }
  reason: 'user-disabled'|'os-revoked'|'source-changed'|'stage-hidden'|'stage-minimized'|'quitting'|'session-changed'
}
type StopReceipt = {
  resource: Resource
  appEpoch: number
  resourceEpoch: number
  activeTracks: number
  activeRequests: number
  status: 'stopped'|'failed'
}
type ProactiveCandidate = {
  eventId: string
  sessionId: string
  sessionGeneration: number
  sourceFactIds?: string[]
  contextRevision: number
  expiresAt: number
  // no model-granted priority, tools, permission, or relationship delta
}
```

- `operationId`唯一，不用时间戳当唯一身份；同一资源最多一个当前start/token。取消reason枚举低敏，不写窗口标题/截图/API key。
- 创建side effect前：`scopeStillCurrent && resourceAllowed && !signal.aborted && ownerIdentityMatches`；在await后同样检查。任何一项失败返回内部`stale`/`cancelled`状态，不能改新一代UI、持久化、TTS、主动队列。
- source选择IPC已有onlySameWindow + sender校验（electron-screen-capture/main:203/221）；新增授权门要叠在此范围，不能扩大访问为任意renderer可授予。main注册不变更上游公共包所有消费者语义时可注入policy callback；具体签名由主 Agent 集成时确定。
- revoke同步置deny；异步stop负责回执。`activeRequests=0`表示本地不再接受/持有该请求，即使远端不支持取消也不等它结束；不能谎称远端费用已绝对停止。

## 5. 窗口/关闭语义矩阵

| 明确产品动作 | 角色是否可见 | 麦克风/看屏 | 生成/播放/主动 | 恢复 |
|---|---|---|---|---|
| 收起聊天面板/关闭仅聊天窗口 | 是，主角色仍在桌面 | 已开启且有效的可以继续；不新授权 | 保留正常陪伴与已授权语音；无须重建runtime | 展开仅UI变化 |
| 主角色窗口hide/整个应用隐藏 | 否 | 立即deny，停已有采集、拒新请求 | 取消采集派生推理、主动生成/排队/语音；停止播放和角色后台动作 | 默认paused；是否自动恢复待产品确认 |
| 主角色窗口minimize | 否 | 同hide | 同hide；不能把chat最小化误当stage最小化 | 同上 |
| 单关麦 | 角色仍可见 | 只撤麦；所有麦克风订阅/在飞ASR/auto-send失效 | 保留文字对话与独立已授权看屏；不把关麦当关TTS | 用户明确开麦再建新代次 |
| 单关看屏/OS撤销录屏授权 | 角色仍可见 | 只撤screen；清frame/context，晚到track停/结果丢弃 | 文字/语音授权独立；无屏幕派生主动开口 | 重新授权/选源建新代次 |
| 切session/character（当前一期单角色） | 是 | 可保持硬件权限；旧attempt/观察ownership取消 | 旧turn结果不进新session；不新增多角色产品范围 | 新session独立generation |
| 退出/Cmd+Q/quit | 否 | 先全deny，再停采集/排队/模型 | 取消所有producer，等有限本地清理/已提交持久化握手，不等模型 | 下一进程新appEpoch |
| 休眠/锁屏/渲染进程崩溃 | 无法保证可感知 | 按全局pause撤销leases | 清理与不接受迟到结果；生命周期owner保底 | 返回后可见paused状态 |

AIRI main/window close当前会hide**主角色窗口**；这不等于用户要求“收起聊天仍能看到她”。因此禁止把“所有BrowserWindow close/hide”粗暴映射成同一个动作。R3 B6 的“最小化暂停”须明确为**主角色窗口/全应用**，不自动涵盖聊天面板。

## 6. 可交给执行AI的任务边界

| ID/依赖 | 目标/可改范围（实施时） | 禁止触碰 | 关键验收 |
|---|---|---|---|
| VLP-01 无 | 形成main产品资源policy与生命周期事件：拟新增`apps/stage-tamagotchi/src/main/services/airi/perception-policy.ts`、`src/shared`契约；有限接入main/windows/main、main/index、已有permissions入口 | 不换Electron壳、Eventa、窗口结构、旧digital-lover；不读密钥 | chat折叠不撤采集；stagehide/min/quit先deny；两个资源互不误撤；same-window权限 |
| VLP-02 →01 | 对接AIRI麦克风所有订阅与source关闭：stage-ui stores/settings/audio-device、voice、voice-messages；main stage装配点 | 不搬Ryza Stt/Turn，不更换Silero/ASR/provider | pending getUserMedia后撤权不留track；device-change、自动/手动/电平订阅都释放；迟到转写不自动发 |
| VLP-03 →01 | 看屏epoch/AbortSignal单owner：use-vision-screen-capture、vision processing/orchestrator/inference；保留原devtools作为诊断 | 不加第二捕获服务，不存原始帧，不把所有用户图片识别全局停掉 | 选源中stop、A→B换源乱序、模型晚到、stop/start交错、provider slot取消不占队 |
| VLP-04 →01/02 | onset候选策略局部适配：voice-activity-plugin + audio-device历史窗参数/测试 | 不把SmartTurn置于打断前，不改core取消语义 | 真实PCM坐标不裁首字；短音与确认语音分别验证；仅当前turn被取消 |
| VLP-05 →04可独立后置 | Smart Turn EOT spike：拟新增可拔插leaf adapter，走attempt.detectEnd插件API；固定模型/预处理，默认关 | 不宣称产品必选，不安装第二ASR/runtime，不改变playback owner | transcript/speech/context revision更新后旧end失效；timeout回退；真实录音与人工标注比较 |
| VLP-06 →01+记忆主任务 | 主动机会门与幂等：character/orchestrator、notebook接统一持久化接口；提出/开始呈现/结束各记录明确 | 不搬Ryza proactive规划、RPG世界、不每tick调用LLM | scheduled/inflight/presented去重；用户输入抢占；返回晚到不说；删除事实使候选/摘要/待发言失效 |
| VLP-07 →03/06 | 在既有设置/控制岛增加“间隔看一眼”“正在看/暂停/安静”明确入口；按正式UI包集成 | 本子任务不做新视觉体系/路由重写 | 无授权不可启动；开关和状态一致；忙时skip；观察不会每帧开口 |
| VLP-08 →01–07 | 端到端离线夹具+新进程持久化/退出用例；docs/04新证据目录 | 不用mock冒充模型/设备/体验 | 下节负例可稳定重放，最终真实验收另门；零网络离线测试必须可运行 |

每项在正式任务表进一步明确1个writer、完整测试命令、产物文件和失败停止条件。上面文件是实施范围候选；本轮一个都不改。跨store的共同policy和公共事件由主 Agent 集成，不能多人并写。

## 7. 端到端离线验证与有限实验

### 7.1 离线可执行链

使用已有core-agent可注入AudioInput/StreamingTranscriber/AudioPlayback + 假provider/假时钟 + 真实store适配测试；每例断言start/stop/submit/publish/play/persist的事件序列与身份。fixture PCM是带坐标的合成信号，标签来自夹具，**不是语音识别质量证据**。Node/浏览器单测采用现有Vitest工程；无依赖安装。

必要负例：

1. 申请麦克风/屏幕权限未返回即off，再返回stream：每个track stop恰一次，UI仍off、无ASR/帧发送。
2. source A慢返回、用户换B、B快返回：仅B可用；A立即stop，A结果不发布。
3. 采集/推理中stagehide、minimize、quit：deny先于任何后续异步提交；0新采集、0context、0TTS、0主动呈现。
4. 关麦时auto-send定时器已设：timer失效、不把旧转写发成新聊天；独立看屏仍可继续。
5. provider忽略abort后返回文本/audio/frame：旧epoch没有任何副作用；已排程音频停、口型/表情动作所有权释放。
6. 同一spark eventId重复100次：只一个scheduled/inflight，最多一次可见发言；failed播放不写成功呈现。
7. proactive生成期间用户开口/文字输入/切会话/删除来源fact：旧结果丢弃，不能打断当前用户。
8. EOT正在推理时新speechRevision/ASR修正/context变化：旧end不封口；当前输入继续。
9. onset100ms短噪声：不interrupt；确认有效语音：旧turn static stop receipts只影响指定session/turn，其他turn不误杀。
10. 确认240ms + preRoll360ms：比较采集首帧与预期，history不足必须显式失败或调整策略，不能检查非空就通过。
11. 观察interval=0/NaN/负数/无限大：拒绝/钳到配置约束；忙时只skip，不排100个模型调用。
12. stop→start→旧stop完成乱序：旧finalizer不把新一代stream/ticker清空；旧metric/error不覆新状态。
13. renderer崩溃/IPC发送者不匹配/过期lease：main拒新capture；退出无需等不settle的供应商promise。
14. 新进程恢复已提交记忆/主动呈现记录；删除/纠正后旧派生候选不复活。SQLite/IDB选择由主记忆任务决定，测试接口只规定语义。

### 7.2 真实有限对照实验（计划，未执行）

| 实验 | 固定变量/样本 | 比较 | 观察指标/决策 |
|---|---|---|---|
| onset确认 | 同设备/音量/模型；有效插话、短附和、键盘、游戏音、自己的TTS各一组；耳机与扬声器分开 | 当前AIRI vs 有界确认门（如120/240ms候选） | user-onset→silence的p50/p95、误打断率、漏打断率、首字保留；收益不足保留原版 |
| EOT | 人工标注中/英完整句、内部停顿、未完句、短回答；固定真实录音PCM | 当前静音基线 vs 固定SmartTurn adapter | 提前封口率、额外等待p50/p95、推理CPU/内存、取消后0commit；不作为onset延迟指标 |
| 间隔观察 | 同一固定公开视频/合成场景；固定视觉模型/图像尺寸；不含个人屏幕 | 3s原版默认 vs 15/30s候选档 | 每分钟请求/token、漏场景变化、有效理解、安静不打扰；确定产品默认档而非先承诺“低价” |
| 主动提起 | 固定事实/承诺数据与人工“适合/不适合此时说”标注 | 无主动基线 vs 确定性机会门+同一模型 | 恰当率、来源正确率、重复率、打扰率；删除/撤权0违规为硬门 |
| 生命周期 | 当前macOS构建、所有可见相关窗口、选源/权限pending/网络慢等阶段 | 改前基线 vs 增量补丁 | UI/off与OS采集指示一致、track/process残留、晚到0效果、退出稳定；真设备证据单列 |

首次样本可按每类10个记录建立问题轮廓，不能冒充统计显著；结果差异不明确时不加入新依赖。真实模型/设备/下载的实验需后续执行任务明确预算与环境，本轮只给方案。

## 8. 本轮新增阅读与证据边界

read-coverage.json列34份文件：31全文、3定向（main/index退出段、renderer index接线片段、devtools screen-capture入口段）。当前AIRI核心输入/输出/controller、设备holder、原生capture source、vision四层、spark/notebook、main角色窗口都已由先前partial提升为full。

本轮未声称全AIRI语义深读；后续已补读ambient-light、voice-messages、main permission服务、system-audio-lipsync、stage-window-lifecycle；具体边界见新增§9。仍须在实施中通过全消费者负例才能宣布所有采集都可撤销。现有Ryza调查包已完整标明自己的coverage与13隔离结果，不重写历史恢复记录。


## 9. 初稿后补读与6项当前AIRI隔离复现

### 9.1 采集消费者实际边界

- 主进程`services/electron/media-permissions.ts:152–177`已有local origin allowlist + selected-source授权；**音频-only本地来源直接允许**（159–160），没有Aimy用户开关/应用可见资源lease。应沿用安全origin筛选再叠产品policy，不能重写为“local就一律grant”。
- `renderer/stores/stage-window-lifecycle.ts:20–29`目前只因minimized暂停stage；hidden并不使stagePaused=true；`renderer/pages/index.vue:361–366`监听mic enabled，392仅unmount停listen。不能以“动画暂停”证明采集已停。**切换到游戏/视频造成失焦不是隐藏，失焦时仍可按授权陪伴；policy不能以focused=false撤权。**
- `renderer/composables/use-screen-ambient-light.ts`全文533行已读。已有startVersion（169）、选源后版本检查并stop迟到track（295–298）、dispose撤代次（230–232），可借它的局部生命周期模式增强vision capture；但它按ambient设置立即启动（154），未读stage lifecycle/产品screen授权。关看屏必须管到这个现成消费者，不能新入口off而ambient仍采集。
- `renderer/features/live2d/system-audio-lipsync.ts:28–124`已有generation/迟到结果清理，source来自getDisplayMedia(video+audio)；这属于屏幕/系统音频授权，不是麦克风授权。其已有保护可沿用；主应用hide/quit仍须撤lease。不要把“保留wLipSync”误当采集系统音频必须一直开。
- `stage-ui/stores/voice-messages.ts:64–79`手动语音附件录音独立访问devices.input；connect清理只取消pending/capturing/finalizing（131–136）。产品撤麦需覆盖仍在transcribing的在飞ASR，已有完成的草稿则按用户动作保留，不能为了关麦无端删用户已录好的内容。
- `renderer/components/WithScreenCapture.vue:36–69`处理OS授权状态/失焦回来复查，未执行产品撤权时stop流；OS权限组件不能替代产品owner。`devtools/screen-capture.vue:79–90`也有直接getDisplayMedia入口，必须受相同policy。
- `main/libs/bootkit/lifecycle.ts:22–25`按顺序await hooks，当前无默认超时。新增退出清理必须有局部deadline和异常隔离，避免永不settle hook堵住整个退出；不能简单追加一个无限等的“保证保存完成”。

### 9.2 6项复现结果（非产品验收）

脚本`airi-isolated-checks.cjs`读取当前源码中的实际函数片段，只擦除TS参数/局部类型/非空断言，注入假Vue refs、假selection/stream、假provider/agent、假时钟，不执行模块bootstrap或真实模型/设备。

| ID | 断言得到的结果 | 真实证据范围 |
|---|---|---|
| AP-01 | startStream等待权限时stop，之后假stream到达仍安装，stop前track计数0 | 真实startStream/stopStream/clearActiveStream/isActiveStream/attachStreamLifecycle，假OS输入 |
| AP-02 | A慢/B快；最终selected=B，但installed=A，两stream均未由竞态清理 | 两次选择都pending且stream尚不存在时换源，现有activeSourceId watcher当时无流可清；Vuewatcher只按此精确前置建模 |
| AP-03 | stopTicker后在飞handler返回，仍recordCapture(123) | 真实runTick/stopTicker，假的deferred handler；不证明实际截图质量 |
| AP-04 | 给当前processCapture额外传caller signal后撤销，它未转发signal、仍发布一次context并更新lastResult | **signal字段当前尚非该payload正式API**；证明必须扩展接线/提交guard，不宣称历史caller本来就能取消 |
| AP-05 | 同eventId两次enqueue：pending=1，scheduled=2 | 真实enqueuebody，时间helper为桩 |
| AP-06 | 两个immediate在provider lookup等待时都过processing门，最终agent.handle被调两次 | 真实handler/process函数，provider/agent仅惰性promise；没有真实模型 |

`airi-isolated-results.json`保留机器结果。六项断言全部得到上述预期缺陷/竞态结果，**不是六项产品测试通过**。零网络/模型/设备/产品写。

新增可复用优先级：先VLP-01/02/03修授权与代次，再VLP-06修scheduled幂等及provider获取前single-flight；最后做确认门/EOT/主动体验实验。已有ambient与system-audio的代次保护属于本底座可复用实现，新增层不必抄Ryza。
