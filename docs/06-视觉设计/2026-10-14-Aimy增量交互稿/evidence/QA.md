# 原型QA记录

日期：2026-10-14。状态：文档原型的有限视觉/交互核验；不是Aimy产品、真实模型或设备验收。来源真值：AIRI已有设置/窗口结构、本稿DESIGN参考锁、用户已明确的三项行为、增量PRD/API。

## 实际检查

- 第一轮15项交互观察成立：空搜索、来源、编辑失败/重试、删除范围、权限拒绝/等待中停止、迟到结果、预算暂停、收起/隐藏、安静、深色、800px横向溢出。原结果见[interaction-checks.json](interaction-checks.json)。
- 独立只读审查指出隐藏后重新开启和预算缺口；修复后追加9项针对复测，见[review-fixes-checks.json](review-fixes-checks.json)。隐藏禁止新采集，恢复仍暂停；started不退预算，授权等待中取消不算started；耗尽禁止重开；来源日期一致。
- 再修一项隐藏后“收起聊天”文案问题并实测，见[collapse-hidden-check.json](collapse-hidden-check.json)。

合计25项观察均与各轮预期一致，属于15项初轮+9项修复复测+1项最后复测；不是25项同一版本的产品通过率。未改动产品代码。所有行为只操作网页内存里的人工示例。

## 视觉检查

1280×900浅色：[最终记忆页](memory-desktop-final.png)。同尺寸深色：[最终深色](memory-dark-final.png)。800×900：[最终窄窗口](memory-narrow-final.png)。另外检查[删除范围](delete-scope.png)、[运行中的观察](vision-running.png)、[预算暂停](vision-budget.png)。前两张早期过程图保留，最终稿以带final及最后预算状态为准。

检查结论：当前所查状态文字可读、操作无重叠、窄窗口没有横向溢出、允许正常纵向滚动、深浅结构一致、停止与状态相邻。修复深色占位文字对比度；按既有token计算浅5.70:1、深6.43:1，仅此颜色对不是完整可访问性认证。系统字体、原图标与原设置层级保留；没有生成正式角色。

Ego浏览器初次截图因目标空间未激活而两次超时；通过computer use切到本轮创建的空间后截图成功。未接管或终止其它任务，未处理真实麦克风/录屏/模型账户。

## 保留限制

Refero live screen查询返回NO_SUBSCRIPTION，本稿依据本地AIRI源码/截图/v3参考完成；不声称已读取外部参考。没有真实VoiceOver、Electron生命周期、macOS授权、持久记忆、语音/画面推理或正式资产验收。本稿模拟状态机不能直接复制为产品逻辑。
