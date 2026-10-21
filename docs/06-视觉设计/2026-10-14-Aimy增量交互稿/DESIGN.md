# Aimy 增量交互稿：参考锁定

日期：2026-10-14。状态：交互提案，未接产品；延续既有视觉，不开新一轮风格探索。来源：用户AIRI完整继承决定、当前源码、v3本地设计资产。用途：本期记忆/看屏/语音状态评审。风险：示例数据/模拟权限不证明真实产品能力。

## 研究与锁定

主参考：AIRI Settings分类侧栏和详情页面、WidgetStage/ControlsIsland、独立ChatPageShell。源码：`packages/stage-pages/src/pages/settings/memory/index.vue`为WIP；`modules/vision.vue`已有间隔和统计；`packages/stage-layouts/src/layouts/settings.vue`是原设置容器。主底座不漂移。

局部样式参考：既有v3的系统字体、玫粉主动作、清楚的语义状态、12px控件圆角，已有猫耳侧脸图标；这些仍是候选样式，未声称用户已批准v3整体。保留已有品牌图，不生成新角色或资产。

Refero live research已尝试两项具体screen查询：`ChatGPT memory settings manage saved memories delete`、`screen sharing recording permission stop sharing indicator`；两次均返回 `NO_SUBSCRIPTION`。没有借未经读取的外部截图做结论，也不需要开通付费订阅才能完成当前增量。按Skill的本地参考路径，研究转用已有AIRI源码/截图/v3规范。无外部参考图被复制。

| 决策 | 来源 | 本稿如何体现 |
|---|---|---|
| 沿分类设置、详情返回 | AIRI Settings | 左侧分类，右侧任务内容 |
| 自动记忆不逐条确认 | 用户10-13回答 | 一次总开关、可管理列表 |
| 来源/纠正/删除是核心 | Aions/Ryza研究+PRD | 行级详情与明确删除范围 |
| 看屏状态与停止可见 | 已有Vision链+撤权缺陷 | 运行区常驻停止，显示来源与间隔 |
| 间隔看一眼 | 用户回答 | 30/60/180秒建议选项，非3秒默认继承 |
| 已授权不等于正在采集 | AIRI源码与v3契约 | 独立系统状态/当前状态 |
| 不新增管理后台或视觉方向 | 用户AIRI继承边界 | 熟悉窗口/表单，少量必要动作 |

## 原型范围

[可点击原型](index.html)：记忆列表/查看来源/纠正/删除/写失败；看屏授权中/拒绝/运行/停止/预算暂停；语音与安静/隐藏语义。所有数据仅在当前网页内存中，刷新重置。source示例为人工编写，不来自用户真实聊天。

桌面目标1280×900；窄窗口800×900；深色同结构。macOS桌面产品不以移动端布局新增需求。原型窗口仅表达设置内容，不等同于Electron完整界面截图。

实施不能复制preview.js成为平行状态机。真实逻辑由既有AIRI owner与本包API控制；UI等待回执，不自行假定授权/写入完成。产品前后截图应在同视口采集，先做一个代表页评审后再扩到相关控件。

## QA

实际截图、检查项与结果保存在evidence。原型视觉/交互通过不代替原生权限、真实模型/设备和正式资产验收。已知限制：Refero订阅不可用；主界面布局以本地源码与历史截图核对；VoiceOver和原生窗口行为待实施验证。
