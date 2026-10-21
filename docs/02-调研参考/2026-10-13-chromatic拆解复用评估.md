# chromatic：面向 Aimy 的拆解复用评估

- 产出日期：2026-10-13（Asia/Shanghai）。状态：调研记录，非选型、非接入、非开发任务。
- 产生原因：用户要求拆解 `/Users/mima1234/Documents/资料/拆解项目/chromatic-main/`，并在 `aimy-app/` 内核实 AIRI 是否已经依赖它。
- 来源：`chromatic-main`（49 文件，v1.1.4，MIT，Copyright 2025 Moeru AI）与 `/Users/mima1234/Documents/aimy/aimy-app/`（AIRI v0.12.0-beta.5 副本，R1 落库提交 `bf41903`）。
- 用途与风险：**结论是「已在上游合并」，因此本报告不产出复用建议，只产出事实核对与边界说明。** 不得据此认定 Aimy 需要新增、升级或替换调色方案。
- 替代关系：本报告取代 [五项目复用讨论汇总](2026-10-11-五项目复用讨论汇总.md) 中 Chromatic 一行的浅查结论，把「已有调色包」细化为可指到行的依赖证据。

## 0. 一句话结论

**chromatic 是 AIRI 自己的第一方依赖，AIRI 已在 v1.1.4 原样使用，无需拆解、无需复制、无需任何复用动作——本项到此结束。**

`chromatic-main` 版本号 1.1.4（`packages/chromatic/package.json:4`、`packages/preset/package.json:4`、根 `package.json:4` 三处一致），与 `aimy-app/node_modules/.pnpm/` 中实际安装的 `@proj-airi+chromatic@1.1.4`、`@proj-airi+unocss-preset-chromatic@1.1.4` **完全同版**。也就是说：用户交给我拆的这份源码，正是 Aimy 主工程当前正在跑的那份代码。

## 1. 项目速览

| 项 | 内容 | 证据 |
|---|---|---|
| 项目名 | chromatic | `README.md` |
| 归属 | **Project AIRI / Moeru AI 自研**，非第三方独立项目 | `packages/chromatic/package.json` 的 `author` 为 `Project AIRI Team <airi@moeru.ai>`、`repository` 为 `github.com/proj-airi/chromatic` |
| 定位 | AIRI 全系项目在用的 OKLCH 动态调色板体系 | `README.md`：「Readability enhanced, clean, nice looking colors palette we used across our Project AIRI projects」 |
| 自我定位 | radix-ui colors 的替代品 | `README.md`：`a alternative of https://www.radix-ui.com/colors/custom` |
| 版本 | 1.1.4 | 三处 `package.json` 一致 |
| 许可证 | **MIT**，Copyright 2025 Moeru AI | `LICENSE.md`；两个子包 `license: "MIT"` |
| 主要贡献者 | Makito (sumimakito)、Lemon Neko、junkwarrior87、Neko (nekomeowww) | `packages/preset/package.json` 的 `contributors` |
| 交付形态 | 两个 npm 包，不发布应用 | `@proj-airi/chromatic`、`@proj-airi/unocss-preset-chromatic` |
| 包结构 | `packages/chromatic`（运行时库）、`packages/preset`（UnoCSS 预设）、`playground`（演示站） | `pnpm-workspace.yaml` 的 `packages: apps/**, packages/**, playground` |
| 唯一运行时依赖 | `culori`（色彩空间换算） | `packages/chromatic/package.json` 的 `dependencies.culori: catalog:` |
| 构建 | `tsdown`，输出 `dist/index.mjs` + `dist/index.d.mts` | 各包 `package.json` 的 `exports` / `scripts.build` |
| 规模 | 源码本体约 640 行（`chromatic/src/index.ts` 399 行 + `preset/src/shared.ts` 218 行 + 两个入口 7/13 行） | 逐文件行数 |
| 与 AIRI 的关系 | **AIRI 的直接依赖，非候选、非参考** | 见下节 |

### 1.1 为什么这份源码是「AIRI 的一部分」而不是「另一个项目」

判断依据是包的归属声明，不是我的推测：

- `packages/chromatic/package.json` 与 `packages/preset/package.json` 的 `author.url` 均为 `https://github.com/proj-airi`；
- `README.md` 明说这套配色是「we used across our Project AIRI projects」；
- AIRI 自己的开发者日志也把它当自家产物记录：`aimy-app/docs/content/{en,zh-Hans,ja,ko}/blog/DevLog-2025.08.05/index.md` 把这两个包署名给 `github.com/proj-airi/chromatic` 的 @sumimakito。

所以正确的心智模型是：**chromatic 是 AIRI 的一个外置子仓库（sibling repo），不是 AIRI 之外的能力来源。** 用户简报里把它当「参考项目」并列，实际它在结构上更像 AIRI 的一个包，只是放在另一个仓库里以便复用。

## 2. 完整功能清单

| 编号 | 功能 | 做什么 | 实现方式 | 核心文件 | 成熟度 |
|---|---|---|---|---|---|
| C1 | OKLCH 基色调 → 完整色阶 | 给一个 baseHue，生成 50–950 共 11 档色阶 | `symbolicShadeConfig` 为每档指定 `chromaMultiplier` / `lightness` / `mixWithWhite`，再经 culori 转 OKLCH | `packages/chromatic/src/index.ts:45`、`:216` | 稳定，有 `index.test.ts` |
| C2 | 色度随色相自动补偿 | 修正不同色相在同等 chroma 下的观感差 | `baseChromaByHue(h) = 0.18 + cos(h*π/180) * 0.04` | `packages/chromatic/src/index.ts:92` | 稳定 |
| C3 | 语义色方案 | 把 `{primary: 0, complementary: 180}` 这类相对色相偏移展开成一组调色板 | `chromaticFrom()` 返回 `DynamicTheme`，含 `animateHue` / `setHue` / `seasonal.{spring,summer,autumn,winter}` | `packages/chromatic/src/index.ts:159`、`:311`（`themeFrom`） | 稳定，但见 §6 风险 R1 |
| C4 | 调色板查询 API | 按 shade 取色、取反色、加 alpha、彩色混合 | `ChromaticPalette.shadeBy(500)`、`.withAlpha()`、`mixColors()` | `packages/chromatic/src/index.ts:279`、`:102`（`time-series-chart.vue` 的实际用法） | 稳定 |
| C5 | UnoCSS 预设（变量模式） | 生成以 CSS 变量为底的原子类，改 `--chromatic-hue` 即可全站换色 | `createVarBasedColorShades()`，`VAR_HUE = '--chromatic-hue'`、`VAR_BRIGHTNESS = '--chromatic-bri'`、`VAR_SATURATION = '--chromatic-sat'` | `packages/preset/src/shared.ts:5-7`、`:110` | 稳定，AIRI 主用模式 |
| C6 | UnoCSS 预设（烘焙模式） | 把色值直接写死进原子类，换取 IDE 颜色预览 | `createBakedColorShades()` | `packages/preset/src/shared.ts:37` | 稳定 |
| C7 | IDE 环境自适应入口 | 在 VSCode 扩展宿主内自动切到烘焙模式以显示色块 | `index.node.ts` 检测 `VSCODE_ESM_ENTRYPOINT` 是否含 `extensionHostProcess` | `packages/preset/src/index.node.ts:8` | 稳定，小而巧 |
| C8 | 修饰符语法 | `<utility>-<color>-<shade>/<opacity>~<saturation>*<brightness>` 一行改饱和度与亮度 | `variantChromaticAdjustments`，默认前缀 `bg/text/border/ring/fill/stroke` | `packages/preset/src/shared.ts`（`createPresetChromatic`） | 稳定，AIRI 几乎未用（见 §4） |
| C9 | 类型导出 | `Color` / `Oklch` / `Shade` / `ColorShades` / `ColorScheme` / `DynamicTheme` | TS 类型 | `packages/chromatic/src/index.ts:5-69` | 稳定 |
| C10 | 演示 playground | 色相滑杆、三维色立体、类名目录 | Vue + UnoCSS 单页 | `playground/`（`src/App.vue`、`src/components/ColorThreeDVolume.vue`、`src/docs/class-catalog.ts`） | 可用，仅供人类看，不参与构建 |

## 3. 架构与工作流

chromatic 没有"工作流"，它是一条**编译期 + 运行期双层**的配色管线：

```text
编译期（构建时）
  uno.config.ts → presetChromatic({ baseHue: 220.44, colors: { primary: 0, complementary: 180 } })
                → createVarBasedColorShades() 生成 bg-primary-500 这类原子类
                → 类里引用 var(--chromatic-hue) / var(--chromatic-chroma-500) / var(--chromatic-bri)

运行期（浏览器/Electron 渲染进程）
  任意组件改 --chromatic-hue（或注入 chromaticHue）
                → 全站 primary/complementary 系列同时换色，无需重新构建
```

两个包的职责切得很干净：

| 包 | 角色 | 是否引入 AIRI 运行时 |
|---|---|---|
| `@proj-airi/chromatic` | 纯计算，输入色相输出色值/色阶对象 | 是（`stage-ui` 与 `docs` 引入） |
| `@proj-airi/unocss-preset-chromatic` | 只给 UnoCSS 用，产出 CSS | 否（只在 `uno.config.ts` 里活） |

设计上值得注意的一点：**默认走变量模式而不是烘焙模式**，因为动态换色是这套体系的核心卖点（AIRI 设置里有色相调节 UI）。烘焙模式被限制为"只在 IDE 里为了预览色块"的降级路径。

## 4. 对照 AIRI 的差距分析

**这一节是本报告的核心。结论：AIRI 已完整接入，不存在需要从 `chromatic-main` 取用的部分。**

### 4.1 依赖声明层

| 位置 | 内容 |
|---|---|
| `aimy-app/pnpm-workspace.yaml:223` | `'@proj-airi/chromatic': ^1.1.4`（catalog 固定版本） |
| `aimy-app/pnpm-workspace.yaml:227` | `'@proj-airi/unocss-preset-chromatic': ^1.1.4` |
| `aimy-app/package.json:64` | `"@proj-airi/unocss-preset-chromatic": "catalog:"` |
| `aimy-app/docs/package.json:22` | `"@proj-airi/chromatic": "catalog:"` |
| `aimy-app/packages/stage-ui/package.json:87` | `"@proj-airi/chromatic": "catalog:"` |
| `aimy-app/plugins/airi-plugin-game-chess/package.json:32` | `"@proj-airi/unocss-preset-chromatic": "catalog:"` |
| 磁盘实装 | `aimy-app/node_modules/.pnpm/@proj-airi+chromatic@1.1.4/`、`@proj-airi+unocss-preset-chromatic@1.1.4/` |

### 4.2 配置接入层

| 位置 | 内容 |
|---|---|
| `aimy-app/uno.config.ts:7` | `import { presetChromatic } from '@proj-airi/unocss-preset-chromatic'` |
| `aimy-app/uno.config.ts:155-162` | `presetChromatic({ baseHue: 220.44, colors: { primary: 0, complementary: 180 } })` |
| `aimy-app/docs/uno.config.ts:3,148` | 文档站同样接入 |
| `aimy-app/apps/component-calling/uno.config.ts:3,35` | 独立子应用同样接入 |

### 4.3 API 实际调用层（不是只装了没用）

| 位置 | 调用的 API | 用途 |
|---|---|---|
| `packages/stage-ui/src/constants/theme.ts:1` | `chromaticHueDefault = 220.44` | 默认色相常量，与 `uno.config.ts` 同值 |
| `packages/stage-ui/src/constants/inject.ts:3` | `InjectionKey<number> = Symbol('@proj-airi/chromatic-hue')` | 跨组件注入当前色相 |
| `packages/stage-ui/src/components/gadgets/time-series-chart.vue:2,4,73,86,102` | `import type { Oklch }`、`chromaticPaletteFrom()`、`shadeBy(500).withAlpha(0.1)` | **真实的运行时消费**：图表按当前主题色相生成同色系配色 |
| `docs/.vitepress/components/BlogPosts.vue:3,109,110` | `chromaticPaletteFrom(baseHue)`、`chromaticPaletteFrom((baseHue+30)%360)` | 博客卡片按色相自动配色 |
| `packages/stage-ui/stories/components/ThemeColorsHueControl.vue:2` | `VAR_HUE` | 主题色相调节控件直接写这个变量 |
| `packages/stage-ui/src/libs/color-from-element.ts`、`components/widgets/ColorPalette.vue` | 色相相关 | 见文件内引用 |

### 4.4 CSS 变量使用广度

全仓（排除 `node_modules` 与构建产物）**48 个文件**引用 chromatic，横跨：

- 设计系统：`packages/ui/src/fallback.css`、`packages/ui/src/components/form/range/range.vue`
- 布局与背景：`packages/stage-layouts/src/components/Backgrounds/default/{index,preview,part-animated-wave,pattern-cross}.vue`、`Layouts/HeaderLink.vue`
- 应用入口：`apps/stage-web/index.html`、`apps/stage-web/src/App.vue`、`apps/stage-pocket/src/App.vue`、`apps/stage-tamagotchi/src/renderer/App.vue`、`apps/ui-server-auth/src/App.vue`
- 启动与加载：`packages/ui-loading-screens/src/components/startup-screen.vue`
- 开发者工具：`packages/stage-ui/src/features/devtools/motion/live2d/components/workbench.vue:108`

### 4.5 逐能力差距表

| 能力 | AIRI 现状 | 该项目做法 | Aimy 是否缺 | 差距有多大 |
|---|---|---|---|---|
| C1 色阶生成 | **已用**：`uno.config.ts:155` 生成全站色阶 | 即本包 | 否 | 零差距 |
| C2 色度补偿 | **已用**：同上，默认参数路径 | 即本包 | 否 | 零差距 |
| C3 语义色方案 | **已用**：`colors: { primary: 0, complementary: 180 }` | 即本包 | 否 | 零差距 |
| C4 调色板查询 | **已用**：`time-series-chart.vue`、`BlogPosts.vue` 有真实调用 | 即本包 | 否 | 零差距 |
| C5 变量模式预设 | **已用**：这是 AIRI 的主用模式 | 即本包 | 否 | 零差距 |
| C6 烘焙模式 | **未直接用**，但 `index.node.ts` 的 IDE 自动切换逻辑随包生效 | 即本包 | 否 | 零差距，属于包内自动行为 |
| C7 IDE 预览自适应 | **随包生效**，无需 AIRI 侧配置 | 即本包 | 否 | 零差距 |
| C8 修饰符语法 | **未查见使用**（`~saturation` / `*brightness` 语法） | 即本包 | 否 | 有少量未用表面，但**无需引入**——能力已在依赖里，要用随时可用 |
| C9 类型导出 | **已用**：`Oklch` 被 `time-series-chart.vue` 导入 | 即本包 | 否 | 零差距 |
| C10 playground | 未纳入 AIRI（本该如此，那是演示站） | 即本包 | 否 | 无关 |

### 4.6 唯一的真实缺口：不是"缺 chromatic"，而是"没充分用"

`DynamicTheme` 提供的动态换色能力（`animateHue`、`setHue`、`seasonal.{spring,summer,autumn,winter}`）在 AIRI 里**没有产品界面入口**。AIRI 用的是 `stage-ui/stories/` 里的 `ThemeColorsHueControl.vue`（storybook 演示件），不是用户可见的设置页。

但必须说清楚：**这不是"从 chromatic 拿能力"的问题，chromatic 已经把能力给全了。** 这是 Aimy 自己的产品决策问题——要不要做一个"角色随季节/情绪换主题色"的设置项。真要改的话，代码侧只需给 `--chromatic-hue` 写值，无需碰 chromatic 源码或依赖版本。

此事在本报告内**不作为复用建议提出**，仅作为事实记录，因为它属于产品范围问题，不属于拆解复用范围。

## 5. 复用裁决

| 能力 | 裁决 | 理由 | 落地方式 | 成本 | 优先级 |
|---|---|---|---|---|---|
| C1–C5、C7、C9 全部配色能力 | **直接复用** | 已经是 `aimy-app/package.json` 与 `pnpm-workspace.yaml` 里的既有依赖，版本 1.1.4 与拆解对象完全一致，已接入 `uno.config.ts` 与多个应用 | **维持现状。不复制、不改版本、不迁移。** R2 品牌定制只换 baseHue 数值 | 0 | 不适用（已完成） |
| C6 烘焙模式 | 直接复用 | 随包存在，由 `index.node.ts` 自动按环境切换 | 无需动作 | 0 | 不适用 |
| C8 修饰符语法 | 直接复用（暂不用） | 能力已在依赖内，未来需要时直接用原子类即可 | 需要时直接写类名 | 0 | 低 |
| C10 playground | **弃用** | 演示站，非产品组成部分 | 不纳入 Aimy | — | — |
| DynamicTheme 季节/动画换色 | **弃用（本轮）** | 能力已具备，但缺的是产品入口，不是技术。属产品范围决策，不在拆解复用范围 | 若未来要「随季节换色」，写 `--chromatic-hue` 即可 | 极低 | 待产品决定 |

**关键裁决：没有一条是「借鉴设计」或需要写代码的。全部落在「已是依赖」或「弃用」两栏。**

## 6. 风险与坑

| # | 风险 | 说明 | 证据 |
|---|---|---|---|
| R1 | **误把 `chromatic-main` 当"要引入的第三方源码"** | 最容易被写错的地方。若有人在 Aimy 里"复制一份 chromatic 源码进来"，会产生与既有依赖重复的第二套实现，并错过 catalog 版本管理 | `aimy-app/pnpm-workspace.yaml:223,227` 已声明依赖 |
| R2 | **版本漂移** | AIRI 用 catalog `^1.1.4` 约束。若手动装 2.x 会与上游分叉；而 Aimy 的策略是「先不跟上游，但预留通道」 | 决定见 [三项产品行为与立项方法](../01-决策记录/2026-10-13-三项产品行为与立项方法.md) §2 |
| R3 | **baseHue 改动的连带影响** | `baseHue: 220.44` 在 `uno.config.ts:155` 与 `stage-ui/src/constants/theme.ts:1` 两处重复定义，改品牌色需同步两处，否则注入值与构建值不一致 | 两处对比 |
| R4 | **`--chromatic-*` 变量命名带 proj-airi 语义** | 变量名本身是 `--chromatic-hue`，与品牌无关，改品牌不影响；但 `packages/stage-ui/src/constants/inject.ts` 的 Symbol 是 `'@proj-airi/chromatic-hue'` | 该文件第 3 行 |
| R5 | **不要把 C10 playground 当成"界面参考"** | 它是配色调试台，与 Aimy 的设置页设计目标不同 | `playground/` 内容 |
| R6 | **许可误读** | chromatic 是 **MIT**，与 Charakuru 的 source-available 完全不同。不存在"打包进应用分发"的障碍 | `packages/*/package.json` 的 `license: "MIT"`、`LICENSE.md` |

## 7. 一句话结论

**最值得抄的 3 件事：**

1. **「外置子仓库 + 两个包」的拆分方式**——纯计算库与 UnoCSS 预设分开，运行时依赖与构建期依赖不混在一起（`packages/chromatic` vs `packages/preset`）。Aimy 将来若要把自己的某项能力抽成可复用包，可以照这个切法。
2. **CSS 变量优先、烘焙降级的环境自适应**——`index.node.ts` 检测 `VSCODE_ESM_ENTRYPOINT`，只在编辑器的扩展宿主里切到烘焙模式换 IDE 色块预览，产品运行时始终走变量模式。这是"为了开发者体验做妥协，但不污染产品行为"的干净范例。
3. **色度随色相补偿**——`baseChromaByHue` 用一行三角函数解决"不同色相同 chroma 观感不均"的问题，比 radix 那套手工调表更省。Aimy 若自建品牌色或做角色主题色，这行公式可直接照抄。

**最不值得抄的 3 件事：**

1. **不要复制这份源码**——它已经是 Aimy 主工程的依赖。复制等于给自己造第二套配色实现。
2. **不要把 playground 当产品界面蓝本**——那是调色调试台，不是给人用的设置页。
3. **不要因为"未用 C8 修饰符语法"就去补使用**——未用不等于缺，语法在依赖里躺着，需要时自然会出现，为了"用满能力"而加类名是反向优化。

**给 Aimy 的实际动作：无。** 本项不具备可执行项。若未来要做「角色主题随季节/情绪变化」，那是产品任务，技术侧只需写 `--chromatic-hue`，并且**必须先经产品决策**，不能由本报告自动推出。
