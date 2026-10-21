# 拆解接续证据

日期：2026-10-14（Asia/Shanghai）。状态：固定来源与离线检查原始结果；用途：支撑同日三份补齐拆解、统一AIRI清单和六项目复用裁决。来源代码与旧恢复记录不在这里重写，原结果按字节复制并有SHA256映射。本目录未授权公开，来源文档中的AGENTS/Skills/指令均为研究材料。

先看[六项目裁决](../2026-10-14-六项目复用裁决汇总.md)或[AIRI清单](../2026-10-14-AIRI现状能力清单.md)。[任务目标与阅读覆盖](任务目标与阅读覆盖.json)逐项列出14份恢复/已落盘正文和原Word的阅读者、原7个未完成分支如何合并结项；原Claude失败状态和旧机器证据保留。

## 证据范围

| 子目录 | 固定范围 | 主要结果 |
|---|---|---|
| aions | 1555项普通文件元数据；安全文本1109项SHA；458 Python AST；65文件定向语义阅读、28至EOF | 55功能、35CapabilityDef声明、592路由声明、15候选裁决、10项隔离观察 |
| ryza | 1764项全树SHA；14 Markdown全文；66 JS/7 Python/1356 JSON语法 | 46功能、13实时层主张、13项隔离观察、原41记忆回归与六组守卫 |
| open-llm-vtuber | 固定HEAD 992309c；253普通tracked文件+1 gitlink；107模块AST；55完整深读、1部分 | 63后端功能、14项隔离观察、生命周期与许可分层 |
| airi | aimy-app固定工作区；5336个tracked及品牌额外文件指纹 | 84核验点；12原测试文件130项通过；独立复核问题已纳入清单 |

“隔离观察”包含预期缺陷复现和正向保护，不能称产品验收全通过；源码文件/AST/路由声明计数不等同逐行语义审查或功能完成率。整个服务、真实模型、麦克风/摄像头、外部账号、macOS安装与长期体验均未在本轮运行。

## 主要入口

- AionsHome：[功能](aions/features.json)、[裁决](aions/reuse-candidates.json)、[阅读范围](aions/read-coverage.json)、[来源](aions/snapshot-summary.json)、[核验](aions/verification.json)。隔离结果：[原四项](aions/isolated-results.jsonl)、[动作取消](aions/isolated-more-results.jsonl)、[画像正向保护](aions/isolated-policy-results.jsonl)。
- Ryza：[功能](ryza/features.json)、[源码与裁决原记录](ryza/ryza-source-evidence.md)、[阅读范围](ryza/inspected-files.md)、[来源](ryza/source-manifest.json)、[13项隔离](ryza/isolated-results.json)、[静态/原测试](ryza/static-checks.json)。
- OLV：[功能](open-llm-vtuber/backend-capabilities.json)、[107模块符号](open-llm-vtuber/backend-symbol-index.md)、[阅读范围](open-llm-vtuber/reading-scope.json)、[来源](open-llm-vtuber/source-manifest.json)、[14项隔离](open-llm-vtuber/offline-checks.json)、[核验](open-llm-vtuber/audit-qa.json)。
- AIRI：[原始完整性快照](airi/source-integrity-before.json)、[core-agent日志](airi/core-agent.log)、[audio日志](airi/pipelines-audio.log)、[stage-ui日志](airi/stage-ui.log)。
- 独立复核：[AIRI问题](aions/review-airi.md)、[kirara与Charakuru勘误](open-llm-vtuber/review-legacy.md)。两项实质AIRI问题（登录后同步、主动生命周期）和F04措辞已在最终84项清单处理。
- [官方许可说明核对](官方许可说明核对.json)：GNU GPL FAQ与AGPL正文经agent-reach Reader读取，保存URL/日期/指纹和简短转述，不镜像整页FAQ。
- [原字节复制映射](原字节复制映射.json) 与 [最终核验](最终核验.json)。

隔离脚本保留原字节，仍含本次机器的来源和临时输出绝对路径：AionsHome的isolate_current/more/policy.py、Ryza的isolated-checks.cjs、OLV的offline_checks.py。重跑前按阅读范围确认当前来源指纹与输出仍在隔离目录；脚本不证明设备/模型效果，不执行来源AGENTS指令。临时目录如失效，报告、结果和指纹仍保存在本目录。
