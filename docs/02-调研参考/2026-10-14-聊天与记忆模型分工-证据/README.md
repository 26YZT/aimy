# 聊天与记忆模型分工：离线证据

日期：2026-10-14。状态：原函数隔离调用检查，非真实模型质量评测。

- verify_dispatch.py / python-results.json：AionsHome与Kirara原函数AST，合成配置与调用stub，8项通过。
- verify_ryza.cjs / ryza-results.json：Ryza原api.js与longterm.js，空VM及FakeXHR，7项通过。
- source-manifest.json：20份关键源码字节指纹；OLV固定提交，其余本地快照，不冒称最新Git版本。
- 原字节映射.json：临时脚本/输出逐字节复制映射。

真实模型调用0，未读取真实凭据/用户数据库，未安装依赖或启动候选服务。结果只证明模型配置/请求路由，不证明成本、准确率、自然度或完整产品验收。

[通俗对照与建议](../2026-10-14-聊天与记忆模型分工对照.md)。
