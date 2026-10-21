# Impeccable 学习记录与 Aimy v3 应用边界

- 日期：2026-10-13。
- 状态：设计参考；本记录不代表产品实现、正式选型或上线验收。
- 来源：本地 `/Users/mima1234/Documents/资料/设计/impeccable-main` 的实际技能入口、参考文档与少量 CLI 源码。
- 用途：为 Aimy v3 的图标构图、AIRI 界面延续、交互优化及风格库评审提供依据。
- 风险：来源中有面向不同产品模式的规则及安装/执行流程，不能脱离语境照搬；源码存在不等于本机运行通过。
- 替代关系：补充本轮设计依据，不替代 Aimy 当前方向、AIRI 基线或产品验收要求，不将前两版设计稿改写为已获批准。

## 读取与执行证据

已完整读取：可分发入口 `plugin/skills/impeccable/SKILL.md`（声明 v4.5.2），以及 `shape.md`、`operate.md`、`mode-operate.md`、`craft-floor.md`、`clarify.md`、`animate.md`、`extract.md`。

定向读取：`README.md` 的介绍、命令与安装段；`skill/SKILL.src.md` 的入口、上下文与模式段；`new-work.md` 的视觉继承与验证流程；`critique.md` 的独立评估、证据合成和认知负荷段；`audit.md` 的检查维度；`harden.md` 的异常输入、文案与错误处理段；CLI 命令分发、engine 连接及 launcher 开头。未声称逐文件通读整个项目。

未执行：安装、launcher、`context`、`detect`、`critique`、`audit`、live server、自动 hook、二进制下载及项目测试。未运行任何 Impeccable 产品命令，也未写入其配置。

README 声称“1 skill、24 commands、59 deterministic rules”；本轮仅记录该自述，未逐项核对规则总数与运行效果。Rust CLI 可见 `detect`、`context`、`critique-storage`、`concept-seed`、`comp-diff` 等分发及静态 HTML/browser engine 连接；这是源码证据，不是本次执行结果。

## 对 Aimy v3 的应用

### 模式与继承

产品屏幕采用 **Operate**：用户完成聊天、语音、查看状态、调整设置等任务；扫描效率、状态明确、标准控件与平台习惯优先。风格库说明页采用 **Read**：结构和导航服务理解，不将说明页的编排直接套到应用界面。

用户已固定猫耳侧脸方向。本轮保留其可识别轮廓，重构主体尺度、视觉重心、负空间、安全边距及小尺寸表现；不借学习来源更换为无关品牌符号。AIRI 的角色区域、对话、输入和设置关系作为界面依据，品牌进入字体、色彩、密度及一个明确的识别细节。

### 交互优化

1. **渐进披露（progressive disclosure）**：主界面维持一个主要任务；模型、设备、外观等次级配置按任务分组，按需展开，避免首次面对整墙选项。相关状态保留在操作附近，减少跨屏记忆。
2. **清晰恢复（clear recovery）**：错误说清失败了什么、已知原因及下一步；权限拒绝给出恢复途径；请求失败保留用户输入；“停止”“重试”“打开设置”描述具体结果。
3. **完整状态**：组件记录 default、hover、focus、active、disabled、loading、error，并覆盖空状态。空态区分首次使用、无结果、未授权与请求失败；加载进度必须有真实依据。
4. **一致操作**：优先熟悉的按钮、输入、标签页和面板；浮层避免被滚动容器裁切；键盘焦点、可访问名称与可见文字一致。
5. **反馈动效**：常规变化以约 150–250 ms 为参考，解释状态或区域关系；重复操作和中断应有即时反馈。减少动态效果时保留可读的状态变化。

### 视觉与交付

- Operate 明确允许系统字体及熟悉的 sans；README 的泛化字体禁忌不应机械覆盖 macOS 产品习惯。一套字体、固定字号和紧凑层级通常足够。
- 强调色用于主要操作、选择及有意义的状态；侧栏、工具栏和内容区采用清楚的中性色层次。状态 token 与品牌色分开定义。
- 正文及 placeholder 对比度参考 ≥4.5:1，大字 ≥3:1；图标线重、焦点、留白与控件密度保持一致。
- 风格库应包括语义 token、组件用途/变体/行为/可访问性、关键状态和 AIRI 映射。示例交互不等于真实模型、设备或权限集成。
- 使用中文长消息、长模型名、未配置、离线、超时、权限拒绝、请求失败及 200% 缩放检查边界，不能只为理想数据设计。

## 有界评审

借鉴 **bounded QA**，本轮常规自检最多两轮：第一轮批量查看目标窗口尺寸、主题、关键状态与键盘路径；将发现的问题一次修复；第二轮确认修复。不得将每个微调都扩展成新的截图循环。

设计判断与技术证据分别报告。设计评审关注层级、情感适配、可发现性、认知负荷与产品特征；技术检查关注可访问性、主题、布局、性能及实现一致性。未运行 detector 就不填写其通过状态，也不把静态截图当作权限、设备或手势验证。

两轮结束仍有实质问题时，记录具体未解决项和影响，不把轮次预算当作通过标准，也不宣称已经达到上线验收。

## 来源索引

下列行号以本次读取的本地文件为准；上游后续变更可能使行号漂移。

| 来源 | 本轮使用依据 |
| --- | --- |
| [README.md:3](/Users/mima1234/Documents/资料/设计/impeccable-main/README.md:3) | 项目自述；14–16 行区分产品事实、命令和 detector。 |
| [实际 SKILL.md:1](/Users/mima1234/Documents/资料/设计/impeccable-main/plugin/skills/impeccable/SKILL.md:1) | 版本与入口；12–15 行的有界验证；25–41 行的 brief 与模式。 |
| [SKILL.src.md:19](/Users/mima1234/Documents/资料/设计/impeccable-main/skill/SKILL.src.md:19) | 源模板中的上下文加载、继承与模式；不能据此自行安装或扩大写入。 |
| [new-work.md:3](/Users/mima1234/Documents/资料/设计/impeccable-main/skill/reference/new-work.md:3) | 产品事实、视觉系统、单个界面任务分开；9–16 行保留既有资产。 |
| [mode-operate.md:7](/Users/mima1234/Documents/资料/设计/impeccable-main/skill/reference/mode-operate.md:7) | 品牌只进入字体、色彩、密度和识别细节；15 行要求可操作的真实屏幕。 |
| [operate.md:11](/Users/mima1234/Documents/资料/设计/impeccable-main/skill/reference/operate.md:11) | 产品字体和颜色；30–43 行组件状态与动效；54–61 行系统字体与标准导航许可。 |
| [critique.md:55](/Users/mima1234/Documents/资料/设计/impeccable-main/skill/reference/critique.md:55) | 独立设计判断与 detector/browser 证据；353–408 行认知负荷和渐进披露。 |
| [audit.md:1](/Users/mima1234/Documents/资料/设计/impeccable-main/skill/reference/audit.md:1) | 技术审计与设计评审的边界；11–60 行检查维度。 |
| [clarify.md:31](/Users/mima1234/Documents/资料/设计/impeccable-main/skill/reference/clarify.md:31) | 动作、表单、错误、权限和空态；80–92 行语境验证。 |
| [harden.md:5](/Users/mima1234/Documents/资料/设计/impeccable-main/skill/reference/harden.md:5) | 异常输入与网络/权限错误；139–163 行恢复及保留输入。 |
| [animate.md:50](/Users/mima1234/Documents/资料/设计/impeccable-main/skill/reference/animate.md:50) | 时间与缓动；73–87 行减少动态效果和中断验证。 |
| [craft-floor.md:5](/Users/mima1234/Documents/资料/设计/impeccable-main/skill/reference/craft-floor.md:5) | 渲染后检查对比度、状态、焦点和真实内容。 |
| [extract.md:24](/Users/mima1234/Documents/资料/设计/impeccable-main/skill/reference/extract.md:24) | token、组件变体、文档及渐进提取。 |
| [main.rs:52](/Users/mima1234/Documents/资料/设计/impeccable-main/crates/cli/src/main.rs:52) | CLI 分发；124–142 行静态与浏览器 engine 连接，未运行。 |
| [launcher:1](/Users/mima1234/Documents/资料/设计/impeccable-main/skill/scripts/impeccable:1) | 二进制/缓存调用；63–65 行可修改执行位，未启动。 |

## 不自动继承的流程

来源中的安装、launcher、生成根 `PRODUCT.md` / `DESIGN.md`、hook、上下文修复、确认门槛及评审存档流程均按来源内容处理。本轮不因这些来源流程扩大范围或修改产品代码。主控按用户请求将设计产物存入根 `docs/` 并更新文档入口；现有用户任务与工作区规则优先。

不同参考之间存在模式差异，例如 craft-floor 的浏览器外观建议与 Operate 对标准控件的强调，以及通用 harden 的流式字号与 Operate 固定字号。应依据 macOS、AIRI 和具体任务选择，不将所有建议累加成产品需求。
