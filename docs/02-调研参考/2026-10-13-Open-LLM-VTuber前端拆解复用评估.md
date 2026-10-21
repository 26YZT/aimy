# Open-LLM-VTuber 前端拆解与复用评估（面向 Aimy）

- 产出日期：2026-10-13（Asia/Shanghai）。状态：调研判断，未选型、未接入、未做产品运行验收。
- 拆解对象本地路径：`/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/`（MIT，Copyright 2025 Yi-Ting Chiu）。
- 对照对象：Aimy 主工程 `/Users/mima1234/Documents/aimy/aimy-app/`（AIRI v0.12.0-beta.5 完整副本）。
- 范畴：**仅前端与表现层**。`frontend/`、`web_tool/`、`src/open_llm_vtuber/live2d_model.py`、`model_dict.json`、`live2d-models/` 目录结构、`LICENSE-Live2D.md`。
- 约束遵守：拆解过程只读，未改动任何文件、未装依赖、未跑服务。本文件是唯一产出。
- 结论全部以文件路径支撑；无法确认的部分已在文中显式标注。

---

## 1. 项目速览

### 1.1 一个必须先说清楚的事实：本地拆解副本的 `frontend/` 是空的

这是本次拆解最重要的前置发现，直接决定后面所有"前端代码"引用的来源。

| 检查项 | 结果 |
|---|---|
| `/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/frontend/` 文件数 | **0**（`find` 返回空，目录存在但无内容） |
| `.gitmodules` 中 `frontend` 的定义 | `path = frontend`、`url = https://github.com/Open-LLM-VTuber/Open-LLM-VTuber-Web`、`branch = build` |
| `git submodule status` | `-06a659b114fff788cf0daaa86e484576db4975bf frontend` |
| 前导 `-` 的含义 | 子模块**未初始化（uninitialized）**，即目录为空是预期状态，不是仓库损坏 |
| 后端仓库 HEAD | `992309c0aa19845960228f880013d4685fde93b5` |

也就是说：**本地这份拆解副本里根本没有前端源码**。前端是**另一个独立仓库**，以 git 子模块形式挂载，且 pinned 在 `build` 分支。

为如实回答"前端到底是什么技术栈"，我把上游仓库只读克隆到 `/tmp` 做了区分（**只读克隆，未触碰拆解副本，也未写入 Aimy 仓库**）：

| 目标 | 位置 | 提交 | 内容性质 |
|---|---|---|---|
| `build` 分支 @ pinned commit | `/tmp/olv-web-probe` | `06a659b114fff788cf0daaa86e484576db4975bf` | **仅编译产物**：`assets/`、`favicon.ico`、`index.html`、`libs/`。commit message 为 "Deploying to build from @ Open-LLM-VTuber/Open-LLM-VTuber-Web@3d57a9a…" |
| `main` 分支 @ 对应源码 | `/tmp/olv-web-src` | `d176e7df2366952e3bacbf12cf9a8b18a4315932`（2025-09-05） | **真实源码**，本报告 3.x 节所有代码引用均出自此处 |

**因此：本报告第 3 章的 React/Electron 前端实现细节，来自上游 `Open-LLM-VTuber-Web` 的 `main` 分支源码，而不是本地拆解副本。** 本地副本能提供的只有后端、`web_tool/`、`model_dict.json`、模型目录和许可证。这一点必须在引用时明确，否则会误以为拆解副本里存在这些文件。

### 1.2 技术栈（上游 `main`，即真实前端源码）

`/tmp/olv-web-src/package.json`（name `open-llm-vtuber`，version 1.2.1）：

| 层 | 选型 |
|---|---|
| UI 框架 | **React 18** + `@chakra-ui/react` ^3.2.3 + `@chatscope/chat-ui-kit-react` |
| 状态管理 | **zustand** ^5.0.3（不是 Redux，也不是 Context-only） |
| 动画 / 路由辅助 | `framer-motion`、`rxjs` |
| 国际化 | `i18next` / `react-i18next`（`src/renderer/src/locales/{en,zh}`） |
| 本地 VAD | `@ricky0123/vad-web` ^0.0.24 + `onnxruntime-web` 1.14.0（Silero ONNX） |
| 桌面壳 | **Electron 31** + `electron-vite` 2.3.0 + `electron-builder` + `vite` 5 |
| Live2D | **没有用 `pixi-live2d-display`**，而是**内置（vendored）官方 Live2D Cubism Web SDK**，见 3.1 |

对照 AIRI：Vue 3 + Pinia + UnoCSS + Vite，Live2D 走 `pixi-live2d-display`（`aimy-app/packages/stage-ui-live2d/package.json`）。

**两者不是同一套渲染栈，前端整体不可移植。** 这一点是后续所有裁决的前提。

### 1.3 规模

`/tmp/olv-web-src` 统计：

| 范围 | 规模 |
|---|---|
| `src/renderer/src`（业务代码，排除 WebSDK） | **10,710 行** ts/tsx |
| `src/renderer/WebSDK`（vendored 官方 SDK + 官方 sample） | **23,099 行** ts/js（不含 `.min.js`） |
| 文件类型分布 | ts 97、tsx 77、json 8、md 8、js 4… |
| Electron 主进程 | 仅 3 个文件：`src/main/index.ts`、`src/main/menu-manager.ts`、`src/main/window-manager.ts` |
| preload | `src/preload/index.ts`、`src/preload/index.d.ts` |
| 关键结论 | **vendored 的 SDK 代码量是自身业务代码的 2.2 倍**——前端相当大一部分是"官方 sample 拿来就用"的胶水层 |

### 1.4 许可证（含 Live2D 专章）

拆解副本 `/Users/mima1234/Documents/资料/拆解项目/Open-LLM-VTuber/LICENSE`：

> "This project is licensed under the MIT License, **except for the Live2D sample models**, which are governed by [LICENSE-Live2D.md]"

所以是**双许可**，必须分开看：

| 对象 | 许可 | 边界 |
|---|---|---|
| 后端代码 | MIT（Copyright 2025 Yi-Ting Chiu） | 可自由使用、修改、再分发，保留版权声明 |
| 前端代码（独立仓库） | 需以该仓库自身 LICENSE 为准 | MIT 是后端仓库的声明，**不能想当然覆盖独立前端仓库** |
| `live2d-models/mao_pro`、`live2d-models/shizuku` | **Live2D Free Material License Agreement v1.6**（末次更新 2025-02-03），见 `LICENSE-Live2D.md` | 见下表 |

`LICENSE-Live2D.md` 关键条款（原文要点）：

| 条款 | 内容 |
|---|---|
| 角色性质 | `Mao Niziiro` 与 `Shizuku` 被列为 **Live2D Original Characters** |
| Shizuku 单独条款 | "Use this character **directly without changing the name or settings**." |
| §1.22 / §1.23 | "General Users" / "Small-Scale Enterprises" 定义为**最近一期销售额 < 1000 万日元** |
| §2.1.3.1 | 对 General Users / Small-Scale Enterprises：`"Purpose of Use: **irrespective of commercial or Non-commercial purposes**"` |
| §2.1.3.2 | 其余主体：**仅限 Internal or Supervision Purpose** |
| Collaboration Characters | **不得商用** |
| 署名义务 | 有明示的版权声明义务，提供长格式（"This content uses sample data owned and copyrighted by Live2D Inc. …"）与短格式两种写法 |
| 再分发 | 样例数据的再分发受限 |

**对 Aimy 的直接含义：**

1. Aimy 若作为**个人或小规模主体**（年销售额 < 1000 万日元）使用 `mao_pro` / `shizuku`，**商用和非商用都允许**（§2.1.3.1），但必须履行版权声明义务。
2. 一旦超过小规模门槛或成为其他类型主体，这两个模型**只能内部使用或监督用途**（§2.1.3.2），不能随产品分发。
3. Shizuku 还额外约束"不得改名、不得改设定"。
4. **`LICENSE-Live2D.md` 管的是模型资产，不是代码。** 把 Live2D 官方 sample 模型当作 Aimy 的默认角色资产、再随商业客户端分发，是需要法务确认的动作，不能由工程决定。这一点在 §6 风险里再次列出。
5. 建议 Aimy 的默认角色皮肤走**自制或另行授权的模型**，`mao_pro`/`shizuku` 只作为开发期调试资产。这与 Aimy 既定的品牌自制路线一致，不构成新决策。

---

## 2. 完整功能清单表

范围：前端与表现层。成熟度判定标准：**成熟**=有完整实现且边界处理到位；**可用**=能跑通但实现粗糙或依赖 sample 代码；**雏形**=存在但不完整/被注释掉。

| 编号 | 功能 | 做什么 | 实现方式 | 核心文件 | 成熟度 |
|---|---|---|---|---|---|
| F01 | Live2D 模型加载 | 从 URL 解析出模型目录与文件名，初始化 Cubism 运行时 | `parseModelUrl()` 字符串解析 + `LAppLive2DManager` 单例；换模型时 `releaseInstance()` 后 `setTimeout(..., 500)` 重新初始化 | `src/renderer/src/hooks/canvas/use-live2d-model.ts` | 可用（有 500ms 魔法延时、`// @ts-nocheck`） |
| F02 | Cubism SDK 集成 | 提供 Live2D 渲染能力 | **vendored 官方 Cubism Web SDK**：`Core/live2dcubismcore.js` + `Framework/src/**` + `WebSDK/src/**`（官方 sample app 改造） | `src/renderer/WebSDK/**` | 成熟（官方代码） |
| F03 | 表达式（表情）驱动 | 按后端下发的表情索引切换表情 | `lappAdapter.setExpression(name)` 或按 index；`setExpression(expressionValue: string \| number, ...)` | `src/renderer/src/hooks/canvas/use-live2d-expression.ts`、`WebSDK/src/lappadapter.ts` | 可用 |
| F04 | 表情复位 | 回到 IDLE 时重置表情 | `resetExpression(lappAdapter, modelInfo)` → `defaultEmotion` 否则 index 0；由 `live2d.tsx` 在 IDLE 触发 | 同上 + `src/renderer/src/components/canvas/live2d.tsx` | 可用 |
| F05 | LLM 表情标记解析（协议后端侧） | 从 LLM 文本中抽出 `[keyword]` 并映射为表情索引 | `Live2dModel.extract_emotion()` 手写字符扫描；`remove_emotion_keywords()` 去掉标记再送 TTS/显示 | 拆解副本 `src/open_llm_vtuber/live2d_model.py` | 可用 |
| F06 | 表情提示词注入 | 把可用关键词列表告诉 LLM | `prompt_content.replace("[<insert_emomap_keys>]", live2d_model.emo_str)` | 拆解副本 `src/open_llm_vtuber/service_context.py`（约 459 行）、`prompts/utils/live2d_expression_prompt.txt` | 可用 |
| F07 | 动作分组 / 点击动作 | 点击模型头/身触发配置的动作组 | `startTapMotion(hitAreaName, tapMotionsConfig)`：命中区域优先，否则合并全部并按权重随机；`anyhitTest()` 命中检测 | `WebSDK/src/lappmodel.ts`（`startTapMotion` ~1163 行、`hitTest` ~844 行）、`use-live2d-model.ts:365-377` | 可用（逻辑明显被改写过） |
| F08 | 说话动作 | 播放语音时随机播 `Talk` 组动作 | `model.startRandomMotion("Talk", LAppDefine.PriorityNormal)` | `src/renderer/src/hooks/utils/use-audio-task.ts` | 可用 |
| F09 | 口型同步 | 音频播放时驱动嘴部参数 | **官方 sample 的 WAV RMS 方案**：`LAppWavFileHandler` 逐帧从已完全缓冲的 PCM 算 RMS | `WebSDK/src/lappwavfilehandler.ts` | 可用 |
| F10 | 口型增益补偿 | 放大小音量口型幅度 | **运行时猴补丁（monkey-patch）** SDK 的 update 方法，`lipSyncScale = 2.0` | `src/renderer/src/hooks/utils/use-audio-task.ts` | 雏形（改的是 SDK 内部方法） |
| F11 | 播放队列 | 按句排队播放音频 | 自研 `TaskQueue`（`addTask`/`clearQueue`/`hasTask`/`waitForCompletion`），`audioTaskQueue = new TaskQueue(20)` | `src/renderer/src/utils/task-queue.ts` | 成熟 |
| F12 | 音频播放管理 | 记录当前播放，提供停止 | 单例 `AudioManager`：`setCurrentAudio`/`hasCurrentAudio`/`stopCurrentAudioAndLipSync` | `src/renderer/src/utils/audio-manager.ts` | 可用 |
| F13 | 插话打断 | 打断时停播、停口型、清队列、回传信号 | `interrupt()`：状态守卫 → `stopCurrentAudioAndLipSync()` → `audioTaskQueue.clearQueue()` → `setAiState('interrupted')` → 发 `interrupt-signal` | `src/renderer/src/hooks/utils/use-interrupt.ts` | 可用 |
| F14 | 打断后丢弃迟到音频 | 打断/聆听状态下不再入队 | WebSocket 消息处理里 `if (aiState === 'interrupted' \|\| aiState === 'listening') { /* skip */ }` | `src/renderer/src/services/websocket-handler.tsx` | 可用 |
| F15 | 客户端 VAD | 浏览器端检测真实说话，自动起停麦 | `@ricky0123/vad-web` 的 `MicVAD`；`DEFAULT_VAD_SETTINGS = {positiveSpeechThreshold: 50, negativeSpeechThreshold: 35, redemptionFrames: 35}`；写 localStorage | `src/renderer/src/context/vad-context.tsx` | 成熟 |
| F16 | 麦克风音频上送 | 采集 → 分片 → 结束信号 | `sendAudioPartition(audio: Float32Array)`，4096 一片发 `mic-audio-data`，末尾带图发 `mic-audio-end` | `src/renderer/src/hooks/utils/use-send-audio.tsx` | 成熟 |
| F17 | 录音转 WAV | 浏览器录音转 16k 单声道 16bit PCM WAV | 手写 RIFF 头 + `floatTo16BitPCM` + 线性插值 `resampleAudio` | 拆解副本 `web_tool/recorder.js` | 可用 |
| F18 | 独立 ASR/TTS 测试台 | 不经角色直接测语音链路 | `POST /asr` multipart；WebSocket `/tts-ws`（`partial`/`complete`/`error`）；按句取 `/cache/{audioPath}` 拼接；`fetchWithRetry(maxRetries=3)` | 拆解副本 `web_tool/main.js` | 成熟 |
| F19 | 字幕显示 | 显示当前句文本 | `subtitle-context` + `subtitle.tsx`；`use-subtitle-display.ts` | `src/renderer/src/context/subtitle-context.tsx`、`components/canvas/subtitle.tsx` | 可用 |
| F20 | 输入字幕 | pet 模式下的输入法/打字浮层 | `input-subtitle.tsx` + `use-input-subtitle.ts`（主进程可切换） | `src/renderer/src/components/electron/input-subtitle.tsx` | 可用 |
| F21 | 桌宠模式 | 透明全屏穿透窗口，角色可跨屏拖动 | 主进程 `setWindowMode('pet')`：`setBackgroundColor('#00000000')`、`setAlwaysOnTop(true, 'screen-saver')`、覆盖全部显示器的虚拟桌面 bounds、mac 上 `setVisibleOnAllWorkspaces(true, {visibleOnFullScreen: true})`、`setFocusable(false)`、`setSkipTaskbar(true)` | `src/main/window-manager.ts`（`continueSetWindowModePet` ~199-240 行） | 成熟 |
| F22 | 鼠标穿透（按组件粒度） | 只在悬停到角色/UI 上时才接收鼠标 | 渲染进程上报悬停组件集合 `updateComponentHover(componentId, isHovering)`；主进程维护 `hoveringComponents`，集合为空才穿透 | `src/main/window-manager.ts`、`src/preload/index.ts`、`src/renderer/src/hooks/utils/use-draggable.ts` | 成熟（设计上值得注意） |
| F23 | 模式切换 IPC 握手 | 保证窗口形态切换时渲染端不闪 | `pre-mode-changed` → `renderer-ready-for-mode-change` → `mode-changed` → `mode-change-rendered` 四步 | `src/renderer/src/context/mode-context.tsx`、`src/main/window-manager.ts` | 可用 |
| F24 | 托盘菜单 | 切模式、显隐、退出、切麦、打断、穿透开关 | `MenuManager.createTray()` + `Menu.buildFromTemplate` | `src/main/menu-manager.ts` | 可用 |
| F25 | 模型缩放（滚轮） | 滚轮缩放角色，带缓动 | `WHEEL_SCALE_STEP = 0.03`、`EASING_FACTOR = 0.3`、clamp `[0.1, 5.0]`，直接在 `model._modelMatrix` 上 `scale()` | `src/renderer/src/hooks/canvas/use-live2d-resize.ts` | 可用（碰到私有 `_modelMatrix`） |
| F26 | 容器/窗口自适应 | 画布随容器与侧栏变化重算 DPR 与尺寸 | `ResizeObserver` + `requestAnimationFrame` 合并；`canvas.width = round(width * dpr)` | 同上 | 成熟 |
| F27 | 相机 / 屏幕采集入对话 | 截图作为多模态输入 | `useMediaCapture`：`ImageCapture.grabFrame()`，压缩质量与最大宽度从 localStorage 读 | `src/renderer/src/hooks/utils/use-media-capture.tsx` | 可用 |
| F28 | 主动说话 | 空闲 N 秒后主动发起一轮 | `proactive-speak-context`：空闲计时 → `sendTriggerSignal`；设置项 `allowProactiveSpeak`/`idleSecondsToSpeak`/`allowButtonTrigger` | `src/renderer/src/context/proactive-speak-context.tsx` | 可用 |
| F29 | 角色配置界面 | 切换角色、配置别名、Live2D 交互开关 | `setting/{general,agent,asr,tts,live2d,common}.tsx` + `character-config-context` | `src/renderer/src/components/sidebar/setting/**` | 可用 |
| F30 | 背景图 | 更换舞台背景 | `bgurl-context` + `use-background.ts`；后端挂载 `/backgrounds` | `src/renderer/src/context/bgurl-context.tsx` | 可用 |
| F31 | i18n | 中英双语 | `i18next`，`locales/{en,zh}` | `src/renderer/src/locales/**` | 可用 |
| F32 | 右键菜单 | 右键弹原生菜单 | `live2d.tsx` 中 `window.api?.showContextMenu?.()` → 主进程 | `src/main/index.ts`、`components/canvas/live2d.tsx` | 可用 |
| F33 | MotionSync | Cubism MotionSync（音素级口型） | **`@motionsyncframework` / `@motionsync` 别名在 electron.vite.config.ts 中声明，指向 `src/renderer/MotionSync/Framework/src` 与 `src/renderer/MotionSync/src`，但该目录在 `main` 分支上没有任何文件** | `electron.vite.config.ts:20-23` | **不存在** |
| F34 | 历史 / 群组 / 邀请 UI | 会话历史抽屉、群聊、邀请对话框 | `history-drawer`、`group-drawer`、`invite-dialog` 等 | `src/renderer/src/components/sidebar/**` | 可用 |

**关于 F33 的说明（如实记录）**：`electron.vite.config.ts` 里确实配了 MotionSync 的两个路径别名，但 `find src/renderer/MotionSync` 返回空——该目录在 `main` 分支上没有提交任何文件。它可能曾经存在、可能是构建时另行注入、也可能是遗留配置。**我不推测它的实现内容，并在此明确：本报告不对 MotionSync 做任何能力判断。**

---

## 3. 深度专章

### 3.1 Live2D 集成方式与模型加载

**做法：vendored 官方 Cubism Web SDK + 官方 sample app 改造。**

`src/renderer/WebSDK/` 目录结构：

| 目录 / 文件 | 内容 |
|---|---|
| `WebSDK/Core/live2dcubismcore.js`(`.min.js`) | Cubism Core（闭源运行时） |
| `WebSDK/Framework/src/**` | 官方 TS Framework 全量：`cubismmotionmanager`、`cubismexpressionmotion`、`cubismphysics`、`cubismeyeblink`、`cubismpose`、`cubismmodelsettingjson` 等 |
| `WebSDK/src/lappadapter.ts` | 模型适配层：`getMotionGroups`/`getMotionCount`/`startMotion`/`getExpressionCount`/`getExpressionName`/`setExpression` |
| `WebSDK/src/lapplive2dmanager.ts` | 全局单例（`getInstance()`），持有 models 数组 |
| `WebSDK/src/lappmodel.ts` | 模型实现，含 `hitTest`(~844)、`anyhitTest`(~868)、`anyhitTestWithFallback`、`startTapMotion`(~1163) |
| `WebSDK/src/lappwavfilehandler.ts` | WAV 加载 + RMS |
| `WebSDK/src/lappdefine.ts` | `HitAreaNameHead='Head'`、`HitAreaNameBody='Body'` 等常量 |
| `WebSDK/src/lappdelegate.ts` | 更新循环与渲染主循环 |

构建期把 `live2dcubismcore.js` 与 VAD 的 wasm/onnx 一起拷贝到 `libs/`（`electron.vite.config.ts` 的 `viteStaticCopy`）。

**加载流程**（`src/renderer/src/hooks/canvas/use-live2d-model.ts`）：

1. `parseModelUrl()` 用字符串切分从后端下发的 URL 里取出 baseUrl / 目录 / 文件名；
2. `updateModelConfig(baseUrl, modelDir, modelFileName, kScale)`；
3. 换模型时 `LAppLive2DManager.releaseInstance()`，然后 `setTimeout(() => initializeLive2D(), 500)`。

**这套实现的特征（也就是它作为"可借鉴来源"的局限）**：

- 文件顶部 `// @ts-nocheck`，类型系统被关掉；
- 全局单例 + `window.LAppLive2DManager` / `window.getLAppAdapter?.()` 全局变量访问；
- 大量**穿透私有成员**：`model._wavFileHandler`、`model._modelMatrix`、`model._modelSetting`、`model._expressions`；
- 换模型的 **500ms 魔法延时**；
- 口型增益靠**运行时覆盖 SDK 方法**（见 3.3）。

**与 AIRI `packages/stage-ui-live2d/` 对照：**

| 维度 | OLV | AIRI | 判定 |
|---|---|---|---|
| 渲染栈 | vendored 官方 Cubism SDK + sample 改造 | `pixi-live2d-display` + 细粒度 `@pixi/*` + `pixi-filters` | AIRI 更规范 |
| 架构 | 全局单例、`window.*` 全局、`@ts-nocheck` | Pinia stores（`expression-store`/`motion-control`/`view-control`/`model-parameters`）+ composables | **AIRI 强** |
| 硬件无关的推理封装 | 无 | `stage-ui/src/components/scenes/Stage.vue` 的 renderer-agnostic 分发器（live2d/vrm/spine/tachie/mmd/godot） | **AIRI 强得多** |
| 模型导入与持久化 | 只有 URL 字符串解析 | `utils/live2d-zip-loader.ts`、`opfs-loader.ts`、`live2d-opfs-registration.ts`、`decode-zip-filename.ts`、`live2d-validator.ts`、`live2d-structure-report.ts`、`live2d-preview.ts`，且带 `*.test.ts` / `*.browser.test.ts` | **AIRI 强得多** |
| 缩放/位移控制 | `kScale`/`initialXshift`/`initialYshift` 写死在 `model_dict.json`，滚轮改 `_modelMatrix` | `stores/view-control.ts`：`position{x,y}` + `scale` 用 `useLocalStorage` 持久化，clamp `[0.01,3]`，有 slider UI | 各有取舍（OLV 的声明式 per-model 配置见 4 章） |
| 头部定位 | `hitTest('Head')` 命中检测 | `composables/live2d/head-anchor.ts`：从 `hitAreas` 取 index，读 drawable bounds 反推头部锚点，还驱动 physics | **AIRI 强** |
| 环境光影响 | 无 | `filters/screen-ambient-light.ts` + preview 组件 + 测试卡 | AIRI 独有 |

**结论：Live2D 集成方式不值得借鉴，AIRI 全面更强。** 唯一值得记的是 OLV 那份**声明式 per-model 配置**（见 4 章 diff-1）。

### 3.2 后端驱动的表情/动作协议（重点）

这是本次拆解的核心问题。两个项目在这里的差异最大，而且**AIRI 的协议明显更成熟**。

#### 3.2.1 协议格式（逐字写出）

**OLV 协议 —— 裸内联方括号标记**

后端在系统提示里注入可用关键词（`src/open_llm_vtuber/live2d_model.py`）：

```python
self.emo_str: str = " ".join([f"[{key}]," for key in self.emo_map.keys()])
# 实际产出形如：
# "[fear], [anger], [disgust], [sadness], [joy], [neutral], [surprise],"
```

提示词模板 `prompts/utils/live2d_expression_prompt.txt` 的关键句：

> "In your response, use the keywords provided below to express facial expressions or perform actions with your Live2D body."
> `- [<insert_emomap_keys>]`
> 示例：`"Hi! [expression1] Nice to meet you!"`
> "you are only allowed to use the keywords explicity listed above… **Remember to include the brackets `[]`**"

即 LLM 被要求输出形如：

```text
你好呀！[joy] 今天想聊点什么？
```

后端用**手写字符扫描**（不是正则）抽取：

```python
def extract_emotion(self, str_to_check: str) -> list:
    expression_list = []
    str_to_check = str_to_check.lower()
    i = 0
    while i < len(str_to_check):
        if str_to_check[i] != "[": i += 1; continue
        for key in self.emo_map.keys():
            emo_tag = f"[{key}]"
            if str_to_check[i : i + len(emo_tag)] == emo_tag:
                expression_list.append(self.emo_map[key]); i += len(emo_tag) - 1; break
        i += 1
    return expression_list
```

注意：**映射结果 `self.emo_map[key]` 是整数索引，不是表情名。** 即 `[joy] → 3`。

再经 `remove_emotion_keywords()` 把标记从朗读/显示文本里去掉，保证 `[joy]` 不被 TTS 念出来。

承载结构（`src/open_llm_vtuber/agent/output_types.py`）：

```python
@dataclass
class Actions:
    expressions: Optional[List[str] | List[int]]
    pictures: ...
    sounds: ...
    def to_dict(self): ...   # 丢掉 None 字段

@dataclass
class SentenceOutput:
    display_text: DisplayText   # text, name, avatar
    tts_text: str
    actions: Actions
```

抽取挂载点（`src/open_llm_vtuber/agent/transformers.py`）：`actions_extractor(live2d_model)` 对每个非标签句调用 `live2d_model.extract_emotion(sentence.text)`。

下发到前端（`src/open_llm_vtuber/utils/stream_audio.py` 的 `prepare_audio_payload`）——**表情搭在音频消息上**：

```json
{
  "type": "audio",
  "audio": "<base64 wav>",
  "volumes": [ /* 每 20ms 的 RMS，已按最大值归一 */ ],
  "slice_length": 20,
  "display_text": { ... },
  "actions": { "expressions": [3], "pictures": null, "sounds": null },
  "forwarded": false
}
```

前端消费（`src/renderer/src/hooks/utils/use-audio-task.ts`）：

```ts
setExpression(expressions[0], lappAdapter, ...)   // 只取第 0 个
model.startRandomMotion("Talk", LAppDefine.PriorityNormal)
```

**协议要点小结（OLV）：**

| 项 | 值 |
|---|---|
| 标记语法 | `[keyword]`，裸方括号，无转义机制 |
| 语义 | 表情**索引**（后端 emo_map 决定数值） |
| 位置 | 内联在自然语言中间 |
| 与文本的关系 | 后端负责剥离，剥离后才送 TTS |
| 流式安全 | **不安全**——`extract_emotion` 在完整句子上跑，且 `[`/`]` 无转义，正文里出现 `[` 会有歧义 |
| 一次多个 | 支持（`expressions` 是列表），但前端**只用 `expressions[0]`** |
| 强度 | 不支持 |
| 时长 | 不支持 |
| 工具调用 | 无 |

**AIRI 协议 —— 结构化特殊 token + 独立工具调用 API**

标记格式（`packages/stage-ui/src/composables/queues.ts`）：

```ts
function parseActEmotion(content: string) {
  const match = /<\|ACT\s*(?::\s*)?(\{[\s\S]*\})\|>/i.exec(content)
  if (!match) return { ok: false, emotion: null }
  const payload = JSON.parse(match[1]) as { emotion?: unknown }
  // 字符串形式 → { name, intensity: 1 }
  // 对象形式 → { name, intensity: clamp(0..1) }
}
```

实际形态：

```text
<|ACT {"emotion":{"name":"happy","intensity":1}}|>
<|DELAY:2|>
```

其中 `<|DELAY:(\d+)|>` 由 `useDelayMessageQueue()` 解析为 `sleep(delay * 1000)`。

**流式安全解析**（`packages/core-agent/src/runtime/llm-marker-parser.ts`）：

```ts
const TAG_OPEN = '<|'
const TAG_CLOSE = '|>'
// 转义写法 <{'|'}  与  {'|'}>  会被归一化回 <| 和 |>
createLlmMarkerParser({ minLiteralEmitLength })
  .consume(textPart, onLiteral, onSpecial)
  .end(onLiteral)
```

关键设计：解析器**保留 `tailLength = max(TAG_OPEN.length - 1, ESCAPED_TAG_OPEN.length - 1)` 个字符不发出**，因此当 token 恰好被切在流中间（收到 `<` 或 `<|`）时，绝不会把半个标记漏进 TTS。测试在 `llm-marker-parser.test.ts`、`response-categoriser.test.ts` 中有覆盖。

**同时 AIRI 还有第二条通道：LLM 工具调用**（`packages/stage-ui-live2d/src/tools/expression-tools.ts`，基于 `@xsai/tool` + zod）：

| 工具 | 参数 |
|---|---|
| `expression_set` | `{name, value: boolean\|number, duration?}` |
| `expression_get` | `{name?}` |
| `expression_toggle` | `{name, duration?}` |
| `expression_save_defaults` | `{}` |
| `expression_reset_all` | `{}` |

配合 Pinia store `live2d-expressions`（`stores/expression-store.ts`）：

```ts
interface ExpressionEntry {
  name: string
  parameterId: string
  blend: 'Add' | 'Multiply' | 'Overwrite'   // 支持混合模式
  currentValue: number
  defaultValue: number
  modelDefault: number
  targetValue: number
  resetTimer?: ...
}
type Live2DExpressionLlmMode = 'all' | 'none' | 'custom'   // 逐表达式授权给 LLM
```

持久化 key `expression-defaults:${modelId}`。逐帧应用在 `composables/live2d/expression-controller.ts`（`applyExpressions(coreModel)`），`Multiply` 混合读的是**眨眼之后的当前帧值**。

**情绪清单注入**（`packages/stage-ui/src/composables/use-airi-runtime-prompt.ts`）：从 i18n key `base.prompt.emotion`/`emoji`/`suffix` 生成 `- happy (Emotion for feeling Happy)` 这类列表。

**跨渲染器的情绪分发**（`packages/stage-ui/src/components/scenes/Stage.vue`，约 265 行起）：

```ts
const emotionsQueue = createQueue<EmotionPayload>({ handlers: [async (ctx) => {
  if (stageModelRenderer.value === 'vrm')        await vrmViewerRef.value!.setExpression(EMOTION_VRMExpressionName_value[ctx.data.name], ctx.data.intensity)
  else if (stageModelRenderer.value === 'live2d') currentMotion.value = { group: EMOTION_EmotionMotionName_value[ctx.data.name] }
  else if (stageModelRenderer.value === 'spine') spineSceneRef.value?.setEmotion(ctx.data.name, ctx.data.intensity)
  else if (stageModelRenderer.value === 'tachie') ...
  else if (stageModelRenderer.value === 'mmd') ...
}]})
```

注意一个**重要的架构差异**：AIRI 的 Live2D 分支把情绪映射到**动作组**（`EMOTION_EmotionMotionName_value`，`constants/emotions.ts`，Neutral → `'Idle'`），而**不是** exp3 表情文件——AIRI 的「表情」是直接操纵模型参数的（`expression-store` 里的 `parameterId`/`blend`），走的是另一条更底层的通道。OLV 则是 `setExpression(index)` 走官方 exp3 表情文件。

#### 3.2.2 协议对照

| 能力 | OLV 做法 | AIRI 做法 | 差距判定 |
|---|---|---|---|
| 标记语法 | `[keyword]` | `<|ACT {json}|>`、`<|DELAY:n|>` | AIRI 结构更强 |
| 载荷 | 整数索引（依赖后端 emo_map） | 具名 emotion + intensity(0..1) | **AIRI 强** |
| 转义 | 无 | `<{'|'}` / `{'|'}>` 归一化 | **AIRI 强** |
| 流式安全 | 否（整句后处理） | 是（增量解析器 + tail holdback） | **AIRI 强得多** |
| 强度控制 | 无 | `intensity` | **AIRI 强** |
| 时长/自动复位 | 无 | `duration` + `resetTimer` | **AIRI 强** |
| 混合模式 | 无 | `Add`/`Multiply`/`Overwrite` | AIRI 独有 |
| 工具调用通道 | 无 | `expression_*` 五个 zod 工具 | AIRI 独有 |
| 逐表达式授权 LLM | 无 | `'all'\|'none'\|'custom'` | AIRI 独有 |
| 文本剥离 | 后端 `remove_emotion_keywords()` | 解析器天然分流 `literal`/`special` | 打平（都可实现），AIRI 更干净 |
| 跨渲染器统一情绪 | 无（只有 Live2D） | 一个队列分发到 vrm/live2d/spine/tachie/mmd | **AIRI 强得多** |
| 前端执行 | 只用 `expressions[0]` | 全量入队 + 逐帧应用 | **AIRI 强** |

**结论：表情/动作协议是 OLV 最不值得照搬的部分，AIRI 已全面领先。**

唯一可借鉴的是它的**教学价值**：OLV 用 20 行 Python 就实现了"LLM 输出表情标记 → 前端执行"的最小闭环，非常适合用来向非工程角色解释"AI 为什么能做表情"。作为 Aimy 的**实现**则不成立。

### 3.3 口型同步

**OLV：官方 sample 的 WAV RMS 方案。**

核心在 `WebSDK/src/lappwavfilehandler.ts`：

```ts
public update(deltaTimeSeconds: number) {
  if (this._pcmData == null || this._sampleOffset >= this._wavFileInfo._samplesPerChannel) {
    this._lastRms = 0.0; return false
  }
  this._userTimeSeconds += deltaTimeSeconds
  goalOffset = Math.floor(this._userTimeSeconds * this._wavFileInfo._samplingRate)
  ...
  rms = Math.sqrt(rms / (this._wavFileInfo._numberOfChannels * (goalOffset - this._sampleOffset)))
  this._lastRms = rms; this._sampleOffset = goalOffset; return true
}
public getRms(): number { return this._lastRms }
public start(filePath: string): void {
  this._sampleOffset = 0; this._userTimeSeconds = 0.0; this._lastRms = 0.0; this.loadWavFile(filePath)
}
```

启动（`use-live2d-model.ts`）：

```ts
playAudioWithLipSync(audioPath, modelIndex)  // model._wavFileHandler.start(fullPath) + audio.play()
```

增益补偿（`use-audio-task.ts`）——**猴补丁**：

```ts
const lipSyncScale = 2.0
model._wavFileHandler.update = function (deltaTimeSeconds: number) {
  const result = originalUpdate(deltaTimeSeconds)
  this._lastRms = Math.min(2.0, this._lastRms * lipSyncScale)
  return result
}
```

特征：

| 项 | OLV |
|---|---|
| 信号来源 | 完整缓冲 WAV 的**逐 20ms RMS 幅度** |
| 是否有音素信息 | **无**，纯响度 |
| 音频来源 | 必须是一个可被 SDK 读到的**文件路径**（`loadWavFile`），配合 `data:audio/wav;base64,` URL |
| 增益 | 运行时覆盖 SDK 方法，硬编码 ×2 |
| 与 TTS 的关系 | 依赖后端按 20ms 切好 `volumes` 数组 |

**AIRI 做法（`packages/model-driver-lipsync/src/live2d/index.ts`）：**

```ts
const lipSync = await createLive2DLipSync(audioContext, wlipsyncProfile as Profile, live2dLipSyncOptions)
```

- 用 **`wlipsync` 的 `createWLipSyncNode` AudioWorklet** 做**元音提取**；
- `RAW_KEYS = ['A','E','I','O','U','S']`，其中 `S → I`（注释写明"to avoid a hard snap"）；
- 可调参数：`cap 0.7`、`volumeScale 0.9`、`volumeExponent 0.7`、`mouthUpdateIntervalMs 40`、`mouthLerpWindowMs 120`；
- 返回 `{node, getVowelWeights(), getMouthOpen(), connectSource()}`。

参数写入（`packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts`，约 733–798 行 + `components/scenes/live2d/Model.vue` 约 462 行）：

- 插件管线按 phase 注册，`useMotionUpdatePluginLipSync(mouthOpenSize, nowSpeaking)` 注册在 **`'final'`** 阶段，**独占 `ParamMouthOpenY`**；
- 用 `nowSpeaking`（而不是 `mouthOpenSize > 0`）作为说话边界，走**释放尾音强制归零**；
- 通过 `getParameterValueById('ParamMouthOpenY')` 读**动作本身写进去的值**再做混合，**避免双重写入**；
- `Model.vue` 里 `mouthOpenSize = computed(() => Math.max(0, Math.min(100, props.mouthOpenSize)))`。

**同一个 lip-sync 驱动被三套渲染器共用**：`stage-ui-three/src/composables/vrm/lip-sync.ts`、`stage-ui-mmd/src/composables/mmd/lip-sync.ts`、`stage-ui/src/components/scenes/Stage.vue`。

| 能力 | OLV | AIRI | 判定 |
|---|---|---|---|
| 信号 | WAV RMS（响度） | AudioWorklet 元音权重 A/E/I/O/U | **AIRI 强** |
| 音素级 | 否 | 是（元音级） | **AIRI 强** |
| 依赖后处理 | 是（后端算 `volumes`） | 否（前端实时） | **AIRI 强** |
| 平滑 | 无（直接 RMS） | lerp 窗口 120ms + cap | **AIRI 强** |
| 与动作冲突 | 直接写参数 | 注册在 final 阶段 + 读回混合 | **AIRI 强得多** |
| 跨渲染器共用 | 否 | 是（vrm/mmd/live2d 共用） | **AIRI 强** |
| 增益方式 | monkey-patch SDK | 配置项 `volumeScale` | **AIRI 强** |

**结论：口型同步不值得借鉴。** 唯一可留意的是 OLV 后端把 `volumes` + `slice_length` 随音频一起下发这一**数据通道设计**——但那是因为它前端不做音频分析；AIRI 前端有能力自己算，不需要这个往返。

### 3.4 流式音频播放与打断

**后端下发**（拆解副本 `src/open_llm_vtuber/utils/stream_audio.py`）：`prepare_audio_payload(audio_path, chunk_length_ms=20, display_text, actions, forwarded)`，用 pydub `make_chunks` + `chunk.rms` 算出每 20ms 的归一化 `volumes`，音频 base64 内联。`conversations/types.py` 里的 `AudioPayload` TypedDict 与之镜像。

**WebSocket 消息面**（拆解副本 `src/open_llm_vtuber/websocket_handler.py`）：

| 方向 | 类型 |
|---|---|
| 后端 → 前端 | `full-text`、`set-model-and-conf`、`control`（`start-mic`/`interrupt`/`mic-audio-end`）、`history-*`、`config-files`、`background-files`、`heartbeat-ack`、`error`、`audio` |
| 前端 → 后端 | `audio-play-start`、`interrupt-signal`、`frontend-playback-complete`（还有 `mic-audio-data`/`mic-audio-end`） |

**前端播放**：

- 队列：`src/renderer/src/utils/task-queue.ts` 的 `TaskQueue`，`audioTaskQueue = new TaskQueue(20)`；
- 单例：`src/renderer/src/utils/audio-manager.ts` 的 `AudioManager`；
- 每句流程（`use-audio-task.ts`）：构造 `data:audio/wav;base64,...` URL → `setExpression(expressions[0], …)` → `startRandomMotion("Talk", …)` → 播放 → 发 `audio-play-start` / `frontend-playback-complete`；`aiState === 'interrupted'` 时跳过；
- 丢弃迟到包（`services/websocket-handler.tsx`）：

```ts
if (aiState === 'interrupted' || aiState === 'listening') {
  /* skip — 不入队 */
} else {
  addAudioTask({ ...message.actions?.expressions ... })
}
```

**打断**（`src/renderer/src/hooks/utils/use-interrupt.ts`）：

```ts
function interrupt(sendSignal = true) {
  if (aiState !== 'thinking-speaking') return          // 状态字符串守卫
  stopCurrentAudioAndLipSync()
  audioTaskQueue.clearQueue()
  setAiState('interrupted')
  sendMessage({ type: 'interrupt-signal', text: fullResponse })
}
```

`stopCurrentAudioAndLipSync()` 内部：

```ts
audio.pause(); audio.src = ''; audio.load();
model._wavFileHandler.releasePcmData()
// 再手动重置 _lastRms / _sampleOffset / _userTimeSeconds —— 代码里自注为 "fallback"
```

**特征与问题**：

| 项 | OLV |
|---|---|
| 状态机 | **字符串状态**（`thinking-speaking` / `interrupted` / `listening` / `IDLE`） |
| 打断粒度 | 全局——一次打断停掉**所有**播放 |
| 停止语义 | `pause()` + 清 `src`，**不保证静音完成**（清 `src` 时可能已有音频在硬件缓冲里） |
| 迟到包处理 | 靠状态字符串判断后整包丢弃 |
| 手动重置 SDK 私有字段 | 有，且代码注释里承认是 fallback |
| 播放进度 | 只回 `audio-play-start` / `frontend-playback-complete`，**无中间进度** |
| 「用户已听到的回复」 | 在播放**开始前**就把整句加进 `fullResponse`，中断时回传——**是"已进入播放任务的文本"，不是真正听到的前缀**（此前报告已记录） |

**AIRI 做法**：

- `packages/pipelines-audio/src/speech-pipeline.ts`：**intent 系统**，每个 intent 有 `behavior: 'queue' | 'interrupt' | 'replace'`、自己的 **`AbortController`**，提供 `cancelIntent(intentId, reason)`、`interrupt(reason)`、`stopAll(reason)`，`intent.controller.abort(reason)`，`playback.stopByIntent/stopAll`，`timeline.flush('speech')`，`ttsMaxConcurrent`，`onInterrupt` 监听器；
- `packages/pipelines-audio/src/playback.ts`：

```ts
interface PlaybackClip { id, audio, signal?, startAtMs?, onStart? }
interface PlayingAudio { done, stop({fadeMs}) }   // "Stop resolves only after silence"
interface PlaybackGroup { enqueue, finish, stop }
```

采用了 `nowMs` **音频时钟调度**，`stop({fadeMs})` **淡出到静音后才 resolve**。

| 能力 | OLV | AIRI | 判定 |
|---|---|---|---|
| 打断粒度 | 全局字符串状态 | per-intent `AbortController` | **AIRI 强得多** |
| 打断策略 | 无 | `queue`/`interrupt`/`replace` | AIRI 独有 |
| 停止语义 | `pause()`，不保证静音 | `stop({fadeMs})` 静音后才 resolve | **AIRI 强** |
| 调度 | 顺序 play | 音频时钟 `startAtMs` + `PlaybackGroup` | **AIRI 强** |
| 与 TTS 的并发 | 无 | `ttsMaxConcurrent` | AIRI 独有 |
| 迟到结果处理 | 状态字符串丢弃 | abort signal 传导到各层 | **AIRI 强** |

**结论：流式播放与打断不值得借鉴。** 这部分是 AIRI 明显更成熟的地方，且 Aimy 的"可靠取消"要求恰恰是 AIRI 这套设计的强项。

### 3.5 UI 结构

`src/renderer/src` 的组织（10,710 行业务代码）：

```text
components/
  canvas/    canvas.tsx  live2d.tsx  background.tsx  subtitle.tsx  ws-status.tsx  canvas-styles.tsx
  electron/  input-subtitle.tsx  title-bar.tsx  electron-style.tsx
  footer/    footer.tsx  ai-state-indicator.tsx  footer-styles.tsx
  sidebar/   sidebar.tsx  bottom-tab.tsx  chat-bubble.tsx  chat-history-panel.tsx
             browser-panel.tsx  camera-panel.tsx  screen-panel.tsx
             group-drawer.tsx  history-drawer.tsx  invite-dialog.tsx
             setting/{general,agent,asr,tts,live2d,common,about}.tsx
  ui/        Chakra 封装：button/dialog/drawer/select/slider/switch/tag/toaster/… (22 个)
context/     15 个：ai-state  bgurl  browser  camera  character-config  chat-history
             group  live2d-config  mode  proactive-speak  screen-capture
             subtitle  vad  websocket
hooks/       canvas/  electron/  footer/  sidebar/  utils/   （共 33 个 hook 文件）
services/    websocket-handler.tsx  websocket-service.tsx
utils/       audio-manager.ts  task-queue.ts
locales/     en/  zh/
```

布局：`canvas`（舞台 + Live2D + 字幕 + 背景）为主视图，`footer`（AI 状态指示 + 文本输入）在底，`sidebar`（聊天/历史/设置/浏览器/相机/屏幕面板）在侧，`electron/` 放桌面壳专属 UI。

**几个值得记的设计：**

| 设计 | 位置 | 说明 |
|---|---|---|
| `mode-context` 的 `ModeType = 'window' \| 'pet'` | `context/mode-context.tsx` | 一个布尔式的双形态，pet 模式 Electron-only，带四步 IPC 握手防闪 |
| **组件级鼠标穿透** | `main/window-manager.ts` + `use-draggable.ts` | 渲染端上报**悬停组件集合**，主进程在集合为空时才穿透。比"整窗穿透/不穿透"精细得多 |
| `forceIgnoreMouse` 独立 store | `hooks/utils/use-force-ignore-mouse.ts` | 一个 zustand store，托盘菜单可强制穿透，覆盖组件级判定 |
| `useDraggable(componentId)` | `hooks/electron/use-draggable.ts` | 浮层组件拖动（`translateX(-50%) translate(x,y)`），并在 pet 模式下通知主进程悬停状态 |
| context 数量 | 15 个 | 用 React Context 组织，但**部分状态又用 zustand**（`forceIgnoreMouse`），风格不统一 |

**对照 AIRI**：AIRI 是 **多窗口**架构（`apps/stage-tamagotchi/src/main/windows/` 下有 caption/spotlight/inlay/chat-floating/desktop-overlay），配 tray、`single-instance`、`ozone`、`debugger`、`file-logger` 等主进程模块，渲染侧有 `stores/window.ts`、`stage-window-lifecycle.ts`、`bridges/electron-auth-callback.ts`。OLV 只有**单窗口 + 两种模式**（window/pet）。

| 能力 | OLV | AIRI | 判定 |
|---|---|---|---|
| 窗口数量 | 1 个窗口，2 种模式 | 5+ 独立窗口 + overlay | **AIRI 强** |
| 穿透粒度 | **组件级**（悬停集合） |  **像素级 alpha 命中测试**（`isTransparentByPixelsExact`、three 的 `isTransparentByThreeExact`）+ `useElectronMouseAroundWindowBorder` 边缘带判定 + Wayland 特殊处理 | **AIRI 强得多** |
| 主进程模块化 | 3 个文件 | 按窗口/职能分离，含 `window-contract.test.ts` | **AIRI 强** |
| 设置界面 | 7 个设置页 | 有独立的 model-settings（live2d/vrm/mmd 各一） | AIRI 更完整 |

**结论：UI 结构不值得借鉴。** AIRI 在多窗口、穿透判定、主进程模块化上都更强。OLV 唯一值得单独记的是"悬停集合"这个**思路**（AIRI 用的是更精确的像素判定，已经超越它）。

### 3.6 模型资产与许可证

拆解副本 `live2d-models/`：

| 模型 | 结构 | 内容 |
|---|---|---|
| `mao_pro` | `runtime/{mao_pro.moc3, .model3.json, .physics3.json, .pose3.json, .cdi3.json, .4096, motions/, expressions/}` + `ReadMe.txt` | 8 个表达式 `exp_01`–`exp_08`；动作 `mtn_01`–`mtn_04` + `special_01`–`special_03`；动作组 `Idle`；`Groups`: EyeBlink → `ParamEyeLOpen`/`ParamEyeROpen` |
| `shizuku` | `runtime/{shizuku.moc3, .model3.json, .physics3.json, .pose3.json, .cdi3.json, .1024, motion/}` + `ReadMe.txt` | Cubism 2.1 → 4 转换产物；动作组 `FlickUp`/`Tap`/`Flick3`/`Idle`；`Groups`: EyeBlink → `PARAM_EYE_L_OPEN`/`PARAM_EYE_R_OPEN`，**LipSync → `PARAM_MOUTH_OPEN_Y`**；`"HitAreas": []`（**没有命中区域**） |

**注意 `shizuku` 的 `"HitAreas": []`**——这意味着 F07 的点击动作对它**完全无效**，`startTapMotion` 永远走"合并全部配置"分支。这是模型资产与 UI 功能不匹配的实际坑。

后端模型目录（拆解副本 `model_dict.json`）是**把模型、缩放、偏移、表情映射和点击动作全放在一个声明式配置里**：

```json
[{
  "name": "mao_pro",
  "url": "/live2d-models/mao_pro/runtime/mao_pro.model3.json",
  "kScale": 0.5,
  "initialXshift": 0, "initialYshift": 0, "kXOffset": 1150,
  "idleMotionGroupName": "Idle",
  "emotionMap": { "neutral":0, "anger":2, "disgust":2, "fear":1, "joy":3,
                  "smirk":3, "sadness":1, "surprise":3 },
  "tapMotions": { "HitAreaHead": {"":1}, "HitAreaBody": {"":1} }
}]
```

服务端挂载（拆解副本 `server.py`/`routes.py`）：`cache`、`live2d-models`、`backgrounds`、`avatars`、`web_tool`，以及 **`frontend` 作为最后的 catch-all（`html=True`）**；`/live2d-models/info` 扫描 `{folder}/{folder}.model3.json`。

许可证结论见 §1.4，此处不重复。

---

## 4. 对照 AIRI 的差距分析表

判定口径：**"Aimy 是否缺"** 指当前 AIRI 主工程（`aimy-app/`）是否缺少该项能力。按用户要求，**AIRI 已有的不报为缺口**。

| 能力 | AIRI 现状（具体文件） | 该项目做法 | Aimy 是否缺 | 差距有多大 |
|---|---|---|---|---|
| Live2D 渲染 | `packages/stage-ui-live2d/`，`pixi-live2d-display` + Pinia + composables | vendored 官方 Cubism SDK + 官方 sample 改造，全局单例、`@ts-nocheck` | **不缺** | AIRI 领先，无差距 |
| 表达式协议 | `stage-ui/src/composables/queues.ts` 的 `<\|ACT {json}\|>`；`core-agent/src/runtime/llm-marker-parser.ts` 流式解析 | `[keyword]` 裸标记，后端手写字符扫描 | **不缺** | AIRI 领先一个数量级 |
| 表情/动作工具调用 | `stage-ui-live2d/src/tools/expression-tools.ts`（5 个 zod 工具） | 无 | **不缺** | AIRI 独有 |
| 表情混合 / 强度 / 时长 / 自动复位 | `stores/expression-store.ts`（`Add`/`Multiply`/`Overwrite`、`targetValue`、`resetTimer`） | 无 | **不缺** | AIRI 独有 |
| 逐表达式 LLM 授权 | `expression-store.ts` 的 `Live2DExpressionLlmMode = 'all'\|'none'\|'custom'` | 无 | **不缺** | AIRI 独有 |
| 跨渲染器情绪统一 | `stage-ui/src/components/scenes/Stage.vue` 的 `emotionsQueue` → vrm/live2d/spine/tachie/mmd | 只有 Live2D | **不缺** | AIRI 领先 |
| 口型同步 | `model-driver-lipsync/src/live2d/index.ts`（`wlipsync` AudioWorklet，元音 A/E/I/O/U，cap/lerp 可调） | 官方 sample 的 WAV RMS + monkey-patch ×2 | **不缺** | AIRI 领先 |
| 口型与动作的冲突处理 | `stage-ui-live2d/src/composables/live2d/motion-manager.ts`（`'final'` 阶段、读回混合、释放尾音） | 直接写参数 | **不缺** | AIRI 领先 |
| 音频打断 | `pipelines-audio/src/speech-pipeline.ts`（per-intent `AbortController`、`queue`/`interrupt`/`replace`） | 字符串状态 + 清队列 | **不缺** | AIRI 领先 |
| 停止语义 | `pipelines-audio/src/playback.ts`（`stop({fadeMs})` 静音后才 resolve、音频时钟 `startAtMs`） | `pause()` + 清 `src` | **不缺** | AIRI 领先 |
| 模型导入 / 持久化 | `stage-ui-live2d/src/utils/`（zip loader、OPFS、validator、structure-report、preview，带测试） | 只有 URL 字符串解析 | **不缺** | AIRI 领先 |
| 头部锚点 / 视线 | `stage-ui-live2d/src/composables/live2d/head-anchor.ts`；`Live2D.vue` 的 `cursorPosition`/`focus-at` | `hitTest('Head')` 仅供点击动作用 | **不缺** | AIRI 领先 |
| 环境光滤镜 | `stage-ui-live2d/src/filters/screen-ambient-light.ts` + preview 组件 + 测试卡 | 无 | **不缺** | AIRI 独有 |
| Electron 多窗口 | `apps/stage-tamagotchi/src/main/windows/`（caption/spotlight/inlay/chat-floating/desktop-overlay + tray + single-instance + ozone + debugger + file-logger） | 单窗口 + window/pet 双模式 | **不缺** | AIRI 领先 |
| 鼠标穿透 | `use-chat-floating-click-through.ts` + `pages/index.vue` 的像素级 alpha 判定 + 窗口边界带 + Wayland 处理 | 组件悬停集合 | **不缺** | AIRI 领先 |
| 客户端 VAD | AIRI 有语音输入链路（`Stage.vue` 引 `voice.activeTurns`） | `@ricky0123/vad-web` + Silero ONNX，阈值可调并持久化 | **不缺**（若 AIRI 的具体阈值可调性不如 OLV，属调参空间，非能力缺口） | 需实际对比调参体验 |
| 独立 ASR/TTS 测试台 | 未在主工程看到同等的独立 HTTP/WS 测试页 | `web_tool/main.js`：`POST /asr` + WS `/tts-ws` 的 `partial`/`complete`/`error` + `/cache/{path}` 拼接 + `fetchWithRetry` | **可能缺**（开发工具类，非产品能力） | 小，但工程效率上有价值 |
| 声明式 per-model 配置面 | AIRI 分散在 `view-control`（position/scale）、`model-parameters`（`motionMap`/`availableMotions`/`currentMotion`）、`expression-store`（defaults） | `model_dict.json` 一处集中模型 URL/缩放/偏移/表情映射/点击动作 | **部分缺**：AIRI 能力都有，但**没有单一配置面** | 小，是组织方式差异 |
| 点击动作（tap → motion，带权重随机） | AIRI 有 `motionMap`/`availableMotions` 与动作控制，但**未确认有"按 hit area 配置权重随机动作"这一层**；AIRI 的 hitAreas 目前用于 `head-anchor.ts` 的头部定位 | `startTapMotion()`：区域优先，否则合并全部权重随机 | **可能有小缺口**，需在 Aimy 阶段实测确认 | 小，且 `shizuku` 的 `"HitAreas": []` 说明 OLV 自己也常失效 |
| 后端口型数据通道 | AIRI 前端自算，不需要 | 后端下发 `volumes` + `slice_length` | **不缺**（设计上不需要） | 无 |
| 主动说话 | AIRI 有其他主动性机制（未在本次范围深读） | 空闲计时 → 触发一轮 | **不缺**（不作判断） | 不计入 |
| MotionSync 音素口型 | — | **`src/renderer/MotionSync/` 目录在上游 `main` 分支为空，别名存在但无实现** | **不适用** | 无法比较 |

**总判定：在 8 个指定问题覆盖的所有核心领域里，AIRI 均处于"更强"或"强得多"的位置。** 该前端唯一不重复的能力是**工程效率类工具**（F18 测试台）和**配置组织方式**（声明式 `ModelInfo`），不构成产品能力缺口。

---

## 5. 复用裁决表

裁决口径：`直接复用` = 代码/结构可搬；`借鉴设计` = 只取思路，在自己栈上重写；`弃用` = 明确不做。

| 能力 | 裁决 | 理由 | 落地方式 | 成本 | 优先级 |
|---|---|---|---|---|---|
| 前端整体（React/Chakra/zustand/electron-vite） | **弃用** | Aimy 主工程是 Vue 3 + Pinia + UnoCSS（`aimy-app/packages/stage-ui-*`），换栈等于推倒重来 | — | — | — |
| vendored 官方 Cubism SDK（`WebSDK/**`） | **弃用** | AIRI 走 `pixi-live2d-display`，已有更规范的封装（`stage-ui-live2d/src/utils/*`、`stores/*`） | — | — | — |
| `[keyword]` 表情标记协议 | **弃用** | AIRI 已有 `<\|ACT {json}\|>` + 流式安全解析（`llm-marker-parser.ts`）+ 工具调用；OLV 方案无转义、无强度、非流式安全 | — | — | — |
| `Live2dModel.extract_emotion()`（`live2d_model.py`） | **弃用** | 同上；且它是后端 Python，与 Aimy 的 TS 运行时不同侧 | — | — | — |
| WAV RMS 口型（`lappwavfilehandler.ts`） | **弃用** | AIRI 有 `wlipsync` 元音级方案（`model-driver-lipsync/src/live2d/index.ts`） | — | — | — |
| monkey-patch SDK 做口型增益 | **弃用** | 反模式；AIRI 是配置项（`volumeScale`） | — | — | — |
| 字符串状态机打断（`use-interrupt.ts`） | **弃用** | AIRI 的 per-intent `AbortController` + `stop({fadeMs})` 明显更强 | — | — | — |
| `TaskQueue`（`utils/task-queue.ts`） | **弃用** | AIRI `pipelines-audio` 的 `PlaybackGroup`/`startAtMs` 时钟调度更完整 | — | — | — |
| 组件级鼠标穿透（悬停集合） | **弃用** | AIRI 已是像素级 alpha 判定（`pages/index.vue` 的 `isTransparentByPixelsExact`），领先一代 | — | — | — |
| pet 模式透明全屏窗口（`continueSetWindowModePet`） | **弃用** | AIRI 有 `windows/desktop-overlay/`、`transparentWindowConfig()`、`caption`/`spotlight` 多窗口方案（`windows/shared/window.ts`） | — | — | — |
| Live2D 官方 sample 模型资产（`mao_pro`/`shizuku`） | **弃用（作产品资产）** | 受 Free Material License v1.6 约束，超小规模主体仅限 Internal/Supervision；Shizuku 另有"不得改名改设定"条款。Aimy 走品牌自制路线 | 如确需，仅作**开发期本地调试资产**，不随客户端分发 | 低 | 低 |
| **独立 ASR/TTS 测试台**（`web_tool/main.js` + `recorder.js`） | **借鉴设计** | 这是一条**不经过角色、直接打语音链路**的调试通路：`POST /asr` + WS `/tts-ws`（`partial`/`complete`/`error`）+ `/cache/{path}` 拼接 + `fetchWithRetry`。AIRI 主工程未见到等价独立页面 | 在 Aimy 里做一个 dev-only 页面，复用 AIRI 已有的 provider 抽象，只做"输入文本 → 听 TTS / 传音频 → 看 ASR"两条直连路径 | 中（1–2 天） | **中** |
| **`recorder.js` 的 WAV 编码**（手写 RIFF + `floatTo16BitPCM` + 线性插值重采样到 16k 单声道） | **借鉴设计** | 逻辑正确且自包含（`MediaRecorder` → `decodeAudioData` → WAV）。但**不要照抄到产品路径**：`linear interpolation` 重采样有混叠，产品应走 `AudioWorklet` + `OfflineAudioContext` | 仅作调试工具用；若要产品级重采样，对照 AIRI 的音频管线实现 | 低 | 低 |
| **声明式 per-model 配置面**（`model_dict.json` 的 `ModelInfo`） | **借鉴设计** | AIRI 对等能力齐全但**分散**在 `view-control`（position/scale）、`model-parameters`（`motionMap`/`availableMotions`）、`expression-store`（defaults）。OLV 把 `url`/`kScale`/`initialXshift`/`initialYshift`/`idleMotionGroupName`/`emotionMap`/`tapMotions`/`defaultEmotion`/`pointerInteractive`/`scrollToResize`/`initialScale` 收在一处（`context/live2d-config-context.tsx`） | 在 Aimy 里增加一个**角色包清单（character manifest）**，把上述字段收敛成单一可序列化声明，指向已有 stores 而非新建状态 | 中（3–5 天） | **中高** |
| **点击动作（tap → 动作组，带权重随机）** | **借鉴设计** | `startTapMotion()`（`lappmodel.ts` ~1163）的"命中区域优先，否则合并全部并按权重随机"是一个干净的规则。AIRI 的 `motionMap`/`availableMotions` 目前更偏"手动选动作"，未确认有这一层 | 在 `stage-ui-live2d` 里加一个可选的 tap→motion 映射层，读 `hitAreas`（已有 `head-anchor.ts` 在用），命中则按权重随机播动作组 | 中（2–4 天） | **中** |
| **`threshold` 化的 VAD 配置 + localStorage 持久化** | **借鉴设计** | `DEFAULT_VAD_SETTINGS = {positiveSpeechThreshold: 50, negativeSpeechThreshold: 35, redemptionFrames: 35}`（`context/vad-context.tsx`）把三个关键阈值暴露给用户并持久化，是很好的可调性样板 | 若 Aimy 的语音输入需要现场调参，对照这几个旋钮暴露设置项 | 低 | 低 |
| **`fetchWithRetry`** | **借鉴设计** | 3 次重试、1s 间隔，简单有效（`web_tool/main.js`） | 若 Aimy 有直连 TTS 文件的分支，可用同型策略 | 低 | 低 |
| 主动说话（空闲计时触发） | **弃用（本轮）** | AIRI 已有主动性机制，且此前报告已判定其"只参考触发设计" | — | — | — |
| 相机 / 屏幕采集入对话 | **弃用** | AIRI 有采集入口；且 Aimy 的隐私关闭要求需要更严的授权与晚到结果拒绝 | — | — | — |
| MotionSync（`src/renderer/MotionSync/`） | **不适用** | 上游 `main` 分支该目录**无文件**，无从裁决 | — | — | — |

**总体裁决：无一模块可直接复用（0 项「直接复用」），6 项「借鉴设计」，其余「弃用」。**

---

## 6. 风险与坑

| # | 风险 | 证据 | 影响 |
|---|---|---|---|
| R1 | **本地拆解副本无前端源码** | `.gitmodules` 声明 `frontend` 为子模块；`git submodule status` = `-06a659b…`（未初始化）；`find frontend/` 为 0 文件 | 任何"从拆解副本读前端代码"的说法都不成立。引用必须指向独立的 `Open-LLM-VTuber-Web` 仓库，且要注明是 `main`（源码）还是 `build`（产物） |
| R2 | **`build` 分支只有编译产物** | `/tmp/olv-web-probe`（`06a659b`，branch `build`）内容仅 `assets/`、`favicon.ico`、`index.html`、`libs/` | 若对照 pinned 版本审查，会拿到压缩过的 JS，无法做代码级判断。必须回到对应的源码提交 |
| R3 | **模型许可证不随代码走** | `LICENSE` 明确 MIT 排除 Live2D sample models；`LICENSE-Live2D.md` §1.22/1.23、§2.1.3.1、§2.1.3.2 | 代码是 MIT 不等于模型可用。商用分发 `mao_pro`/`shizuku` 在超小规模主体之外**不被允许**；Shizuku 还禁止改名改设定 |
| R4 | **`shizuku` 无命中区域** | `live2d-models/shizuku/runtime/shizuku.model3.json` 中 `"HitAreas": []` | 点击动作对它是**失效**的，`startTapMotion` 永远走"合并全部"分支。复制这套配置会发现行为与预期不符 |
| R5 | **前端大量 `@ts-nocheck` 与私有成员穿透** | `use-live2d-model.ts`（`// @ts-nocheck`）；`model._wavFileHandler`、`model._modelMatrix`、`model._modelSetting`、`model._expressions` | SDK 升级即碎。任何"照抄实现"的想法都会把这个脆弱性带进来 |
| R6 | **`MotionSync` 目录在上游 `main` 为空，但构建配置引用了它** | `electron.vite.config.ts:20-23` 定义 `@motionsyncframework` / `@motionsync`；`find src/renderer/MotionSync` 无结果 | 目录名暗示存在音素级口型能力，但**源码不存在**。不能据此认为 OLV 有 MotionSync，也不能引用其实现 |
| R7 | **口型增益是运行时猴补丁** | `use-audio-task.ts` 覆盖 `model._wavFileHandler.update`，硬编码 `lipSyncScale = 2.0`、上限 `Math.min(2.0, …)` | 与 SDK 更新循环强耦合；且 ×2 是经验值，换模型/换音色可能不适用 |
| R8 | **打断不保证静音** | `stopCurrentAudioAndLipSync()` 用 `audio.pause()` + `audio.src=''; audio.load()`；代码内自注"fallback"手动重置 SDK 私有字段 | 快速连续打断时可能听到残余音频；这是 AIRI `stop({fadeMs})` 明确处理的场景 |
| R9 | **"已听到的回复"语义不准** | `use-audio-task.ts` 在播放**开始前**把整句加入 `fullResponse`，中断时整句回传 | 对话历史会包含用户并未真正听到的后半句。若移植这个思路到 Aimy，会污染记忆 |
| R10 | **状态机用字符串，跨模块隐式耦合** | `'thinking-speaking'`/`'interrupted'`/`'listening'` 在 `use-interrupt.ts`、`websocket-handler.tsx`、`use-audio-task.ts` 之间靠字面量传递 | 漏改一处即出 bug；AIRI 的 intent + abort signal 正是为解决这类问题 |
| R11 | **换模型有 500ms 魔法延时** | `use-live2d-model.ts`：`setTimeout(() => { LAppLive2DManager.releaseInstance(); initializeLive2D() }, 500)` | 换模型体感有可感知停顿，且不同机器上可能不足或过长 |
| R12 | **`volumes` 方案把音频分析与播放耦合到后端** | `stream_audio.py` 用 pydub 逐 20ms 算 RMS 随音频下发 | 增加带宽与后端 CPU；且这套数据只有在"前端不做音频分析"时才成立，AIRI 不需要 |
| R13 | **单窗口双模式 vs 多窗口** | `main/window-manager.ts` 一个 `BrowserWindow`；`mode-context` 在其上切 window/pet | 想做多层浮层/多角色/独立字幕窗时，这个架构是上限 |
| R14 | **v2 正在重写** | 拆解副本 README 说明 v2 处于早期讨论；此前报告已记录 | 前端 v1 的演进会趋缓；长期跟踪价值下降 |

---

## 7. 一句话结论

**这个前端对 Aimy 的价值是"反面教材 + 三个小样板"：它在 Live2D 表情协议、口型同步、音频打断、鼠标穿透和多窗口这些核心能力上全面弱于 AIRI（其中表情协议和打断是代际差距），唯一值得拿走的是一套独立的语音链路调试台、一个把模型配置收敛成单一声明的角色清单思路，以及一个"按命中区域权重随机播动作"的干净规则。**

**最值得抄的 3 项：**

1. **独立 ASR/TTS 测试台**（拆解副本 `web_tool/main.js`、`web_tool/recorder.js`）——不经过角色直接打 `/asr` 与 `/tts-ws` 的调试通路，AIRI 主工程未见等价物，能显著降低语音链路的排障成本。
2. **声明式 per-model 配置面**（上游 `src/renderer/src/context/live2d-config-context.tsx` 的 `ModelInfo`，配套拆解副本 `model_dict.json`）——AIRI 对等能力齐全但分散在三处 store，收敛成"角色包清单"可以让角色换装/分享变成纯数据操作。
3. **tap → 动作组、权重随机的规则**（上游 `src/renderer/WebSDK/src/lappmodel.ts` 的 `startTapMotion`，约 1163 行）——规则干净、边界清楚，AIRI 的 `motionMap` 目前更偏手动选动作。

**最不值得抄的 3 项：**

1. **`[keyword]` 表情标记协议及其后端解析**（拆解副本 `src/open_llm_vtuber/live2d_model.py` 的 `extract_emotion`）——无转义、无强度、无时长、非流式安全，且只送一个索引；AIRI 的 `<|ACT {json}|>` + `llm-marker-parser.ts` + `expression-tools.ts` 工具调用是完整领先的一代。
2. **WAV RMS 口型 + monkey-patch 增益**（上游 `WebSDK/src/lappwavfilehandler.ts` 与 `hooks/utils/use-audio-task.ts`）——纯响度、无音素、靠运行时覆盖 SDK 方法、硬编码 ×2；AIRI 的 `wlipsync` AudioWorklet 元音方案 + `motion-manager.ts` 的读写混合是正解。
3. **字符串状态机的打断与播放队列**（上游 `hooks/utils/use-interrupt.ts`、`utils/audio-manager.ts`、`utils/task-queue.ts`）——全局粒度、不保证静音、靠字面量字符串跨模块耦合；AIRI `pipelines-audio` 的 per-intent `AbortController` + `stop({fadeMs})` + 音频时钟调度是更可靠的取消链路，也正是 Aimy「可靠取消」要求所依赖的基础。

**附加提醒（非"抄/不抄"范畴，但必须记）：** 拆解副本 `frontend/` 是**未初始化的空子模块**，真实前端在独立仓库 `Open-LLM-VTuber-Web`，`build` 分支只有编译产物、源码在 `main`。**任何后续引用都必须标明这一点，否则会把"编译产物"或"不存在的文件"当成源码。** 同时，`live2d-models/` 下的 `mao_pro` 与 `shizuku` 受 Live2D Free Material License Agreement v1.6 约束，**代码 MIT 不代表模型可用**，不应作为 Aimy 的默认角色资产随客户端分发。
