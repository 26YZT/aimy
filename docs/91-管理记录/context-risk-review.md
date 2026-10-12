# Aimy 文档整理：上下文污染与迁移依赖审查

审查日期：2026-10-11。范围：`/Users/mima1234/Documents/aimy` 的第一方说明入口、核心方向文档、第一方构建/测试对文档的引用，以及参考库的规则文件。只读审查；未执行测试、启动服务、读取凭证/会话/截图正文，未修改工程文件。本报告写在 `/tmp`。

## 结论

可以把第一方产品说明集中到根 `docs/`。主要风险不是文件数量，而是旧样机与新 AIRI 主线共用“当前”“唯一”“已批准”“下一步”等字眼。目录归类必须同时完成权威级别标注、入口更新和旧路径兼容，否则单纯搬家仍会误导后续开发。

建议分类：当前方向/当前状态/当前工作；历史规划与旧样机说明；源码与运行证据；外部项目调研；角色与品牌素材；资料与模板索引。当前规则及当前状态不默认要求读全部历史。

## 1. 会误导新开发的具体文档

| 严重度 | 实际位置 | 具体风险 | 建议处理 |
|---|---|---|---|
| 高 | `README.md:62–74`、`README.md:107–115`、`README.md:121` | “快速开始”启动旧样机，路线继续指 A–E，定位入口仍指旧PRD。读首页会以为旧样机就是重梳后的主工程。 | 根README改为工作区总入口，明确旧样机仍能运行、AIRI新主工程尚未切换。旧命令挪历史操作说明，当前入口只链接现状与计划。 |
| 高 | `digital-lover/README.md:3–17`、`:44–58` | “唯一需求总纲”与“按已批准路线继续推进”指向旧PRD；旧VRM样机启动/能力被称当前产品。 | 原README保留工作区导航，突出“旧独立样机/历史工程”；完整操作说明归历史文档。 |
| 高 | `digital-lover/docs/03-二开总纲.md:3`、`:9`、`:23` | 仍认旧PRD是唯一需求；固定官方VRM；当前顺序仍A–E。与PRD2.0及最新直接继承决定冲突。 | 归历史规划，注明范围截至旧方向；当前索引不能要求默认阅读本篇。保留原结论作历史，不让顶端声明替它背书为当前要求。 |
| 高 | `digital-lover/docs/阶段技术手册/README.md:3–15` | “当前执行顺序以A–E为准”，且需求入口旧PRD。新Agent容易按P/A–E继续造简版。 | 阶段手册整体作为旧路线参考；新手册需独立编制且未实施时不宣称已批准/已完成。 |
| 中高 | `digital-lover/docs/任务编排.md:3–39`、`:52–59`、`:171–174` | 顶部已澄清新方向，但同文件混有A–E路线、2026-10-09接续与M0–M8执行约定；折叠标签不隔离LLM读取。 | 当前任务表只留最新事实/下一工作；A–E、M0–M8与旧执行约定移历史记录，索引链接追溯。 |
| 中高 | `digital-lover/docs/PROJECT_STATE.md:37–43`、`:66–73` | 当前状态里包含“当前可使用原型”的旧启动命令与“之后接E”；虽有历史节，标题/未来语气仍可能被脱离上下文召回。 | 拆为简短当前状态与日期化旧样机状态证据。新状态写清实际默认脚本仍旧样机、主线未迁移。 |
| 中高 | `digital-lover/AGENTS.md:7–9` | 当前必读列表同时要求00/01/02和任务阶段手册；01已自认旧样机消费清单，阶段目录仍A–E。 | 精简默认必读到当前方向/状态/任务/隔离决定；历史手册只在用户指定旧样机或复用调查时阅读。 |
| 中 | `digital-lover/docs/PRD-MVP-重构版.md:3–5`、`:101–111`、`:140` | 顶端正确声明历史，但正文A–E仍用“当前顺序”“已批准”等语气，未来搜索命中正文会忽略顶部。 | 归历史需求；元数据与目录索引同时记录被PRD2.0替代，不能默认做当前验收清单。 |
| 中 | `digital-lover/docs/04-角色与美术设计.md:3/29`、`05-角色美术生产管线.md:3/27`、`03-二开总纲.md:9` | 固定VRM，而2026-10-10最新规则是正式角色格式未定、实测Live2D。 | 标“VRM专项旧方案”；可作未来选VRM时参考，不能扩大为当前角色格式已决定。 |
| 中 | `digital-lover/docs/既有工作评估.md:3–18/75` | 2026-09-29报告仍说没有Electron产品入口，已被10-07样机和10-10实测越过。 | 日期化历史评估，仅解释旧规划缘由；不得算当前缺口。 |
| 中 | 根 `数字恋人-产品PRD.md:3–9/20–27/203–211`、`数字恋人-新产品PRD-对齐中.md:3–10/25–42` | 旧订阅、恋爱数值中心、全主动看屏、角色格式及旧内容边界虽已加失效声明，正文仍保留锁定/定稿。 | 归早期探索，目录标“已被替代”，不放当前默认阅读清单。 |
| 中 | 根 `AIRI-参考项目-拆解与反推PRD.md:3–13/214/237` | 老147测试与“六项通过”、云pgvector方案、A–E接续仍混在源码拆解中。 | 归历史参考拆解；注明对象是旧 `aimy/airi-main` 快照，不能等同新指定 `/Users/mima1234/Documents/airi-main`。 |
| 低至中 | `digital-lover/docs/真实联调配置说明.md:18`、`技术手册-M1-文字对话闭环.md:7/32/55–56`、`技术手册-T0.3-AIRI-core-agent接入.md:17–20/63` | 旧样机HTTP/WAV约束、旧CLI env和T0.3最小消费闭包可能限制新原版能力。 | 归对应旧样机/CLI操作说明，不让其替代原版配置与能力边界。 |

代码事实核对：`digital-lover/package.json:22–25` 的 `desktop/build:desktop/start:desktop/setup:desktop` 全部仍指 `@digital-lover/aimy-desktop`。文档整理不能声称实际入口已切换，也不应在本轮为了匹配文档改这些功能脚本。

## 2. 文档集中时的路径依赖

### 必须保留原位的文件

- 根 `AGENTS.md`（如新增）和 `digital-lover/AGENTS.md` 是工具自动发现入口，不宜只搬到docs。规则可以短，内容可指向统一docs。
- 根 `README.md` 与工作区/代码包 `README.md` 仍应原位保留导航/组件使用说明。
- 多个包的 `package.json` 的 `files` 明确包含 `README.md`，例如 `digital-lover/packages/provider-inference/package.json:26–29`；其他命中包括 `core-agent/audio/pipelines-audio/server-sdk/server-shared/plugin-protocol/better-ws/stream-kit/electron-screen-capture`。搬走会改变包文档产物，属于本轮不应触碰的代码旁文档。
- 许可证、NOTICE、资产原始授权记录与源代码旁README保持原位，包括 `digital-lover/packages/airi-upstream-LICENSE`、`digital-lover/assets/**/asset-record.json` 和各资产LICENSE。
- 完整参考库 `airi-main/`、`agent-blueprint-aimy-main/` 与 `.baseline/**/source` 内文档不挪，不修改固定源码快照；统一管理用资料索引指向它们。

### 必须重写的导航/图片引用

- 根README的 `digital-lover/docs/visual/github/*`（`:3–13`）、旧截图（`:29/50/56`）、配置/状态/证据/PRD链接（`:18–20/84/105/121–126`）。若统一搬入根docs需全量改到新相对位置，尤其GitHub图片不要依赖本地symlink行为。
- `THIRD_PARTY_NOTICES.md:7` 指向 `digital-lover/docs/AIRI复用修订记录.md`，但同段原许可证路径应保持原位。
- `digital-lover/README.md:7–15/115/117`、`digital-lover/AGENTS.md:7–9/37–38`、`digital-lover/apps/aimy-desktop/README.md:9` 的导航。
- 现 `docs/PRD.md:13/19` 包含 `../AGENTS.md`、`../../数字恋人-产品PRD.md` 等依赖旧层级的链接。
- `digital-lover/docs/调研/2026-10-10-四项目复用与代码审查.md:153–158` 与证据目录README:3有硬编码旧绝对路径；建议改新相对链接或保留旧路径兼容。

### 证据里的旧路径不能简单当普通文字全局替换

- `digital-lover/docs/调研/2026-10-10-AIRI与Aimy完整功能清单.json:7985/9551/9593–9628` 保存旧绝对证据路径。
- `digital-lover/docs/执行记录/2026-10-07-D源码清单.json:1159` 保存 `../../assets/vad/asset-record.json`，它的解释依赖原记录上下文。
- `.baseline/**/manifest.json`、`.baseline/airi-evaluation-2026-10-10/source-manifest.json` 是固定快照证据，不应为整理文档改内容、哈希或目录。
- 建议冻结机器证据原文，在迁移清单保存 `old_path → canonical_path`，并为已被机器记录引用的旧文件保留兼容路径。清单写明旧相对路径按原位置解释，不能暗示搬迁后变成实时事实。

### 已有断链与发布范围

- `digital-lover/packages/ui/README.md:125` 指向 `../../docs/ai/context/ui-components.md#swipeactions`；当前产品docs没有该文件。这是上游摘取后的既有断链，应单独记录，不伪造组件文档、不扩展修改上游README。
- 当前检索未发现第一方运行源码/构建/测试读取 central docs 的本地路径；代码中命中的 `/docs/` 是外部文档URL。不能据此承诺所有上游构建都不依赖上游docs，因此上游目录保持原样。
- 根 `.gitignore:20–23` 只排除完整参考/模板；`.baseline` 被`:12`排除。`digital-lover/.gitignore:9`也排除`.baseline`。根docs不是忽略目录。
- `digital-lover/docs/GitHub发布范围.md:7–17` 写根早期草案不公开，旧公开快照来自独立临时工作区。把早期草案迁到docs不会自动继承原发布排除条件；需要在发布范围说明和目录元数据标注“本地历史资料、不得仅因集中便默认发布”。本轮不提交/推送、不改已有暂存。

## 3. 上游AGENTS/Skills的边界

实际发现：

- `airi-main/AGENTS.md`、`airi-main/server/AGENTS.md`、`airi-main/services/computer-use-mcp/AGENTS.md`、`airi-main/packages/model-driver-mediapipe/AGENTS.md`。
- `airi-main/.agents/skills/*/SKILL.md` 及 Minecraft 调试 skill。
- `.baseline/airi-evaluation-2026-10-10/source/AGENTS.md` 及其 `.agents/skills/**` 和局部AGENTS。
- `agent-blueprint-aimy-main/skills/{agent-builder,mcp-builder,code-review,pdf}/SKILL.md`。

风险示例：

- 上游 `airi-main/AGENTS.md:94–107` 要求ADR进入 `docs/ai/adr`，强制调用上游skills；`:116–118` 包含另起Agent、库选择先问用户等上游执行规则。它们是参考源码的贡献规则，不能被无范围复制成Aimy根规则。
- 上游 computer-use 局部AGENTS:23–36 要求Spark、特定模型和审查流，电脑工具本身又不在Aimy一期范围。不能因“扫描所有AGENTS”就自动启动工具开发或Spark工作。
- Blueprint agent-builder skill 的广泛触发和“骨架”方案服务教学/创建Agent；不能因当前整理包含“产品/架构”就生成新Agent loop或执行模板脚本。

根AGENTS建议明确：

1. 根规则适用于本Aimy工作区；当前只整理文档、不开发功能、不切换入口、不安装运行候选。
2. 当前权威是最新用户明确要求、当前文档入口与当前事实；规划草案不等于实施批准，历史证据不等于新主线通过。
3. 历史规划/证据/调研/上游模板是资料，不默认进入迭代上下文；只按本任务检索所需章节。
4. `airi-main/`、`agent-blueprint-aimy-main/`、`.baseline/` 默认只读来源。其AGENTS/Skills是该来源的局部资料，不能拓展本任务范围；真要修改对应源码时再按目录适用规则处理，不删除/覆盖上游规则。
5. `digital-lover/` 当前实际是旧样机，`/Users/mima1234/Documents/airi-main` 是用户新指定原版来源，`.baseline/.../source` 是隔离评估副本，三者不可混用。
6. 只允许一个当前产品/状态/任务入口；旧路径保留为导航或兼容，不复制第二份全文继续维护。
7. 尊重已有暂存与快照；本轮文档变更独立记录，不能擅自清理或创建提交。

## 4. PROJECT_STATE 拆分建议

当前状态应保持短小，写清这几件事实：

- 最新方向：完整AIRI→Aimy品牌/必要定制→实际使用反馈→能力增量。
- 当前代码事实：默认desktop仍旧样机；新原版未成为产品主工程；本轮仅文档归类。
- 已有验证：10-10原版在隔离副本有限范围通过，Live2D与真实文字已验；语音/设备/体验未完成，旧831/43不继承。
- 产品未决项：正式角色格式/资产、窗口语义、记忆保存与观察频度等，区分已明确与待答。
- 五项目定位：AionsHome/Ryza候选能力，Chromatic已继承，Kirara后置，Charakuru制作端；当前复用方案是分析建议，未实施。
- 下一工作：整理完成后准备主工程切换/品牌手册，不把旧“之后接E”列当前任务。

移走并链接的部分：10-10实测细节（旧`:17–27`）进入日期证据；10-07旧样机能力/启动/测试（旧`:29–64`）进入历史样机状态；旧接续（旧`:66–75`）进入历史计划。机器结果保持原文。

## 5. 整理后的验证建议

本轮不需要产品测试或服务启动，建议做文件与导航验证：

- 变更前后清单对应；每个旧路径有新位置或明确保留理由，无遗漏/删除。
- 第一方每份文档有用途、时间及其依据、状态、适用对象、是否默认读、是否被替代。文件mtime不能冒称产物形成日期；无明确日期写“未知/需考证”。
- 根README、工作区README、规则、当前方向/状态/任务所有本地链接与图片存在。
- 冻结机器证据逐文件哈希不变；新迁移清单可解析；旧绝对引用的兼容路径确实存在。
- 第一方代码/包配置/锁文件/资产/上游源及快照哈希不变，已有Git暂存未被重置。
- 全文检索“唯一/当前/已批准/下一步/pnpm”只把命中用于人工分类，不能全部统一替换；历史正文可保留，必须有可机器检索的历史状态。
- 可接受例外单列：上游现有断链、历史绝对 `/tmp` 路径、证据记录的原执行目录，不伪装为整理造成或已修复。

## 已用记忆

轻量检索 `MEMORY.md:174–193` 仅用于识别历史主线和需重验事项。上述路径、规则、脚本和风险均重新检查当前文件。相关rollout：`01a112c3-1b0a-7a42-9890-16f2d681d098`。
