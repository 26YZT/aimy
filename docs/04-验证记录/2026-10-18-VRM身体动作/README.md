# VRM 身体动作与体验包更新

日期：2026-10-18（Asia/Shanghai）。状态：手动身体动作已验证并安装，完整自然度仍待用户体验。
来源：本次用户反馈、指定本地 VRM、当前主工程、独立 profile 的原包与新包实跑。
用途：区分待机、显式动作、按钮回执、实际骨骼变化和已安装版本。
风险：动作幅度、衣物物理和取景依赖模型。工程检查不代表正式人物美术与自然度验收。
替代关系：补充累计能力清单 A20/A23，不改写原版与前批证据。

## 结果

原包的待机已经运行，3 秒内左上臂约 3.191°，对应蒙皮顶点位移约 0.03596 模型单位。
因此没有证据表明原包完全没有绑定待机。用户期待的显式身体动作缺少操作入口。

本次增加“身体动作 → 挥手 / 点头 / 停止动作”。一次播放后返回原待机。
设置窗口经过 Eventa 命令通道驱动主舞台，并校验 owner、已加载模型及可用状态。
包内使用原生按钮点击，采样观察到手臂最大约 90.97°、头部约 16.04°。
中途停止显示“已停止动作，恢复待机”。没有代发聊天或执行付费模型评测。

新增动作首次验证遇到保持姿势被待机覆盖。已有动态骨骼回归反例，修复后通过。
动画统一使用原 VRMA 的归一化骨骼名称，共用一个属性混合绑定。

## 检查命令

所有产品命令从 `/Users/mima1234/Documents/aimy/aimy-app` 执行。

| 命令 | 结果与边界 |
| --- | --- |
| `pnpm -F @proj-airi/stage-ui-three exec vitest run src/composables/vrm/gestures.test.ts src/composables/vrm/animation.test.ts src/composables/eye-tracking.test.ts` | 3 文件、14 项通过。真实 Three/VRM 骨骼与 mixer，包含动态待机覆盖反例 |
| `pnpm exec vitest run --config apps/stage-tamagotchi/vitest.config.ts --project browser src/renderer/composables/model-settings-runtime.browser.test.ts` | 1 文件、3 项通过。包含跨上下文命令和过期 owner/model、锁定、错误 renderer 的拒绝 |
| `pnpm -F @proj-airi/stage-ui-three typecheck` | 通过 |
| `pnpm -F @proj-airi/stage-ui typecheck` | 通过 |
| `pnpm -F @proj-airi/stage-tamagotchi typecheck` | 通过 |
| `pnpm -F @proj-airi/stage-tamagotchi build` | 最终普通桌面构建通过 |
| 16 个本次 TS/Vue 文件的 `pnpm exec eslint` | 0 error，6 个既存 warning。未自动修复其他批次文件 |
| `pnpm typecheck --concurrency=2` | 未通过，先失败于既存可选 mediapipe 工作区依赖缺失。没有安装或修改配置掩盖 |
| `pnpm lint` | 未通过，缺少既存 `@radix-ui/colors`。保留机器日志 |
| `git diff --check`（本次相关区域） | 通过 |

## 运行与包

运行检查使用独立临时 appData，外网请求与设备权限拒绝。没有读取私人 Aimy-Preview。
测试导入原文件后，分别观察保存、选中、渲染、骨骼和蒙皮。
动作截图可见手臂抬起。包内原生点击另有采样，不把单纯“已开始”文案当动作证明。
原生控制栏的 AX 自动化受自动收起影响，进入设置采用仓库规定的 agent-browser 流程。
身体动作区的原生 AX 挥手、点头、停止按钮均可达。

体验版版本：`0.12.0-beta.5+aimy.20261018.2`。
已安装：`/Users/mima1234/Applications/Aimy体验版.app`。
旧程序备份：`/Users/mima1234/Applications/Aimy体验版-20261018-身体动作更新前.app`。
桌面原符号链接保留。应用身份 `ai.aimy.preview` 和 Aimy-Preview 资料目录保留。
安装器未读取、迁移或清空私人 profile。VRM 原文件没有修改，也没有进入安装包。
包中 1,380 个构建文件逐字节一致。仅体验包装的编译主进程副本关闭上游更新。
包归档 SHA256：`6d90f787329870d7a5ae8d61084b462a333c6bde13dbfae44918aabadc8dec10`。
采用原体验版相同的本机 ad-hoc 签名模式，安装前后严格验签通过。不是对外分发公证。

## 注视与未验范围

原截图的注视方向是“禁用”。模型注视方向选择“鼠标”后，独立设置窗口与主舞台模式同步。
输入坐标映射测试通过，指定资产的眼骨对注视模式有响应。该文件水平输出范围约 10°。
没有证明它在用户所有屏幕位置都具有与默认 AIRI 示例相同的视觉幅度。

当前只有手动触发两个内置身体动作。没有接入聊天自动驱动、任意动作生成或 VRMA 导入界面。
动作穿模、物理自然度、其他人物比例、隐藏/重显组合和长期使用仍需单独体验证据。
Godot 是独立实验入口，缺少执行资源。本次动作使用内置 VRM，不依赖 Godot。

## 机器证据

原始工作目录：`/var/folders/r7/gs0cbny53rz391_2ht9swv300000gn/T/aimy-vrm-motion-20261018-xk3y8yul`。
重要结果另复制到本目录 `evidence/`，保持原字节。模型本体及截图不复制进仓库。
