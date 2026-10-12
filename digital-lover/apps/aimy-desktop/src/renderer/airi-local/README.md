# AIRI local conversation reuse

> 文档状态：旧独立样机／开发验证工具的就近说明，不是新Aimy产品入口。
> 产物时期：初稿日期未记录；2026-10-11盘点时已存在。精确初稿时间未记录时保持未知。
> 保留原因：保留包使用、版权来源或旧样机技术边界，供定向复核。
> 上下文风险：只说明所在包或旧样机，不代表新Aimy产品已集成、批准或验收。
> 原位置：`digital-lover/apps/aimy-desktop/src/renderer/airi-local/README.md`；归类整理：2026-10-11。
> 阅读入口：[文档中心](../../../../../../docs/README.md)。历史正文中的“当前、唯一、已锁定、下一步”仅适用于原时期。

The database repository and chat types are copied from `airi-main/packages/stage-ui/src`, under the AIRI MIT license. They are kept intact so their source remains comparable. `database/storage.ts` changes only the database base to `aimy-local` and removes the unused cloud outbox mount.

The Aimy composition calls only index/session read, write and local deletion. It has no cloud service, account, WebSocket, outbox drain or authentication consumer.
