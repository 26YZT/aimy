# REVIEW-PLAN-B 正式包独立只读审查

日期：2026-10-14（Asia/Shanghai）。审查范围：02 PRD、03技术、04API、05UI、07验证、08任务全文；交互原型index.html/preview.js全文，DESIGN.md与接口目录JSON作一致性对照。未操作浏览器、未改仓库。本报告只写当前/tmp目录。

总体：正式包已正确区分收起聊天/主角色隐藏/普通失焦，纳入mic hold和全部消费者、onset/pre-roll/EOT单协调者、signal与晚到结果、主动先决定后呈现、跨扬声器不承诺恰好一次。没有发现推翻单一AIRI运行时方向的P0/P1问题。以下是交接前应修的具体P2，以及一个演示数据P3。

## P2-01 原型隐藏角色后仍能直接重开采集，缺“恢复可见”状态

- 定位：`docs/06-视觉设计/2026-10-14-Aimy增量交互稿/preview.js:4,15–16,21–23`；对照`02-产品PRD.md:66`、`04-API与事件契约.md:63`、`05-界面与交互.md:39`。
- 静态反例：点hide-stage时只是stopAll并改window-state文字；没有stageVisible/paused状态。随后mic-toggle无条件`mic=!mic`，screen-start也只检查quiet/selecting/running，600ms后能变running。界面仍显示“角色已隐藏”，但感知重新开启。
- 影响：原型正在演示隐私语义的关键负例，却把“隐藏后禁止新的采集，恢复可见后手动开启”误做成“停止一次即可直接重开”。虽然没有真实采集，不是产品安全漏洞，但不能作为该流程评审通过的示例。
- 最小建议：原型增加可见/暂停状态；hidden时禁用mic/screen start，加入明确“恢复显示（仍暂停）”演示动作。collapse不修改stage可见；恢复不自动开；然后用户可手动开。产品代码仍由真实owner控制，不复制此状态机。
- root浏览器复核负例：start mic/screen → hide → 点start应拒；restore→仍off；手动start才active。另检collapse→不撤既有授权；blur→继续。

## P2-02 VOICE-02允许区漏掉实际pre-roll历史窗所在文件

- 定位：`08-开发任务与交接.md:186–193`允许`stores/settings/audio-device.ts`；`03-技术设计.md:140`要求确认延迟+pre-roll+调度余量。
- 事实：当前`aimy-app/packages/stage-ui/src/composables/audio/audio-device.ts:14,74–75,101–105`中的`MICROPHONE_HISTORY_MS=360`创建AudioInput历史窗。`stores/settings/audio-device.ts`只持有选择/开关/订阅，不能调此历史容量。
- 影响：执行AI按照允许区无法满足“确认240ms仍有360ms真正预录”的验收，除非临时扩范围。任务给了关键验收却没给对应可写文件。
- 最小建议：在VOICE-02允许区加`packages/stage-ui/src/composables/audio/audio-device.ts`及对应局部历史窗/PCM坐标测试路径；保留“仅证实缺口才启动”。不必现在改产品代码。
- 验收负例：确认延迟240ms、要求onset前360ms；assert首样本坐标而非WAV非空。history不足不能静默裁字头。

## P2-03 configure写命令与公共CAS/幂等规则不一致

- 定位：`04-API与事件契约.md:29`声明所有写入另带mutationId/expectedRevision；但`:75 proactive.configure`没有这两项；接口目录JSON的proactive.configure(kind=write)也只有scope/enabled/quiet/cooldown/maxCalls。vision.configure会返回revision，却无expected config revision/幂等字段。
- 具体交错：设置窗A读取quiet=false；窗B先写quiet=true；窗A之后保存enabled/频次时把旧quiet=false一并写回。没有expectedPolicyRevision，合法字段校验挡不住旧UI覆盖新的安静意图。两窗口的间隔/预算配置也有相同覆盖风险。
- 最小建议：统一write/control-persist命令的CAS协议：proactive.configure增加mutationId+expectedPolicyRevision；vision.configure明确expectedConfigurationRevision和重复请求语义。或明确这些只接受局部patch且由owner按命令序列核验，但必须与§2和JSON目录一致。
- 负例：A旧revision保存→CONFLICT，编辑输入保留；quiet=true不被旧配置覆盖；相同mutationId+相同payload返回原回执，不同payload拒绝。给ENG-07/13/15补配置竞态用例。

## P2-04 UI不能查看本包拟定的调用预算和主动频次初值

- 定位：`04-API与事件契约.md:69,75`给出Vision默认20次/小时、主动冷却15分钟/12次每天；`02-产品PRD.md:46,50,64`要求频次/预算可见；原型`index.html:16–20,9–10,24`只呈现间隔、轻主动开关和“演示预算耗尽”，没有上限/已用/重置窗口或冷却说明。
- 影响：默认60秒看一眼在每帧理解时20分钟就会触预算，而原型读起来像能全天每60秒理解；也无法评审“轻主动开启后多频繁”。文档称这些是建议初值是正确的，但UI没有展现同一初值，尚不能证明需求的可理解性。
- 最小建议：在观察状态区域至少显示“自动理解最多20次/小时（建议初值）/本小时已用/剩余、达到后暂停”；轻主动行显示“至少间隔15分钟、最多12次/天（建议初值）”。若这些初值暂不进入UI，正式包明确为未决参数并别在API当默认落地。计数可调控件是否第一批提供可由主Agent定，但本次至少要能看到生效配置。
- 验证：PRD/API/UI/原型/JSON用同一单位与值；不得把0 Token/未知成本显示免费；耗尽后start不得绕过同窗口预算，恢复时间应明确。

## P2-05 预算attempt与“stale不写计数”需要分清两个账本

- 定位：`03-技术设计.md:138`失败/取消都记attempt；`04-API与事件契约.md:69`成功/失败/取消都有记录；但`:71`写stale回包不写“计数”。ENG-15覆盖取消/未知费用，未定义reserved/started/cancelled-before-start的核算边界。
- 影响：执行AI可能为避免stale污染UI而退回预算，或把尚未发出网络的排队取消也永久算一笔真实调用；跨停/重开后存在绕过调用上限或过度暂停的两种实现。
- 最小建议：明确预算owner记录`reserved → started → settled`；已发出Provider请求的started attempt取消/迟到都不退回调用上限；未发出网络的reservation取消可释放。stale回包不得改**当前epoch结果/当前观察展示计数**，但不能撤销已开始请求的低敏审计/预算消耗。小时/天窗口、重启恢复与重置时刻也应明确或标待确定。
- 负例：预算1，启动A后stop/start、A晚到，不能再借stale返还预算启动B；另例排队未开始就cancel不算已发出模型请求。

## P3-01 来源详情日期和列表示例不一致

- 定位：`preview.js:3`第三条记忆date=10月13日；`index.html:30`所有来源详情硬编码“2026年10月12日”，`preview.js:7`只更新fact/source正文。
- 建议：日期/会话标题放到每条示例结构并随detail一起更新，或把详情日期标成非逐条的说明而非来源元数据。原型用人工示例是正确的，但来源信息不应在演示里自相矛盾。

## 已确认可保留的关键设计

- 02:29/66、03:118、05:37–42明确收起聊天仍见角色、失焦不撤权、主角色hidden/min/quit停；没有继承“main close→hide即可说明聊天折叠”的旧误读。
- 03:114明确独立mic/screen epoch与全部hold/手动录音/电平/devtools/ambient；停止监听不等于释放设备。LIFE与VIS任务分步合理。
- 03:140–142和VOICE-02验收已经正确列onset/EOT分工、确认+pre-roll、单终点协调者；SmartTurn是条件实验而非必装依赖。
- 04:9正确区分跨IPC operationId与进程内AbortSignal；stop用代次幂等，不让旧stop关闭新start；远端取消/计费如实表达。
- 主动先完整决定后呈现、same event全状态去重、provider获取前上锁、uncertain不补播，以及quiet硬门都有明确方向。
- 07把源码/工程/真实模型设备/人测分层，不把本轮离线缺陷复现当产品通过；原型明确无真实模型设备。

审查建议：先修P2-01/02/03，其余P2补足配置和核算文本；再由root唯一浏览器操作者复核。无需增新框架、页面或真实调用。本报告没有做视觉好坏评分，也未声称浏览器行为实测通过。
