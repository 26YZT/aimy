# AIRI 复用修订记录

## 来源与约束

来源为本地只读 `../airi-main` 快照；该工作区没有可引用的 Git commit SHA。原许可证保存在 packages/airi-upstream-LICENSE。保留原包名称、导出、源码与测试，定制只发生在 Aimy 副本。

## 2026-10-07 的定制

| 范围 | 修订 | 验证原则 |
|---|---|---|
| 包 manifests | 补齐独立工作区缺少的 Node/Vite 类型、Vitest、tsx与浏览器运行时；以已核对版本锁定 | 不通过更改编译选项或源码 alias 掩盖缺失依赖 |
| core-agent/runtime | 不可信异常日志只输出固定诊断标签 | 原始异常继续 rejection；保持生成、usage观察与取消行为 |
| pipelines-audio/playback-manager | 总容量策略优先；取消意图不自动重启等待音频；一次抢占不额外drain；旧Promise不能结束新同ID播放 | 原8测试保留，复现3项失败后修复，并新增异步身份与兼容回归 |
| 新增 Aimy 模块 | perception-gate；不改 AIRI 参考视觉工作台 | 发出取消信号，关闭/隐藏后拒绝旧结果；D 的设备与provider适配已接产品，真实设备待验 |

依赖 SDK 的 Responses 补丁继续由 pnpm patchedDependencies 应用，本轮未修改补丁内容。后续升级需比较 manifests、源码、测试、许可与补丁；不自动追随最新版。

原 AIRI tsdown 0.22.14 的 unplugin-unused peer范围与已安装0.6.0存在声明警告；构建结果另行记录。不能通过弱化测试或更改原库来抹掉此警告。

Experience Lab复用现有AIRI工厂/Core Agent与相同xsAI0.5.0音频SDK；使用隔离Node进程和provider请求fetch适配边界实现预算与安全统计，不另写模型协议。只有用户显式live才读取自己的配置；本轮未执行live。

## 桌面切片接入

- C 新接入 `stage-ui-three`、`stage-shared`、`ui`、`model-driver-lipsync`、`electron-screen-capture` 五包，保留上游 src、原测试与包导出；独立 manifest 将 catalog 版本改为具体范围并补测试/构建依赖。capture 包满足原类型闭包，D 的选源捕获使用受限 Electron 适配。
- Vue/Pinia 在 renderer 构建时 dedupe，避免独立包不同依赖 peer 实例导致上游 model store 无法读取应用 Pinia。上游源码不以删功能/改测试来绕过问题。
- AIRI stage-ui 的 IndexedDB storage、chat-sessions repo 与两类会话类型复制到桌面 `airi-local`，去除远程会话装配，只调整本地 storage 命名和类型引用；来源细节见该目录 README。
- AIRI stage-tamagotchi 的窗口/IPC 归属模式用于精简 Aimy composition；不搬其 eager 插件、MCP、电脑操作、云账号与更新器。主进程接原 Core Agent/provider，显式禁全部工具。
- 原型资源、待机 VRMA/HDR 由真实 stage-ui-three 构建消费；示例、代码许可证和正式发行签核分开记录。
- Electron 内置模块显式 external，sandbox preload 桥接打包 CJS；角色引擎异步加载，CSP 放行本地 WASM，角色失败不阻塞聊天。Aimy 自有适配包含安全配置、请求验证/脱敏、40秒超时、取消、退出保存握手和本地会话 UI。

## D 实时原型修订

- 从 stage-ui 局部复制 VAD、AudioWorklet、音频图生命周期与 voice-input-transcription-chain，以及原测试到 `apps/aimy-desktop/src/renderer/airi-voice`。不引入 hearing/account/analytics store。VAD 增加本地权重加载、250ms 连续确认、代次隔离、队列清理；产品实例限制8帧，原构造默认值保留兼容回归。逐文件来源和 SHA 见 `执行记录/2026-10-07-D源码清单.json`。
- 产品适配连接原音频管线/PlaybackManager 与实际 WebAudio。分句合成允许两路并发、严格按原文本序播放。补充输入 buffer 转移保护和跨取消代次的物理解码预算；取消不能释放尚未完成的 native decode 预留。超限保留文字、停止朗读。
- `model-driver-lipsync/src/runtime/wlipsync/index.ts` 在消费侧预注册可信本地 `audio-processor.js?url`，原 WASM/DSP 与接口保留。`stage-ui-three/src/composables/vrm/lip-sync.ts` 用静音分析支路保持处理器运行，停止时输出零帧释放口型，并拒绝 closed context 的迟到节点；补6项生命周期回归，不修改参考库。
- Aimy设备状态加主进程全局revision，get/事件/操作回复使用相同版本。前端统一丢弃迟到/重复快照，启动复核当前授权token与本地代次，防止跨开关快照覆盖或撤权后重新开启；保留原按能力独立开关与main确定性门禁。
- main 通过 AIRI provider 与相同 xsAI 0.5.0 执行 ASR/TTS/Vision，增加独立配置、授权 lease、一次性 receipt、15秒截止、有界响应读取、零重试和取消。屏幕观察直接发布，不经第二轮模型生成；本地会话撤销时回滚待提交观察。
- Electron 权限入口核对主 frame、准确 URL、临时授权和选源。当前 Electron 的 display 请求为 media、空 mediaTypes；仅在选定视频源授权下放行，display handler 继续拒绝系统音频/摄像头。拒绝回调使用 Electron 支持的 null，避免空对象触发内部类型异常；不拓宽通用 IPC 或脚本 CSP。
- 本地 VAD 模型/运行时固定版本与 SHA，构建复制匹配 WASM/Worklet，关闭远端权重加载。C 历史192文件一致清单保留为当时证据，D 的上述定制单独记录，不再宣称当前所有副本逐字一致。

工程、假设备原生链路和真实模型/设备分别验收；当前分段HTTP语音不宣称已达到自然实时交流。参考库始终只读，未改既有 Git 暂存内容。
