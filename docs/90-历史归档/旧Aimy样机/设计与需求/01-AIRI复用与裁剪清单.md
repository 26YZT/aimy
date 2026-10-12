# 01 · AIRI 复用与产品消费边界

> 文档状态：历史归档，不作为当前需求、技术选型或开工依据。
> 产物时期：初稿日期未知；头部引用2026-10-10隔离决策。精确初稿时间未记录时保持未知。
> 保留原因：记录九包/五包接入、占位与许可来源。
> 上下文风险：按清单重新摘包装配会复建旧简版；不能以“一期不消费”批量裁剪完整原版workspace。
> 原位置：`digital-lover/docs/01-AIRI复用与裁剪清单.md`；归类整理：2026-10-11。
> 阅读入口：[文档中心](../../../README.md)。历史正文中的“当前、唯一、已锁定、下一步”仅适用于原时期。

> 以下包接入与定制描述旧独立样机，不是新主线的拼装清单。当前按 [PRD 2.0草案](../../../00-当前方向/PRD-2.0-对齐草案.md)与 [直接继承决策](../../../01-决策记录/2026-10-10-AIRI直接衍生与旧样机隔离.md)，以完整原版workspace/桌面入口起步，旧样机保持独立；先不大规模裁剪原版结构或重复摘包装配。

## 1. 已接入的最小依赖闭包

| 包 | 职责 |
|---|---|
| core-agent | 会话编排、hook、context、流式运行时 |
| provider-inference | 多供应商聊天/ASR/TTS 等适配；每项能力仍需配置验证 |
| plugin-protocol | 模块、权限和事件协议 |
| server-sdk、server-shared、better-ws | 频道客户端、共享类型与 WebSocket 依赖 |
| stream-kit | 队列等流处理 |
| pipelines-audio、audio | 音频管线及基础处理 |

九包已接入不等于所有音频或插件能力已成为 Aimy 功能。构建与类型检查结果分别记录在 PROJECT_STATE，不用旧测试外推全工作区可用。

## 2. 桌面消费闭包与后续接入

桌面原型新增接入 stage-ui-three、stage-shared、ui、model-driver-lipsync、electron-screen-capture 五包；会话、VAD、Worklet 与语音链路采用 stage-ui 的局部源码适配，桌面入口采用精简 composition。capture 包满足共享类型依赖；D 的选源与采集由受限 Electron session / desktopCapturer 适配连接 getDisplayMedia，原包的电脑操作等消费者未引入。详细来源和变更见 `AIRI复用修订记录.md`。

| AIRI 入口/包 | Aimy 目标 | 接入条件 |
|---|---|---|
| apps/stage-tamagotchi | macOS 桌面与窗口/系统能力 | 检查 Electron、IPC、平台脚本和依赖闭包 |
| stage-ui、stage-shared | 多轮会话、角色卡、设置、语音/视觉逻辑 | 查真实调用链，保留原行为与相关测试 |
| stage-ui-three | VRM、口型、眨眼、视线、表情、待机 | 合法资产、渲染与驱动实测 |
| ui、i18n | 必要 UI 原语与文字 | 由消费链路触发，不整包复制来凑目录 |
| 当前会话存储适配 | 本地恢复与删除 | 以 IndexedDB 实现为起点做目标平台恢复验证 |

本地 `duckdb-wasm`、`drizzle-duckdb-wasm` 只有迁移说明，不能列为现成数据库；`memory-pgvector` 不当作完成的记忆服务。Aimy 先建立本地记忆闭环，不默认接入云端向量数据库。

## 3. 一期不消费

移动端、Web 版、文档站、多形象格式、IM/社交集成、游戏服务、电脑自动操作、云端账号/托管与大范围实验包均不进入一期产品出口。保留参考库原内容；若共享依赖包含这些类型，依据实际编译边界保留必要部分。

## 4. Aimy 自有模块

| 模块 | 当前性质 | 接入方向 |
|---|---|---|
| relationship-engine | 可运行领域原型 | 人格/情绪/关系事件辅助、确定性校验与恢复 |
| companion-engine | 接口占位 | 主动决策、频率、安静与冷却 |
| memory | 接口占位 | 已确认事实/偏好、检索、纠正、删除、恢复 |
| avatar-fitting | 后置接口占位 | 用户自建角色/导入另行立项 |

源码来源、许可证及定制补丁须可追溯；正式产品资源需独立许可检查，不能用开源代码许可证代替模型/音色授权。
