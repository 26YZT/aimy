# Ryza 只读证据包

日期：2026-10-14（Asia/Shanghai）。主 Agent 正式文档写作输入；所有调查输出仅在本目录。

- [完整报告/46项功能/实时层与窗口对照/17项风险/复用裁决](ryza-source-evidence.md)
- [浏览覆盖与未覆盖项](inspected-files.md)
- [逐文件 SHA 与固定快照元数据](source-manifest.json)
- [46项功能机器清单](features.json)
- [21个 AIRI 对照文件](airi-compared-files.json)
- [13项隔离结果](isolated-results.json) / [可重跑脚本](isolated-checks.cjs)
- [66 JS / 7 Python / 1356 JSON 与原离线检查结果](static-checks.json)
- [来源未改与引用校验](verification.json)

检查重跑：`node /tmp/aimy-20261014-ryza-audit/isolated-checks.cjs`。只加载当前来源函数，所有设备、网络、模型与存储都是注入桩；零模型调用、零真实麦克风、零服务与安装、零产品代码写入。13项含通过与缺陷复现，不能写成13项产品验收通过。

原长期记忆回归41 PASS和分层守卫0违规，均不能覆盖已复现的并发、迟到回调、删除和捕获启动竞态。1764个来源文件最终逐字节复核未变；46个功能引用与87个Markdown来源链接均存在且行号有效。
