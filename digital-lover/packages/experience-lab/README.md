# Aimy Experience Lab

这是阶段 B 的服务连通性探测入口，复用 AIRI Provider-Inference / Core Agent 与 AIRI 使用的 xsAI 音频 SDK。只验证 OpenAI 与 OpenAI-compatible 接口工厂；不提供通用供应商配置界面，也不代表推荐某个服务。

## 运行边界

默认运行只输出 `not-run`，不读取 `.env`、不读取图片或音频、不请求模型。只有同时给出 `--live --capability` 才会探测：每次最多一个网络推理请求，零重试，30 秒请求取消与父进程终止上限，禁用工具及内置工具解析器。HTTP 重定向会直接失败，避免 307/308 将一次请求变成再次上传或推理。

```bash
pnpm --silent --filter @digital-lover/experience-lab start
pnpm --silent --filter @digital-lover/experience-lab start --live --capability llm
pnpm --silent --filter @digital-lover/experience-lab start --live --capability vision --image /absolute/path/authorized.png
pnpm --silent --filter @digital-lover/experience-lab start --live --capability asr --audio /absolute/path/authorized.wav
pnpm --silent --filter @digital-lover/experience-lab start --live --capability tts
```

需要先由工作区安装依赖并执行 `pnpm build`。显式 live 请求可能产生模型服务费用。

使用 `--silent` 避免 pnpm 启动器回显带文件路径的命令参数。受限环境若阻止 tsx 启动器的本机 IPC 管道，可在本包目录运行 `node --import tsx src/index.ts`，并按相同方式追加能力参数。

Vision 只上传 `--image` 指定的文件；ASR 只上传 `--audio` 指定的文件。工具没有屏幕捕获、麦克风采集或录音能力，不写入任何截图、音频或原始结果。文件必须非空且不超过 25 MiB；图片支持 PNG/JPEG/WebP/GIF，音频支持 WAV/MP3/M4A/MP4/OGG/WebM/FLAC。TTS 使用固定短句「你好，我是 Aimy。」，要求返回具有格式块与非空数据块的 WAV，只记录字节数。

## 配置

只有 `--live` 会读取 `digital-lover` 根目录 `.env`，可用 `AIMY_ENV_FILE` 显式选择其他文件。已设置的环境变量优先；使用相对路径时按启动目录解析。每种能力需要自己的配置，不自动借用其他能力的密钥或模型：

| 能力 | 必填 | 可选 |
|---|---|---|
| LLM | `AIMY_API_KEY`、`AIMY_MODEL` | `AIMY_BASE_URL`、`AIMY_API` |
| Vision | `AIMY_VISION_API_KEY`、`AIMY_VISION_MODEL` | `AIMY_VISION_BASE_URL`、`AIMY_VISION_API` |
| ASR | `AIMY_ASR_API_KEY`、`AIMY_ASR_MODEL` | `AIMY_ASR_BASE_URL` |
| TTS | `AIMY_TTS_API_KEY`、`AIMY_TTS_MODEL`、`AIMY_TTS_VOICE` | `AIMY_TTS_BASE_URL` |

LLM/Vision 的 `API` 只支持 `responses` 或 `chat-completions`；不填时沿用对应 AIRI 工厂默认值。有 `BASE_URL` 时使用兼容工厂，无值时使用 AIRI 的 OpenAI 工厂及其官方地址。

## 结果与验收

输出是一行 JSON，只包含白名单统计：`capability`、`status`、`durationMs`，以及成功结果适用的 `firstTokenMs`、`textLength`、`audioBytes`。`durationMs` 包含进程启动和本地前置检查；`firstTokenMs` 从开始调用 Core Agent 到首个非空文字增量，适用于 LLM/Vision。文本长度按 JavaScript 字符串长度计数。

状态为 `ok` / `not-run` 时退出 `0`；参数、配置或输入待补时退出 `2`；服务失败或超时退出 `1`。不会输出密钥、地址、输入文件路径、文本内容、音频数据、原始异常或堆栈。服务运行在独立进程，SDK 日志被消费而不转发，失败仍明确记录为 `failed` 或 `timeout`。

ASR 测的是文件转写，TTS 测的是整段音频返回；两者均不能作为实时语音、插话、回声处理、口型同步或设备体验已经验收的证据。默认不执行真实服务验收；使用者显式选择 live 并准备配置及授权文件后，才能获得真实服务数据。

```bash
pnpm --filter @digital-lover/experience-lab test
pnpm --filter @digital-lover/experience-lab typecheck
```

回归通过隔离 CLI 的外部 fetch 边界模拟真实 SDK 请求，不 mock 包导入；测试只使用临时假配置与文件，不接触用户 `.env` 或真实模型服务。另用本机临时 HTTP 服务验证 307/308 重定向不会到达第二个推理端点；受限沙箱下需要允许本机临时端口监听。
