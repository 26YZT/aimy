# MasterGo 聊天界面改版验收

日期：2026-10-20。状态：已实现、验证并更新体验版 `0.12.0-beta.5+aimy.20261020.2`。用途：记录本轮视觉来源、改动、真实渲染、检查范围与交付。

## 视觉来源与适配

用户明确取消微信参考，改用 MasterGo《聊天软件界面设计》。用户完成登录后，读取 Page 1 的 Chat、Contacts、In Chat 默认／搜索／滚动／输入画板。未编辑原稿、改权限或复制其中示例人物照片到产品。详见[设计锁与原稿截图](../../06-视觉设计/2026-10-20-MasterGo聊天改版.md)。

本轮不是只换主题色：白底、紫色渐变发送气泡、浅紫接收气泡、圆角色头像、非对称圆角、轻分隔列表、常规字重标题、紧凑描边输入栏均按原稿重新组织。窄窗进入会话时隐藏底部导航，返回列表后再展示聊天／角色／我；宽窗保持原桌面三栏。浮动窗工具条变简洁，保留移动、缩放、静音、样式与收起。

原稿是375×667手机界面，桌面工具条、宽窗三栏、中文字体、“我”与深色模式属于Aimy适配。为可读性加深灰蓝文字；不伪造原稿的未读数、已读或对方正在输入状态。未增加空功能的表情按钮。

## 实际效果

- [原生新包聊天截图](evidence/native-chat.png)：隔离profile内的6条合成测试消息，不是用户私人聊天，也不是模型实际回复。
- [窄窗真实组件](evidence/messenger-narrow.png)、[宽窗](evidence/messenger-wide.png)、[我](evidence/messenger-me.png)、[深色气泡](evidence/history-dark.png)。

源参考对照：灰底／绿色／方头像已替换为白底／紫色／圆头像；输入栏从大框改为紧凑自动增高栏；消息、角色、设置仍接原有功能。

## 改动范围

唯一产品目录仍是 `aimy-app`。修改Messenger展示与局部样式、InteractiveArea的输入布局、消息item/avatar、浮动窗外框；没有改会话／角色／Provider／语音／共享／凭据／记忆的产品逻辑或schema。录音状态、附件预览、引用、多行输入、发送／停止继续由原组件负责。其他宿主默认stage外观不变。

测试维护：当前源码的capture已使用共享Eventa renderer边界，旧测试仍mock旧vue入口。补上当前原生适配器的mock后验证通过；没有为通过测试修改看屏产品实现。另修复本轮涉及组件里的dark scoped选择器，避免Vue编译后意外作用于整个`.dark`页面。

## 检查

| 项目 | 本次结果 |
|---|---|
| 聊天／导航／草稿／附件／共享控件 | 最终52项通过，[日志](evidence/ui-final.log) |
| 共享真实Pinia／Canvas store | 7项通过；与控件5项合跑共12，[日志](evidence/screen-regression-final.log) |
| 气泡／宽窄／深浅色／消息动作 | 5项通过，[日志](evidence/history-final.log) |
| 组件输入布局 | 短输入栏小于70px，多行可增长到90px以上，清空后恢复；未读真实凭据 |
| 类型 | Desktop、stage-ui检查通过 |
| 构建 | 完整桌面构建通过，[日志](evidence/build-delivery.log) |
| 定向lint | 0错误，保留既有warning，[日志](evidence/scoped-lint-delivery.log) |
| 全仓pnpm lint | 被文档站缺少`@radix-ui/colors`阻断；未安装依赖掩盖，[日志](evidence/root-lint.log) |
| 全仓pnpm typecheck | 被可选scenarios包缺失本地工具阻断，其他任务随turbo终止；不能称全仓通过，[日志](evidence/root-types.log) |
| 原生窗口 | 精确包内入口、独立appData、外网阻断：实际打开聊天并目视对照，6条合成消息正确呈现；原生返回／角色／我未逐项重复点按，相关行为由真实组件回归覆盖 |
| 隐私／费用 | 隔离profile正常退出，真实密钥解密0次；无本轮付费模型调用 |

上述计数有交叉：52项中已包含共享控件5项；独立用例合计64项。既有Virtualizer ResizeObserver告警保留在日志，不代表已修复该告警。

本轮早期/tmp验证目录被清理，未据此改写源码。已把最终日志、截图直接保存在本目录并重新执行检查。当前原稿与最终验证材料均已保留。

## 包装与安装

继续使用原身份 `ai.aimy.preview`、原数据目录 `~/Library/Application Support/Aimy-Preview` 和桌面链接。只替换程序，安装器没有读取、迁移或清空私人资料；旧版程序已留备份。继承的41,188个依赖／资源文件核对通过，新构建1,381个文件逐字节核对。仅打包副本关闭上游自动更新，使用ad-hoc `--options 0`并严格验签。

安装位置：`/Users/mima1234/Applications/Aimy体验版.app`。

备份：`/Users/mima1234/Library/Application Support/Aimy-Package-Backups/20261020-MasterGo/Aimy体验版-紫色界面更新前.app`。

ASAR SHA256：`4f8610c5534aa56bf47e222557930f88feed0df28e7cd4a535fd03a319c0cb00`。

[安装与启动回执](evidence/installation.json)、[包内容核对](evidence/package-proof.json)。安装后通过LaunchServices打开已签名程序，只核进程，不查看私人窗口。无暂存、提交、推送或公开发布。
