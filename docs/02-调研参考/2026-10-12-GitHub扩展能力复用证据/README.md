# 2026-10-12 GitHub 复用调研证据

固定版本的GitHub API元数据、代码树、许可/源码链接、关键文本行号及源码文件SHA-256汇总。来源代码本身不复制进工作区。独立候选报告记录源码地图、可拆模块和适配判断。

- `memory-evidence.json`：9个记忆候选；4个重点深审。
- `multimodal-evidence.json`：11个语音/多模态候选；4个重点深读。
- `character-evidence.json`：14项角色工具/规范；深读与浅读级别逐项标注。
- `auxiliary-evidence.json`：Orama、sqlite-vec、Transformers.js、Promptfoo元数据与targeted source SHA。
- `auxiliary-github-search-results.json`：补充GitHub发现搜索结果。
- `airi-local-source-evidence.json`：所查本地AIRI源文件哈希；该目录无`.git`，不等同远端HEAD。
- 四份`*-源码预览.md`：候选架构、源码行和固定GitHub链接、复用建议、风险。
- `memory-source-links.md`：记忆子项来源链接清单。
- `auxiliary-targeted-source-sha256.json`：辅助候选逐文件来源、行数与sha。

所有URL指向immutable commit。仓库代码license不覆盖模型、角色、音色及第三方样例资产。静态审查不能证明运行行为，报告逐项标注未验证范围。没有安装或执行这些远端项目，没有发起真实模型/设备调用。

- `document-verification.json`：主报告固定源码链接、文档导航及产品文件/Git索引保护核验；不属于候选运行测试。
- `downloaded-text-source-hashes.json`：取回文本源码的SHA-256清单；源代码本身留在临时区，没有成为产品代码。
