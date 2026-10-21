# 四项语音服务修复与复验

日期：2026-10-18。状态：修复与真实复验完成，普通启动已恢复。
来源：用户明确要求修复 MiMo 识别、Apple 错字及两个本地服务连接，并再次验证。
用途：记录实现、机器安装和真实请求证据。
替代关系：接续当日“其余模型服务连接验证”，保留原失败证据。
风险：识别是统计模型。短句通过不证明所有声音和长句都无错字。

## 改动

1. MiMo 识别使用 `mimo-v2.5-asr`。请求仅包含音频，接受 WAV/MP3，传递取消信号。
2. MiMo 对缺少转写字段的响应报错。错误提示保留 HTTP 状态，不回显服务端原始内容。
3. Apple 新增自动、听写、语音转写模式。当前中文配置为 `zh-CN` 和听写短句。
4. Apple 语音转写分支关闭降低准确率的快速结果选项。听写分支使用原生短句提示。
5. Provider 提交边界深拷贝嵌套参数及 RPC 返回结果。修复保存和音色读取的 `DataCloneError`。
6. 安装官方 arm64 VOICEVOX 0.25.2 和 AivisSpeech 1.2.0，配置当前用户后台启动。

原 AIRI 配置、Hearing、Speech 和原生 Apple 插件继续拥有运行链路。
没有新增第二套识别器、固定短句替换或自动云端改写。

## 真实识别与合成

MiMo 旧配置真实返回 HTTP 400。修复协议后，本轮已有真实识别和合成请求返回 HTTP 200。
识别清晰中文样本返回“请检查麦克风和语音识别服务是否正常。”。
合成音频可解码且非静音。原品牌混合短句仍有误识别，原始结果保留在 JSON。

Apple 对比使用同一段音频。原错误“与英灵接”在听写模式中恢复为“语音连接”。
两条其他中文短句正文正确。一条较长样本仍出现“饮杯”和漏“这”的错误。
自动语音转写模式在该长句上更好，因此保留模式选择。
本轮不宣称通用识别准确率达到百分之百。

本轮受控 MiMo 识别/合成请求共 7 次，全部 HTTP 200。最终安装包也已再次通过。

| 本地引擎 | 音色数量 | 实际合成 | 解码时长 | RMS |
|---|---:|---:|---:|---:|
| VOICEVOX 0.25.2 | 127 | 139,308 字节 WAV | 2.901 秒 | 0.0519 |
| AivisSpeech 1.2.0 | 10 | 289,948 字节 WAV | 3.287 秒 | 0.1377 |

两项均由最终安装包的原 Speech 链路执行。`/version`、`/speakers`、`/audio_query`、`/synthesis` 全部返回 200。
配置提交成功，无 `DataCloneError`。音频可解码且非静音。
Aimy 新进程恢复了两项地址、配置状态、127/10 音色和 Apple/MiMo 模型设置。
默认服务及音色保持，屏幕和麦克风采集均关闭。
本地两个引擎提供日语合成。当前默认仍是 MiMo 合成、Apple 识别，未切换用户的默认服务。

## 本机服务

安装目录：`/Users/mima1234/Library/Application Support/Aimy-Voice-Engines/`。
Aivis 模型缓存：`/Users/mima1234/Library/Application Support/AivisSpeech-Engine/`。

- VOICEVOX 地址：`http://127.0.0.1:50021/`。
- AivisSpeech 地址：`http://127.0.0.1:10101/`。
- 两项 LaunchAgent：`~/Library/LaunchAgents/ai.aimy.localvoice.voicevox.plist` 和 `ai.aimy.localvoice.aivis.plist`。
- 登录启动。实际监听仅 IPv4/IPv6 回环地址。Aivis 错误遥测关闭。
- 后台标准输出指向 `/dev/null`。Aivis 自带日志位于其运行数据目录。
- 两项受控重启后均重新返回版本。Aivis 初始化慢于进程创建，验收等待版本接口恢复。

暂停当前登录会话中的本地服务：

```sh
launchctl bootout "gui/$(id -u)/ai.aimy.localvoice.voicevox"
launchctl bootout "gui/$(id -u)/ai.aimy.localvoice.aivis"
```

再次启动：

```sh
launchctl bootstrap "gui/$(id -u)" /Users/mima1234/Library/LaunchAgents/ai.aimy.localvoice.voicevox.plist
launchctl bootstrap "gui/$(id -u)" /Users/mima1234/Library/LaunchAgents/ai.aimy.localvoice.aivis.plist
```

## 工程检查

- MiMo 浏览器回归：3 例通过。
- Apple 适配器：4 例通过。
- 配置双窗口、凭据隔离、音色目录和 Apple 设置：13 例通过。
- 两个本地适配器：30 例通过。合计 50 例，使用真实 Vue/Pinia，替身仅限外部边界。
- provider-inference、stage-ui、stage-pages、stage-tamagotchi 和 i18n 的工作区类型检查通过。
- 本轮触及的 TypeScript/Vue 文件 ESLint 通过。
- provider-inference、i18n 和桌面构建通过。体验包源产物逐文件核对及严格签名检查通过。
- 根 `pnpm lint` 未通过：已有 `@radix-ui/colors` 缺失。
- 根 `pnpm typecheck` 未通过：最终轮次 `cap-vite` 缺少 `@moeru/std` 声明。此前轮次也遇到可选工作区依赖缺失。

主要命令均从 `/Users/mima1234/Documents/aimy/aimy-app` 执行：

```sh
pnpm -F @proj-airi/provider-inference exec vitest run --project browser src/providers/cloud/mimo-audio/index.browser.test.ts
pnpm -F @proj-airi/provider-inference exec vitest run --project node src/providers/local/voicevox/define.test.ts src/providers/local/voicevox/engine.test.ts
pnpm -F @proj-airi/stage-ui exec vitest run --project node src/libs/providers/providers/apple-speech/index.test.ts
pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/stores/providers/config-repeat-ensure.browser.test.ts src/stores/providers/config-local-only.browser.test.ts src/stores/providers/provider-local-runtime.browser.test.ts src/libs/providers/providers/apple-speech/hearing-settings.browser.test.ts
pnpm -F @proj-airi/provider-inference typecheck
pnpm -F @proj-airi/stage-ui typecheck
pnpm -F @proj-airi/stage-pages typecheck
pnpm -F @proj-airi/stage-tamagotchi typecheck
pnpm -F @proj-airi/i18n typecheck
pnpm -F @proj-airi/provider-inference build
pnpm -F @proj-airi/i18n build
pnpm -F @proj-airi/stage-tamagotchi build
pnpm lint
pnpm typecheck
```

## 资料与边界

[MiMo 官方识别协议](https://mimo.mi.com/docs/en-US/api/audio/Speech-Recognition)。
[VOICEVOX 官方发行版](https://github.com/VOICEVOX/voicevox_engine/releases/tag/0.25.2)。
[AivisSpeech 官方发行版](https://github.com/Aivis-Project/AivisSpeech-Engine/releases/tag/1.2.0)。
Apple 模式与快速选项依据本机 `@xsai-apple-speech/transcription` 0.1.3 的公开类型和真实原生分析。

仅使用合成音频，没有采集真人麦克风或私人屏幕。没有播放音频或进行人工听感验收。
密钥由应用原加密存储解析，没有向工具、截图或报告回传真实值。
聊天、视觉、当前识别服务和默认音色选择保持。没有迁移、清空运行数据或提交 Git。

## 安装包

路径：`/Users/mima1234/Applications/Aimy体验版.app`。
版本：`0.12.0-beta.5+aimy.20261018.5`。
ASAR SHA256：`ea9d7b5a6e4c36076902b3eb21d30b0f0e9d63350a802813f7dd2ab8e8993b26`。
严格签名检查和 1,380 个构建文件比对通过。之前的原包保留为“语音服务修复前”。
中间构建仅用于复现。最终包以此校验值和 `installation.json` 为准。

机器结果见 `real-audit-verified.json`、`local-audit-verified.json`、`post-restart.json` 和 `summary.json`。
原始错字样本见 `real-audit.json` 及 Apple 模式对比 JSON，不能用成功请求覆盖识别偏差。

普通启动的原生 Aimy 窗口已观察，主进程不含调试参数，本轮调试端口均关闭。
