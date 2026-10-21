# PLAN-C 离线规划与实验交接

2026-10-14（Asia/Shanghai）。所有写入仅本目录；产品与候选资料只读。

- `planning-contracts.md`：本期裁决、内部输入输出、主动Prompt草案、取消/工具边界、资产能力检查、PRD/API/Prompt/eval要求及review清单。
- `reading-manifest.json`：新增全文读16个关键源码、2632行、绝对路径与SHA；另引用前轮OLV完整阅读范围，未冒称所有provider语义审计。
- `run-experiments.mjs` / `experiments.json`：首批4组（marker65边界、VoiceResponse取消、Charakuru结构检查、现装Chromatic）。
- `spark-noresponse-experiment.mjs` / `.json`：第5组，Spark最终silence前可能已有text送sink；不是声音/真实UI验证。
- 其余 `.mjs` 为从已读源码生成的临时隔离模块：原功能body保留，擦除TS类型或替换依赖边界；不作为产品实现。

重现：

```sh
node /tmp/aimy-20261014-olv-planning/run-experiments.mjs
node /tmp/aimy-20261014-olv-planning/spark-noresponse-experiment.mjs
```

Node24.20.0。未安装任何依赖；Chromatic复用AIRI当前已安装1.1.4。5组断言通过只证明所标注源码/假外缘/合成fixture行为，不等于真实LLM、设备、VRM成品、90帧物理、UI或用户验收。未访问网络、账号、密钥、真实模型、屏幕或麦克风。
