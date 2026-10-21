# DELTA-RY：只保留真正的AIRI增量候选

日期：2026-10-14（Asia/Shanghai）。状态：只读重筛与安全离线执行证据；未改产品代码。用户口径：仅复用AIRI缺少或有证据更强的能力；Chromatic排除。不是沿用上一版“本期适配”名单，也不把设计稿、缺陷复现和通用工程方法列为新增功能。

## 1. 结论

本轮RY01–RY13重筛为：**新增3、待AB2、已有3、工程参考1、不适用4，窄更强0**。新增3项都属于一个“记忆能力”领域里的窄功能差异，不是三个新runtime；没有任何Ryza整模块被判定可直接复制。

- **RY03**：会话卡分层、dated事实条目与重要条目保留。AIRI当前对应UI/包仍占位；已执行层级滚动、保留与关闭自动摄取正例。
- **RY04**：只保留关键词/ISO日期打分、active过滤、最多12条canonical记录选择。**撤回“完整原条目预算已实现”**：原normalizer会截120字，归纳JSON会硬截12000字并变非法。整条预算要由Aimy另写，不能记为Ryza优势。
- **RY08**：只保留已存会话卡查看/编辑/删除的交互与命令形状。**不等于事实自动纠正或可靠遗忘**；原mutation会在Quota失败仍返回true，旧归纳还能复活删除条目。存储压力提示另归工程参考。

RY05动作节奏和RY06回声均先待AB；RY07人设/TTS分开是AIRI已有，实际provider函数执行已核实，不再作为新增。

## 2. 逐ID资格

| ID | 原能力（必要时窄化） | eligibility | 是否保留本期增量候选 | 理由/后续 | 关键证据 |
|---|---|---|---|---|---|
| RY01 | 桌面窗口与显示集成 | 已有 | 否 | AIRI已有透明角色、多窗/穿透/位置；这是基线，不计外部新增功能。 移出复用候选，保留AIRI基线检查 | [main.js:150](/Users/mima1234/Documents/资料/拆解项目/ryza-ai-revive-master/desktop/main.js:150), [index.ts:82](/Users/mima1234/Documents/aimy/aimy-app/apps/stage-tamagotchi/src/main/windows/main/index.ts:82) |
| RY02 | Provider、流式音频和取消 | 已有 | 否 | AIRI已有更完整的stream/signal/TurnRef/PlaybackGroup；Ryza整句返回与取消缺陷不是增量。 移出复用候选，原缺陷只留回归输入 | [turn.js:23](/Users/mima1234/Documents/资料/拆解项目/ryza-ai-revive-master/web/js/turn.js:23), [response.ts:94](/Users/mima1234/Documents/aimy/aimy-app/packages/core-agent/src/voice/output/response.ts:94) |
| RY03 | 会话卡/事实层与重要条目保留 | 新增 | 是，待安全适配 | AIRI当前长期记忆UI与包仍占位；Ryza实际有卡片滚层、dated entries与protected retention。仅证明机制差异，不证明事实准确/可靠生命周期。 保留为新增记忆子能力的策略/纯规则适配；不搬consolidate/store | [memory.js:187](/Users/mima1234/Documents/资料/拆解项目/ryza-ai-revive-master/web/js/memory.js:187), [longterm.js:135](/Users/mima1234/Documents/资料/拆解项目/ryza-ai-revive-master/web/js/longterm.js:135) |
| RY04 | 关键词/ISO日期排序及active条目选择 | 新增 | 是，待安全适配 | 实际_score/_select/active过滤与最多12条canonical输出可执行；完整原条目预算未实现，撤回原能力合并说法。 只保留可解释词法选择叶子；Aimy另做整条预算/输入校验，不把自研修复算Ryza优势 | [longterm.js:143](/Users/mima1234/Documents/资料/拆解项目/ryza-ai-revive-master/web/js/longterm.js:143), [longterm.js:157](/Users/mima1234/Documents/资料/拆解项目/ryza-ai-revive-master/web/js/longterm.js:157) |
| RY05 | 表现节奏、去重与动作让位 | 待AB | 否 | Ryza有两套间隔/去重，但AIRI已Motion Magic、exclusiveOwner/pose release/暂停；不同角色骨骼和参数下未证同条件更自然。 从本期适配降条件AB；通过同资产同音频对照再纳入 | [avatar.js:138](/Users/mima1234/Documents/资料/拆解项目/ryza-ai-revive-master/web/js/avatar.js:138), [Stage.vue:93](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/components/scenes/Stage.vue:93) |
| RY06 | 文本回声过滤 | 待AB | 否 | 已有算法函数并不证明当前AIRI AEC不足或误拦可接受；需要扬声器/短句/多语言真实对照。 保留实验候选，当前不计新增采用；不复用采集器 | [echo.js:110](/Users/mima1234/Documents/资料/拆解项目/ryza-ai-revive-master/web/js/echo.js:110), [voice.ts:417](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/voice.ts:417) |
| RY07 | 人设语气与TTS风格分开 | 已有 | 否 | AIRI已有角色卡/独立speech配置；实际MiMo provider已把stylePrompt和朗读input分开，AIRIC02/03执行核实。Ryza模式是否更好未试听。 从本期适配移到已有配置/产品调参；不新增ASMR模式 | [index.ts:56](/Users/mima1234/Documents/aimy/aimy-app/packages/provider-inference/src/providers/cloud/mimo-audio/index.ts:56), [Stage.vue:410](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/components/scenes/Stage.vue:410) |
| RY08 | 已存会话卡的查看/编辑/删除 | 新增 | 是，待安全适配 | AIRI记忆管理页仍WIP；Memory.get/update/remove确有动作；但不是可靠事实纠正/彻底遗忘，压力提示是工程反馈。 窄化为卡片管理交互/命令形状；可靠事实更正/屏障/回执由Aimy自管。存储压力拆工程参考 | [memory.js:300](/Users/mima1234/Documents/资料/拆解项目/ryza-ai-revive-master/web/js/memory.js:300), [app.js:2422](/Users/mima1234/Documents/资料/拆解项目/ryza-ai-revive-master/web/js/app.js:2422) |
| RY09 | 回听与收藏 | 不适用 | 否 | 当前用户范围没有选择回听收藏需求；不能因候选存在就新增实体/功能。 不进入当前增量清单 | [voicecache.js:101](/Users/mima1234/Documents/资料/拆解项目/ryza-ai-revive-master/web/js/voicecache.js:101) |
| RY10 | RPG世界/经济/NPC/签到 | 不适用 | 否 | 确为Ryza有的领域玩法，但偏离当前现实桌面单角色陪伴；确定性状态原则不是外部新增功能。 当前排除；不用工程原则冒充玩法复用 | [game.js:352](/Users/mima1234/Documents/资料/拆解项目/ryza-ai-revive-master/web/js/game.js:352), [npc.js:101](/Users/mima1234/Documents/资料/拆解项目/ryza-ai-revive-master/web/js/npc.js:101) |
| RY11 | Android/跨端壳与原生闹钟 | 不适用 | 否 | macOS一期无直接需要；共用代码不是跨设备同步；删除native合同缺陷不能反向算增强。 当前排除 | [RyzaAlarm.java:186](/Users/mima1234/Documents/资料/拆解项目/ryza-ai-revive-master/android/app/src/main/java/com/ryza/chat/RyzaAlarm.java:186) |
| RY12 | ZIP/明文镜像/eraser与工程负例 | 工程参考 | 否 | ZIP读长、明文镜像、清除不全为失败证据；hash/guard/test等通用工程方法不算新增用户功能。 实现不引入；只保留回归输入 | [crfstore.js:97](/Users/mima1234/Documents/资料/拆解项目/ryza-ai-revive-master/web/js/crfstore.js:97), [web-storage.js:72](/Users/mima1234/Documents/资料/拆解项目/ryza-ai-revive-master/desktop/web-storage.js:72) |
| RY13 | 计划中的vision/proactive/语义端点 | 不适用 | 否 | planned=true且文件未创建，不能执行不存在模块或称现成增强；AIRI已有vision/spark主链。 排除现成复用判断；方案仅历史参考 | [layers.json:78](/Users/mima1234/Documents/资料/拆解项目/ryza-ai-revive-master/config/layers.json:78), [orchestrator.ts:61](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/modules/vision/orchestrator.ts:61) |

## 3. 实际执行的方法与输入输出

Ryza：真实当前`web/js/memory.js`与`longterm.js`完整IIFE在VM中加载，假localStorage、固定时钟/随机种子，模型端口只用合成字符串/惰性promise；无网络/模型/设备。共**8正向+9负向**，全部断言得到记录中的预期行为。负例复现不叫功能通过。

AIRI：实际notebook完整源码及MiMo provider的完整函数用Node24内置stripTypeScriptTypes擦除类型，在VM注入假的Vue/Pinia/fetch。共3项；不执行AIRI模块bootstrap、UI或真实provider。

### 正向8项

| case | 实际函数 | 主要输入 | 实际输出与断言 | 证明范围 |
|---|---|---|---|---|
| DRY-P01 | Memory.ingest→flushPending→promoteSessions | 4对合成会话；2轮/卡，2卡升级 | pending0、sessions0、summaries1、n2 | 分层协调有效；summarizer是假文本，不测摘要质量 |
| DRY-P02 | LongTerm.add→isProtected/enforceLimit | 2保护条目+60普通条目 | 条目40，两个保护条目都在；digest非空 | 只证明存储保留规则 |
| DRY-P03 | LongTerm.add/load/normEntry | 日期、分类、关键词后fresh VM同假存储 | 元数据/正文一致 | 不是真实新进程/磁盘验收 |
| DRY-P04 | Memory.ingest/promptBlock | enabled=false | pending0、prompt空 | 自动摄取关闭门 |
| DRY-P05 | LongTerm._score/_select | cue=2026-10-14 灯塔；target importance1，对手3 | target score8且被选 | ISO日期与词法命中可解释，非语义召回 |
| DRY-P06 | LongTerm.restore/_select/promptBlock | retired importance5 vs active1 | 只选active，旧文不进prompt | 状态过滤有效，自动纠正本身未实现 |
| DRY-P07 | LongTerm._select/promptBlock | 15条短canonical记录，limit12 | 12条、每条已存完整字符串都在 | 不是原输入/总Token预算的完整性证明 |
| DRY-P08 | Memory.add/get/update/remove/load | 凉茶→乌龙茶→删除 | 当前/同假存储fresh VM均无该卡 | 会话卡管理，不等于可靠事实忘记 |

### 负向9项

| case | 输入/交错 | 当前实际结果 | 对采用的限制 |
|---|---|---|---|
| DRY-N01 | 归纳发旧事实后追加新事实 | 请求只含旧，pending却全清 | 不搬consolidate；Aimy需冻结批次/原子确认 |
| DRY-N02 | 43条promise | 存43超过nominal40，单prompt仍只选12 | “保护”不是有界容量或保证每次召回 |
| DRY-N03 | 160字末尾含取消的新事实 | 存120字、取消信息丢失 | 拒用原normalizer，不声称完整条目预算 |
| DRY-N04 | 70条长保护事实归纳 | 请求恰12000字符且不是合法JSON | 先整条打包再serialize，禁止切JSON |
| DRY-N05 | 海边事实 vs query“海岸” | 更重要的无关咖啡被选 | 只有词法基线，不能说中文语义更强 |
| DRY-N06 | 同日偏好改述、前缀不同 | 新旧两条active | 文本前缀去重不是可靠纠正 |
| DRY-N07 | storage拒写时update卡 | 返回true，lastWriteOk=false，内存新/盘旧 | mutation必须有durable receipt，不能照搬成功值 |
| DRY-N08 | remove事实后旧归纳回包 | 已删除正文被重加 | 需Aimy版本/屏障/lineage，Ryza未实现可靠遗忘 |
| DRY-N09 | 时钟10/14，query“昨天”，10/01重要旧事 vs10/13新事 | 仍选10/01；recent cue为每条统一加1 | 只保留ISO日期字面命中，不宣称自然语言时间检索 |

完整输入/输出、断言与scope见`positive-negative-results.json`；脚本可重跑。没有在本轮写一个“修好的Ryza实现”再把它冒充来源通过。

## 4. 同类AIRI实际对照

1. `settings/memory/index.vue`、`memory-short-term.vue`、`memory-long-term.vue`全文仍是WIP；`memory-pgvector/src/index.ts`仍空module:configure。没有名为stage-ui/stores/memory的已实现事实服务。它的聊天持久化/编辑删除不是分层事实记忆，不能拿聊天存储替代此领域缺口。
2. **AIRI-C01实际执行**：邻近的CharacterNotebookStore.addNote能建立人工note；fresh VM实例空，无fact selector/promptBlock。说明它是另一个内存notebook，不是承诺的长期事实引擎；不能把此测试当“AIRI聊天持久化失败”。这支持RY03/04/08的领域差异，但不证明Ryza已满足Aimy可靠性要求。
3. **AIRI-C02实际执行**：MiMo createMimoSpeechProvider把style=“平静、清晰地说”和朗读input=“今天一起玩游戏。”分别序列化为两条消息，voice独立；假响应返回2字节synthetic audio。**AIRI-C03**：voice-design无style在fake fetch之前拒绝。人设/TTS风格分离并非Ryza新能力，RY07移已有。未测声音质量。
4. RY05对照实际Stage.vue:93–99/103–107的MotionMagic/exclusiveOwner/release/paused、profiles.ts:31的idle/speaking数据。已有角色动作权威不缺；Ryza特定骨骼的1.8–3.8s/3.8–7.4s、去重与让位是否更自然，必须同正式资产/同音频/同动作集AB。目前不打“更强”标签。

## 5. 三个保留点的工程化边界

- RY03只提炼卡片层级策略、isProtected等规则；自动事实提取的语义准确度未测。保存、纠正、删除、取消、来源版本、事务全部交Aimy现有规划的唯一MemoryRepo/Service。与AionsHome等候选合并成一个记忆owner，不引入Ryza全局store/localStorage键。
- RY04可适配`score/select(active)`作为基线，但须明确完整输入记录验证、limit合法范围、分区、稳定排序、最低相关门与总预算；无匹配时_select仍按importance返回，并非可自动判无关的完整检索器。整条预算不是来源现成函数；不得把Aimy新写的安全包装计为“Ryza已经更强”。
- RY08只借卡片管理交互/命令需求；正式UI基于AIRI组件、等待durable receipt、CONFLICT保留编辑、删除屏障防旧来源/归纳复活。原update/remove成功值与eraser不能照抄。
- 动作/回声AB无优势或收益不足即不纳入；不因研究过就必须接入。自用也不改变正确性和用户授权要求。

## 6. 来源/版本/只读核验

Ryza固定快照1.2.23/code26，无.git所以commit未知。1764个文件最终对原审查SHA逐项复核未变；树fingerprint `ee93d14443ec2e0f64966ea80d67fe80e2b4b24dbb97f778594a9f1503793cf6`（Python Path组件排序算法见scope-manifest）。

实际执行文件：

- memory.js SHA256 `11fbb6fae5def1214cf939d275d001460fe6da02dcfd08165c56c286932c5611`
- longterm.js SHA256 `abcd214c2e21121fe9fccbc5aff3bac5f795529b6f50214b47af0e6a2293dd7b`

AIRI对照只用当前aimy-app，HEAD与逐文件原hash在`scope-manifest.json`。无源码写入、安装、服务启动、真实凭据读取、真实模型/设备；Chromatic不进入此增量清单。

## 7. 交接文件

- eligibility.json：13个ID逐项资格、保留与否、实际正/负case与绝对路径行号。
- positive-negative.cjs / positive-negative-results.json：Ryza 17项可重跑实际函数执行。
- airi-counterparts.cjs / airi-counterpart-results.json：AIRI 3项邻近对照与WIP/hash证据。
- scope-manifest.json：scope原hash、版本、固定树核验与排除项。

命令：`node /tmp/aimy-20261014-delta-ryza/positive-negative.cjs`，`node /tmp/aimy-20261014-delta-ryza/airi-counterparts.cjs`。结果是“20项断言得到明确行为”，不是“20项产品功能验收通过”。
