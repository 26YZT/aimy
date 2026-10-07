# aimy Text Chat CLI (M1 T1.1)

当前可运行一个单轮命令行文字对话，复用 AIRI Core Agent 的 `streamFrom` 和 Provider-Inference。每轮输入结束后退出；多轮上下文及桌面 UI 不在本任务范围。

## 配置

在 `digital-lover` 工作区根目录的本地 `.env` 中填写；从工作区或包目录启动都读取这一文件：

```dotenv
AIMY_API_KEY=你的新密钥
AIMY_MODEL=你的模型名称
# 可选：配置 OpenAI-compatible 服务时填写
AIMY_BASE_URL=https://服务地址/v1
# 可选：responses 或 chat-completions
AIMY_API=chat-completions
```

密钥不应粘贴到对话、提交、截图或日志。`.env` 已被 gitignore。

已设置的环境变量优先于 `.env`，不会被文件内容覆盖。需要使用其他配置文件时，通过 `AIMY_ENV_FILE` 指定路径，建议使用绝对路径；相对路径按启动目录解析：

```bash
AIMY_ENV_FILE=/absolute/path/aimy.env pnpm chat
```

## 运行

```bash
pnpm chat
# 或直接选择 CLI 包
pnpm --filter @digital-lover/text-chat-cli start
```

CLI 已固定使用本地开发运行器 `tsx@4.23.12`。首次运行前，在 workspace 根目录执行 `pnpm install`；Core Agent 等复用包通过构建产物提供接口，首次安装及修改这些包后执行 `pnpm build`。

## 异常提示

缺少 API Key、模型名称、协议配置不合法或输入为空时，CLI 输出固定的本地校验提示。模型服务、SDK 初始化或流式响应失败时，CLI 输出统一提示「模型服务暂时不可用，请检查模型配置与网络连接后重试」，并以退出码 `1` 结束；不回显原始错误、请求信息或堆栈。Core Agent 保留固定诊断标签，同时继续向调用者传递原始异常。

## 验证

```bash
pnpm --filter @digital-lover/text-chat-cli test
pnpm --filter @digital-lover/text-chat-cli typecheck
```

测试包含真实 CLI 子进程，分别覆盖 Chat Completions、Responses 的流式失败，以及供应商初始化的同步异常和异步拒绝；另验包目录启动时的配置加载、`AIMY_ENV_FILE` 覆盖与环境变量优先级。子进程使用临时目录与测试假凭证，禁止外部网络调用，不读取用户 `.env`；默认根路径测试在临时工作区运行同一 CLI 源码。这些回归验证配置与异常保护，真实模型质量与可用性仍待本地配置后验收。
