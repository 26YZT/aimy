# digital-lover 旧样机工作区

更新：2026-10-11。此目录保留旧独立Aimy样机及其依赖、测试和来源。后续产品方向是完整继承AIRI原版桌面；当前源码与启动脚本尚未切换。

**说明文档统一在[根 docs](../docs/README.md)。** 当前方向、状态与任务分别见[方向](../docs/00-当前方向/开发方向与边界.md)、[PROJECT_STATE](../docs/PROJECT_STATE.md)、[任务](../docs/任务编排.md)。

`desktop`、`build:desktop`、`start:desktop`仍启动`apps/aimy-desktop`。这些命令是旧样机操作方式，本轮没有修改，也不能用于证明新主线已建立。

旧安装、构建、启动、服务探测和原生检查说明保存在[整理前工作区README](../docs/90-历史归档/入口快照/digital-lover-README-旧样机说明.md)。只有定向检查旧样机时才使用，不默认重跑付费模型或设备验收。

`apps/*`、`packages/*`内必要README和许可证保留原位；新开发不要整体搬入旧UI、桥接、会话和音频装配。`docs/`子目录仅保留旧链接兼容入口，正文不在此维护。
