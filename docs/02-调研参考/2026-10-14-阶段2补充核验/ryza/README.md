# PLAN-B 增量设计输入

日期：2026-10-14（Asia/Shanghai）。用户授权研究与可开发规划；未实施。

- [完整增量技术设计审查](voice-proactive-vision-lifecycle-design.md)：R4纠错、状态机/事件/取消与窗口语义、8项任务边界、14离线负例、5类有限对照实验、全消费者核查与6项复现。
- [新增读取覆盖](read-coverage.json)：34文件，31 full、3 partial，逐文件SHA。
- [6项当前AIRI隔离结果](airi-isolated-results.json) / [实际源码函数验证脚本](airi-isolated-checks.cjs)。
- [只读与结果校验](verification.json)。

重跑隔离检查：`node /tmp/aimy-20261014-ryza-planning/airi-isolated-checks.cjs`。实际源码片段只擦除TS类型/非空断言；假refs/stream/provider/agent/clock，零网络/模型/设备。六项是缺陷或竞态复现，不能写成产品验收通过。

主 Agent 统一写正式docs；本目录仅研究与规划输入。没有修改仓库、依赖、Git暂存或恢复记录。
