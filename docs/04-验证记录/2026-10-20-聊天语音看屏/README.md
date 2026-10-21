# 聊天界面、共享入口、钥匙串与 MiMo 语音验收

日期：2026-10-20。来源：用户六张布局参考、钥匙串提示原文、确认使用 MiMo、当前 aimy-app 代码、离线与隔离桌面测试。用途：记录本轮实际改动与证据边界。状态：代码、离线回归及源码构建原生验证通过；包内原生点击及安装交付见“安装包”。只在 AIRI 主工程上增量修改，旧 digital-lover 未参与。

## 用户可以体验什么

| 变化 | 实际行为 | 没有据此宣称的效果 |
|---|---|---|
| 聊天／角色／我 | 宽窗会话列表，窄窗底部导航；白色接收与绿色发送气泡、双方头像；角色用原角色卡，“我”进入资料及所有原设置 | 不包含微信好友、朋友圈、支付；不复制截图里的私人头像、姓名、聊天 |
| 屏幕共享 | 聊天与人物侧栏可选屏幕／窗口并开始，一键停止；有共享状态、权限与模型错误说明 | 不能绕过 macOS 授权；真实视觉模型效果本轮未测 |
| 陪我看游戏 | 同一条共享链，关注可见游戏画面 | 不控制游戏、不执行鼠标键盘；不等于 Minecraft/Factorio 机器人 |
| 钥匙串 | 实例缓存先检查再解密；设置页保存状态不读密钥；MiMo 静态目录不顺带读取其他服务；失败暂停，用户显式重试 | 未读取 Keychain ACL；首次使用或 ad-hoc 更新后的系统授权仍可能出现，不承诺永久免密码 |
| MiMo 流式语音 | 标准 mimo-v2.5-tts 的 PCM 可在响应结束前进入原播放链，停止透传；设置里可手动采用自然语气建议 | 未试听或比较实际首音延迟，不能声称达到 GPT 或优于原版；设计／克隆音色仍走整段返回 |

原聊天、角色、Provider、录音、播放、权限、资料和持久化 owner 继续沿用 AIRI。原发送、图片、语音消息、引用、复制、删除、重试、工具显示与浮动窗拖动／缩放／折叠保留。弹幕形态继续使用原表现。草稿按当前窗口的账号／会话隔离；跨窗口模式交接沿用原接口。外部切换时原 reply watcher 的瞬时回复目标不保证恢复，本地点击切换前则会保存快照。

## 如何把声音做得更自然

“活人感”至少包括内容口语化、语气停顿、开口速度、接话与打断。本轮先改善 MiMo 的播放机制，并提供可选择的语气提示，不通过新增导演模型增加费用。原短句分段策略没有重写，不把此次成果说成所有段间停顿已经优化。风格按钮清楚标注会替换当前风格，挂载页面不会改用户已有输入。

当前仍是聊天模型生成文字，再由 MiMo 合成声音。原生语音到语音是另一条需要单独评估的模型接入路线；本轮没有切换供应商，也没有假设 ChatGPT 的具体内部模型。要判断真实收益，应在相同 MiMo 模型、音色、文本下试听，并测首音、停顿和打断；本轮没有动用此前八例记忆测试预算。

协议来源：[MiMo Speech Synthesis v2.5 官方指南](https://mimo.mi.com/docs/en-US/quick-start/usage-guide/audio/speech-synthesis-v2.5)。架构参考：[OpenAI Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations)。

## 验证与已修复问题

| 检查 | 结果与证据 |
|---|---|
| 最终完整界面回归 | 52项通过：原InteractiveArea39、Messenger组合6、展示2、共享控件5。[日志](evidence/ui-final.log) |
| 消息显示回归 | 既有47项与新增Messenger5项通过；真实宽窄／深浅组件截图已检查。[旧功能](evidence/history-regression.log)、[新外观](evidence/history-messenger.log) |
| 共享与聊天出站 | Node59项及真实Pinia／Canvas两窗7项通过；停止、过期、切角色／账号／模型、删除会话、迟到输出都拒绝陈旧画面。[Node](evidence/screen-node.log)、[浏览器](evidence/screen-browser.log) |
| MiMo播放 | 协议12+ASR3、真实consumer5+语音设置9通过。覆盖SSE分块、PCM奇数字节、取消、错误与原播放路由。[协议](evidence/voice-protocol.log)、[消费链](evidence/voice-consumer.log) |
| 凭据 | native安全存储10、Provider运行12、MiMo页6等定向检查通过。多加密服务页面挂载零读密钥／零HTTP，实际预览才解析。[native](evidence/credentials-native.log)、[运行](evidence/credentials-runtime.log)、[页面](evidence/credentials-page.log) |
| 类型／构建 | Desktop、stage-ui、stage-pages、provider、core、i18n相应检查通过；桌面完整构建通过。[构建](evidence/desktop-build.log) |
| lint | 定向ESLint无错误。根pnpm lint尝试但被已有文档站依赖 @radix-ui/colors 缺失阻断，未擅自装依赖。[阻断原日志](evidence/full-lint-blocked.log) |
| 原生窗口／系统捕捉 | 独立测试profile、真实Electron，人物侧栏与聊天follower分别实际点选自建合成窗口→采集→停止。主Stage获得第一帧；视觉推理使用合成stub，没有模型请求。[回执](evidence/native-screen.json) |
| 正常退出／秘密边界 | 隔离窗口正常退出，真实密钥解密次数0。[退出](evidence/native-quit.json) |

审查中真实发现并修复：MiMo页加载无关服务目录造成额外解密；侧栏弹窗未纳入防穿透交互状态；启动媒体未完成时关闭选择器未取消；旧窗口取消干扰新窗口选择；重复选择同会话后丢最新草稿；迟到草稿恢复拉回旧会话。均有对应回归，未用隐藏错误或替换整套数据链处理。

测试浏览器有既有 Virtualizer ResizeObserver 通知告警，同一fixture在原stage外观也可复现。日志保留，测试成功不等于已消除所有原有告警。

## 看图

以下全为合成资料的真实组件渲染，不是用户私人资料，也不是凭空制作的设计稿。

- [宽窗聊天](evidence/messenger-wide.png)
- [窄窗聊天](evidence/messenger-narrow.png)
- [我的资料与设置](evidence/messenger-me.png)
- [深色消息](evidence/messenger-dark-bubbles.png)
- [原生聊天窗口](evidence/native-chat.png)

## 代码接点

均相对 aimy-app：

- 桌面组合：`apps/stage-tamagotchi/src/renderer/components/messenger/`、`pages/chat.vue`、`pages/chat-floating.vue`、原 `InteractiveArea.vue`。
- 气泡：`packages/stage-ui/src/components/scenarios/chat/components/{history,assistant-item,user-item,message-avatar}.vue`；新外观可选，其他宿主默认不变。
- 共享：`renderer/stores/screen-sharing.ts`、`components/screen-share-control.vue`、App初始化、Stage侧栏、两个原开发者入口；沿用原capture/orchestrator；`stage-ui/services/screen-context.ts`与原chat/core出站边界校验。
- 凭据：原main provider-secrets服务、IPC、storage adapter、Provider实例缓存、验证composable、MiMo设置页。
- 语音：原provider-inference MiMo adapter新增stream.ts，原stage-ui speech store接原SpeechOutput/PcmBlock；没有第二音频播放器。
- 文案：i18n英文和简中，原i18n入口导入Messenger／screenSharing。

无Git提交／暂存／推送，无私人数据迁移或清空。此前staged快照仍相同。相关功能与技术边界见[实施手册](../../05-实施手册/2026-10-20-聊天改版与语音看屏/README.md)。

## 安装包

版本 `0.12.0-beta.5+aimy.20261020.1` 已装到 `/Users/mima1234/Applications/Aimy体验版.app`，桌面原链接保持。原 `.5` 程序保存在 `/Users/mima1234/Library/Application Support/Aimy-Package-Backups/20261020/Aimy体验版-更新前.app`。

使用已验证 `.5` 的相同依赖和原生资源；通过官方 ASAR streams API 有界替换完整新构建，未重新安装依赖。核对1,382个新构建文件、41,188个继承文件，main仅在打包副本中关闭上游自动更新。身份 `ai.aimy.preview`、preview入口及 `Aimy-Preview` 数据位置不变。安装器不读取、迁移或清空私人资料。

沿用 `codesign --force --deep --sign - --options 0`，严格验证通过；未改Gatekeeper或Keychain ACL。新包ASAR SHA256：`366649695a82f78653858a36b4cca42eb2fdb64769c6956c921791b18882462b`。

精确包内代码以独立appData、外网阻断、禁止密钥解密方式运行，系统录屏权限已授予。使用computer use实际点按Stage与chat-floating，共享自建合成窗口并停止，视觉调用为stub。首个脚本未在引导遮挡期间点中控件，其失败日志保留；之后关闭测试引导，再用原生点按验证成功，没有修改产品来绕过。正常退出，密钥解密0次。

回执：[安装](evidence/installation.json)、[包字节核对](evidence/package-proof.json)、[原生点按](evidence/package-native-cua.json)、[包内正常退出](evidence/package-native-quit.json)。这不代表真实MiMo听感、真实视觉理解或用户的Keychain授权已验收。

安装后已由LaunchServices打开已签名程序，持续运行超过40秒。只核对进程，不读取私人窗口／配置证明启动；正常应用自行访问原profile不等于安装器或工具读取密钥。
