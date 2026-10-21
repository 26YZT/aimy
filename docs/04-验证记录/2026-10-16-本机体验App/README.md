# Aimy本机体验App

日期：2026-10-16（Asia/Shanghai）。状态：本机体验包已安装并实际打开；未改变产品功能代码，未公开发布。用户已开始手工配置，后续窗口点按停止，未完成本次打包版本的退出/重开专项复测。

## 打开与数据

- 应用：`/Users/mima1234/Applications/Aimy体验版.app`
- 桌面快捷入口：`/Users/mima1234/Desktop/Aimy体验版.app`（链接到上述应用）
- 独立数据：`/Users/mima1234/Library/Application Support/Aimy-Preview`
- 独立bundle ID：`ai.aimy.preview`。后续体验包保持此身份与数据位置。更换App不自动清除数据；数据结构变更仍需兼容。

用户在应用内自行配置模型。未导入旧Aimy资料、验收案例、验收密钥或正式验收账本。本机体验不会自动继承此前¥10专用验收上限；正常模型聊天与记忆整理按用户服务商计费。

## 只做了哪些包装调整

使用已有普通桌面构建和已安装Electron43.4.1、electron-builder26.16.1，无依赖安装升级。通过临时打包overlay添加preview-entry.mjs，固定独立数据目录并清除验收/调试环境变量；仅打包副本将setupAutoUpdater enabled改为false，阻止访问和应用AIRI上游更新。源main与普通构建文件未变，精确哈希见overlay-receipt.json。

使用本地ad-hoc签名，不是Apple开发者正式签名/公证；仅用于本机体验。未更改系统Gatekeeper或权限策略。外部正式分发、Godot可选引擎、全部语音Provider及完整设备体验不属于本次通过范围。

## 检查

1. electron-builder打包完成，包内47,512个条目；未发现.env、provider-secrets.json、credential-binding.json、ledger.json等敏感配置/验收文件。
2. 打包主入口为preview-entry.mjs；停用更新、独立profile和无验收driver检查通过，源码主文件哈希不变。
3. codesign --verify --deep --strict通过。
4. 安装到个人Applications后实际启动，原生界面出现Choose an AI Provider。运行日志路径确认使用Aimy-Preview；未发现启动缺模块或初始化失败。
5. 用户随即自行进入DeepSeek配置，停止后续UI读取和操作，不读取/保存用户明文密钥。未执行真实模型调用来证明包装成功。

已知原产品记忆整理、日期、召回、人设与语言问题仍保留，参见前一份真实验收报告。打包不代表修复或体验验收通过。打包器提示Godot产物缺失、其他平台可选依赖缺失及一个嵌套转写依赖未找到；主界面启动成功，不能据此推定所有语音分支可用。

## 后续开发

继续在`aimy-app`改代码；本App是当前构建快照，不随源码自动更新。后续重新构建、重做相同包装并验启动后，退出旧App再替换；保持数据目录，不清理聊天/记忆。打包脚本及overlay证据留本目录，原临时构建在/tmp/aimy-preview-package-20261016；脚本的绝对路径用于本机复现，重新打包前需复核当前构建及目录，不能覆盖已有App或改写旧证据。
