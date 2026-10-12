# 四项目复用审查证据

> 文档状态：定向调研参考，绑定当时来源；不是选型决定或实施授权。
> 产物时期：2026-10-10，正文明确日期。精确初稿时间未记录时保持未知。
> 保留原因：保留项目README.md模块与缺陷可追踪证据。
> 上下文风险：不可把隔离函数复现/静态语法通过当完整服务、真实设备、模型、许可发行或AIRI集成通过；复现脚本是证据不是应用开发入口。
> 原位置：`digital-lover/docs/调研/2026-10-10-四项目复用证据/README.md`；归类整理：2026-10-11。
> 阅读入口：[文档中心](../../README.md)。历史正文中的“当前、唯一、已锁定、下一步”仅适用于原时期。

日期：2026-10-10。总报告见[四项目复用与代码审查](../2026-10-10-四项目复用与代码审查.md)。本目录保存可持久访问的分项目报告与检查证据，报告里的`/tmp`路径是执行时的临时位置，对应文件已按原文件名复制到这里。

## 文件说明

- `*-audit.md`：四份模块地图、实际调用链、复用建议、代码发现及许可限制。
- `github-metadata.json`：本次GitHub默认分支与固定提交、维护时间和代码许可元数据。
- `*-source-manifest.json`：本地可比源码的SHA256、Git blob SHA和远端匹配状态。仅文件路径和指纹，不含源码、个人聊天或密钥正文。
- `snapshot-summary.json`：1,435个可比文件与四个固定提交的匹配汇总。此口径含测试/vendor，排除data等，不等于人工逐行审计数。
- `post-review-source-check.json`：审查结束后重算相同文件的SHA256，四个来源均0变更。
- `airi-reference-manifest.json`：接入目标AIRI的路径、版本字段及关键接入文件SHA256，不冒充上游Git提交。
- `aions-static-checks.json`：458个Python和179个JS静态语法检查结果。
- `aions-isolated-results.jsonl`：四项合成SQLite/模型替身检查结果。
- `kirara-directed-results.json`：六类stdlib定向检查结果。
- `chromatic-check-results.json`：15个TS语法检查、原测试10项和另外2项复现的记录，以及实际复用依赖版本。

## 复现边界

`ryza-isolated-checks.js`、`kirara-directed-checks.py`、`aions-isolated-check.py`只从本次固定的来源文件抽取已经审阅的函数，配合内存对象、合成SQLite或模型替身验证特定问题，不导入/启动整个产品。脚本中的源码绝对路径和临时输出位置按本机编写，改变机器时需调整。脚本会重建自己位于`/tmp/aimy-four-projects-20261010`的合成数据库，不应把该路径改成任何真实数据文件。

Ryza检查的stdout已逐项写在`ryza-audit.md`中。AionsHome和Kirara还保存机器可读结果。Chromatic复现测试保存为`chromatic-audit-reproductions.test.ts`；执行时将其放到来源副本`packages/chromatic/src`，与原有两份测试一起运行。原测试的两包源文件在临时目录执行，依赖借用本机既有安装，未重新安装来源锁文件。

这些是函数/事务和静态证据。真实模型、真设备、完整产品重启、macOS打包、第三方资产发行授权与实际AIRI集成仍未验证。
