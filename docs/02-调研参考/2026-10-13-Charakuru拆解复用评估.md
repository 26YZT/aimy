# Charakuru：面向 Aimy 的拆解复用评估

- 产出日期：2026-10-13（Asia/Shanghai）。状态：调研记录，非选型、非接入、非开发任务。
- 产生原因：用户要求拆解 `/Users/mima1234/Documents/资料/拆解项目/Charakuru-main/`，重点挖工作流本身、AI agent 协作方法、Blender 集成、Tripo 成本，以及与 Live2D 路线的对比。
- 来源：① GitHub 源码仓 `Charakuru-main`（60 文件，只有文档与图片）；② **发行包 v1.0.4**（11,159,648 字节，SHA256 `2438dff64e5573cd80bf8691c49713be96d4c46a4cd1dcce52108c4da83ba290`，已核对与官方 release 摘要一致），解压至 `/tmp/charakuru-extract/charakuru-1.0.4-2026-10-12T17-55-01-211Z/`（工作区之外，遵守只读约束）；③ 对照 `/Users/mima1234/Documents/aimy/aimy-app/`（AIRI v0.12.0-beta.5 副本）。
- 用途与风险：**本报告不构成采用该工具链的授权。** 许可证为自定义 source-available 且明确禁止再分发，任何"打包进应用"的动作都必须先取得书面许可（见 §2）。
- 替代关系：本报告取代 [五项目复用讨论汇总](2026-10-11-五项目复用讨论汇总.md) 中 Charakuru 一行的 v1.0.3 结论，把「插画到VRM的内部制作工具」细化为可指到行的证据，并首次给出 Skill 协作机制、成本与 Live2D 对比。

## 0. 一句话结论

**Charakuru 不是可以拿来复用的代码库，是一个"用 AI agent 把一张立绘做成 VRM"的工艺包；它对 Aimy 的价值在于工艺与 Skill 组织方式，而不在代码——而且它的标准产物（无表情、无视线、固定脸）恰好落在 AIRI 已有情绪映射能力够不着的地方，必须补做才能用。**

## 1. 项目速览

| 项 | 内容 | 证据 |
|---|---|---|
| 名称 | Charakuru（曾用名 ELYTH Avatar Kit / Chara Kit） | `LICENSE` §1「also previously named ELYTH Avatar Kit or Chara Kit」 |
| 作者 | Nano（ナノ） | `README.md` |
| 赞助 | Tripo | `README.md`；`LICENSE` §8「Tripo sponsor logos remain Tripo-owned」 |
| 版本 | **发行包 v1.0.4**（`package.json` `"version": "1.0.4"`）；`README` 徽章仍写 1.0.2，落后于发行包 | 以发行包为准 |
| 一句话定位 | 「一张角色立绘 → 一个 VRM 化身，把工作分给 AI agent」 | `README.md`：「A kit for turning one character illustration into a VRM avatar, sharing the work with an AI agent」 |
| 技术底座 | Tripo Smart Mesh（云端 3D 生成）+ Blender 5.2（本地 DCC）+ Codex（带浏览器控制与图像生成的 agent） | `README.md` 依赖清单 |
| 交付形态 | 本地 Node.js 应用（`npm start` → `http://127.0.0.1:8766`）+ 9 个 agent Skills + Blender Python 脚本 | `package.json` `scripts.start: node server.mjs` |
| 运行环境 | Node.js ≥ 22、桌面版 Chromium 浏览器、Codex、Tripo 账号、Blender 5.2 + VRM Add-on + Blender MCP | `README.md`、`AGENTS.md`「必要環境とセットアップ」 |
| 输入 | 一张可用立绘（PNG/JPEG/WebP，≤20MB） | `README.md` |
| 输出 | `exports/avatar.vrm`（VRM 1.0）+ `exports/avatar.blend` | `AGENTS.md`「保存・再開・入出力」 |
| 许可证 | **自定义 source-available，非 OSI 开源** | `LICENSE` 开头；详见 §2 |
| 规模 | 发行包含 21 个 `scripts/`、76 个 `public/` 条目、9 个 Skills、1 份 90 行根 `AGENTS.md` | 目录清点 |

### 1.1 一个必须说清楚的发现：GitHub 仓里没有应用

用户给的 `Charakuru-main/` **只有文档和图片**（README、tutorial、getting-started、browser-use、license、LICENSE、THIRD_PARTY_NOTICES、CONTRIBUTING、`docs/images/`、`public/{fonts,vendor}/`），**没有 `AGENTS.md`、没有 `skills/`、没有 `server.mjs`、没有 `scripts/`**。

原因写在 `README.md` 里：可分发应用与根 `AGENTS.md` 位于**专用发行 ZIP**中，不在仓库源码归档里。

所以真正要拆的东西必须从 Releases 取。本轮取到 v1.0.4，并逐字节核对了 SHA256。**如果只拆 `Charakuru-main/`，会漏掉本项目最有价值的全部内容**——这正是用户点名要挖的「AI agent 协作方法、Skill 指令和结构」。

## 2. 许可证边界（必读，先于一切技术判断）

**结论：可以在本机研究、学习、个人自用；不可以随应用分发；产出的模型可以随便用。**

### 2.1 基本信息

| 项 | 内容 |
|---|---|
| 名称 | Charakuru Source-Available License and Terms of Use, Version 1.2 |
| 版本日期 | 2026-10-07 |
| 版权方 | Copyright (c) 2026 Chara Kit contributors |
| 性质 | `LICENSE` 开头自述：「**a custom source-available license, not an OSI-approved open-source license and not the MIT License**」 |
| 章节数 | 11 节（`LICENSE` 第 11/77/101/143/170/184/204/213/251/266/280 行） |

### 2.2 免费范围（§2「Free permission」）

免费使用需满足 **(a) 或 (b)** 之一：

- (a) 使用是**真正个人的、在 Business Use 之外**；或
- (b) **Revenue 与 Funding 同时低于财务门槛**。

门槛数值为 **JPY 100,000,000**（1 亿日元），且 §2/§3 的措辞是「**both** Your Revenue and Your Funding」，即**两项分别测试、不是相加**。

几个容易被误读的定义（均出自 §1）：

- **Revenue** 是**整个业务的毛收入**，不是「本项目收入」；个人用最近一个完整自然年；经营不满 12 个月**不做年化**。
- **Funding** 是**自业务开始以来累计**的外部股权融资与经营性借款，**不限于最近 12 个月**。
- **Business Use** 包含「internal model production, commissioned work, sales of models or content, and incorporation into a product or service」，**并且包含这些活动的开发与测试阶段**，即使项目还没赚钱。
- 受控集团（common control）下的实体需**合并评估**。

**对 Aimy 的含义：** 用户已确认「现阶段纯自用不外传」，落在 (a) 支路——真正个人、非 Business Use。这条支路**不看收入门槛**。研究与本机使用是允许的。

### 2.3 禁止再分发（§4「GitHub forks, contributions, and redistribution」）

这是**对本项目最硬的一条**，原文列举：

> 「Except for the GitHub repository activities above and private operational copies under Section 2, **redistribution requires prior written permission from the Licensor. This includes free or paid copies, reposting on other sites, mirrors outside GitHub, re-uploaded ZIPs, package registries, installers, bundled applications, and independently distributed modified releases.**」

逐条对应到 Aimy：

| 动作 | 是否允许 |
|---|---|
| 在本机跑这个工具链做自己的角色 | **允许**（§2 私人使用） |
| 把工具代码或 Skills 复制进 `aimy-app/` 并随 Aimy 安装包分发 | **禁止**（"bundled applications" 明文列举） |
| 在 GitHub 上 fork / 提 issue / 提 PR | 允许（§4 第一段，且「applies regardless of the financial threshold」） |
| 在 fork 里发 GitHub Releases 或 GitHub Pages 托管应用 | **禁止**（§4 明文） |
| 把某个 Skill 单独摘出来给别人 | 需 **§4 书面许可**，且必须随附本许可证 |
| **花钱买商业许可** | **不等于获得再分发权**（§4：「A commercial license fee does not by itself authorize redistribution.」） |

还有一条容易踩的：§2 明确「**Making Kit code available to customers, including delivering the application to their browsers, is redistribution**」——即使客户只是用浏览器访问，也算再分发。也就是说**不能把 Charakuru 做成 Aimy 的在线建模服务**。

### 2.4 产出物归你（§6「Models and other Outputs」）

这一条是**对 Aimy 最有利的一条**：

> 「The Licensor claims **no ownership, royalty, Kit attribution requirement, or redistribution restriction** over Your Outputs solely because You used the Kit. You may use, edit, sell, license, and distribute authorized Outputs...」

Outputs 定义为「the models, textures, images, animations, videos, scene data, and user project data You produce through authorized use of the Kit」，且明确「Merely using the Kit or its project format does not make an Output Covered Materials」。

**边界：** §6 同时说「Calling something an Output does not exempt a copy of Kit code, a Skill, or other substantial Covered Materials embedded in it from this License」。**做出来的 VRM 归你，工具代码不归你。**

对 Aimy 的具体结论：**用 Charakuru 做出来的 Aimy 角色 VRM，可以放进 Aimy 分发。** 这是整个许可证里唯一直接支撑产品化的一条。

### 2.5 随附素材不可动（§8）

项目自带素材（**示例角色与模型、参考美术、截图、缩略图、GIF、视频、宣传图、logo，以及 weighted donor body**）只能用于本工具链与文档：

- 不得**抽出单独使用**；
- 不得**上传到外部服务**做独立用途；
- 不得**单独再分发**；
- **该禁令同时适用于商业与非商业用途**，且「a commercial software agreement does not grant those rights」。

donor body 的专门例外是：可**在本地**加载与修改，**仅限 body fitting 与 weight transfer**，可留本地中间副本，但「The donor, its meshes, rig, and intermediate fitted copies must not be taken out for independent use or distributed separately」。

**对 Aimy 的含义：** `assets/donor/weighted-body.blend`（1,093,222 字节）**不能进 Aimy 仓库、不能上传到任何服务**。只能留在本机做体重转移。如果 Aimy 将来要做"用户自己捏角色"的功能，这条路被 §8 堵死。

### 2.6 第三方与其它

- Three.js、fflate、three-vrm、three-vrm-animation、Orbitron 字体按各自许可证（MIT / OFL），见 `THIRD_PARTY_NOTICES.md`、`public/vendor/*.txt`、`public/fonts/Orbitron-OFL.txt`。
- §9：违约有 **30 天补救期**。
- §11：**英文版为准**；商业联系 `divedesign.info@gmail.com`。
- §8 末：不授予任何商标或背书权；ELYTH / Tripo / OpenAI / Blender 等名称归各自所有；**赞助不等于所有权、支持义务或对修改版 fork 的背书**。

### 2.7 许可证结论

| 使用方式 | 判定 | 依据 |
|---|---|---|
| 本机研究、学习、个人做自己的角色 | **允许** | §2 (a) |
| 用产出的 VRM 做 Aimy 的角色并随 Aimy 分发 | **允许** | §6（Outputs 无归属与再分发限制） |
| 把工具/ Skills 打包进 Aimy 分发 | **禁止**，除非取得 §4 书面许可 | §4 |
| 把 donor body 或示例角色带出本机 | **禁止** | §8 |
| 商业授权自动带来再分发权 | **不会** | §4 |
| 未来 Aimy 对外分发时的动作 | **必须先向 Licensor 取得 §4 书面许可**，否则工具链只能停在个人工具身份 | §4 |

## 3. 完整功能清单

### 3.1 应用侧（本机 Web 应用，`server.mjs` 系列）

| 编号 | 功能 | 做什么 | 实现方式 | 核心文件 | 成熟度 |
|---|---|---|---|---|---|
| A1 | 本机 Web 应用 | 8766 端口提供建模工作台 | Node HTTP 服务，无框架，`npm start` | `server.mjs`、`server-config.mjs` | 稳定 |
| A2 | 会话交接协议 | 应用 ↔ agent 双向交接 | `agent-session.mjs begin URL REQUEST_ID` → POST `/api/session/{start,status,progress,complete,fail}`；轮询 35s 等 `status==='running'` | `scripts/agent-session.mjs`、`server-session.mjs` | 稳定，是架构核心 |
| A3 | 请求文本生成 | 按工序生成给 agent 的日文委托文 | `sessionPrompt(r, appRoot, origin, locale)`，按 kind 分发 | `public/session-prompts.mjs` | 稳定 |
| A4 | 立绘导入与图像库 | 导入原画、管理 8 方向素材 | 本地图像信息/元数据解析 | `public/images.mjs`、`image-ui.mjs`、`image-metadata.mjs` | 稳定 |
| A5 | 三视图制作与导入 | 生成/导入 3 方向参考图 | 图像渲染 + 导入 | `public/three-view-*.mjs` | 稳定 |
| A6 | 候选模型审阅 | 头 4 + 体 4 共 8 个候选的预览与选择 | 3 个 `.mjs` UI + wireframe 渲染 | `public/models.mjs`、`candidate-wireframe.mjs` | 稳定 |
| A7 | 模型编辑器 / 头身调整 | 调整比例、身高尺 | `height-ruler.mjs`、`fine-range.mjs` | 同左 | 稳定 |
| A8 | 材质预览 | MToon 材质效果预览 | `mtoon-materials.mjs` + `public/mtoon-profile.json` | 同左 | 稳定 |
| A9 | 动作预览 | 走路动作检查 | 载入 `elyth_base_walk_v1.vrma` | `public/motion-review*.mjs`、`review-walk*.mjs` | 稳定 |
| A10 | 绑定（rig）审阅 | 骨骼与权重检查 | 骨向导数据 + 审阅 UI | `public/rig-guide*.mjs`、`rig-review.mjs` | 稳定 |
| A11 | 揺れもの物理预览 | SpringBone 效果预览 | 本地弹簧物理模拟 | `public/spring-physics.mjs` | 稳定 |
| A12 | VRM 导出界面 | 填写模型名/作者/利用条件并正式导出 | `vrm-export-ui.mjs` | 同左 | 稳定 |
| A13 | VRM 审阅 | 成品检查 | `review-vrm.mjs`、`vrm-review.mjs` | 同左 | 稳定 |
| A14 | 单一工程文件 | 一个 ZIP 承载全部工程状态 | `project.charakit`（v4/v5/v6 格式），`archive.mjs` + fflate | `public/project.mjs`、`archive.mjs` | 稳定 |
| A15 | 多语言 | UI 与提示文本多语 | `i18n.mjs`、`locales.mjs`、`translations*.mjs`、韩语专项 | 同左 | 稳定 |

### 3.2 Agent 侧（9 个 Skills——本项目最有价值的部分）

每个 Skill 是标准 `SKILL.md`（YAML frontmatter `name` + `description`）+ `references/` 子文档 + 可选 `scripts/`：

| 编号 | Skill | 做什么 | 规模 | 成熟度 |
|---|---|---|---|---|
| S1 | `charakit-project` | 工程文件的读写、解包、导入导出（最基础的一个） | `SKILL.md` 7,825 B；4 个 reference；4 个脚本 | 稳定 |
| S2 | `character-parts-images` | 从立绘生成「头（含发）+ 体」× 4 方向 = 8 张素材 | 9,515 B；3 ref（含 `part-contract.md`、`prompts.md`） | 稳定，有 `check_assets.py` 校验 |
| S3 | `character-three-views` | 三方向参考图制作（后加入） | 3,843 B；3 ref | 稳定 |
| S4 | `character-material-brushup` | 材质上色与打磨，含单一画质标准的详细描述 | 5,892 B；4 ref（含 `painting.md`） | 稳定 |
| S5 | `tripo-agent-workflow` | **驱动 Tripo Studio 的完整指令集**（浏览器自动化） | 9,710 B；4 ref（含 `commands.md`、`tripo-ui.md`） | 稳定，是工序主干 |
| S6 | `tripo-studio-download` | 从 Tripo 下载产物（后加入） | 6,147 B；含 `receive.mjs` | 稳定 |
| S7 | `avatar-weight-transfer` | 权重转移到自身体型 | 3,199 B；4 ref（含 `bone-guide.md`、`manual-transfer.md`） | 稳定 |
| S8 | `avatar-spring-setup` | **揺れもの（头发/裙/飘带）设置与自动验证** | 10,618 B（最长）；配置 JSON + 3 条命令 | 稳定 |
| S9 | `tripo-character-setup` | Tripo 侧角色与 Humanoid 设置 | 2,169 B；含 `humanoid_setup.py` | 稳定 |

其中 5 个带 `agents/openai.yaml`（Codex 界面卡片）：`character-parts-images`、`character-three-views`、`character-material-brushup`、`tripo-agent-workflow`、`tripo-studio-download`。格式为界面展示用的三元组：

```yaml
interface:
  display_name: "頭（髪込み）・体の4方向素材"
  short_description: "頭と髪を一体にし、体と合わせて完成した立ち絵の塗りで8枚の素材を作ります"
  default_prompt: "$character-parts-images を使い、…8枚の画像ZIPで返してください。"
```

注意 `README.md` 说「七个 Skills」，但 v1.0.4 发行包里有 **9 个**——`character-three-views` 与 `tripo-studio-download` 是后加的。**以 `AGENTS.md` 的 9 个为准**，`AGENTS.md` 的「工程別Skills」表列的正是 9 个。

### 3.3 Blender 侧（21 个脚本）

| 编号 | 脚本 | 做什么 | 类型 |
|---|---|---|---|
| B1 | `production.py` | 组装、MToon 应用入口（`assemble` 子命令） | Blender |
| B2 | `mtoon-export.py` | 给全部网格套 MToon 材质并导出 | Blender |
| B3 | `transfer-weights.py` | 权重转移 | Blender |
| B4 | `extract-donor.py` | 从 donor body 抽取可转移数据 | Blender |
| B5 | `spring-setup.py` | 揺れもの `setup` / `update-centers` | Blender |
| B6 | `separate-springs.py` | 分离揺れもの部件 | Blender |
| B7 | `export-rig.py` | 导出绑定（含头身 FBX） | Blender |
| B8 | `export-segmentation.py` | 导出分割结果 | Blender |
| B9 | `export-review.py` | 导出审阅产物 | Blender |
| B10 | `verify-springs.mjs` | **读实际 VRM 验证物理**：同部位物理 ON/OFF 对比 90 帧顶点位置 | Node |
| B11 | `tripo-project.mjs` | Tripo 工程操作（`candidates`/`analyze`/`classify`/`prepare`/`references`/`returns`/`assemble`/`segmented`） | Node |
| B12 | `import-bones.mjs` | Tripo 返回的 FBX 回灌 | Node |
| B13 | `run-local-job.mjs` | 触发本机作业（如 `transfer-weights`） | Node |
| B14 | `agent-session.mjs` | 会话交接（见 A2） | Node |
| B15 | `project-write.mjs` | 写工程文件 | Node |
| B16 | `set-weight-plan.mjs` | 设权重计划 | Node |
| B17 | `update-{images,model,three-views,spring-parts}.mjs` | 各工序结果登记 | Node |
| B18 | `package-images.mjs` | 图像打包成 ZIP | Node |

Blender 调用的固定形态（`skills/tripo-agent-workflow/references/commands.md`）：`blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python SCRIPT -- ARGS`。`--factory-startup` 隔离用户配置、`--disable-autoexec` 禁自动执行、`--python-exit-code 1` 让脚本报错转成非零退出码——**这三件套是把 Blender 当可靠 CLI 用的关键**，逐条都值得抄。

## 4. 架构与工作流总结

### 4.1 七步工序链

`docs/tutorial.md` 的屏幕顺序，对应 `AGENTS.md`「制作工程と確認地点」：

| 步 | 工序 | 产物 | 工具 |
|---|---|---|---|
| 0 | 准备（装依赖、开 Blender/Tripo） | — | 人工 |
| 1 | 启动工具（`npm start` → `127.0.0.1:8766`） | 会话 | Node |
| 2 | 载入立绘，请求 8 张素材 | `images/` 8 张 | Codex 图像生成 |
| 3 | 确认 8 张素材 | 定稿素材 | **用户确认点** |
| 4 | 选头部/身体 3D 候选（各 4 个） | `models/candidates/` | Tripo Smart Mesh |
| 5 | 调整头身比例 | 比例定稿 | 应用 UI |
| 6 | 检查动作（走路） | 动作确认 | `elyth_base_walk_v1.vrma` |
| 7 | 检查完成的 VRM | `exports/avatar.vrm` | Blender + VRM Add-on |

### 4.2 完整数据流

```text
立绘 PNG/JPEG/WebP
   ↓ [S2 character-parts-images]  Codex 生成 8 张（头含发 ×4 + 体 ×4 方向）
素材 8 张 ──────→ 用户确认 ★
   ↓ [S5 tripo-agent-workflow]  浏览器自动化驱动 Tripo Studio
Tripo：图像 → 3D 候选（头 4 + 体 4，P2.0 / 25,000 四角面）
   ↓ 用户选候选 ★
   ↓ Tripo：细分（Smart Segmentation）、Smart UV、4K 重贴图 ×5 贴图组
   ↓ [B1 production.py assemble]  组装 + 从组装起即套 MToon
work/character.blend
   ↓ [B4 extract-donor.py / B3 transfer-weights.py]  从 donor body 做权重转移
   ↓ [S8 avatar-spring-setup]  揺れもの计划写进 blend（键 charakit_spring_plan_v1）
   ↓ [B7 export-rig.py]  Humanoid 绑定
   ↓ [B2 mtoon-export.py]  全网格 MToon
exports/avatar.vrm + exports/avatar.blend
   ↓ [B10 verify-springs.mjs]  90 帧物理 ON/OFF 自动验证
```

三个标星处是**用户决策点**，对应 `AGENTS.md` 明列的 5 项用户专属决定：**元絵登録、画像確認、候補決定、頭身調整、動作確認**。其余（分割、分类、导出、登记、保存）全都是 agent 的活。

### 4.3 最值得学的设计：Agent 协作机制

这是用户点名「最有价值」的部分，拆开看有 5 个可分离的设计：

**(1) 根 `AGENTS.md` 作为唯一共通知识入口。**
90 行，集中写明：必要环境、App 委托的接法、制作工程与确认地点、Skills 选择、保存与恢复、失败时的处理。`docs/project-AGENTS.md`（放在每个制作文件夹里的 11 行入口）**明确声明不复制工程说明**：

> 「制作の共通知識は、開始依頼に示された**キットのルートAGENTS.md**を参照してください。… このファイルに工程説明を複製しません。」

值得抄的点：**共通知识单一来源，项目级文件只做指针。** 这直接消灭了"文档多处描述、改一处漏一处"的经典问题。

**(2) App ↔ agent 的显式交接协议。**
不是"agent 猜应用状态"，而是应用把一段可粘贴的请求文交给用户，请求文里含 `node <kit>/scripts/agent-session.mjs begin <URL> <REQUEST_ID>`。agent 必须**先跑这条命令**：

- `agent-session.mjs` 向本机应用 POST，**轮询最长 35 秒**等 `status === 'running'`；
- 只有返回 `saved: true` 才允许继续；
- 输出 `{saved, task, project, directory, instructions, appRoot}`——`project` 是正本，`directory` 是制作文件夹；
- 只接受 `http:` + `127.0.0.1`/`localhost` 地址（硬校验，防 SSRF）。

对应的工程侧结构固定（`AGENTS.md`）：`projects/<id>/project.charakit` 为正本；`directory` 下分 `images/`、`models/candidates/`、`models/segmented/`、`models/parts/`、`textures/`、`work/`、`exports/`。

**(3) 工序与 Skills 一一对应，确认点写在表里。**
`AGENTS.md` 用一张「制作工程と確認地点」表把每道工序的 agent 范围与用户检查点并列，再用一张「工程別Skills」表把工序映射到 9 个 Skill。**agent 不需要理解整个流程——它只需要读表确定当前工序该加载哪个 Skill。**

**(4) 明确禁止 agent 越权。**
`AGENTS.md` 里有几条罕见的硬约束，值得逐条抄：

> 「**表情生成、瞳分離、LookAt設定、眼内部の再構築を勝手に追加しません**」

> 「自動検査は技術的な妥当性を見ますが、**見た目の良し悪しは採点しません**」（外观好坏由用户判断）

> 「日付別・v2・final2のキットを量産しません」（禁止批量产出 `-final2` 式版本）

还有一条安全相关的：

> 开始命令被执行策略拒绝时——「**不重复被拒命令、不改写 kit 脚本以规避限制、不把聊天里的「許可します」当作已执行**」

**(5) Skill 的指令写法：frontmatter + references 分层。**
`SKILL.md` 只放主流程，细节推到 `references/`（如 `part-contract.md` 放"头含发/体 × 4 方向"的契约与左右约定表，`prompts.md` 放可直接用的英文生成提示词模板）。**主文件读一遍能开工，细节按需取。** 这是 Skill 能同时做到"不啰嗦"和"够精确"的关键。

### 4.4 另一个值得学的：确定性脚本包住不确定的 AI

工作流里 AI（Codex/图像生成/Tripo）负责**含模糊性的环节**（画素材、生成网格、判定分类）；一旦进入可确定的部分立刻切成**普通脚本**（Blender Python、Node 校验）。典型是：

- Tripo 返回结果后，用 `import-bones.mjs`、`project-write.mjs` 这类确定性脚本落盘，不靠 agent 手动写文件；
- 完成前必须过 `verify-springs.mjs` 的 90 帧物理对比，**不是靠 agent 说"我做完了"**。

值得抄的原则：**agent 的自由度只开在必须开的地方，验收一律交给可重复的脚本。**

### 4.5 Tripo 调用方式与成本

**关键架构事实：Charakuru 完全不使用 Tripo API。**

证据：`skills/tripo-studio-download/SKILL.md:8` 明说「追加のダウンロード用拡張・**Tripo APIキー**・DCC Bridgeは不要です」；`AGENTS.md:15` 写明「認証情報を表示・収集せず、正規のログインを使います」。

它走的是**浏览器自动化**：用 Codex 的 browser control 打开用户自己的 Chromium，用**用户自己已登录的 Tripo 账号**操作 Tripo Studio 网页。`docs/browser-use.md`（仅日文）定了 5 条选择/复用规则：

1. 复用用户已有的浏览器/窗口/配置；
2. 优先用户指定的标签页；
3. 用已登录 Tripo 的那个标签页；
4. 在既有浏览器里**加**标签页，而不是开新浏览器；
5. 只有确认没有浏览器在跑，才新开一个；
6. **绝不自动回退到 Codex 内置浏览器或独立自动化配置**。

**这个设计的取舍很清楚：**

| 维度 | 浏览器自动化（本项目的做法） | 若改用 Tripo API |
|---|---|---|
| 密钥 | 不需要，不接触凭证 | 需要管理 API key |
| 账号 | 用用户自己的登录 | 需计费账号 |
| 断点 | 依赖网页 DOM，Tripo 改版即可能失效 | 接口稳定 |
| 自动化能力 | **能用 Studio 的全部交互功能**（含界面内操作） | 受 API 能力边界限制 |
| 归因 | 归功于用户账号的操作 | 归 API 调用 |

**成本（Tripo 侧，按 credits 计，1 credit = $0.01）：**

| 操作 | 消耗 |
|---|---|
| 图生 3D（无贴图 / 标准贴图） | 20 / 30 |
| 多视图生 3D | 20 / 30 |
| 文生 3D | 10 / 20 |
| HD 贴图 / 108K Ultra / HD 几何 | +10 / +20 / +20 |
| **四角面网格（Quad Mesh）** | **+5** |
| Smart Low-poly | +10 |
| Generate Parts | +20 |
| Retopology（v2.0 Smart） | 30 |
| **Smart Segmentation（从模型 / 从图像）** | **55 / 85** |
| Advanced Convert | 10 |
| Rig Check | 免费 |
| **自动绑定（Auto Rig）** | **25** |
| 动作重定向 | 10 / 个动作 |

订阅档：Free 200 credits/月、Pro $20/3,000、Max $90/25,000、Team $55/座/90,000。

**一轮完整角色的量级估算：** 头 4 候选 + 体 4 候选（8 次 25k 四角面生成，若含贴图约 8×35 ≈ 280）+ 分割（55）+ 重贴图（数个部位）+ 绑定（25）+ 动作（10）——**单角色大致落在 400–600 credits，即 $4–6 的云端成本量级**（不含订阅差额、不含重做）。这个数字必须标注为估算，因为本项目没有把自己的消耗记账落盘，且候选数可调。

**必须提醒的一点：** ComfyUI 合作节点使用**另一套 credit 池**，不能与上面的数字混用。

**无法确认的：** 网上按 "P2.0" 档位名称给出的价格**未能核实**。上表是按操作类型列的价格，不是我按档位名反推的。

## 5. 对照 AIRI 的差距分析

**AIRI 现状全部在 `aimy-app/` 实测，来源见每条证据列。**

### 5.1 AIRI 的情绪/表情系统现状（本报告的关键背景）

先把 AIRI 的实际能力摆清楚，因为 Charakuru 的产物要怎么落地取决于它：

| 能力 | AIRI 现状 | 证据 |
|---|---|---|
| 情绪词表 | **9 个标签**：`happy / sad / angry / think / surprised / awkward / question / curious / neutral` | `packages/stage-ui/src/constants/emotions.ts:1-11` |
| 情绪入口 | LLM 在回复文本里内联输出 act token（`|<ACT {"emotion":{"name":"surprised","intensity":1},"motion":"shrug"}|>`），前端解析后派发 | `packages/stage-ui/src/composables/queues.ts:24`（`parseActEmotion`）；提示词在 `packages/i18n/src/locales/en/base.yaml:27-56` |
| 情绪强度 | **有**，`EmotionPayload.intensity` 为 0–1 浮点 | `emotions.ts:61` |
| 派发 | 单一队列 fan-out 到 `vrm / live2d / spine / tachie / mmd` 五种渲染器 | `packages/stage-ui/src/components/scenes/Stage.vue:265-292` |
| 情绪持久化 | **无**。没有情绪状态机、心情向量、好感度累积，任何 DB 里都没有情绪键 | 全仓检索无 emotion 持久化 |
| VRM 表情映射 | **最完整的一张表**：7 个状态（含 enum 之外的 `relaxed`）→ VRM expression 权重 + blendDuration。刻意用 0.7–0.8 而非 1.0（"too raw / smiles too much"，issue #590） | `packages/stage-ui-three/src/composables/vrm/expression.ts:53-105` |
| VRM 口型 | VISEME = `aa/ee/ih/oh/ou`；说话时情绪让位给口型 | `.../vrm/expression.ts:119`、`lip-sync.ts` |
| Live2D 表情映射 | **最弱的一环**：情绪映射到**动作组名**（`EmotionHappyMotionName = 'Happy'`）而非表情；同文件的 `EMOTION_VRMExpressionName_value` 有 4 个是 `undefined` | `packages/stage-ui-live2d/src/constants/emotions.ts:15-58` |
| Live2D 自有表情系统 | **存在但不由情绪驱动**：解析 `exp3.json`，参数级 blend，且**可作为 LLM 工具调用**（开关 `none/all/custom`） | `packages/stage-ui-live2d/src/stores/expression-store.ts`、`tools/expression-tools.ts`、`packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.vue:144` |
| MMD morph 映射 | `EMOTION_MORPHS` + 日英名回退（`笑い/にこり/smile`） | `packages/stage-ui-mmd/src/constants/morphs.ts:37,91` |
| Spine 映射 | 情绪 → 动画轨道名，双轨（idle 持久 / emotion 叠加） | `packages/stage-ui-spine/src/constants/emotions.ts:56`、`composables/spine/animation-manager.ts` |
| Tachie 映射 | 情绪 → **整张静态图片文件名**；无口型 | `packages/stage-ui-tachie/src/constants/emotions.ts:7`、该包 README |
| 自动眨眼 | 每渲染器各写一遍：VRM `useBlink`（1–6s，0.2s 正弦）、MMD 同款（自述"identical timing model"）、Live2D 是设置项 `blinkModeOptions` | `packages/stage-ui-three/src/composables/vrm/animation.ts`、`stage-ui-mmd/src/composables/mmd/blink.ts` |
| 视线跟随 | VRM 用真 Raycaster（`'camera' \| 'mouse' \| 'none'`）；MMD 骨骼驱动 + 空闲扫视（400–2200ms） | `packages/stage-ui-three/src/composables/eye-tracking.ts`、`stage-ui-mmd/src/composables/mmd/gaze.ts` |
| 空闲动作 | Live2D idle 动作组检测、Spine 双轨、MMD `idleMotionName`、VRM `.vrma` | 各包对应文件 |
| VRM 待机动画 | **支持 `.vrma`**：`loadVRMAnimation()` + `clipFromVRMAnimation()`，随包一个 `idle_loop.vrma`；但**没有用户可选动画的界面** | `packages/stage-ui-three/src/composables/vrm/animation.ts:18,37`、`components/Model/VRMModel.vue:823` |
| VRM 弹簧骨 | **已支持**：`springBoneManager.update(delta)` 每帧驱动，且会过滤 `VRMC_springBone_collider` 网格 | `packages/stage-ui-three/src/components/Model/VRMModel.vue:519-520,639`、`composables/vrm/core.ts:71,91` |
| MToon 材质 | **已支持**：`AiriMToonMaterialLoaderPlugin` 扩展 `MToonMaterialLoaderPlugin`，处理描边宽度模式 | `packages/stage-ui-three/src/composables/vrm/loader.ts:2-58` |
| 一次性情绪模型 | **无**。`docs/content/en/blog/DevLog-2025.04.14/index.md:183-225` 描述过情绪记忆模拟（遗忘曲线、情绪影响重排），**纯设计稿，代码零实现** | 同上 |
| **从图像造模型 / Blender / Tripo / 导出 GLB / 绑定** | **完全不存在。** 全仓无 blender/tripo/meshy 命中；无 `GLTFExporter`；所有格式**只能导入** | `DisplayModelFormat` 枚举（`packages/stage-ui/src/stores/display-models.ts:8`）只有 `live2d-zip / live2d-directory / vrm / spine-zip / tachie-zip / pmx-zip / pmx-directory / pmd` |

### 5.2 差距分析表

| 能力 | AIRI 现状 | 该项目做法 | Aimy 是否缺 | 差距有多大 |
|---|---|---|---|---|
| **从一张立绘造出 VRM** | **完全没有**。只能导入成品 | 完整 7 步工序 + 9 Skills + 21 脚本 | **缺** | **巨大，且是净增能力**。这是本项目唯一无可替代的价值点 |
| **VRM 成品能否被 AIRI 直接用** | **能**。导入 UI 接受 `.vrm`（`model-selector.vue:134,204`），MToon 与 SpringBone 都已支持 | 导出 `exports/avatar.vrm`（VRM 1.0） | **不缺** | **零差距。** 这是整个评估里最好的消息：Charakuru 的产物无需转换即可进入 Aimy |
| 表情（表情形变） | VRM 表齐全（7 状态） | **标准流程不生成表情**：`README.md` 明写「New characters have a neutral face with a fixed gaze. **Expressions and eye movement are not included.**」；`AGENTS.md` 明令 agent 不得擅自加表情生成 | **缺** | **中到大。** AIRI 有映射表，但没有可被驱动的形变目标——映射表的 key 在模型上不存在。须在建模阶段补做 blendshape 或后处理注入 |
| 视线（LookAt） | VRM/MMD 有视线驱动 | **不生成**，且禁止 agent 擅自做 | **缺** | **中。** AIRI 驱动逻辑齐全，缺的是模型侧的 eye bone 与瞳分离 |
| 自动眨眼 | VRM/MMD/Live2D 全有 | 依赖模型自身的 blink 形变 | **缺** | **小到中。** AIRI `useBlink` 逻辑完备，但同样要求模型有 blink blendshape；Charakuru 默认产物没有 |
| 口型（口型同步） | VRM 有 `aa/ee/ih/oh/ou` | **不生成**对应形变 | **缺** | **中。** 同上：驱动侧齐全，模型侧缺目标 |
| 揺れもの（头发/裙摆物理） | VRM 有 `springBoneManager` | **做得比 AIRI 更深**：`avatar-spring-setup` 10,618 B 的完整方法论 + `verify-springs.mjs` 90 帧自动验证 | 不直接缺，但**验证方法缺** | **小（能力）／大（方法论）。** AIRI 能跑弹簧骨，但没有"验证成品 VRM 的物理是否真的生效"的手段 |
| 待机动作 | 有 `.vrma` 支持 + 随包 `idle_loop.vrma`，**无用户选择界面** | 提供 `elyth_base_walk_v1.vrma` 走路动作 | **无缺口，反而有可借鉴** | **小。** Charakuru 的动作文件可用，但更重要的是它证明了「给用户换动作」这件事的形态 |
| 建模工具链 / Blender 集成 | **零** | 21 个脚本，Blender 当可靠 CLI 用 | **缺** | **大。** 但注意：Aimy 一期不需要这个能力，见 §6 |
| agent 协作方法论 | AIRI 有真实的插件系统（`extension.airi.json` Manifest v2）与 `.claude/skills/`（32 个，**面向开发者的工具**，不是给角色用的） | 9 个 Skill + `AGENTS.md` + 会话交接协议 | **不直接缺，但形态可借鉴** | **中。** AIRI 的 Skills 是给写代码用；Charakuru 的 Skills 是给**做内容**用。后者是一种 Aimy 尚无的组织方式 |
| 单文件工程格式 | 无对应物（AIRI 用 IndexedDB + localforage） | `project.charakit` 单 ZIP 正本 | 不缺 | **小。** 思路可借鉴，但不是必须 |
| 从立绘做 2D 立绘（Live2D/Tachie） | **可导入** Live2D zip / tachie zip，同样无制作工具 | 也是 3D 路线，不管 2D | 缺（但非本项目范围） | 无关 |

### 5.3 §5.2 的核心矛盾（必须写清楚）

这一条决定了整份报告的裁决：

> **AIRI 的情绪系统是一张"输出侧"完备、"输入侧"缺失的网。** 它有 9 个情绪标签、有到 VRM 的完整权重映射表、有口型 viseme、有眨眼、有视线、有弹簧骨——但**这一切都要求模型本身携带对应的 blendshape 与骨骼**。AIRI 从造不出模型，也不检查导入的模型有没有这些目标。

而 Charakuru 恰好是**唯一能造出模型的那一环**，但它的标准流程**明确不生成表情、不生成视线、不分离瞳孔**（`README.md` 的限制声明 + `AGENTS.md` 的明令禁止）。

所以两者拼在一起，**中间缺一块**：Charakuru 出的是"无表情的干净 VRM"，AIRI 需要的是"带 blendshape 的 VRM"。这块缺口就是 Aimy 若走这条路必须自己补的工程量。

### 5.4 与 Live2D 路线的对比

用户问：VRM 3D 建模 vs Live2D 2D 立绘，哪个更适合桌面陪伴？AIRI 两套都支持。

| 维度 | VRM（3D） | Live2D（2D 立绘） | 对桌面陪伴的含义 |
|---|---|---|---|
| AIRI 情绪映射完整度 | **强**：7 状态的权重组 | **弱**：映射到动作组名而非表情，4/9 为 `undefined` | Live2D 在 AIRI 里反而没用上它最擅长的表情参数；但 Live2D **另有**一套非情绪驱动的 exp3 参数系统且**可作为 LLM 工具调用**，实际表现未必差 |
| 表情资产门槛 | 需要建模阶段做 blendshape | 需要画师分离部件 + 参数绑定 | VRM 的可自动化程度高，Live2D 强依赖美术 |
| 从一张立绘的可得性 | **Charakuru 这条路可行**（AI 生成） | 无开源等价物，靠 Live2D Cubism 手工绑定，成本高 | **VRM 路线在"无画师"前提下唯一走得通** |
| 表现力 | 全身可动、可换视角、物理更自然 | 单方向、角度受限，但**脸的精细度高**、原画还原度高 | 桌面陪伴多为正面小尺寸，"精细的脸"未必比"能转身的身体"更重要 |
| 性能 | Three.js 全 3D 场景，重 | 2D 贴图，**轻** | 桌面常驻应用对功耗敏感，Live2D 占优。AIRI 的 `springBoneMs` 等 trace 项说明它自己也在意这个 |
| 物理 | VRM SpringBone（AIRI 已支持） | 组件物理 | 打平 |
| 口型 | viseme `aa/ee/ih/oh/ou` | 参数 | 打平 |
| 授权风险 | Charakuru 产物归己（§6），可分发 | 取决画师与 Live2D 软件授权 | **VRM 这条路授权更干净** |
| 与角色亲密感 | 可转身、可摆手、可走 | 更"像立绘"，更像 VTuber | 主观，但**桌面常驻**场景下 3D 的体积感与"她真的在我桌上"更契合 |

**结论（明确表态）：就 Aimy「角色永久在桌面上、要像活着」这个产品定义而言，VRM 路线更匹配，且是当前唯一可行的路线**——因为 Aimy 没有画师，且 Live2D 无对应的自动制作工具。

**但必须同时说明三个保留：**

1. **这不是说 Live2D 没用。** AIRI 里 Live2D 的整体成熟度高于 VRM（exp3 参数系统 + LLM 可调用工具 + 系统音频口型），只是它的情绪映射表不如 VRM 完整。两套都留着是对的。
2. **Live2D 的性能优势在桌面常驻场景是真实优点**，VRM 常驻的功耗需要实测。AIRI 的 trace 机制（`packages/stage-ui-three/src/trace/types.ts`）说明上游自己也在盯这个。
3. **Charakuru 路线的前提是接受"手工补表情"这段工程**，否则做出来的角色在 Aimy 里会是一张不会笑的脸——恰恰违背产品定义。

## 6. 复用裁决

| 能力 | 裁决 | 理由 | 落地方式 | 成本 | 优先级 |
|---|---|---|---|---|---|
| **把 Charakuru 当作做 Aimy 自己角色的工具（本机用）** | **直接复用** | §2 (a) 允许纯个人本机使用；§6 明确产出的 VRM 归己、可再分发 | 本机跑工具链做出 `avatar.vrm`，把 VRM 文件（**不含任何 kit 代码与素材**）放进 Aimy。**绝不把 kit 代码、Skills、donor body 带进仓库** | 时间：一轮制作数小时到数天；云端 credits 约 $4–6 量级/角色（估算） | **中高**——这是"要有 Aimy 自己的角色"唯一的可行路径 |
| **Skill 组织方式（`AGENTS.md` 单一入口 + 工程別 Skills 表 + references 分层 + 「不复制工程说明」原则）** | **借鉴设计** | 本项目最有价值的设计，且是**方法论层面的**，借鉴不受 §4 分发限制（不复制文本，只学结构） | 若 Aimy 未来要做"角色内容制作"或"给 agent 的能力包"，照这个结构组织；1 个根入口 + N 个 Skill + references 分层 | 低 | **高**——这是本报告认为最值得抄的一件事 |
| **App ↔ agent 显式会话交接协议** | **借鉴设计** | 解决了"agent 不知道应用状态"的通用问题：显式 `begin URL REQUEST_ID`、`saved: true` 前置、localhost 硬校验、固定输出契约 | 若 Aimy 要接桌面 agent 协作，设计对应的交接协议；**不复制代码** | 中 | 中 |
| **「确定性脚本包住 AI」的边界划分** | **借鉴设计** | AI 只管模糊环节，落盘与验收一律交给可重复脚本；完成必须过自动检查而非 agent 自述 | 直接作为 Aimy 任何 agent 化功能的工程原则 | 低 | **高** |
| **Blender CLI 三件套**（`--background --factory-startup --disable-autoexec --python-exit-code 1`） | **借鉴设计** | 把 Blender 当可靠 CLI 的必备参数，逐条都有理由 | 将来若 Aimy 接 Blender 时直接照用 | 极低 | 低（但零成本） |
| **`verify-springs.mjs` 的物理验证方法**（同部位物理 ON/OFF 对比 90 帧顶点位置） | **借鉴设计** | AIRI 能跑弹簧骨但不会验证成品是否真的生效。这个思路可独立于 Charakuru 使用 | 若 Aimy 需要模型质量检查，照这个思路写自己的验证 | 中 | 中 |
| **`project.charakit` 单文件工程格式** | **弃用（本轮）** | AIRI 用 IndexedDB + localforage，已有自己的持久化契约（`airi-local` / `airi-sync-queue`，R2 明确不改）。引入第二套工程格式是净负担 | 不引入 | — | — |
| **把 Charakuru 代码/Skills 打包进 Aimy** | **弃用** | §4 明文禁止 "bundled applications"；且许可证明确商业授权也不自动带来再分发权 | **不做。** 若未来要做，先取 Licensor 书面许可 | — | — |
| **donor body（`assets/donor/weighted-body.blend`）进 Aimy** | **弃用** | §8 明文禁止带出本机、禁止上传、禁止单独分发，商业协议也不授予 | 只留本机做体重转移 | — | — |
| **把 Charakuru 做成 Aimy 的在线建模服务** | **弃用** | §2 明确「把 kit 代码提供给客户，包括交付应用到他们浏览器，属于再分发」 | 不做 | — | — |
| **Tripo API 集成进 Aimy** | **弃用（本轮）** | Charakuru 自己都不用 API（走浏览器自动化）。Aimy 一期边界明确不含"自建角色"，且这属于外部付费服务 | 不做 | — | — |
| **Live2D 路线** | **不使用（但保留 AIRI 现有支持）** | 无自动制作工具，Aimy 无画师；但 AIRI 里 Live2D 成熟度高于 VRM，不该关掉 | 保持现状 | — | — |

**裁决总表一句话：唯一要动手的是「本机用这个工具做 Aimy 的角色 VRM」；其余全部是方法论借鉴或明确弃用。**

## 7. 风险与坑

| # | 风险 | 说明 | 证据 |
|---|---|---|---|
| R1 | **许可证是最大的坑，且不在技术侧** | 工具看起来"免费开放"，实际是 source-available，禁止再分发。最容易出事的动作是"顺手把 kit 复制进 repo"或"打包进安装包" | `LICENSE` §4；详见 §2 |
| R2 | **donor body 与示例角色不是你的** | §8 明令：不得抽出单独使用、不得上传外部服务、不得单独再分发，**商业与非商业都禁**，且商业协议不给这些权利 | `LICENSE` §8 |
| R3 | **产物表情缺失，与 Aimy 产品定义直接冲突** | 标准流程出"neutral face with a fixed gaze, expressions and eye movement are not included"。Aimy 要的是"活着"的角色 | `README.md` 限制章节 |
| R4 | **agent 被明令禁止自作主张补表情** | `AGENTS.md`：「表情生成、瞳分離、LookAt設定、眼内部の再構築を勝手に追加しません」——即**不能指望 agent 顺手帮你补上 R3**，必须由人明确要求 | `AGENTS.md` |
| R5 | **依赖浏览器自动化，Tripo 改版即可能失效** | 不用 API，靠网页交互。`docs/browser-use.md` 的规则说明它自己也知道这个脆弱性 | `skills/tripo-studio-download/SKILL.md:8` |
| R6 | **外部付费服务，成本会漂移** | Tripo 是收费云端，credits 价格与档位可能变；本报告的估算基于当前表，且 **"P2.0" 档位命名价格未能核实** | §4.5 |
| R7 | **运行环境重** | 需 Node 22+、Chromium、Codex、Tripo 账号、Blender 5.2 + VRM Add-on + Blender MCP。这不是"装个依赖"能解决的 | `README.md`、`AGENTS.md` |
| R8 | **仓库里没有应用，容易拆错对象** | 只看 `Charakuru-main/` 会得出"这就是个文档项目"的错误结论。必须取发行 ZIP | 目录清点对比 |
| R9 | **文档与发行包版本不一致** | README 徽章 v1.0.2、README 说"七个 Skills"，实际发行包 v1.0.4、9 个 Skills。**以发行包与 `AGENTS.md` 为准** | `package.json` vs `README.md` |
| R10 | **必须经 Blender，不能纯云端** | 权重转移、MToon、弹簧骨都在 Blender 侧。想跳过 Blender 则此路不通 | `scripts/*.py` |
| R11 | **「见た目の良し悪し」没人替你判断** | 自动化只验技术有效性，外观由用户定。意味着需要投入人工审阅时间，不是全自动 | `AGENTS.md` |
| R12 | **不要把 Tripo 的 ComfyUI 节点计费与 Studio 计费混用** | 两套 credit 池 | §4.5 |

## 8. 一句话结论

**最值得抄的 3 件事：**

1. **`AGENTS.md` 的"单一共通知识源 + 项目级文件只做指针"结构，加上「工程別Skills」映射表与 references 分层。** 这是整个项目最有价值的设计：agent 不需要理解全流程，只需读表确定"当前工序该加载哪个 Skill"，而 Skill 主文件读一遍能开工、细节按需取。用户点名要看的就是这个，它确实是可独立于 Charakuru 使用的方法论。
2. **「确定性脚本包住不确定的 AI」的边界划分。** AI 只负责含模糊性的环节（画素材、生成网格、判定分类），一旦进入可确定的部分立刻切普通脚本；完成必须过 `verify-springs.mjs` 这类可重复的自动检查，**而不是 agent 自述完成**。这条原则直接适用于 Aimy 未来任何 agent 化功能。
3. **App ↔ agent 的显式会话交接协议。** `begin URL REQUEST_ID` + `saved: true` 前置 + `127.0.0.1` 硬校验 + 固定输出契约（`project` 为正本、`directory` 为工作目录），把"agent 猜应用状态"变成"应用把状态明确交付给 agent"。设计干净，可照搬思路。

**最不值得抄的 3 件事：**

1. **不要复制它的代码或 Skills。** 许可证明文禁止再分发，包括"打包进应用"。工具代码、Skills、donor body 都只能留在本机。**做出来的 VRM 归你，工具不归你**——这条线要划得非常清楚。
2. **不要指望它给你一个有表情的角色。** README 明说标准流程是中性脸 + 固定视线、不含表情与眼动，`AGENTS.md` 还明令 agent 不得擅自补做。而 AIRI 的 9 情绪映射表恰恰需要模型携带对应 blendshape——**中间这块缺口是 Aimy 走这条路必须自己补的工程量**，不能算进"免费拿到角色"的成本里。
3. **不要把它做成 Aimy 的在线建模功能。** §2 明确"把应用交付到客户浏览器属于再分发"，§4 禁止 hosted app。这条路在拿到书面许可前是死的。同理，`project.charakit` 单文件格式也不必引入——Aimy 已有自己的持久化契约，第二套是净负担。
