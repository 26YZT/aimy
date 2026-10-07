# Aimy 桌面交互样机

在工作区根执行 `pnpm setup:desktop`、`pnpm build:desktop`、`pnpm start:desktop`。开发使用 `pnpm desktop`，工程回归 `pnpm verify`，原生窗口回归 `pnpm verify:desktop`，语音/看屏/解码预算/视觉分别为 `pnpm test:media`、`pnpm test:screen`、`pnpm test:decode-budget`、`pnpm test:desktop-visual`。需要 Node 24、pnpm 11.24.0 和目标 macOS 的 Electron 运行时。当前交付为源码启动样机，尚未制作签名、公证和分发安装包。

## 可使用的链路

打开窗口 → 看到 VRoid Sample A → 配置自己的兼容模型服务 → 多轮文字或分享一张图片 → 流式回复 → 停止生成 → 隐藏/重开或退出 → 重启恢复。分享图片支持 PNG/JPEG/WebP/GIF，单张最大 4 MB；识图模型可单独设置，留空使用对话模型。对话模型需支持流式 Chat Completions 或 Responses。当前界面和角色供产品方向评审，示例不作为正式官方资产。

语音与选源看屏原型已接入，工程831项测试/21个类型检查项目与隔离语音16项、看屏8项门禁通过，真实模型/设备体验仍待验。配置要求见 [真实联调说明](../../docs/真实联调配置说明.md)。设置包含“对话与识图／语音识别／语音合成”三页，各自保存服务地址、模型和自己的密钥；TTS另填音色ID。首批采用AIRI已核对的兼容HTTP接口：ASR上传WAV片段，TTS返回WAV。用户可使用不同服务商，不自动借用聊天密钥或发现模型/音色。

配置后显式点击“麦克风”持续收听，分段转写进入多轮对话；“朗读”独立控制分句语音与口型。当前HTTP原型在新语音持续确认250ms后替换未完成旧段，停止旧ASR/LLM/TTS/播放并保留新段，不代表完整原生流式ASR、自然插话或扬声器回声已验收。

“看屏”需要主动选择一个窗口或屏幕，只共享画面。约5秒最多观察一次，忙时或完全相同帧跳过；识图回复直接作为观察文字保存，无第二次LLM调用，原帧不进入会话。关闭、隐藏、最小化、退出和重载会撤销授权并停止相关流；重显或重启不会自动重开。

## 进程与数据边界

- 主进程消费 AIRI Core Agent/provider；不加载内置工具、插件、MCP、电脑操作、云账号或更新器。请求工具集合为空，禁用工具能力，HTTP 重定向拒绝，每轮 40 秒截止且不自动重试。
- 凭证通过受限 IPC 从短暂密码输入送至主进程。Electron safeStorage 不可用时拒绝保存，不使用明文回退。配置保存后密码输入清空；非敏感配置可回传，密钥不返回 renderer。
- 默认资料目录为 Electron appData 下的 `Aimy`（macOS 通常是 `~/Library/Application Support/Aimy`）；与 AIRI/通用 Electron 资料分开。`settings-v1.json` 保存密文配置/窗口状态，文件权限 0600；会话与用户分享图片使用 AIRI IndexedDB 仓库，位于应用的 `persist:aimy` 分区。损坏配置保留，用户重新保存时生成备份。
- 屏幕/麦克风默认关闭，主进程只给当前授权、可信主frame的audio-only或选定video-only源放行；摄像头和组合摄像头请求拒绝。renderer沙箱、Node关闭、context isolation、导航/弹窗及sender限制保持有效。
- ASR/TTS/视觉请求分别有15秒截止、单请求/零重试/重定向拒绝，以及上传/响应流/文本上限；结果须匹配授权代次和一次性receipt。已解码音频包含当前播放与待播，总量最多24MiB/45秒，单段8MiB/15秒，最多两路native decode。取消后，未完成decode仍计入物理预算直到结束；超限停止本轮朗读，文字保留。
- 发送前先保存用户输入，回复保存完成后显示；取消/隐藏中止当前生成并拒绝迟到结果。退出先取消并等待会话及配置/窗口写入，保存失败保留窗口。清空有确认，删除本地消息和分享图片；它不会要求外部模型服务删除曾处理的请求。
- “本地”指应用记录留在本机；发送时，对话上下文和主动分享的图片交由配置的模型服务处理。BYOK 运行时仍存在客户端凭证可见风险，不能把安全存储理解为在客户端隐藏平台密钥。

`APP_USER_DATA_PATH` 仅用于指定独立资料目录，例如测试。桌面不读取 `.env`；构建的 envDir 也避开工作区用户配置。

## 资源与复用

`scripts/prepare-assets.mjs`校验工作区`assets/prototype/`和`assets/vad/`中模型SHA，生成忽略的`public/assets/`。VAD使用固定Silero权重及匹配的本地ONNX/WASM，关闭远端模型加载和浏览器模型缓存；wLipSync的音频处理器改为可信本地脚本，未放开data脚本CSP。源码及资源许可见AIRI许可证与两类资产清单。

`stage-ui-three` 负责 VRM、待机和基础渲染。使用异步角色边界；资源加载失败时，聊天和设置仍能工作。Vue/Pinia 显式 dedupe，确保应用和复用包共享同一运行时。主进程显式 external Electron，sandbox preload 将 Eventa 桥接依赖打入 CJS。

会话仓库改自 AIRI stage-ui，详情见 `src/renderer/airi-local/README.md`。产品规则通过薄适配层接入，没有搬入原桌面全功能 eager composition。

## 验证边界

`tests/desktop-smoke.ts` 启动真实 Electron 和真实 Vue/VRM/UI/IPC/SDK，使用临时资料目录、本机假模型与假密钥。它验证三轮上下文、增量回复、图片、取消、服务失败、安全存储调用边界、权限拒绝、新进程恢复和删除。结果与截图存入命令输出的临时证据目录。

原生测试显式指定Electron binary，实际use-mock-keychain旗标false。safeStorage密文读写/恢复有实际证据，分发包Keychain策略未独立审计。语音测试使用离线公共文字文件假麦克风、真实本地Silero/Worklet、真实SDK本机响应及真实WebAudio；测试静音输出、仅测试AudioServiceSandbox文件输入配置，不接实际麦克风。看屏测试只用自建窗口画面。真实模型质量/延迟、耳机/扬声器回声、系统采集许可、用户体验、30分钟稳定性、正式角色声音和分发仍需实测。
