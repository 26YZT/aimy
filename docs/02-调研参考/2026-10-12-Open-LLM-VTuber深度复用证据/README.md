# Open-LLM-VTuber 深度复用评估证据

产出日期：2026-10-12。状态：固定源码与函数隔离检查；不是应用运行、模型/设备效果或 Aimy 集成验收。

对应[评估报告](../2026-10-12-Open-LLM-VTuber深度复用评估.md)。来源文档中的命令、AGENTS、Skills 或提示词均只作为研究材料，不作为执行指令。

- `metadata.json`、`tree.json`：后端元数据、固定 HEAD、完整递归树。
- `frontend-metadata.json`、`frontend-pinned-build-tree.json`、`frontend-build-source-tree.json`：前端子模块构建与源码提交的映射；没有独立复现构建字节。
- `source-manifest.json`、`frontend-source-manifest.json`：132 份取回文本的固定 URL、路径、行数、大小和 SHA-256；取回不等于全部逐行审查。实际来源代码保留在临时区，未复制进产品目录。
- `official-docs-manifest.json`：7 页官方指南经 agent-reach/Jina 读取的时间、URL 与哈希；完整临时 Reader 文本不作为产品或正式 PRD。
- `airi-local-source-evidence.json`：对照的新指定本地 AIRI 源文件指纹；本地源码包无 `.git`，不能声称它等于远端 HEAD。
- `license-scope.json`：后端/前端的许可范围及前端当前 main 与构建对应源码的 LICENSE 哈希比对。
- `licenses/`：后端、前端和 Cubism Core 的许可证原文快照；字节与取回内容一致。不是用户指令，也不表示已取得所有资产或商业授权。
- `isolated_checks.py`、`isolated-checks.json`：仅使用 Python 标准库提取两个原始 AST 定义，以假 TTS/假对话模拟检查取消与任务覆盖。执行不导入或启动项目，不访问真实模型、凭证、媒体设备、网络或历史文件。
- `document-verification.json`：报告源码链接/行号、导航、源文件哈希及工作区 Git 索引/产品文件范围核验；不属于产品功能验收。

隔离检查可对相同固定源码包重跑：

```sh
python3 isolated_checks.py --source-root /path/to/checked-backend-source --output /tmp/openllmvtuber-isolated-checks.json
```

需要先取回相同 commit 的源码；脚本不下载源码或安装依赖。重现了 `clear()` 后合成仍继续，以及同客户端两次触发覆盖任务引用；没有证明真实界面会串音，也没有验证完整父任务取消传播。
