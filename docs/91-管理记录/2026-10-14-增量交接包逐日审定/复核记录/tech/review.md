# 增量交接包：技术、API、验收只读审定意见

日期：2026-10-14。状态：只读review，等待主写者更新文档后终核；未执行产品/旧实验、未改仓库、未读旧样机/旧AIRI/外部候选源码、未联网/安装/运行模型或启动app。唯一写入本tmp目录。

**Day1已选A：首批记忆管理与普通聊天中的相关召回，后台续聊放下批；共同基础收尾保留。该选择只确认范围，不是代码授权，也不冻结整套17API/15任务的所有参数。** 接到这个用户选择前的null已由主写者明确转述的新选择覆盖；其他日期选择仍为null，不自行代选。

当前交接包可作为具体审定底稿，不能把17个操作当已经可调用的API。最重要的技术修正是：真实删除落盘回执、最后异步准备后的发送资格、旧native/portable投影重算和按当批完成的依赖。这些是工程判断，不需要再让用户选await/CAS/数据库内部函数。

机器版详见 `findings.json`：17操作逐项分类、15任务现有/拟新增最小文件与受影响验证、7个发现、源码锚点/指纹。所有拟新增文件名只是本审给出的精确候选边界，未授权创建。

## 1. 运行责任应明确到进程与owner

| 层 | 当前真实位置与已有能力 | 本批增量归属 |
|---|---|---|
| 界面 | `apps/stage-tamagotchi/src/renderer`、`packages/stage-pages`的Vue页面；当前memory页仍为占位 | 记忆列表/来源/更正删除与反馈，走renderer owner，不复制HTML原型运行逻辑 |
| renderer业务和存储 | `packages/stage-ui`的Pinia/chat/session、synced leader动作、Provider适配；`database/storage.ts`将local/outbox挂IndexedDB | 新MemoryService/Repo/worker、事实投影和回执在此；IDB不是Electron-main库 |
| 通用运行规则 | `packages/core-agent` Conversation/协议/turn/语音取消，纯端口与共享代码 | 新每请求memory resolver/guard、scope epoch和失效重算；不硬引Electron到core |
| Electron `src/shared` | 进程桥的可序列化类型与Eventa描述符 | 资源策略/secret桥DTO，**不承载一个执行数据库业务的“shared后台”** |
| Electron main | 窗口与OS/Electron权限、userData路径、已有channel服务等 | 产品资源lease/撤权/有界退出；拟新增secret桥。main验证实际IPC sender/window，MemoryService校验本地principal/character/session；不说所有普通内存函数都经main鉴权 |

依据：[renderer存储](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/database/storage.ts:7)、[synced runtime](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/libs/pinia/setup-synced.ts:24)、[chat owner装配](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/chat.ts:542)。记忆无需新增HTTP服务器或第二套Electron/聊天/音频运行时；AIRI原本已有的本地channel服务继续保留，并不把它虚构为新Memory API服务。

当前所查app源未见已实现的safeStorage保险库；03所写应读作**拟用Electron API建立窄桥**。配置/推理仍有renderer消费者，必须逐消费者适配secretRef/安全调用或受限内存密钥模式，不因写出main桥便宣称普通Pinia/config同步已经没有明文。

## 2. 七个发现：哪些要改、由谁决定

| ID/优先级 | 当前事实 | 修正建议/归属 |
|---|---|---|
| HT01 P2 | `deleteMessage`调用setter，setter内部`void persistSession`，其Promise完成不是落盘回执 | SRC/MEM内用可等待、有scope/source版本的实际删除/编辑回执；cleanup成功后再报告来源已删。工程判断 |
| HT02 P2 | core调用LLM端口后仍有tools/string projection/resolveStep等await；native同scope会直接重放，协议提前生成messages/input | 将最后资格门覆盖实际协议/传输边界及每步；失效必须丢旧payload，从有效history+最新projection重算；补同任务精确路径。工程判断 |
| HT03 P2 | 业务/IDB在renderer；当前main权限规则不是新增产品lease，secret桥不存在 | 03/04写清owner和真实IPC责任，保持现会话/协议/Provider。工程判断 |
| HT04 P2 | 读取时INT全局依赖PRO/VIS/CHAR；用户现已选A | 保持15IDs，MEM03承担普通聊天相关引用；PRO01仅后台；INT/EXP按当批切片与条件后批依赖。用户范围已答A；映射是工程判断 |
| HT05 P2 | `onUserMessageAppended`是void且不await，用户chat落盘与memory job入另一key之间有间隙 | 定义有界source游标恢复/重排或可等待postcommit处理；kill在两者之间后恢复不能漏新源，不做全库回放。工程判断 |
| HT06 P2 | Envelope有factKey但未写host稳定规则；持久autoSave/配置revision/cleanup回执位置欠明确 | 首批写清现有schema字段/owner与含糊替换处理；不假装kind/text相等解决语义同一性。后台字段后批再审，不重新交架构题给用户 |
| HT07 P2 | Node实际24.20.0 vs工具声明26.7.0；profile override只存在源码，未启用 | 实施前工程统一精确基线并验证；profile只用独立测试目录、核有效app.getPath，禁止读迁旧数据。并入现BASE/LIFE回执，不新增任务 |

HT01/02/04主写者已明确计划修正，本文件不是称其已实施；需在下一轮正式文档核对是否落实。

### HT01：删除/编辑回执的确切源码

[commitUserMessage:341](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/chat/session-store.ts:341)等待persist并复查generation，是可复用的durable提交基础；但[deleteMessage:385](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/chat/session-store.ts:385)→setSessionMessages→[replaceSessionMessages:321](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/chat/session-store.ts:321)采用`void persistSession`。因此04“durable commit/delete”要拆清对象，不能把await deleteMessage当已删源。

原[enqueuePersist:162](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/chat/session-store.ts:162)与[persistSessionMessages:317](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/chat/session-store.ts:317)已有可等待路径，后者已导出；应在原session owner内完成明确删除回执。不要绕过它直接写chatSessionsRepo，跳过索引/generation/缓存/取消。先持久fact屏障，再清chat；失败维持PARTIAL/unknown，同mutation只续同cleanup。

### HT02：native失效后必须重算实际请求

- [buildContext:568](/Users/mima1234/Documents/aimy/aimy-app/packages/core-agent/src/runtime/chat-orchestrator-runtime.ts:568)优先generationTranscript，也会使用providerTranscript；仅改UI/content不够。
- [Chat native replay:179](/Users/mima1234/Documents/aimy/aimy-app/packages/core-agent/src/messages/chat-completions.ts:179)、[Responses native replay:84](/Users/mima1234/Documents/aimy/aimy-app/packages/core-agent/src/runtime/responses.ts:84)直接重放同scope数据；[scope:47](/Users/mima1234/Documents/aimy/aimy-app/packages/core-agent/src/runtime/request-context.ts:47)当前没有memoryEpoch。
- [llm-service:82](/Users/mima1234/Documents/aimy/aimy-app/packages/core-agent/src/runtime/llm-service.ts:82)还有异步resolveStep、prepareStringContent、builtin/custom tools；[Chat adapter:28](/Users/mima1234/Documents/aimy/aimy-app/packages/core-agent/src/runtime/chat-completions.ts:28)先投messages，prepareStep又可能await配置。高层927前检查不是最后网络边界的证明。

拟实现合同应为：撤交付/abort旧请求→丢弃旧Conversation派生的payload/request对象→失效受影响native与portable派生round/text→从过滤后有效history+最新memory projection重新buildContext→重算scope并投协议→最后异步准备后/真正发送前复查guard。单改epoch导致scope失配后，portable内容若仍含旧事实，同样不能发。SDK内部还await时需受控传输边界或实际请求拦截证明；**当前没有可宣称已存在的安全发送hook**。

同SRC/MEM允许区补精确现有文件：`packages/core-agent/src/types/llm.ts`、`runtime/llm-service.ts`、`runtime/chat-completions.ts`。最后一个与已列`messages/chat-completions.ts`是不同文件；已有request-context/responses与两协议消息文件继续保留。不是新增功能/API/任务。

### HT05/06：首批数据合同的最小补全

[onUserMessageAppended:379](/Users/mima1234/Documents/aimy/aimy-app/packages/core-agent/src/runtime/chat-orchestrator-runtime.ts:379)返回void，[750调用](/Users/mima1234/Documents/aimy/aimy-app/packages/core-agent/src/runtime/chat-orchestrator-runtime.ts:750)不等待。不能仅把async enqueue挂上去便称job耐久。现有sourceStates游标/jobs可承载有界恢复合同，覆盖聊天commit后、enqueue前退出的负例，不添加新的业务实体/第二outbox。

03 Envelope与04 `memory.policy`需明确autoSave和持久mutation/cleanup回执的具体字段/owner。factKey由host控制；纠正已有factId可确定，自动候选若不足以判定同一事实不得任意覆盖另一偏好。明确稳定槽位/已有事实关联规则与歧义行为即可，实际语义质量仍待真实模型评测；不假装代码能确定所有同义关系。后台event/policy/预算/uncertain状态留后批审定，不为方便先冻结。

## 3. 17API：全部是提案，不是17个已就绪接口

| 操作 | 当前可复用基础 | 仍拟新增/适配 | 执行owner |
|---|---|---|---|
| memory.list | 原历史/IDB基础 | 当前事实查询/游标/revision | renderer MemoryService/Repo |
| memory.source | 原session/message IDs/load | per-fact source版本/可见源 | renderer MemoryService→session owner |
| memory.correct | 原IDB依赖/轮次保护 | fact版本/CAS/替代/失效 | renderer MemoryService |
| memory.forget | 原会话删除/取消 | 屏障、awaitable源清理/PARTIAL | renderer MemoryService→chat owner |
| memory.policy | 无同等原生设置 | autoSave/epoch/持久revision | renderer MemoryService |
| memory.enqueueSource | 原durable user commit/final转写 | 来源版本/job去重/恢复 | renderer source adapter |
| memory.resolveRequest | 原Conversation/ctx | 每请求resolver/guard/投影 | pure core port→renderer adapter |
| memory.commitCandidates | 原IDB库 | lease/epoch/source/CAS提交 | renderer worker→MemoryRepo |
| perception.start | OS/Electron media、原采集 | 产品lease/epoch/all-consumer门 | main政策+renderer资源owner |
| perception.stop | 原voice/capture停止 | 独立hold/所有消费者回执 | main/renderer资源owner |
| perception.stopAll | 原window事件 | 有界统一撤权/退出握手 | main→renderer owners |
| vision.configure | 原interval/统计 | 长间隔/CAS/预算/单owner | renderer Vision owner，后批 |
| proactive.configure | 原attention设置 | enable/quiet/durable预算 | renderer policy owner，后批 |
| proactive.consider | 原Spark/角色链 | 资格/完整decision/最终门 | 原Spark owner，后批 |
| presentation.cancel | 原TurnRef/interrupt/静音receipt | operation身份/fact依赖取消 | renderer voice/chat owners |
| diagnostics.summary | 原io/context tracing | 低敏聚合读取契约 | renderer只读adapter |
| operation.get | 原本地存储基础 | 持久mutation/cleanup查询 | 相应renderer owner |

接口名称未在当前产品实现。源码找到同类基础不等于可调用同等新契约；也不将“没有同名函数”当全仓能力不存在。新HTTP/WS端点数量为0。

## 4. 保持15任务，按当批最小边界审定

`findings.json/task_matrix`逐任务列出存在/拟新增的精确候选路径和验证，不要求所有允许区都改。主写者确认后的正式边界才可作为未来实施任务输入。

| 当批 | 现任务IDs | 最小文件方向/原代码保留 | 受影响验证 |
|---|---|---|---|
| 共同基础 | BASE-01、LIFE-01、LOCAL-01 | 可见品牌触点；main/windows/permissions/shared DTO、renderer App/lifecycle、audio hold/voice/真实消费者；Provider同步发送/secret桥。保留原窗/角色/聊天/Provider/namespace | 原品牌回归、media-permissions/stage-window-lifecycle/voice原测试；迟到grant/hold释放/未同意0发送/secret失败 |
| 已选A | SRC-01、MEM-01、MEM-02、MEM-03 | chat/session/core端口与实际协议边界；拟新增memory.repo/types/stores/memory；填现memory页。保留原ID/leader/会话持久队列与有效native重放 | 来源durable/ref版本、enqueue崩溃恢复、真实IDB CAS/quota、改删/receipt/PARTIAL、两协议实际body、当前/历史证据和正常聊天引用 |
| 每批收口 | INT-01、EXP-01 | 只改当批diff测试/修复；不因记忆首批完成要求先做后台/看屏/正式资产 | A的受影响ENG切片与原定向回归；工程完成/模型体验待验分开，未授权模型不假验 |
| 后台后批 | PRO-01 | 原Spark/character policy/sink+已选后的持久event适配；保留现语音/角色owner | say/silence、session/epoch、新输入、生成中关闭、presenting未知不重播 |
| 尚未选/后批 | VIS-01、VIS-02、VOICE-01、VOICE-02、CHAR-01 | 只保留现链。VOICE-02条件实验；不下载EOT、不换renderer、不决定正式格式/音色 | 后续选定或真实基线证明缺口后再审对应验证 |

不改变15IDs，不增加实体/依赖或任务。REQ-MEM04普通聊天相关引用归MEM03；PRO01只后台。INT/EXP按选择切片完成与记录，不以全局未来依赖阻断首批，也不凭首批完成宣布整产品验收。未来未选择分支留草案，不要求用户为实现方便再次批准无关架构。

## 5. 生命周期与环境须保留的区别

- 主舞台[close→hide](/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/main/windows/main/index.ts:155)不等于收起聊天；[聊天按钮](/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/renderer/components/stage-islands/controls-island/controls-island-chat-button.vue:33)对floating chat独立toggle。用户已确认收起聊天仍见角色，普通失焦仍陪伴。
- [stage lifecycle:20](/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/renderer/stores/stage-window-lifecycle.ts:20)当前仅最小化暂停动画；不可把它当采集/后台总闸。main隐藏/min/quit资源门是增量，恢复仍暂停的参数保持未冻，不因OS权限granted自动开采集。
- [audio settings hold:29](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/settings/audio-device.ts:29)独立订阅；voice.stopListening不能代表释放。预录360ms实际在[composable:14](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/composables/audio/audio-device.ts:14)，VOICE-02已需该文件，不能只改settings。
- 保留[VoiceResponse interrupt](/Users/mima1234/Documents/aimy/aimy-app/packages/core-agent/src/voice/output/response.ts:342)与原静音回执，关闭/删除新增的是交付资格和依赖guard；不新建播放器。
- 最新env记录Node24.20.0，`.tool-versions`为26.7.0，root package无对应engines。不能把26说成已实测/最低版本，也不能把24局部通过当已统一。由工程固定版本并跑受影响检查，不需要用户做无关技术选型。
- [APP_USER_DATA_PATH:81](/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/main/index.ts:81)源码支持override，但本轮未启用/核实际userData。独立profile是建议启动方式；禁止读取/迁移/清空旧数据证明“干净”。未来实际启动前核有效路径与孤立数据，再运行测试。

所有测试这里只审存在/必要性，没有重跑130项或新离线实验。真实浏览器read回和SQLite进程证据仅是已有研究范围，不拿来代替新MemoryRepo实现验收。需要用户未来决定的是下一日的可感知范围/体验/模型预算；await、事务回执、消息来源/最终门与文件路径由工程落实。
