# Aimy体验版：新功能打包与安装更新

日期：2026-10-18（Asia/Shanghai）。状态：用户明确要求更新后体验；新包已安装并实际启动，旧程序留备份。来源：当前源码、前轮111项工程记录、此次构建/包内容/签名/隔离运行与安装回执。用途：确认新增能力确实进入用户打开的App，不把源码修改当作已更新安装包。此前真实记忆失败和设备/自然度未验结论保持。

## 现在打开什么

- 应用：`/Users/mima1234/Applications/Aimy体验版.app`
- 桌面快捷入口：`/Users/mima1234/Desktop/Aimy体验版.app`，仍指向上述应用。
- 本次版本：`0.12.0-beta.5+aimy.20261018.1`，构建号 `2026.10.18`。
- 新增入口：设置 → 陪伴增强；VRM检查沿原角色导入入口。新增自动功能默认关闭，保存后生效。
- 旧程序备份：`/Users/mima1234/Library/Application Support/Aimy-Package-Backups/20261018/Aimy体验版.app`。

应用身份保持 `ai.aimy.preview`，名称保持Aimy体验版；继续使用 `/Users/mima1234/Library/Application Support/Aimy-Preview`。安装器没有读取或迁移私人聊天、模型配置、密钥文件，没有清空/替换数据目录。正常打开后的应用依照既有行为读取自己的设置；未通过查看私人窗口内容来证明配置保存。

## 核对与结果

1. 更新前读取旧App的代码归档，确认没有companion-settings新模块；旧包SHA留在installed-before.json。
2. 46个本轮源码/接点hash与前轮测试快照一致；重新完成普通桌面构建，未安装/升级依赖或新增产品行为。
3. 沿原preview入口打包，保持固定profile和清理验收/调试环境变量；仅编译副本关闭AIRI上游自动更新，源main与普通构建不改。添加本轮THIRD_PARTY_NOTICES与许可证。
4. 包含47,552个归档条目；逐字节核对1,380个普通构建文件。main单独与停用更新后的副本比对。续聊、回顾、语音转换、设置、资产检查标记存在；未发现.env、provider-secrets、credential-binding、ledger等禁止文件。
5. 隔离运行实际包内app.asar入口，显示“稍后接着聊、回顾重要的事、声音与语音输入、角色互动、本地行为规则”五组；七项自动开关均关。将等待时间设为17分钟，正常退出后同一测试profile重开，revision=1和17分钟均恢复。两次正常退出均约2秒，无强杀。
6. 隔离检查由同版本已安装Electron加载精确包内入口，并在入口前指定独立appData；使用OS外网隔离并禁止访问私人Aimy-Preview目录。测试没有真实模型调用；不能把它说成已使用私人profile验过全部功能或做过原生点击。
7. 旧App未运行后，移动到备份位置，再安装新App；桌面链接不变。安装后归档hash与检查包一致，codesign严格验证通过。
8. 首次正式启动发现本机签名模式不匹配，修正后通过LaunchServices实际打开已安装App并确认主进程持续运行。实际私人窗口内容未读取，未代用户发聊天或评测请求。

关键回执：[delivery.json](evidence/delivery.json)、[package-audit.json](evidence/package-audit.json)、[首次隔离状态](evidence/smoke/first.json)、[重启恢复](evidence/smoke/restart.json)。最终包归档SHA-256为 `48bc90b5efd5a72aa1a7366945e0aa4ae7b1538ef325eddfbcf3e6f344f8c2d0`。

## 失败历史与修正

- 首次构建包装环境PATH未含pnpm位置，依赖枚举失败；补入既有 `.local/bin` 后重新包装成功，没有安装依赖。原日志保留。
- builder沿原内部可执行名输出airi.app；只将应用目录改回Aimy体验版.app，保持已验证的bundle ID、内部可执行名与profile。
- 首次本机签名误加hardened-runtime，与保留的Electron Framework Team ID不一致。静态codesign验证虽然通过，实际启动却被DYLD拒绝。因此没有把签名检查当作运行通过。已恢复旧体验版相同的ad-hoc签名模式（`--options 0`），保持系统Gatekeeper设置；重新验签后正常打开。旧签名日志、修正日志和简化错误回执分别保留。未修改产品业务代码或任何用户数据来解决此问题。

最终本机签名命令：

```sh
codesign --force --deep --sign - --options 0 '/Users/mima1234/Applications/Aimy体验版.app'
codesign --verify --deep --strict '/Users/mima1234/Applications/Aimy体验版.app'
open '/Users/mima1234/Applications/Aimy体验版.app'
```

本机体验签名不是正式Apple分发公证。打包器仍报告既有可选Godot产物、其他平台二进制及一个嵌套转写依赖缺失；本轮不声称全部可选引擎/语音分支已经验过。真实声音、角色和陪伴效果由后续体验检查，前轮8例失败不因打包更新变成通过。

后续仍在aimy-app开发。当前App是10月18日快照，不自动追随源码；再次更新继续保持同一身份和数据目录。备份仅含旧程序，不含私人profile；回滚时应先正常退出当前App，并核对后续数据格式兼容性。
