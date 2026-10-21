# AIRI 交互继承与 Aimy v3 优化映射

- 日期：2026-10-13。
- 状态：设计提案，供前端和 UI 参考；尚未接入产品。
- 来源：仅 `/Users/mima1234/Documents/airi-main` 当前源码，不混用 Aimy 仓库内旧 `airi-main/` 或旧样机。
- 用途：固定 AIRI 已有结构，说明 v3 可改善的操作体验和需补齐的界面状态。
- 风险：本次为静态源码阅读；源码存在不代表真实模型、麦克风、屏幕、恢复或安装包验收通过。未启动产品、未读取凭证或个人会话。
- 替代关系：补充 v3 交互依据；保留粉雾 v1、静玫 v2，未替代当前产品规则、未批准主工程切换或待答选择。
- 版本固定：来源目录无 `.git`，无法据此给出提交号；以下文件 SHA-256 为本次阅读指纹。

## 阅读路径约定

表中 `T/` 表示 `apps/stage-tamagotchi/src/renderer/`，`U/` 表示 `packages/stage-ui/src/`，`L/` 表示 `packages/stage-layouts/src/`，均相对于上述外部 AIRI 来源根。

## 保留的 AIRI 结构

| 结构 | 源码证据 | v3 继承方式 |
|---|---|---|
| 桌面角色主体 | `T/pages/index.vue:409–456`：听觉状态、资源状态、`WidgetStage`、`ControlsIslandRoot` | 保持角色为桌面主体，控件围绕角色浮置；不将陪伴界面重做成数据仪表盘 |
| 角色控制岛 | `T/components/stage-islands/controls-island/index.vue:319–332,446–508`：展开面板含设置，主控含聊天、听觉、静音与拖动 | 保留核心操作和次级面板层次，改善文字提示与状态可识别性 |
| 独立聊天窗 | `T/pages/chat.vue:23–39`：标题栏、`InteractiveArea`、`ChatSessionsDrawer` | 保留标题、历史、底部编辑器和会话抽屉结构 |
| 附着/浮动聊天 | `T/pages/chat-floating.vue:55–88,196–217`：共享草稿交接，内容隐藏仍挂载，键盘移动/缩放 | 保留形态间一致的编辑器与草稿；收起与隐藏语义另待确认 |
| 多模态编辑器 | `T/components/InteractiveArea.vue:183–219,499–538,568–612`：发送键、组合输入、图片预览与反馈、语音输入、发送/停止 | 保留输入能力和操作顺序，补全稳定布局与明确状态 |
| 独立设置与引导 | `T/layouts/settings.vue:63–86`、`T/pages/settings/index.vue:26–58`；`U/components/scenarios/dialogs/onboarding/onboarding.vue:123–166` | 保留独立窗口、返回导航、路由详情及欢迎→服务商→配置→模型的引导顺序 |

## 8 项交互优化提案

### 1. 核心入口可发现

当前设置位于控制岛展开网格（controls island:319–332），会话抽屉通过点击标题打开（chat:25–27）。v3 为聊天、麦克风、声音和设置提供一致的图标、可读名称、焦点态与 tooltip；聊天标题旁补清晰的“历史会话”入口。设置在聊天界面也应可直达，减少用户猜测。

### 2. 编辑器位置稳定

草稿、图片缩略图和回复引用分区，状态变化不推动发送键跳位。继承中文输入法组合期间不发送、发送键偏好和 Shift+Enter 换行（InteractiveArea:183–219,535–538）。将当前发送键以轻量提示露出，避免偏好仅靠悬停或右键发现（:594）。录音期间的只读状态需要解释原因（:526）。

### 3. 图片附件状态完整

覆盖空、读取中、就绪、多图、移除、格式/读取失败；反馈在附件区域出现，错误后保留文字草稿。依据为现有缩略图移除及 `role=alert/status`（InteractiveArea:499–516）。图片预览就绪仅表示附件准备完成，不等于模型已理解图片。形态切换时保留草稿、附件和回复目标（chat-floating:81–88）。

### 4. 连续语音与单条录音分清

控制岛听觉入口是持续麦克风配置；编辑器 `VoiceInputButton` 处理录音和待发送语音消息（InteractiveArea:77–80,568–580）。v3 使用“语音陪伴”和“录一条语音”等不同名称，避免单个麦克风图标承担两种不明行为。持续语音展示等待授权、聆听、转写、思考、说话、已停止、设备中断；单条录音展示录制、预览/待发送、移除。现有听觉配置有设备选择与 Auto send（hearing-config:120–137），不得据此宣称自然连续语音已真实验收。

### 5. 停止始终可辨认

当前逻辑在有响应且编辑器为空时显示停止；输入新草稿后改为发送，并先打断当前回复（`L/composables/use-chat-interruption.ts:25–34,44–50,63–77`）。v3 的正在说话状态提供明确“打断”动作，保留发送键位置，说明被停止的是生成/声音响应。停止失败应给恢复操作；设计状态不可充当取消陈旧模型结果的运行证据。

### 6. 授权状态与采集状态分离

听觉源码分别维护 `permissionGranted` 与 `enabled`（`U/components/scenarios/dialogs/audio-input/hearing-config.vue:14–16,66–74`）。v3 显示“系统已授权”与“正在使用麦克风”的不同状态；麦克风和看屏各自授权、各自停止。看屏设计包含来源选择、正在分享的来源、停止、系统拒绝和来源消失。**当前聊天区显示器图标实际是 `computer-use-toggle`（InteractiveArea:551–563），不等于被动看屏，也不能作为一期电脑自动操作入口。** 看屏界面为 Aimy 设计提案，不能写成原版已有同等能力。

### 7. 设置按用户任务与配置结果组织

保留 AIRI 的独立设置路由、页标题与返回结构（settings layout:63–86），设计首页按角色与表现、声音与输入、模型服务、权限与数据展示当前摘要和待处理事项。服务商及连接地址进入对应详情。配置引导已有未检查、检查中、成功、失败、重试（provider-configuration:66–79,126–183）；界面区分已填写、连接检查通过和实际可用，凭证遮蔽，不把测试通过写成产品验收通过。

### 8. 失败与系统拒绝均有恢复路径

设备失联或系统拒绝授权时，提供保留当前草稿的重试、更换设备、前往系统设置、返回后重新检查状态；未经再次确认不显示正在采集。附件读取/发送失败、连接失败、语音中断分别给就地反馈。源码已有草稿保留依据（chat-floating:81–88）及配置重试依据（provider-configuration:126–183）；系统拒绝后的完整恢复链是待实现/验收契约。收起聊天、应用隐藏、最小化、退出须分别描述，不能从旧样机规则推定。

## 仍待确认的产品选择

- 收起聊天保留原桌面角色，还是应用最小化后另留小角色。
- 重要记忆自动保存，还是逐次确认。
- 低费用观察采用间隔看一眼，还是收集变化后定时汇总。
- 正式角色格式、人设和音色。

这些项目不能由设计库中的演示状态自动定稿。关闭、隐藏或退出停止采集及拒绝新调用的已有底线仍有效；“收起聊天”的具体语义继续待答。

## 源码 SHA-256

```text
1f22654edc0c7d655fffbf9c34f5f1729f65112cb3678286cbc3774aa4ffefc6  T/pages/chat.vue
8d61dcd36df3f0f90f6054d47fde1838e4ea506ed2dd3dbb47fa8043cc0376b2  T/pages/chat-floating.vue
9947b73be7d6c82091fae1bf4fb61281027be3e44716d1bfdbe2d3fe7420c8ad  T/pages/index.vue
80c511e7d1abab1d57ee0a197dff4a0b7a8e1018603616e68a8419578c5e21be  T/components/InteractiveArea.vue
327a2aec9b56483dda51683492372d9921f45303734e6e02282d7f9d938b0830  T/components/stage-islands/controls-island/index.vue
848bfef05b383033d2498f134f8ecc682a26d754677527a4cd684e315bb4f1d9  T/pages/settings/index.vue
72525cd9db7af542538c540e1ac135f362929a39e8688c61048a71e0a1f2830b  T/layouts/settings.vue
c06ad7a364acabaca115dad5f661f3e01d7eb3b86686af585dcfdd224d1b94a4  T/pages/onboarding.vue
05f6aa7fa257ed588501bdaf3064036eabd25baacab05ad5a574902ec4697646  U/components/scenarios/dialogs/onboarding/onboarding.vue
b0ce99adf8e552205cb8aadd3ea931aa5ad70650ea865c43b33a6aae5a32eb93  U/components/scenarios/dialogs/onboarding/step-provider-configuration.vue
056d831e117d45bc23628a43069b607e95fcddecc00248952d579eaebc3b3c95  U/components/scenarios/dialogs/audio-input/hearing-config.vue
a618143be6a89f2c55a47a709515290c40bad7f3716a543cd33c6c1291fba409  L/composables/use-chat-interruption.ts
```

本次没有将 2026-10-10 旧截图当成当前运行证据；交互演示通过也只证明设计参考的演示行为。
