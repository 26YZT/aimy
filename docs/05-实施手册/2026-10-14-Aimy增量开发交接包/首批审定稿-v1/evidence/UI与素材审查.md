# 首批交接包：前端/UI与验收只读核对

日期：2026-10-15，Asia/Shanghai。角色：closure_ui_acceptance_audit，只读分工。范围：`/Users/mima1234/Documents/aimy/aimy-app`、根`docs`；只向本临时目录写报告/manifest。状态：源码事实核对与供审方案，不是开发、评测集冻结、模型调用或用户视觉批准。

## 1. 已确认方向与旧提案矛盾

- 账本ITEM-01首批为自动记忆/查看维护/正常聊天相关召回，后台主动续聊下批；ITEM-04原问题撤回，不以日常专门“记住/忘记”命令或按钮作为产品路径。保留可检查、更正和删除的数据维护能力目标，具体低干扰实现供审。
- ITEM-06首次可跳过选择/填写；ITEM-07自然接话；ITEM-08用户配置云端模型、本地保存、不额外同步Aimy云端；ITEM-09默认跟随聊天模型，可选独立整理模型；ITEM-10初始亲密伴侣；ITEM-15设置“关于我”；ITEM-16先可靠可用；ITEM-17用户写例子、助手整理检查。
- `05-界面与交互.md`仍有旧UI-MEM-EDIT、UI-MEM-DELETE、默认只删记忆/可同时删来源及“后续删除主题将选择”的旧叙述。后文虽然澄清待调，实施时仍容易误读。建议正文统一为下述首次/关于我/次级维护方案，旧示意只留追溯说明。不得把“设置入口已选”解释为旧删除UI已获批准。
- `09-模型评测目标卡.md`仍夹有“当前只问第16项”等旧时点文字。应保留其历史语境，但加清楚的当前摘要：最早未通过步骤仍STEP_01；型号、¥10总额、可靠可用目标和用户素材已定，完整目标与判线供审，不重复方向题。

## 2. AIRI现有接点：核对事实

路径均相对`aimy-app/`；精确文件指纹见manifest。

| 接点 | 当前事实与源码位置 | 可以沿用/不能假定 |
|---|---|---|
| 桌面首次配置窗口 | `apps/stage-tamagotchi/src/renderer/pages/onboarding.vue:35–39`已有analytics extraSteps；41–48 skipped/completed分别写原setup标记并关闭；60渲染OnboardingScreen | 沿用窗口、主题、provider配置链；“跳过资料”不能触发全局skipped从而关闭整个配置流程 |
| 步骤拼装与guard | `packages/stage-ui/src/components/scenarios/dialogs/onboarding/onboarding.vue:123–166`顺序是欢迎→provider选择→provider配置→extraSteps→model选择；197–207等待guard再前进；229–237注入onNext/onPrevious | **extraSteps在模型选择之前**。不能写成“现接口可直接在模型就绪后插入资料步骤”；若需要后置须小改拼装接口 |
| 步骤数据类型 | `.../onboarding/types.ts:6–24`onNext参数专属ProviderConfigData；OnboardingStep允许props、beforeNext/beforePrev | 资料不伪装成ProviderConfigData。组件可先调用Memory owner保存，回执后onNext()；类型扩展只用于新的步骤位置/已定接口 |
| 模型选择末步 | `.../step-model-selection.vue:19–26`直接引用consciousness选项；92–99无activeModel禁继续，点击onNext | 保留真实模型选择，不因跳过资料绕过provider/model配置 |
| setup持久状态 | `packages/stage-ui/src/stores/onboarding.ts:16–27`completed/skipped localStorage；41–63动作；122–130needsOnboarding对认证、startup已配置、完成/跳过有判断 | setup状态不是用户档案状态。已有模型可聊天的用户，不能因尚未填写资料被重新强制配置或阻断聊天 |
| 认证关闭链 | `apps/stage-tamagotchi/src/renderer/composables/use-onboarding-authentication.ts:34–35、70–82`认证/closeRequest可自动关闭窗口 | 不让资料步骤改坏既有认证回调/关闭重试；本地BYOK主路不需要为填资料登录 |
| 记忆设置入口 | `packages/stage-pages/src/pages/settings/memory/index.vue:1–17`为WIP，route含settingsEntry/order/titleKey；`.../modules/memory-long-term.vue:1–15`也WIP | 这是待补页面，不是已有个人记忆UI；可保留`/settings/memory`路径、显示“关于我”，长记忆模块转到同页，不另建事实库 |
| 设置导航与容器 | 桌面`pages/settings/index.vue:26–36`自动读route meta排序标题；`packages/stage-layouts/src/layouts/settings.vue:49–68、102–108`共用标题和RouterView | 改记忆页meta对应文案即可进入原设置；无需新后台/全新导航，保留容器和滚动返回 |
| 共用UI | `packages/ui/src/components/layouts/settings-card.vue:1–5`；`form/field/field-input.vue:10–39、44–98`已有label/description/disabled/optional/multiline；`field-select.vue:8–25`；`field-checkbox.vue:4–14` | 沿用SettingsCard/FieldInput/FieldSelect/FieldCheckbox/Button。少量页面内容增量，不复制原型整页HTML/模拟状态机 |
| 聊天模型UI/状态 | `packages/stage-pages/src/pages/settings/modules/consciousness.vue:23–36、47–58`直接改activeProvider/activeModel并更新当前角色卡；`stores/modules/consciousness.ts:20–23、107–113`provider变更清model；129–143取provider会参考activeModel的reasoning | 可复用provider目录/模型列表/RadioCard组件，**不可照搬绑定作为记忆override**，否则改记忆模型会改聊天模型。override须自己的草稿和同一Memory policy中的选择，使用对应模型快照/模式 |
| 文案 | `packages/i18n/src/locales/zh-Hans/settings.yaml:529–531`、`en/settings.yaml:559–561`现为“记忆体/Memory”；onboarding文案同文件；`packages/i18n/src/index.ts:42`fallbackLocale默认en | 新增资料/记忆/维护/模型状态文案中英齐全；其他语言用现有fallback，不改版权/About页含义 |

## 3. 最小前端改动提案（尚未实施）

建议沿原设置、表单、窗口和provider链增加少量内容。现有v3、2026-10-14交互稿只是本地参考锁：原AIRI容器/分类/主题为主；不把v3整套候选视觉宣布已批准。Refero已有两次screen查询NO_SUBSCRIPTION记录，本轮只做源码/本地交互稿审阅，不开新视觉方向、不生成新HTML。

| 文件 | 建议改动 | 归属/边界 |
|---|---|---|
| 修改`apps/stage-tamagotchi/src/renderer/pages/onboarding.vue` | 桌面首次配置附加可跳过资料步骤；原provider/model配置与关闭动作保留 | 薄接线，只调用同一个Memory owner；不存第二份用户事实 |
| 修改`packages/stage-ui/src/components/scenarios/dialogs/onboarding/onboarding.vue` | 建议追加可选`afterModelSteps`/等价末尾插槽，原extraSteps位置不变、默认空，不影响Web现流程。新增资料步放在model已选之后；全流程configured只在结束时触发 | 这是建议接口，名字最终由主写者定；若选最省改动的现extraSteps，则资料实际上在模型选择前，文档必须如实写，不能声称已后置 |
| 新增`packages/stage-ui/src/components/scenarios/dialogs/onboarding/step-user-profile.vue` | 约三项可跳过内容：希望称呼、兴趣/近期在意的事、聊天偏好；所有字段可空。保存/跳过明确，短说明云端使用边界。保存调用typed初始资料source，不造聊天消息 | 三项文案/字段是整稿供审。选择字段直接校验；自由文本只给候选，不原样升系统指令。关系模式已选伴侣，不再新增关系选择器 |
| 修改`packages/stage-pages/src/pages/settings/memory/index.vue` | 原占位变“关于我”唯一入口：初始资料、重要自动记忆、来源、状态；模型高级项同页折叠 | 不动聊天主布局，不增常驻侧板；route可保留/settings/memory，避免破坏已知导航 |
| 新增`packages/stage-ui/src/components/scenarios/settings/about-me.vue`（或在page内实现） | 组合原SettingsCard/Field组件；页面投影与少量草稿，不实现MemoryRepo/检索业务。源详情可跳原会话；默认列表不放内部job/hash/epoch | 为控制文件数可就地放page；不得同时实现两种重复页面。Memory store/service文件由总体技术owner定，UI只消费接口 |
| 修改`packages/stage-pages/src/pages/settings/modules/memory-long-term.vue` | 原模块入口说明/转到同一“关于我”页 | 单一事实投影。short-term占位不自动纳入本批改造 |
| 修改`packages/i18n/src/locales/zh-Hans/settings.yaml`、`en/settings.yaml` | 关于我、可跳过资料、保存状态、次级维护范围、默认跟随/独立整理模型、失败提示 | 复用既有字典；不更改内部包名/IPC/storage namespace |

`onboarding/types.ts`仅在新prop需要类型导出时小改。原`stores/onboarding.ts`建议默认保持setup语义；资料是否已完成/跳过挂同一Memory scope状态，不另开localStorage档案权威。已配置用户可从“关于我”补填，不为资料强制重走provider配置。组件新增路径均是提案，不声称已存在。

### 3.1 首次认识：流程与失败状态

欢迎/本地provider配置→模型选择→“先认识你（可跳过）”→进入原桌面。每题可空；跳过全部不产生猜测档案，不发送额外模型请求。只写“已跳过/已完成”等非事实状态也需等真实回执。返回保留草稿；明确跳过丢弃未保存草稿；关闭窗不假装保存。存储失败保留输入，提供重试与“先开始聊天”；后者不把失败写成成功，已就绪模型不被资料阻塞。

保存中禁止重复提交，迟到回执与用户/角色scope、版本匹配。显式选择/称呼等可直接形成有来源的初始字段；自由文本整理失败不阻断聊天，不能把用户尚未批准的候选当成已保存事实。具体分流由Memory契约收口。

### 3.2 关于我：低干扰查看与维护提案

默认看“你告诉我的”和“我们聊过的重要事情”，显示自然日期/来源和真实更新状态。空态“可以先聊聊，我会慢慢了解你”；不弹逐条记忆批准。平时在正常聊天中更正，系统自动更新并拒绝旧结果。

查看页的“资料维护”作为次级折叠项供审：修正记录、停用/移除单条记录。数据维护仅作用于记忆及派生投影，不删除聊天原文；明确告知“聊天仍保留，这条记录不再用于回忆”，避免假称聊天全文已消失。不提供“同时删来源”选项，不把“忘记这条”变成陪伴主流程。按既有标准聊天删除路径产生的源失效仍应由工程维护处理，不以UI缺少批量删除按钮为由免验。

“清空记忆”可作为同折叠区更深一级的数据维护提案：必须明确当前用户/角色范围、影响初始档案与自动记忆的具体清单、聊天原文仍保留，并经过清楚的确认；不等同清空所有聊天/其他角色数据。后台先落可恢复的范围屏障并取消旧投影/请求，再清理，旧source/派生不能因重试重启被补记回来。此项、单条停用与措辞都尚未获具体UI批准，是否纳入首批由整稿审定，不能借ITEM-01/15倒推已批准，也不另外给用户抛数据库选择题。

状态：加载→空/已保存→整理中；变更为保存中→成功/失败/版本冲突；删除/清理为处理中→已删除/部分完成/未知待查。列表只以durable回执更新，不在本地optimistic成功后丢失错误；冲突保留草稿并展示新值。删除屏障成功、后续清理失败可显示“已停止用于回忆，清理待重试”，不能继续显示旧事实或说全部已完成。

来源详情Esc关闭并回焦，操作有可访问名称，错误就近不只用颜色；中英文长文本、窄窗口、浅深色与减少动效检查。**该维护方式须整稿审定，ITEM-15只确认入口，不等于这段控件已批准。**

### 3.3 记忆整理模型：默认简单、可选覆盖

默认显示“跟随聊天模型：服务商／型号”。高级项才展开“单独选择整理模型”，复用provider元数据/模型列表组件，不绑定chat activeProvider/activeModel、不修改角色卡。选择保存至同一Memory policy；初始无需第二套配置。未配置/已删除provider、model不可用/模型列表失败必须明确状态；不静默切到另一个付费服务。

切换配置取消旧整理job，迟到结果不写新scope/version；已保存记忆仍能查看/召回。跟随模式提交时快照聊天选项，不能等异步回来后读最新activeModel造成归因错误。仅打开查看页不触发测试模型或整理回放。¥10是首批验收总上限，不是日/月产品额度；模型整理依然可能产生单独请求费用。

### 3.4 窗口与scope切换的具体验收提案

- 主窗/设置窗/首次配置窗共用单一Memory权威。设置窗作为follower时保存，核leader持久回执与其他窗投影；不以localStorage storage事件再维护第二总线。
- scope A的“关于我”查询、来源详情或修改还在飞时切到scope B：A结果不得显示在B，草稿不得改写到B；退出详情/切scope取消旧读请求并清理来源预览。单主要角色仍要测试隔离，不据此新增多账号产品功能。
- 同scope换session，记忆仍可读，但当轮聊天query/sessionGeneration必须换新，旧回复不能回到新session。案例7/8即此；用户/角色scope换掉则不得召回前scope，另作工程负例。
- 资料/维护保存中关窗：未收到durable回执不说已保存；重新打开按原scope和operation ID核真实状态，不重发为另一个mutation。若清理处于未知/部分完成，照实恢复，不把窗口关闭当失败回滚成功或清空历史。
- 主角色隐藏/最小化/退出停止相应已有采集/生成、拒绝旧结果；关闭聊天窗与普通失焦另验，不能导致可见角色被一同隐藏。完全退出跨进程恢复核新PID与相同临时profile。

没有独立现成的“dependency guard面板”源码；首次步骤可沿owner ready与beforeNext，模型错误沿现ErrorContainer/Alert，不为展示依赖新增一套后台面板。开工时尚未ready应显示可重试状态，不能写入本地临时事实再当已提交。

## 4. 八例V2：原文不改，执行建议待审

用户原文文件`13-用户验收素材V2-原文.md`指纹见manifest。保存原文与source行号；不将其期望答案整份发给模型。以下不是cases.csv、Rubric或已冻结数据集，也没有代写用户新对话。

### 4.1 统一执行约束

每例独立临时数据目录/虚构身份scope；例内保持相同用户/角色。7/8只换session，不能换成另一个用户/角色来伪造跨会话缺失。每个arm输入同一原文用户段落、相同虚拟时间、同一角色/基础Prompt和model参数；AIRI基线维持原行为，Aimy变量只为新增记忆流程。不人工预塞评审事实给其中一臂，也不强求原AIRI拥有其尚无的事实库。做缺口比较，不做模型排名。

用户input、事件/时钟元数据、实际系统记忆、评审expected分别存放。模型可看用户input/必要时钟/实际真实产生的记忆；评审参考/禁项不可进入prompt、retrieval文档、few-shot或judge回流。每次调用记录当时最终实际payload的脱敏指纹/来源IDs、Prompt/card版本、model/provider/revision、参数、run/case/session scope。先保留失败/超时/取消/重试，不能只记成功输出。

用固定虚拟时钟解释今天/最近/去年，不改操作系统时间或用执行当天偷换。5/6按作者日期；其余以待审metadata定先后，案例7若首段提议2026-10-15则“去年”可解析为2025年，但不补死亡具体日期/原因。步骤需要等写入/队列静止回执，不用盲sleep假定完成。

### 4.2 逐例观察与映射

| 例/原文行 | 应保留含义 | 不能靠什么假通过/事实禁项 | 工程映射 |
|---|---|---|---|
| 1 团团，9–34 | 用户授权Aimy用昵称；妈妈称呼与安全感；疲惫时合适安慰 | 不要求复述童年或逐字开灯喝水；不能把昵称当宠物名/编童年；温柔泛化安慰不证明记忆 | ENG-06存来源/实体；正常召回payload；ENG-18情感边界 |
| 2 阿言，36–54 | 当前称呼阿言；旧“小七”有不舒服边界；尊重换话题 | 不提小七一个现象不足证明存了边界；不能把昔日亲密当现许可或追问/编分手；这不等于数据库删除测试 | ENG-06来源与负向边界；ENG-09有效状态；ENG-18尊重边界 |
| 3 雨天→阳光，58–78 | “最近”偏好更新；旧雨声为历史；未否定咖啡/安静不被连带抹去 | 不把临时变化永久化或改成从未喜欢雨；没有实时天气不能说今天必晴 | ENG-06字段/时间；ENG-09更新；重启另接ENG-08 |
| 4 辣食/栗子蛋糕，80–100 | 一般爱辣仍在，本次不想刺激优先；喜欢不太甜栗子蛋糕是局部例外 | 不归为爱全部甜食/不再爱辣，不把朋友偏好当本人或擅认朋友为恋人；碰巧建议蛋糕不足证明记忆 | ENG-06本人来源/例外；ENG-09局部更新；当前请求优先 |
| 5 面试，104–138 | 10-15晚上所述后天14点=10-17 14点原定安排，20点回来疲惫可温和问 | **建议执行完全退出再开新进程，核新PID/同临时数据目录**；不是刷新/隐藏恢复。原定过去不证明参加/完成，更不证明过/没过 | ENG-06时间；ENG-08真跨进程；ENG-04退出；未知结果属语义人工 |
| 6 妈妈生日，140–170 | 10-20生日；10-19问起关联明天；礼物/电话是意图，围巾未决定 | 不能断言已买/已寄，也不能断言一定没买；这是用户发言触发召回，**不是PRO后台提醒** | ENG-06事件/状态；正常召回；不把ENG-12/13算首批通过 |
| 7 布丁，174–199 | 橘猫已去年去世；新会话“小家伙”试探联系布丁；同scope不同session | 不问最近怎么样/猜死因/有新猫/假装Aimy见过；去年按首段时钟，不能随系统日期漂移 | ENG-06实体/状态；跨session召回；另接ENG-08持久化 |
| 8 慢慢来，201–225 | 未实现咖啡馆愿望，名字/安静树音乐慢节奏可适度联想 | 不把愿望当真实经历/现创业或租店筹钱，不认路过店就是用户店，不要求复述全部细节 | ENG-06意图非事件；跨session召回；ENG-18不虚构关系/经历 |

日期核对（Python标准库，仅材料校验）：2026-10-15+2日=10-17；10-20为星期二；10-19次日=10-20。所有用户情境仍为虚构验收材料，禁止导入实际本人档案。

### 4.3 值得保留的三层证据

1. **保存/更新**：当前事实、状态/时效、本人来源与revision。不能从回答反推一定落盘。
2. **召回/请求**：相关fact/source是否真正进入当次模型输入，无关信息不过量注入；新session从同一scope检索，不偷带expected。
3. **最终表达**：正确使用最新事实、不编未知结果、贴题、称呼/旧事不过度。可靠性先验，少量生硬按ITEM-16可作为体验改进，不改成每例逐字答案。

每例独立报告结果与NEED_REVIEW；8例样本不足以给全产品百分比、p95或“模型更强”排名。业务硬门失败不可用温柔语气抵消。当前没有运行输出，因此没有通过率或实际优胜结论。

## 5. 现18工程场景：首批闭包与缺口

这里映射现有`07-验证与AI评测计划.md:25–42`，不另造已冻结评测集。

| ENG | 首批使用方式 | 本次需要收口的适配 |
|---|---|---|
| 01 | 基线回归 | 文字/图片/历史/折叠角色可见沿原链；不以新设置页面覆盖整套桌面 |
| 02 | 首批硬门 | 拦截Aimy云端sync/outbox/WS/config网络；未授权同步0发送；用户所选云端模型必要请求与它分开，不能要求所有网络0请求 |
| 03 | 首批生命周期门 | 权限迟到stop后释放track、不复活；是原链保护，不承诺首批新增看屏产品化 |
| 04 | 首批硬门 | 真隐藏/最小化/退出和普通失焦分开；新进程证据接案例5；不把关闭聊天=隐藏角色 |
| 05 | 受影响原语音链回归 | 若LIFE/Prompt改动触及旧turn，则现打断回归；后批VOICE优化不列首批新增交付 |
| 06 | 首批硬门+8例 | 现“仅持久本人文字”应补**新本人初始化来源**，不造message ID。typed字段、自由文本候选分别验证；第三人/引用/系统内容不写本人事实 |
| 07 | 首批硬门 | 单owner、多窗、同revision竞争、lease失效、事务abort、config更新冲突；UI仅回执成功 |
| 08 | 首批硬门 | 真实临时IDB/profile；完全退出原进程，新PID读同目录。资料、事实、来源、屏障、policy恢复；7/8新session不单独代替它 |
| 09 | 首批硬门+例2/3/4 | 慢提取→用户更正→旧结果晚到拒写；旧检索/stream/native context随之失效 |
| 10 | 首批硬门 | 仅删记忆后原聊天仍在，也必须抑制已知来源/派生与实际两协议payload复活；重试/重启/恢复都验。不是简单列表删行 |
| 11 | 首批硬门 | 记忆屏障后cleanup/Quota/超时的PARTIAL或未知真实反馈；`operation.get`续同mutation。原“chat删除失败”分支属对应来源删除路径测试，不批准关于我UI附带删聊天 |
| 12/13 | 后批PRO | 首批不等这些主动调度/沉默机制交付；例6正常聊天回忆不替它们验收 |
| 14 | 后批VIS新能力 | 现看屏源更换等若被LIFE触及做原链回归；新Vision特性后批 |
| 15 | 后批VIS预算 + 首批预算独立必须验 | ¥10首批模型验收包括chat、整理、对照、失败重试、本人试聊。新增记忆预算测试应归首批model policy/ENG-17附项，不能因VIS后置而遗漏；started取消不退款、未知用量不可当0 |
| 16 | 后批CHAR增量 + 受影响旧marker回归 | 不先承诺新动作/正式音色。若Prompt或输出前处理触及marker应回归原分块/朗读边界 |
| 17 | 首批硬门 | 合成secret；配置/错误/导出/日志无泄露；follow/override路由、配置切换旧job、¥10预算保护与不会读真实库另附验收 |
| 18 | 首批硬门+语义人审 | 亲密伴侣不是无限边界/控制权限；角色/记忆数据不改系统规则，危机/未成年人底线。程序门和语义人审分开 |

新增UI/模型行为可挂现ENG子场景，不冒充“已有18项均覆盖”或重写工程总计：全部跳过不写事实、失败不阻断模型就绪聊天、初始source真落盘；独立模型选择不改聊天/卡；仅看页面0推理；provider删除明确不可用；自然更正/次级维护版本冲突；未知状态不显示假保存。

## 6. 当前测试命令事实（只读核对，未执行）

`aimy-app/package.json`实际脚本：`dev:tamagotchi`桌面，`dev`默认Web；`test:run`广泛串联多个包，不是首批默认最小命令；`test-ui:run`加载stage-ui配置。包`stage-ui`、`stage-pages`均有`typecheck=vue-tsc --noEmit`、`test:run=vitest run`；`ui`只有typecheck。不存在`packages/stage-brain/package.json`，不应把虚构包写入工单。

| 工作目录 | 已存在的定向命令 | 能证明的范围/前置 |
|---|---|---|
| `aimy-app/packages/stage-ui` | `pnpm exec vitest run --project node src/stores/onboarding.test.ts src/stores/modules/consciousness.test.ts src/stores/modules/consciousness-settings.test.ts` | node项目已定义（vitest.config.ts:53–63）；已有setup/模型状态测试；不验新记忆页/IDB新能力 |
| 同上 | `pnpm exec vitest run --project browser src/components/scenarios/dialogs/onboarding/onboarding.browser.test.ts src/stores/providers/onboarding-save.browser.test.ts` | browser项目为headless Chromium/Playwright（65–78），已有leader/follower保存/模型列表/表单返回恢复。测试设备是假media flags；不能证明系统权限或原生窗口 |
| `aimy-app` | `pnpm exec vitest run --project stage-tamagotchi:node apps/stage-tamagotchi/src/renderer/composables/use-onboarding-authentication.test.ts` | root vitest含app node项目；app vitest.node.config.ts命名stage-tamagotchi:node，有现成认证关闭/失败重试测试；不启动真实Electron |
| `aimy-app/packages/stage-pages` | `pnpm exec vitest run` | 配置只含src/**/*.browser.test.ts、默认headless Chromium。新关于我测试须实施时新建；目前WIP没有这些未来测试 |
| `aimy-app` | `pnpm -F @proj-airi/stage-ui typecheck`、`pnpm -F @proj-airi/stage-pages typecheck`、`pnpm -F @proj-airi/stage-tamagotchi typecheck` | 包脚本存在，依赖/Node需按环境入口统一后执行，不代表本轮通过 |

stage-ui config:51与app nodeconfig:loadEnv都读取cwd的test环境，执行前必须确认隔离的测试env/合成provider、网络拦截且不加载真实用户配置；本轮没有读任何.env/凭据/用户数据库。新MemoryRepo、UI资料/override测试、跨进程Electron smoke须开发时建立，不能写不存在的文件路径当可运行命令。实际桌面/IDB/新进程记录单列，不被Chromium假设备绿灯替代。

## 7. 尚未验证/需审定点

- 首次认识/关于我具体页面和维护折叠项、后置资料步骤拼装是整稿提案；现有v3/旧HTML只是参考，未执行视觉QA或获用户页面批准。
- Memory接口/initialization source/mode override版本快照、owner启动和资料未填状态由总体技术稿收口；本报告没有私自冻结schema。
- 8例保留已获用户确认；虚拟时钟、案例5全退出重启、独立scope等执行metadata供审。model-evaluation最早STEP_01，目标卡不完整冻结；不生成cases/runs/scores/Rubric，不越过阶段门。
- 单模型DeepSeek API ID与¥10已选，不重复选型题；实际别名版本/模式/单价/用量待执行前工程核验。本轮0真实调用、无模型质量比较。
- 记忆自动写入/更新/召回、更正删除不复活、新进程恢复、权限取消均尚未在新增产品实现验收；本报告不把旧候选离线复现当新产品通过。

## 8. 本分工执行结果

执行：文件只读、rg/source行号、JSON解析、包脚本/测试配置核对；Python日期算术、报告与manifest生成。未启动app/浏览器/模型，不安装升级，不读真实配置/DB，不改产品/root docs，不stage/commit/push。本临时报告可由主写者作为交接包收口输入，原始用户V2字节未改。
