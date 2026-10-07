# M1 T1.1：文字对话 CLI 实施计划

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
