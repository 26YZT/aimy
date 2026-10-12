# M1 T1.1：文字对话 CLI 实施计划

> 文档状态：历史归档，不作为当前需求、技术选型或开工依据。
> 产物时期：2026-09-24，仅文件名；正文无独立日期。精确初稿时间未记录时保持未知。
> 保留原因：单轮CLI实施计划，解释早期代码来源。
> 上下文风险：正文复选框与Task/步骤是旧指令，不是本轮执行授权；不得按计划重新复制包或改入口。
> 原位置：`digital-lover/docs/superpowers/plans/2026-09-24-m1-text-chat-cli.md`；归类整理：2026-10-11。
> 阅读入口：[文档中心](../../../README.md)。历史正文中的“当前、唯一、已锁定、下一步”仅适用于原时期。

## 范围
新增 `packages/text-chat-cli`，接入 AIRI `provider-inference` 与 `core-agent/streamFrom`，实现单轮命令行流式文字对话。

## 步骤

1. 创建 workspace 包、TypeScript 配置和入口。
2. 先为配置解析编写失败测试，再实现配置解析。
3. 为流式事件拼接和错误处理编写测试，再实现 AIRI adapter。
4. 接入 OpenAI / OpenAI-compatible Provider。
5. 运行新包测试、typecheck，并回归 AIRI Core Agent 和 relationship-engine。
6. 更新 README 与本手册执行记录。

## 非目标
不实现 Electron、UI、VRM、语音、屏幕捕获、记忆持久化或工具执行。

## 验证命令

```bash
pnpm install
pnpm --filter @digital-lover/text-chat-cli test
pnpm --filter @digital-lover/text-chat-cli typecheck
pnpm --filter @proj-airi/core-agent test
pnpm --filter @proj-airi/core-agent typecheck
pnpm --filter @digital-lover/relationship-engine test
pnpm --filter @digital-lover/relationship-engine typecheck
```
