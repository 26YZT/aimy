# 终核：长期记忆、召回与主动续聊正式交付

2026-10-14。状态：所审事实/方法/复制证据一致；原LM08 P2已关闭；交付入口存在1处待补P2，另1处可精确化P3。唯一写本文件，不重跑、不改仓库或冻结结果。旧review-lm-root.md保留。

范围：正式Markdown§§1–4/6–7、机器JSON method_limits/能力结论/evidence refs、copied memory/recall/browser/protocol原字节及派生修订；未独立重审§5主动调度源码与全部proactive执行，依对应worker审查。不能把本终核描述为对主动分支全部实现重新验收。

## 已关闭：LM08来源/提交层次摘要

正式证据 `memory/results.json` 的LM08 `comparison.limits` 现写：主任务manual来源事实删后，U1新topic候选提交；自动private:U1同源副探针仅内存新建、未SQL commit。与内层数据一致：

- 主任务baseline_manual sources为 `['manual']`。
- 自动副探针deleted_entry_sources为 `['private:U1']`，同源改topic内存重放changed=true，但persisted_after_probe entries仍空。
- `memory/run.py:27` 同步采用两层文案，copied source-manifest里的三个输出脚本SHA全部匹配。
- 原 `memory/aions-results.json`、`memory/airi-results.json` 与tmp原文件逐字节一致，没有为修摘要重跑/改case结果。
- 正式Markdown第36行和JSON MEM-BOUNDARY-01 limits也保留manual主序列/自动纯副探针差别。

因此旧review-lm-root.md提出的P2已关闭，可保留旧review为修订前记录；不要据旧review重复称该问题未修。

## P2：正式报告的证据入口README尚不存在

位置：[正式报告:97](/Users/mima1234/Documents/aimy/docs/02-调研参考/2026-10-14-长期记忆召回与主动续聊同条件验证.md:97)已链接：

`2026-10-14-长期记忆召回与主动续聊同条件验证-证据/README.md`

本次两次读取/链接核验时该文件不存在，`cat`返回No such file。其余六个JSON raw_evidence引用都存在，证据文件也齐；缺的是人类阅读入口。主写者若正在补写，完成后核一次该路径即可关闭，不需要动62份原字节或重跑实验。

建议入口说明各分支的真/假边界，尤其原Q07补注、LM08原review已修、default-shaped core与新页面realm层次、PR09原结果与补证分开。后续当前55条/入口更新应链接到实际存在的该README。

## P3：Q05应显式区分top5漏选与12背景中含有R07

位置：[正式报告:49](/Users/mima1234/Documents/aimy/docs/02-调研参考/2026-10-14-长期记忆召回与主动续聊同条件验证.md:49)写“无embedding两方没有可靠选到海边记录”。“可靠”已避免绝对化，因此不是原数据歪曲；但读者仍可能以为Ryza实际上下文无海边条目。

copied `recall/ryza-results.json` Q05原文臂：

- `_select(cue,5)`＝R06/R08/R02/R05/R10，未R07。
- 实际prompt的原生12项＝R06/R08/R02/R05/R10/R01/R03/**R07**/R11/R12/R13/R14。
- 原ctx确含“去海边散步时捡到了一个贝壳”，它是按原背景补满政策进入，不证明识别“海岸→海边”的语义，也没有模型最终答复。

建议简化写成：AH无命中；Ryza top5未命中，但原12项背景中碰巧包含R07，不能据此称同义召回成功或失败的最终回答。保留原数据和两层ID记录即可。

## 确认通过的正式结论

1. 既有能力与具体缺口分开：AIRI聊天持久化、同session历史、精确去重/轮次guard/事件基础保留；缺失限定默认陪伴事实闭环，不由内存manager推出聊天丢失/全monorepo无记忆。
2. 同条件与不等价接口分开：fixture冻结、同文本/候选、无embedding；AH importance除5转换明示；raw与受控keywords/date两臂分列，后者不称自然语言路由实测。
3. top5/1200限制没有被掩盖：AH原10、Ryza selector5可用但prompt12；不补参数、不后截断、不拿整provider历史与memory block比费用。短样本under1200不作保证。
4. AIRI unsupported不是0分：默认查询接口不造；完整原core装配的synthetic session/empty context/no memory provider范围明确，不泛称所有插件/配置无跨会话支持。history含答案不是召回正确。
5. Q07历史取消证据按补注解释：原fixture/raw不改；R09有取消原文可相关，不等于active复活；Q03同理区分旧偏好历史与当前事实。future timestamp合成限制已写。
6. LM10硬拒绝不当摘要：Aions600字拒收、context0且pending/error；没保住1504字，未称总结质量更好。AIRI1540只限原manager输出。
7. 新进程/realm不互换：SQLite新Python、manager新Node、真实IDB/localStorage新页面分别报告；未称新浏览器OS或Electron端到端恢复。会话删除与逐事实忘记不混。
8. structured compaction不冒默认事实摘要：RawMessage32不改，显式history-block可留5+generic计数；没有称默认桌面已自动摘要或恢复事实。
9. 分期为建议而非实施：P0基线→事实/删除→证据召回→主动，真实模型/人测后置；没有选型/装依赖/启动computer-use或第二runtime。当前正式JSON声明14需求/15任务/17API/5Prompt不变；现追溯矩阵14/15、接口目录17、Prompt目录5也一致。

## 指纹和链接静态核验

- 62份复制映射：copy SHA全部匹配；对应tmp source SHA亦全部匹配。
- protocol fixtures SHA＝`61b8c0b87067f9d349876f11217adcb82d321df795ddfec6e330e0f9caa14b61`；gold SHA＝`47c98f5dfefbfaf2a7043d7ecd4afff3bf10d429b6c15c8c1333f9106c87c4b8`。
- recall三份raw冻结SHA全部匹配；未随Q07裁定改原输出。
- memory原两臂raw与tmp一致；LM08仅派生比较/生成文案修清。
- 六项JSON raw_evidence文件引用存在。当前正式Markdown仅上述证据README链接缺失。

当前55条及主入口升级v1.3是主写者接下来的工作，本次未对尚未写出的版本作通过承诺。完成后应只新增证据/收窄理由，不将上述50召回观察、10×两臂合同或浏览器重建数累加为功能通过率。

## Closure：主写者后续补写已核实，两项关闭

2026-10-14，收到主写者修复说明后只读定向复核；上文保留的是此前写入前快照，不代表当前待办。没有重跑或重写原raw。

- **证据入口P2关闭**：`docs/02-调研参考/2026-10-14-长期记忆召回与主动续聊同条件验证-证据/README.md`现已存在且可读，正式报告第97行目标已落地。入口列出协议/记忆/召回/主动/浏览器/default core各组真/假边界，明确manual与自动同源叶子、PR09原inconclusive与补证、Q07补注和页面realm层次。
- **Q05精确化P3关闭**：正式报告第49行现明确“Aions无命中；Ryza top5不含海边R07，实际12项背景可能含R07，未测模型如何使用”，并说明不能把背景偶然包含算语义命中，也不能宣称最终模型必答错。当前五项目JSON及05能力选择JSON的RY04 reason同样收窄，二者一致。
- **此前LM08 P2继续保持关闭**：manual主序列与自动private:U1纯重放/未SQL提交的限定未被这次修改撤销。

在本终核所审§§1–4/6–7、method limits、相关复制证据与以上入口范围内，**无剩余P1/P2或本次列出的P3问题**。本次只补关闭记录，未扩大为§5全部主动源码/设备/真实模型或整体应用验收；主写者接下来执行最终复制指纹与总导航核验。
