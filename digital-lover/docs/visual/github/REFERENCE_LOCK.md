# Aimy GitHub 首页设计依据

2026-10-08，范围为仓库 README、品牌展示资产及 About 元信息，不改应用功能。

## 主方向

采用已有 Aimy 桌面界面作为明确视觉目标：薄荷绿、深绿文字、系统无衬线字体、四角星和 lowercase aimy 字标。来源为 `apps/aimy-desktop/src/renderer/style.css`、`components/AppIcon.vue` 及已验收的原生截图。沿既有品牌直接构建，不另做角色或位图探索。

参考 [Cap README](https://github.com/CapSoftware/Cap) 的居中品牌、短导航和真实产品预览优先；仅借用信息顺序。参考 [Vue README](https://github.com/vuejs/core) 的紧凑状态标识和明确文档入口；不复制其赞助、下载或 CI 状态。

Refero 在线样式检索返回 NO_SUBSCRIPTION，改用已有产品目标和该技能的 color / typography / copywriting / anti-ai-slop craft 规则，不声称已取得在线样式素材。

## 决策与角色

| 决策 | 来源 | 保留规则 |
|---|---|---|
| 品牌色、字标和星形 | Aimy 已有窗口 | 品牌主色用于识别与少量状态，不把绿色等同于整个 MVP 通过 |
| 真实窗口预览靠前 | Cap README + 原生证据 | 截图不伪造产品状态；明确示例角色与模拟服务 |
| 三个本地状态 SVG | Vue README + GitHub 阅读限制 | 只展示 Prototype/macOS/BYOK，不添加未经运行的 CI 或许可徽章 |
| 原型边界紧邻能力 | 项目状态 + copywriting craft | 无真人级、无已完成记忆/主动陪伴等未验承诺 |
| 快速启动和文档导航 | 已有工作区手册 | 相对链接可用，模型和密钥要求清晰 |
| 深浅两套横幅 | color craft | 深色单独设置中性色，不机械反色；SVG 无脚本/外部资源 |

## 固定视觉角色

- 浅色画布 `#eaf4ef`；品牌 `#277c6f`；来自既有 Aimy 界面。
- 深色画布 `#152c25`；品牌 `#a4dcc5`；仅用于适配仓库主题。
- 字体使用系统 sans；不引入装饰 serif、emoji、渐变或重复卡片。
- 媒体采用已存在的测试截图；新图仅是代码原生 SVG 字标和简单几何，不生成或修改位图。
- README 使用 GitHub 支持的 Markdown/HTML，不依赖自定义 CSS。

出口：相对链接/SVG解析、平台阅读和 GitHub 实际呈现核对；发布保持原暂存区，远端基于当前 main 追加，不覆盖源码或参考范围。
