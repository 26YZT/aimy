# DELTA-OLV 只读复核交接

2026-10-14。仅Open-LLM-VTuber与AIRI；所有写入在本tmp目录。

- `delta-findings.md`：固定前端来源链、原14结果/63能力核验、4项候选与分层裁决。
- `pinned-build-commit.json` / `pinned-source-commit.json`：GitHub公开commit元数据；build06a659明确来源3d57a9a完整SHA。
- `frontend-source/`：新建depth1固定源commit浅克隆；未改既有clone。
- `frontend-version-comparison.json`：旧main d176与pinned-source8个关键文件字节相同。
- `source-provenance.json`：后端253文件无变化、63路径/行有效、原14隔离记录与107 AST仍对应固定源码；未复现构建字节。
- `frontend-source-manifest.json`：226 tracked entries字节指纹，目录/哈希盘点不等于全量语义阅读。
- `delta_checks.py` / `backend-delta-results.json` / `backend-run.log`：译播5分支、7过滤输入、synthetic memory来源。
- `delta_checks.mjs` / `frontend-delta-results.json` / `frontend-run.log`：AIRI过滤默认/启用同输入；OLV精确tap方法与AIRI真实hit回调同点击。

重现：

```sh
python3 /tmp/aimy-20261014-delta-olv/delta_checks.py
node /tmp/aimy-20261014-delta-olv/delta_checks.mjs
```

不启动前后端、不安装依赖、不访问模型/翻译服务/真实设备。只有GitHub元数据和新固定clone用了网络；测试完全离线。原函数/方法body配stub边界，具体限制见结果JSON。独立译播与区域权重动作仅证明局部行为增量，未证明真实体验优于AIRI。
