# 最终当前裁决只读复核

日期：2026-10-14（Asia/Shanghai）。范围：当前五项目增量裁决Markdown/JSON、05当前01能力选择与能力选择JSON。只读核文与JSON字段；没有重跑候选测试、模型、设备或浏览器。

结论：**主要校正和数量口径正确；剩1项P2标题字段一致性建议。无新增P1。**

## 已确认

| 核对项 | 当前结果 |
|---|---|
| Ryza执行数量 | 报告:58明确17项=8正向+9负向，另3项AIRI邻近对照；JSON validation_scope分别17和3，没有重复合并成产品通过率 |
| 完整预算/可靠事实CRUD | 主报告:36–37和MEM-F02:87–88明确撤回；RY03/04/08 reason均把已验证机制与原链缺陷分开 |
| ISO/关键词 vs 自然日期NLP | MEM-F02:87明确“昨天”不能按昨日筛选；05当前01:16同样收窄，没有称自然语言时间检索已成立 |
| RY07重复排除 | 两份JSON均selection=AIRI已有或不更强、product_increment_eligible=false、functional_slices=[]、requirements=[]；保留实际MiMo style/text证据 |
| RY05/06未AB | 两份JSON均条件收益实验，eligible=false、functional_slices=[]、requirements=[]，只留下reference_requirements |
| 55是审核记录 | 主报告:9/121、05当前01:9均明确非55功能；JSON55条、55唯一ID |
| eligible 8对应5功能 | 两份JSON eligible IDs相同：AH-R01/AH-R02/AH-R03/AH-R06/RY03/RY04/RY08/OL03；union为MEM-F01/MEM-F02/PRO-F01/OLV-F01/OLV-F02五项；OL03一条审核拆成两个具体功能，没有错算成8个独立功能 |
| 工程参考不选入 | 两份JSON全部工程参考eligible=false，且requirements=[]；可以有reference_requirements，但不进入功能短名单 |
| Chromatic排除 | 当前active_projects仅五个目标；excluded_projects含chromatic；决策记录与当前01没有给CH01/CH02继续安排功能/优先级 |
| 真实更强结论 | 报告开头、05当前01明确没有真实模型/设备/人测AB领先结论；三记忆子候选合并到同一Memory包，没有再引Ryza完整store/runtime |

## P2：两份JSON的当前capability标题仍保留已撤回的宽名称

正文reason已经正确，但机器字段仍可被UI/执行AI单独读取为当前被选功能：

- `docs/02-调研参考/2026-10-14-五项目功能增量与验证裁决.json:387`，`05交接包/能力选择.json:242`：RY04=`关键词日期排序与完整条目预算`，同条eligible=true。
- 前者:447、后者:302：RY08=`可编辑记忆与存储压力反馈`，同条eligible=true。
- 主Markdown附表:136/139照用这两个宽标题，表头又是“当前归类”，没有标“原审核名称”。

建议：当前`capability`统一改为：

- RY04：`关键词/ISO日期与active条目选择`。
- RY08：`已存会话卡查看、编辑与删除`。

需要保留旧名追溯，可放`original_capability`/`previous_capability`，或附表明确列“原审核名称/当前采纳范围”；不要让当前eligible的标题继续包含“完整预算”或把存储压力工程反馈混进被选功能。同步两份JSON与附表即可；不改ID/eligible/功能切片/数量，也无须重跑已固定测试。

其他未发现本次关注范围的新增矛盾。该建议为文案与机器可读语义对齐，不改变已有实验结果、产品代码或AIRI单一运行时边界。
