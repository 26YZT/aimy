# 侧栏、头像、语音同步与雾蒙粉验证

日期：2026-10-20。状态：已完成源码、自动化检查、原生点按，并更新体验版 `20261020.3`。来源：用户5张截图与本轮实际代码／测试。用途：记录本轮变化和可证明的范围。技术边界见[实施手册](../../05-实施手册/2026-10-20-侧栏头像语音与雾蒙粉/README.md)。

## 用户能看到的变化

1. 角色窗口右侧固定一列按钮；展开仍为一列，小窗口可以纵向滚动。看屏、游戏只在这里，长权限错误进入自己的详情弹窗，不再挤乱聊天标题。
2. 点聊天标题头像或角色列表头像，可以选择本地图片、保存或恢复默认头像。沿用原角色卡，图片不上传；对话、角色列表及其它窗口共享同一头像。
3. 角色和聊天的麦克风主按钮共用开关。任一端关闭，两边停止；聊天菜单仍保留单条语音和转文字，角色端右键可以进入语音设置。原有语音服务配置继续使用。
4. 默认配色使用用户参考中的雾蒙粉，聊天气泡、选中态、侧栏与设置共用主题色。新安装和旧工厂默认色迁到雾蒙粉，用户主动选择过的自定义色保留。

这次保留MasterGo的页面结构，只替换用户明确要求的颜色和交互。语音自然度、模型准确率与语音服务本身不是本轮已证明的改善。

## 根因与修复

- 散乱按钮来自原四象限停靠、横向展开和共享控件内的横排／长错误文本。现在固定右上停靠、40px单列，弹窗单独承载详情。
- 聊天录音此前直接获取应用内采集许可，没有先开启许可；连续聆听也存在先启动、后授权的竞态。现在由原Stage语音owner等待许可、管理单采集源，其它窗口只发命令和显示状态。
- 手动录音与听写从“等待权限／停止旧监听”阶段就互斥；取消的旧请求不能影响下一次开麦或释放新请求的位置。测试先复现了错误，再修复。
- 侧栏共享和连续听写采用正在交互的聊天会话；背景窗口恢复不能抢目标，切换目标停止旧共享。删除或越权会话拒绝继续。
- 头像提交只写原metadata.avatar，先持久化再同步。旧角色编辑草稿不能覆盖新头像；取消／关闭／角色或账号变更拒绝迟到结果。关闭时等待取消回执，预期取消不被误判成保存故障。

## 验证证据

| 检查 | 结果与范围 |
|---|---|
| 桌面UI | 57项通过，包含真实组件输入、侧栏布局及共享控件；[日志](evidence/desktop-ui-final.log) |
| Messenger原数据链 | 13项通过，覆盖导航、草稿、头像维护、取消与后台目标保护；[日志](evidence/messenger-final.log) |
| 共享目标 | 10项通过，真实Pinia／Canvas；[日志](evidence/interaction-target-final-2.log) |
| 主题／原会话 | 33项通过，含主题4项和原会话29项；[日志](evidence/theme-session-final.log) |
| 语音 | 36项浏览器测试通过，真实host/bus/store及两消费者；麦克风、VAD、ASR为合成边界，未调用真实付费服务；[日志](evidence/voice-final.log) |
| 头像owner | 8项跨窗口／原角色编辑保护通过；[日志](evidence/avatar-owner-final.log)；取消令牌3项、图片解码5项、原卡编辑页5项通过（[编辑页](evidence/avatar-editor-regression.log)）；原卡既有同步／继承17项也通过 |
| 类型／lint | Desktop、stage-ui、stage-pages相关类型通过；定向lint无剩余错误，保留已有warning。不是全仓所有可选包均已通过 |
| 桌面构建 | 完整electron-vite build通过；[日志](evidence/build-final.log) |
| 新进程恢复 | 精确新ASAR＋独立profile：头像保存后正常退出，再启动头像hash一致，雾蒙粉保持，麦克风默认关闭；[保存](evidence/avatar-save.json)、[重启](evidence/avatar-restart.json) |
| 原生按钮点按 | 解锁后实际打开聊天、选图保存、角色端开麦／聊天端关麦、菜单单条录音／Escape取消、收起聊天均通过；[回执](evidence/native-click-receipt.json) |

计数存在交叉，不合并成“总功能数量”。ResizeObserver和测试路由等已有控制台告警保留在原日志，未声称全部清除。

## 包内容与交付边界

候选包版本 `0.12.0-beta.5+aimy.20261020.3`，新构建1,382个文件逐字节检查，41,188个继承依赖／资源保持，原preview入口、应用身份与资料目录不变。仅编译副本关闭上游更新；ad-hoc签名使用`--options 0`，strict/deep验证通过。

ASAR SHA256：`4ee39e7cc842a57f5a0454b2e8528826bd277a582a407887d8910d80ba10da44`。

[包证据](evidence/package-proof.json)、[签名验证](evidence/signature-verify.txt)。本轮不读取真实密钥、不调用付费模型、不迁移／清空私人资料、不暂存／提交／推送。原生资料检查使用独立缓存目录下的合成会话。

## 解锁后的实际复测与交付

[聊天实图](evidence/native-chat.png)、[角色右栏实图](evidence/native-rail.png)。测试图中的对话和头像仅属隔离资料；聊天服务未配置提示是隔离环境状态。头像通过系统文件选择器选图并点保存，退出再启动后hash一致，见[点击保存后](evidence/native-ui-avatar-before.json)与[重启后](evidence/native-ui-avatar-restart.json)。

角色端开麦后，聊天和Stage的enabled／ready／listening同时为true；聊天端关闭后两边均为false，见[开启](evidence/native-microphone-on.json)与[关闭](evidence/native-microphone-off.json)。单条录音能进入计时，Escape恢复输入栏。本轮Chromium使用合成设备，外网被阻断，连续识别曾显示Failed to fetch；因此不声称验证了真实ASR服务或声音效果。原生拖到屏幕四角未逐项复跑，几何与小尺寸可达性采用浏览器验证。

已安装并经LaunchServices打开 `/Users/mima1234/Applications/Aimy体验版.app`，版本 `0.12.0-beta.5+aimy.20261020.3`；桌面原链接继续可用。旧包备份在 `/Users/mima1234/Library/Application Support/Aimy-Package-Backups/20261020-Rose/Aimy体验版-雾蒙粉更新前.app`。仅替换程序；没有读取／迁移／清空用户资料。启动只核对进程，不读取私人窗口或密钥。[安装回执](evidence/installation.json)。
