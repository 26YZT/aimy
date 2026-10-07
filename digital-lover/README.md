# Aimy

Aimy 是基于 AIRI 的虚拟情感陪伴产品工作区。工程基线和桌面文字/图片样机已通过；分段语音、插话取消、朗读/口型与选源看屏原型已接入，工程与隔离原生链路通过。真实模型/设备体验及连续陪伴按已批准路线继续推进。

## 产品与进度入口

- [唯一需求总纲](docs/PRD-MVP-重构版.md)
- [当前项目状态](docs/PROJECT_STATE.md)
- [任务顺序](docs/任务编排.md)
- [阶段技术手册](docs/阶段技术手册/README.md)
- [本轮实施证据](docs/执行记录/2026-10-07-A与B基线.md)
- [桌面样机证据](docs/执行记录/2026-10-07-C桌面样机.md)
- [实时交互原型证据](docs/执行记录/2026-10-07-D实时交互原型.md)
- [真实联调配置要求](docs/真实联调配置说明.md)
- [角色资产清单](docs/资产清单.md)

旧根目录 PRD、旧 M0–M8 任务表保留历史信息，执行以已批准总纲与当前状态为准。

## 安装与工程验证

需要 Node.js 24 与 pnpm 11.24.0。在本目录运行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test:setup
pnpm setup:desktop
pnpm verify
```

`test:setup` 下载锁定 Playwright 对应的无头 Chromium；只需首次安装或更换浏览器运行时后执行。`verify` 顺序执行依赖与桌面构建、全工作区类型检查、Node 回归和浏览器回归。首次构建桌面前需要下面的 `setup:desktop`。测试使用假配置、模拟传输和本机服务；不等于真实模型或设备验收。

也可以分别运行：

```sh
pnpm build
pnpm typecheck
pnpm test:unit
pnpm test:browser
pnpm test:experience
```

工作区使用固定的隔离依赖布局，保证 CI 和本机执行一致。不要为修复类型错误而更改 tsconfig 或用 mock 绕过包导入问题。

## 启动桌面样机

首次安装 Electron 运行时，然后构建并启动：

```sh
pnpm setup:desktop
pnpm build:desktop
pnpm start:desktop
```

开发模式为 `pnpm desktop`。窗口内进入“模型服务设置”，填写兼容服务地址、接口协议、对话模型和自己的密钥；支持单独配置识图模型。样机不读取 CLI 的 `.env`，不预置付费服务配置。保存后密钥输入清空，凭证由主进程调用 Electron safeStorage 加密到本机配置文件。

可以与示例 VRM 进行多轮流式文字交流、主动分享图片、停止生成、隐藏/重开窗口。会话和分享图片保存在本机 IndexedDB，配置和窗口状态由主进程保存；退出等待写入，清空对话会删除保存的消息和图片。标题栏可拖动；隐藏后用 Dock 的“显示 Aimy”或 `⌘⇧A` 重开。

角色使用已标注的VRoid Sample A。麦克风、看屏和朗读默认关闭；ASR/TTS独立配置后可显式开启，选源看屏说明画面发送范围。当前原型采用连续收听+分段HTTP转写+分句WAV播放；真实模型、回声与完整实时体验另验。关系/长期记忆和主动搭话未接产品，正式角色/音色和安装包尚未交付。

原生窗口回归在独立临时资料目录和本机假服务上执行，不读取用户配置：

```sh
pnpm verify:desktop
pnpm test:media
pnpm test:screen
pnpm test:decode-budget
pnpm test:desktop-visual
```

详细数据边界和运行说明见 [桌面应用](apps/aimy-desktop/README.md)。

## 开发期文字对话

CLI 用于模型连接与单轮流式诊断；桌面样机使用独立的窗口配置和多轮会话。

```sh
cp .env.example .env
# 在本机编辑 .env，填写自己的对话服务配置
pnpm chat
```

配置文件默认在本工作区根目录；从包目录启动也使用同一文件。环境变量优先，另可用 `AIMY_ENV_FILE` 指定配置路径。不要把密钥粘贴进对话、日志、截图或提交。CLI 详细说明见 [text-chat-cli](packages/text-chat-cli/README.md)。

## B 服务连通性探测

[Experience Lab](packages/experience-lab/README.md) 复用 AIRI 工厂与 SDK，分别探测对话、识图、文件 ASR 和整段 WAV TTS。默认不读配置、不上传文件、不调用模型：

```sh
pnpm --silent smoke:live
```

只有你在本机填写对应配置并显式选择 `--live` 才发送一次请求，例如：

```sh
pnpm --silent smoke:live -- --live --capability llm
pnpm --silent smoke:live -- --live --capability vision --image /absolute/path/authorized.png
pnpm --silent smoke:live -- --live --capability asr --audio /absolute/path/authorized.wav
pnpm --silent smoke:live -- --live --capability tts
```

真实请求可能产生用户服务费用；最多一次请求、零重试、30秒截止，拒绝HTTP重定向，不自动采集设备。静默pnpm启动避免包管理器回显输入路径；程序只输出安全统计，不保存内容。各能力配置位于 `.env.example`，详见包说明。`ok` 只代表这次服务请求成功，ASR文件转写/整段TTS不代表实时语音、回声、插话或体验质量已通过。

识图、中文 ASR、中文 TTS可以使用不同服务商。真实服务与设备目前未验，后续实验不能用假数据替代真实耗时和质量。

## 当前功能边界

- Core Agent、provider、音频和协议依赖已接入；复用源码保留来源与原测试。
- CLI、关系原型可运行；感知门禁已有取消与迟到结果保护。
- 主动陪伴决策和长时记忆仍待实现；Electron 交互样机已有入口，分发安装包尚未完成。
- 示例 VRM 已按用户确认准备，仅用于交互原型；正式角色、人设、音色和发行资产仍待验收。
- 游戏、账号、云同步、订阅、自建角色和电脑自动操作后置。

## 复用与恢复

GitHub 交付只发布 Aimy 产品工作区及必要依赖，不包含完整参考库和其他模板；构建无需 `airi-main/`。范围与本地暂存保留方式见 [GitHub发布范围](docs/GitHub发布范围.md)。

`../airi-main` 保持只读。Aimy 定制说明见 [复用修订记录](docs/AIRI复用修订记录.md)。开工前源码快照保存在本地 `.baseline/`，不包含凭证、依赖和构建产物；Git 暂存未改动。当前父仓库尚无历史提交，因此快照与校验清单用于恢复基线，不能冒称已有提交 SHA。
