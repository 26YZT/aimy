# Aimy · 粉雾风格库 v0.1

日期：2026-10-12（Asia/Shanghai）。状态：**可评审设计提案；图标文件已导出；未接入产品；人工视觉确认待完成。**

来源：用户本轮提供的粉色猫耳侧脸参考图、Refero 附带的设计工艺规范、AIRI 现有界面截图及本项目当前边界。用途：确定 Aimy 图标与全 UI 的一致视觉语言，给后续品牌实施提供可复用素材和规则。

风险：参考图来源与许可未知，本包不嵌入或分发其原始像素。图标路径为本轮重新绘制，仍需在正式商用前确认品牌及资产权益；不以文件导出代替真实安装包、Dock 和菜单栏验收。替代关系：新增独立设计提案，不替代 AIRI 产品基线、R2 手册或任何待答产品决定。

## 看设计

- [交互风格库](index.html)：品牌图标、聊天、权限、连接模型、桌面控制条、设置、组件及设计变量。
- [浅色总览](evidence/desktop-light.png) / [夜间总览](evidence/desktop-dark.png)
- [完整规范](design-spec.md)：视觉、状态、布局、文案、动作、接入边界及发布检查。
- [参考锁定与决策](research.md)：每项主要选择的来源与采用理由。

可直接双击 `index.html` 打开。部分浏览器会限制 file 协议的外部 SVG 图标引用；需要完整交互时，在本目录运行：

```sh
python3 -m http.server 4179 --bind 127.0.0.1
```

然后访问 `http://127.0.0.1:4179/`。所有资源本地提供，无第三方字体、分析脚本、模型请求、设备调用或数据存储。页面输入在刷新后消失。

## 可交付文件

| 内容 | 文件 | 用途 |
|---|---|---|
| 主应用图标 | [SVG](assets/aimy-icon-light.svg)、[1024 PNG](assets/aimy-icon-1024.png)、[ICNS](app-icons/Aimy.icns) | macOS 应用主图标候选 |
| 深色 / 莓粉版 | `assets/aimy-icon-dark.svg`、`assets/aimy-icon-rose.svg` 及 1024 PNG | 备选品牌资产；不自动更换 Dock 图标 |
| 无底标记 | [aimy-mark.svg](assets/aimy-mark.svg)、`aimy-mark-1024.png` | 头像、品牌位和空状态 |
| 小尺寸 | `aimy-mark-compact.svg`、`aimy-icon-compact.svg` | 去掉细节的 16/32 px 应用图标 |
| 菜单栏 | `aimy-tray-template.svg`、18/36 px 与 16/32 px PNG | 单色透明模板，接入时启用原生 template 语义 |
| macOS 图标集 | `app-icons/Aimy.iconset/` | 16–1024 px、普通/Retina 共十个标准文件 |
| UI 图标 | `assets/ui-icons.svg`、`assets/ui-icons/` | 26 个统一线性图标；24 网格、1.8 描边、currentColor |
| 主题变量 | [tokens.json](tokens.json)、[tokens.css](tokens.css) | 浅色/深色语义色、字号、间距、圆角、动效 |
| 样式组件 | [components.css](components.css) | 按钮、输入、开关、气泡、状态、焦点、空状态 |
| 独立预览 | `index.html`、`gallery.css`、`preview.js` | gallery 仅用于设计展示，不能整页搬入产品 |
| 检查证据 | `evidence/` | 对比度、浏览器交互及多视口截图 |

## 当前完成与未完成

已完成：可编辑矢量与本地导出图标；完整浅深主题提案；典型界面与主要组件状态；浏览器视觉和有限交互检查。

未完成：人工最终选稿、商标/资产权益审查、接入 AIRI Chromatic 主题与真实组件、正式角色模型及音色、真实麦克风/看屏/模型调用、安装包与 Dock 原生验收。原型没有实现长期记忆，也没有替用户决定自动保存记忆、观察频率或收起窗口行为。

导航：[视觉设计入口](../README.md) / [根文档中心](../../README.md)。
