# 首批审定稿 v1：独立 UI / 验收复核

日期：2026-10-15，Asia/Shanghai。范围：`docs/05-实施手册/2026-10-14-Aimy增量开发交接包/首批审定稿-v1/` 全部现有正文、Prompt和机器目录，含审查附件。状态：只读审稿；主写者正在生成核验记录。本分工只写此临时报告，不改正式docs/产品，不运行git status、应用、模型或产品测试。

## 结论

主体已经符合“基于AIRI、复用优先、审定后开工”：首批范围和17项选择没有被重问，ITEM-04撤回被正确保留；首次资料、单一关于我页面、模型覆盖、8例和工程门都已具体化。复核期间提出5项窄修订，**最终定向复核已确认5项全部闭合；当前本分工未发现关键未闭合项，可以交用户审定。** 以下保留修订前发现与最小修法作为追溯；最终状态见末节。这不代表用户已经批准、产品已实施或模型评测通过。

## 初审发现的三项窄缺口（最终已闭合，保留追溯）

### UIR-03｜P1：真正重启测试仍会被普通 node 回归自动收集

位置：`文件边界.json:1198`拟新增`apps/stage-tamagotchi/scripts/acceptance/memory-restart.test.ts`；同文件purpose说与普通mock测试分开。现产品`apps/stage-tamagotchi/vitest.node.config.ts:15`却包含`['src/**/*.test.ts','scripts/**/*.test.ts']`，根Vitest又注册此node项目。

因此按该未来命名，普通`vitest run`就会收集需要真实Electron/新进程的测试，未配置时可能使用默认profile或依赖未构建应用。文字说“分开”不能控制收集。

最小修复二选一，由工程决定，不再问用户：

- 改为`memory-restart.electron-smoke.ts`并给独立tsx运行命令；脚本强制显式独立临时profile、已构建app入口、合成数据，否则拒执行。文件边界/追溯矩阵同步改名。
- 或保留`.test.ts`，在契约明确默认跳过、只有显式smoke开关和隔离profile guard同时满足才运行；缺前置不能悄悄用默认userData。单独命令与skip原因必须记录。

验收不是多写一个镜像实现测试：普通node回归不启动Electron；独立smoke才实际全退出、新PID读同临时目录，退出失败不能强杀后算正常退出通过。

### UIR-04｜P2：新增 afterModelSteps 的完整流程断言尚不明确

位置：`02-首批PRD与交互规格.md:22`明确新增afterModelSteps；`06-验收与评测目标.md:41`ENG-X08目前只泛列首次资料/组件/截图。文件边界包含新`step-user-profile.browser.test.ts`，但没有原`onboarding.browser.test.ts`允许区，也没有明确新测试挂完整OnboardingScreen而不是仅子组件。

不是认定未来一定漏测，而是当前手册未把已发现的重要顺序差异落实到必验断言。最小修复：ENG-X08点名完整流程——原extraSteps仍在model前；选好model后才到profile；跳过profile不发全局skipped；afterModelSteps为空时原流程不变；保存失败/owner未ready可以先开始聊天且不假保存。可以让新测试mount完整Screen，或把既有onboarding.browser.test.ts加入允许区，不必两个都改。

### UIR-05｜P2：关闭自动整理的 UI 入口未和 setPolicy 对齐

位置：`02-首批PRD与交互规格.md`定义关闭/重开自动整理；03说明关闭撤任务且保留已存事实；18API有`memory.setPolicy`。但“关于我”的具体规格未说明用户在哪里关闭。

最小修复：同页增加“自动整理新聊天”的总开关与真实状态，附说明关闭后不补暂停期，已有记忆仍保留/可相关召回，单条停止使用另走维护；保存失败/冲突显示实际值。它不是逐条记忆批准，不扩大ITEM-04为日常记住/忘记流程。若首批不提供开关UI，则要明确setPolicy仅内部启用、关闭入口后置；不能让交互/API各说各话。

## 已在复核期间处理的项

### UIR-01｜原P1：维护影响范围缺少 host 预览输出，已修正

原稿R3承诺展示同源派生影响，memory.remove需confirmedAffectedIds，却没有host给UI的影响集合同。现`04:45–47`及机器目录已扩既有memory.source（没有加第19操作）：maintenancePreview含affectedCurrentFactIds/derivedKinds/scopeExplanation/snapshotRevision/impactDigest；remove带previewRevision/digest、事务复算影响集，变化则冲突要求重看。现在UI不需要自己猜血缘，符合低干扰维护的知情范围。

### UIR-02｜原P2：统一 mutation 封套误套资源停止，已修正

原稿“mutating操作都要Memory expectedRevision”与资源接口不符。现04拆MemoryCommand/InternalJobCommand/AppCommand；UI Memory写有mutationId/expectedRevision，内部job用捕获版本/lease，资源停止不因记忆revision冲突被阻。Receipt也明确只为Memory持久回执，资源回执另给epoch/停止明细。机器目录有相应preconditions；未发现仍强套记忆revision到停止操作。

## 已核一致的重点

| 审查点 | 结论 |
|---|---|
| ITEM-04撤回 | 默认查看/来源，日常自然更正，次级修正/停止使用作为本次整稿待审；不做聊天侧板/日常forget输入，不加附带删除聊天/整库清空 |
| 新资料步骤 | 承认原extraSteps实际在model前，拟新增afterModelSteps默认空；owner ready，无session可存；结构化与待整理分开，未填/失败不挡聊天 |
| 单一owner | 原AIRI renderer leader/存储/Provider沿用；profile与about同库；没有新Python后端/向量库/第二身份体系 |
| 模型覆盖 | 默认跟随，可单独指定；不绑定chat activeProvider/activeModel，不改角色卡；不可用保留来源暂停、不隐式付费fallback |
| 窗口/scope | ENG-X06跨scope旧回执不污染；同scope新session保持记忆；保存超时/关窗按同operation恢复；hide/min/quit与失焦/关聊天分开 |
| 八例输入边界 | 原文不改，user段落/虚拟时钟/系统实际记忆才能进入被测输入；expected/禁项/评分留评审侧，不进retrieval/few-shot；Prompt未含昵称等具体答案 |
| 八例语义 | 临时偏好不永久化；栗子蛋糕局部例外；未知面试结果；围巾未决定；布丁去世/去年按source clock；梦想未发生均保留 |
| 时间与进程 | 5/6作者日期保留，其他日期为待审metadata；7/8同scope换session；案例5建议全退出新PID，ENG-08明确真新进程，不把刷新/隐藏当重启 |
| 单模型比较 | 同model/基础角色/输入/时钟/工具/预算，Aimy只增加记忆链与任务Prompt；不手塞expected增强基线，不声称模型排名 |
| 费用 | ¥10一次campaign，两臂/8profile/整理/重试/本人试聊共用，unknown预留不当0，重启不重置；本轮0调用 |
| 评测阶段 | 最早STEP_01，完整目标卡待审，不把保留八例解释成cases/Rubric/评分已冻结；语义和自然度未验证 |

八例已经用于产品/Prompt设计，应当视为已知验收回归素材；当前稿没有据此声称盲测或统计泛化，因此不构成泄题问题。继续保留这一结论强度边界即可，不需擅自增加用户新故事。

## 初审机器核对结果（修订前快照）

只读Python/JSON/哈希/源路径检查，不运行产品测试：

- 现10份JSON均可解析；18操作唯一、全model_callable=false。
- 文件边界106个路径唯一，56现有/50拟新增；现有文件SHA与存在性、拟新增不存在性一致。
- 10需求、9任务的文件/API引用均有对应声明；API工程ID全部在06出现。
- 3个新Prompt字节SHA一致；原用户V2 SHA为`37fa26c0f5ea08e4fb6b3c6b9691640c805231af31562f9cf0b036cb7c9e6bdc`，与06一致，8例完整。
- evidence/UI与素材审查.md与原临时报告字节一致；evidence/README.md正确说明附件是历史审查快照、整合新稿为准，没有将附件中的可选替代方案强行升级为已批准范围。
- 既有9条测试预检只是文件/配置存在，未写成运行通过；本分工没有改Git索引或运行git status。

主写者的交付核验记录正在生成，不把暂缺文件报为内容缺陷。UI交互规范可供用户审定，但没有渲染/视觉QA、工程验收或模型效果通过结论。

## 最终5点定向复核：全部闭合

在主写者通知修正后，只重新读02/04/06及对应JSON，没有泛查或执行新测试：

| ID | 最终证据 | 状态 |
|---|---|---|
| UIR-01影响预览 | 02:56明确host预览/变化重看；04:45–47、接口目录的memory.source输出maintenancePreview，memory.remove带previewRevision/impactDigest并原子复算 | 已闭合，API仍18项 |
| UIR-02分开命令 | 04:11/15/19分别MemoryCommand/InternalJobCommand/AppCommand；30–32明确资源停止不因Memory revision冲突被阻；资源回执不伪称Memory落盘 | 已闭合 |
| UIR-03独立smoke | 06:118及文件边界/追溯矩阵改`apps/stage-tamagotchi/scripts/acceptance/memory-restart.electron-smoke.ts`，不匹配当前scripts/**/*.test.ts；显式tsx、已构建入口/独立合成profile/campaign参数缺失即拒启 | 已闭合；是未来脚本约束，尚未实测 |
| UIR-04完整首次流程 | 06:41 ENG-X08明确原extraSteps/model/profile顺序、profile skip不触发全局skip、空afterModelSteps兼容；文件边界加入现onboarding.browser.test.ts，MEM-03/INT-01路径已同步 | 已闭合 |
| UIR-05总开关 | 02:54明确同页“自动整理新聊天”调用memory.setPolicy；关闭取消未提交任务、已有记忆仍召回、不补暂停期，失败/冲突回真实状态 | 已闭合 |

当前机器目录读到118文件边界（65现有/53拟新增）与18API；初审106文件的全指纹检查是上节当时快照，不冒充对后续扩充118项已重新逐项验过。主写者负责最终总核，本分工最后仅核上述5处修订。未改根docs/产品/用户素材，未运行git status或任何应用/模型/产品测试。无需再为这5项追加抽象方向选择题；用户仍需审定整稿后才能开工。
