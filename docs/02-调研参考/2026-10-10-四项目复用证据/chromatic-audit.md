# Chromatic 在 AIRI 与 Aimy 中的用途和代码审查

> 文档状态：定向调研参考，绑定当时来源；不是选型决定或实施授权。
> 产物时期：2026-10-10，正文明确日期。精确初稿时间未记录时保持未知。
> 保留原因：保留项目chromatic-audit.md模块与缺陷可追踪证据。
> 上下文风险：不可把隔离函数复现/静态语法通过当完整服务、真实设备、模型、许可发行或AIRI集成通过；复现脚本是证据不是应用开发入口。
> 原位置：`digital-lover/docs/调研/2026-10-10-四项目复用证据/chromatic-audit.md`；归类整理：2026-10-11。
> 阅读入口：[文档中心](../../README.md)。历史正文中的“当前、唯一、已锁定、下一步”仅适用于原时期。

日期：2026-10-10。来源：`/Users/mima1234/Documents/资料/chromatic-main`。GitHub 默认分支 main 的固定提交：`b5859e420de6006b458fcbb672136302ebe17eba`。23 个可比代码、脚本、样式和 HTML 文件与该提交全部一致。

## 结论

**继续使用 AIRI 已有的 Chromatic 即可。它是主题配色工具，不提供模型、记忆、主动陪伴或人物行为能力。** Aimy 品牌色、明暗主题及有需要时的情绪氛围色可以建立在现有接线之上，无需再复制整个仓库。

README 中关于 AIRI 记忆数据库的介绍属于生态说明，不能据此把 Chromatic 识别为记忆模块。

## 全局结构

全仓49文件。代码、样式、HTML共23文件、3,503行，其中15个TypeScript文件。两个发布包与一个演示应用：

| 部分 | 实际职责 | Aimy 的使用方式 |
|---|---|---|
| `packages/chromatic` | 基于 culori 的 OKLCH 调色；50到950色阶；亮度、饱和度、透明度；命名配色和色相动画 | 需要程序化颜色值时使用现成 API |
| `packages/preset` | UnoCSS preset；CSS 色相/亮度/饱和度变量；静态和变量色阶；工具类修饰符；Node/浏览器双入口 | 继续由 AIRI 的 UnoCSS 配置消费 |
| `playground` | Vue + Vite 的配色说明/色阶选择；Three.js 三维色彩空间展示组件 | 开发参考，无需随 Aimy 打包 |
| `.github/workflows` | lint、build、typecheck及发布 | 当前 CI 没有运行测试的步骤 |

根包及两个发布包版本字段均为1.1.4。主要运行依赖culori；preset使用UnoCSS。Three.js、Vue及Markdown渲染属于演示应用，不是每个使用Chromatic的产品都必须引入的新功能。

## AIRI 已有接入证据

- [根 UnoCSS 配置](/Users/mima1234/Documents/airi-main/uno.config.ts:155) 已调用 `presetChromatic`，基色220.44，包含 primary 和 complementary。
- [依赖目录](/Users/mima1234/Documents/airi-main/pnpm-workspace.yaml:223) 已声明 `@proj-airi/chromatic` 和 `@proj-airi/unocss-preset-chromatic` 的 `^1.1.4`。
- [桌面主题更新](/Users/mima1234/Documents/airi-main/apps/stage-tamagotchi/src/renderer/App.vue:370) 已把用户主题色写入 `--chromatic-hue`。
- [图表组件](/Users/mima1234/Documents/airi-main/packages/stage-ui/src/components/gadgets/time-series-chart.vue:4) 已调用 `chromaticPaletteFrom`，并用 `withAlpha` 生成半透明颜色。

因此成本最低的接法是调整现有主题参数及必要品牌默认值。若要随角色情绪变化主题，另由 Aimy 的表现规则产生颜色状态，不让 Chromatic 承担情绪推断或关系规则。

## 代码审查结果

### C1 透明色混合不保留 alpha

定位：[mixColors](/Users/mima1234/Documents/资料/chromatic-main/packages/chromatic/src/index.ts:279)。两个输入转换为 OKLCH 后，输出只构造亮度、色度和色相，没有混合 alpha。隔离运行实际源模块，输入透明度0.2和0.4，输出alpha为undefined，转换显示时按不透明处理。

影响范围是调用该混色API的透明效果。现有AIRI图表使用的是`withAlpha`，本轮未发现它受此问题影响。若未来用`mixColors`制作透明氛围过渡，需要明确alpha插值规则。严重性P2，属于特定API缺陷，不阻断基本配色复用。

### C2 色相动画没有取消与后发优先规则

定位：[animateHue](/Users/mima1234/Documents/资料/chromatic-main/packages/chromatic/src/index.ts:169)。每次调用启动独立interval，没有dispose或取消接口。验证：先启动0到120的动画，再`setHue(240)`，旧动画结束后颜色仍回到120。

这是API生命周期限制，不能据此宣称现有AIRI界面已经发生错误。若在情绪变化中使用它，需要调用方统一控制动画所有权和卸载清理，或继续使用AIRI已有CSS过渡。严重性P2，仅针对动态使用场景。

### C3 CI 质量覆盖有限

[CI](/Users/mima1234/Documents/资料/chromatic-main/.github/workflows/ci.yml:35)包含构建检查，但没有执行`test:run`。已有测试主要覆盖色阶数学一致性和UnoCSS修饰符，不包含颜色对比度、透明混色或动画中止。不能把“readability enhanced”宣传语当成所有主题自动满足可读性标准的证明。

## 实际检查

- 15个TypeScript文件用TypeScript解析器检查，无语法错误；这不是完整类型检查。
- 在临时目录复制两份原有测试及对应源文件，借用本机已有依赖执行：**原有10项测试全部通过**。
- 增加两项仅用于本次审查的隔离复现：alpha丢失、旧动画覆盖后续setHue，均确认当前行为。连同原测试为3文件12项通过，不能把这12项全部写成上游原测试。
- 依赖环境：Node v24.20.0、Vitest4.1.11、UnoCSS66.7.5、culori4.0.2。没有安装来源锁文件，不能称为该仓库完整构建验证。
- 未启动演示网站，未做浏览器外观、可读性或完整AIRI桌面回归。本轮没有产品集成。

临时检查：`/tmp/aimy-four-projects-20261010/chromatic-check/`；机器记录：`chromatic-check-results.json`。

## 许可

[LICENSE.md](/Users/mima1234/Documents/资料/chromatic-main/LICENSE.md:1)及两个包声明MIT。复用时保留版权与许可；演示依赖的许可证仍按实际分发范围单独处理。
