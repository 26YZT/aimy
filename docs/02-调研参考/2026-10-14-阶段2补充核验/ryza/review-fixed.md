# REVIEW-PLAN-B 修复复核

日期：2026-10-14（Asia/Shanghai）。方法：只读核对当前03/04/05/08、接口目录JSON、原型HTML/JS/CSS和引用tokens；没有操作浏览器、改repo或执行真实模型/设备。原review-formal.md保留。

结论：原审查的**5个P2与1个P3均已在文档/静态原型层关闭；没有剩余P1**。浏览器交互、键盘/焦点与截图由root唯一操作者复验。另记录一个不影响授权门的P3文案交错，见末尾。

| 原项 | 复核证据 | 状态 |
|---|---|---|
| P2-01 hidden后可重开感知 | preview.js:4有stageVisible；16禁start、17执行入口再判；21/22禁mic且处理器guard；24 hide置false；25 restore置true但mic=false/screen停。index.html:27有“恢复显示（仍暂停）” | 关闭；需root验证hide→start拒绝、restore仍off、手动start才active |
| P2-02 VOICE-02漏真实history文件 | 08-开发任务与交接.md:237补`packages/stage-ui/src/composables/audio/audio-device.ts`与对应PCM历史测试 | 关闭；原03:140/142仍保持confirm+pre-roll与单EOT协调者 |
| P2-03 configure缺CAS/幂等 | 04:70 vision.configure持久write带scope/mutationId/expectedRevision并返configurationRevision；76 proactive同样policyRevision；接口JSON两项kind=write并有相同字段、CONFLICT/IDEMPOTENCY_MISMATCH/STORAGE_FAILED；29明确先查mutation身份再首次比较revision | 关闭；需实施时做旧设置窗不覆盖quiet/预算的负例 |
| P2-04 预算/主动频次不可见 | index.html:10显示至少15分钟、最近24h最多12次；20显示20次/滚动小时、已用/剩余；preview.js:15–17按最近小时算预算、耗尽禁按钮并guard处理器；20示例耗尽/重置按钮显式区分；17默认60秒仍与PRD/API一致 | 关闭；重置仅原型夹具，不进入真实产品 |
| P2-05 stale计数与预算混淆 | 03:138、04:72明确reserved→started→settled，未发网络可释放reservation，started取消/失败/迟到不退额度；stale不改当前epoch结果展示但保留预算/低敏审计；滚动小时/24h、重启不重置、显示最早释放时间 | 关闭；静态契约一致，不代表持久预算已实现 |
| P3-01 来源日期硬编码 | preview.js:7读取当前m.date到detail-date；index.html:31日期节点为动态来源占位 | 关闭；第三条10月13日已不再显示固定10月12日 |

补充检查：

- `node --check docs/06-视觉设计/2026-10-14-Aimy增量交互稿/preview.js`退出0；接口目录JSON解析成功。
- toast在preview.js:5先取消旧timer，再在3000ms后隐藏；短消息不永久遮挡。
- placeholder在preview.css:3显式使用text-tertiary、opacity=1。按引用tokens与surface离线计算：浅色#75616C/白底约5.70:1，深色#B8A3B1/#2A242B约6.43:1。只是颜色值对比计算，不代替实际渲染/系统可访问性验收。
- 仍正确区分scope所有者、系统已允许/正在采集、stop的resourceEpoch与恢复手动开；没有新增产品依赖或平行语音状态机。

## 新增非阻塞P3：隐藏后“收起聊天”仍把状态文案改成角色可见

preview.js:24 的collapse处理器无条件写“角色继续可见 · 聊天已收起”。在stageVisible=false时点击collapse，会出现文字“角色可见”而实际guard仍hidden的自相矛盾；**它不会绕过mic/screen授权门，故不是剩余P1/P2**。

建议二选一：hidden时禁collapse；或collapse仅更改chatCollapsed，并根据stageVisible组合状态文案，保留“角色已隐藏”。同样若quiet/stop操作改变screen文案，可继续由统一paint函数根据stageVisible优先显示暂停原因，避免各handler互相盖字。root可在现有浏览器复测中顺手核查，不需要新增页面或模型调用。
