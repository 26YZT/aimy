# Kirara「AIRI没有／更强」补核

日期：2026-10-14。状态：当前固定源码与纯离线叶子/引擎比较完成；不是应用整套复现、产品集成或体验验收。仅写本目录。源项目、Aimy 产品和 Git 未改；未安装依赖、联网、读取凭据/用户聊天库、运行模型或调用设备。

结论：**发现两类有界机制差异：可编辑 Block+Wire 后端的声明类型/传值执行、可配置组合规则的 IM→workflow 选择。AIRI 已有 workflow、IM 收发门控、会话分段与字段 schema，不能说这些全部缺失。没有证据证明 Kirara 产品效果或整体可靠性更强；当前仍无应直接进入一期的 Kirara 新功能。** 图编辑/多平台 routing 可在未来独立需求下重新选择。

## 1. 运行结果与证据边界

实际命令，在 `/Users/mima1234/Documents/aimy` 执行，最终均 exit 0：

```text
python3 -B /tmp/aimy-20261014-remaining-kirara/checks.py
node /tmp/aimy-20261014-remaining-kirara/airi-checks.cjs
```

| 组 | 正向 | 预期拒绝 | 缺陷/有界反例 | 合计 |
|---|---:|---:|---:|---:|
| Kirara | 8 | 6 | 6 | 20 |
| AIRI 相邻链 | 6 | 6 | 2 | 14 |

34 条观察均符合预期断言，包含明确缺陷；**不是 34/34 产品通过率，也不是胜率**。运行时 Python 3.12.10、Node v24.20.0；AIRI 使用实际已安装的 TypeScript、Zod 版本见 `run-summary.json`。未测试 Python 3.10；来源 pyproject 的 >=3.10 不等于本轮验证该运行时。

Kirara 实际执行从当前源码 AST 提取的原始类/函数体，去掉注入装饰器调用；实际用 stdlib `asyncio.timeout`、`ThreadPoolExecutor`、`typing`、`inspect`、`re`。Pydantic DTO/config 构造、依赖容器、日志、事件/持久层、dispatcher 的最终执行 sink 是显式假边界。因此不是 Kirara 原生安装启动或 Pydantic 验证。

AIRI 执行原 TypeScript 工作流、RunStateManager、strategy、相邻纯函数，使用实际 Zod4.4.3；`executeAction` 是记录器，**没有执行 shell 命令**。Discord 只执行原 MessageCreate 回调及 normalize 函数，消息/客户端发送为假对象，未构造 DiscordAdapter、登录或发信；翻译 t 和一个 context strategy 标签也为假边界。

## 2. 四个有界比较切片

| 切片 | 当前事实与正例 | 负例/限制 | 复用资格 |
|---|---|---|---|
| KI-DIFF-F01 / KI07 | 普通 `TextBlock→TextConcatBlock` 真沿 Wire 取值，输入 `你好`、`世界` 输出 `你好世界`；声明 int→str 错线拒绝（P01/P02/N01） | 实际返回 int 仍写入结果，再在 concat 失败（C01/C02）；条件 kwargs 复现 TypeError（C03）；前端缺失、未测实际编辑/循环/并行/恢复 | typed 图后端是有界机制差异，整体引擎不判更强。后置；整体成本 L |
| KI-DIFF-F02 / KI04、KI02 | 原 Annotated/ParamMeta 反射出标签、帮助、类型、默认（P03/P04）；AIRI 原 provider schema 的 .meta、默认及真 Zod 正反例已执行（A06–A09） | Kirara 默认 bool 仍 required=True（C04），元数据不等同值校验；Kirara WebUI 没有实跑；AIRI并非所有设置自动生成 | 现有字段能力重复，图块反射仅工程参考。无需换 AIRI 设置链 |
| KI-DIFF-F03 / KI06、KI07 | 原 prefix+group AND、禁用、优先级降序、只执行首条命中和无命中均运行（P05–P07/N02–N05） | 空 group 直接 return True，跳过后续 AND（C05）；真实平台/市场未测。AIRI 原 Discord mention/DM/bot 门控已运行（A10–A13） | 声明式多规则→workflow 是有界差异，不能算「AIRI 没 IM」。一期后置；规则 M，完整多平台 L |
| KI-DIFF-F04 / KI01 | MemberScope/GroupScope 正确区分合成 g1/u1、g1/u2、g2/u1（P08/N06） | query 预载 A 后遍历所有缓存，`extra_identifier='A'` 仍返回 A、B（C06）；AIRI 已有 guild/DM 分段（A12/A14） | 工程参考；不是事实记忆新增或更好召回，不搬 manager |

编号前缀均为 `KI-`，例如 P01=`KI-P01`、A01=`KI-A01`。

**同输入比较的限度：**P01/A01 都给 `你好`、`世界`。Kirara 是原始块真的拼接；AIRI 是原引擎顺序派发，最终字符串是假的动作记录器 `calls.join`，不能声称 AIRI 提供同一数据流合并节点或两者功能对等。A05 仅原 step resolver 接受错类型，没有调用下游 action executor，不据此宣称 AIRI 整条链无校验。P05/A10 都给群聊 `!你好`，但 Kirara 的 prefix/group 与 AIRI 的 mention 是不同已配置政策，回或不回不代表效果优胜。

## 3. 确切源码锚点

Kirara 来源：`/Users/mima1234/Documents/资料/拆解项目/kirara-ai-master`。

- [构建时 Wire 声明类型检查](/Users/mima1234/Documents/资料/拆解项目/kirara-ai-master/kirara_ai/workflow/core/execution/executor.py:41)，[普通块执行与取值](/Users/mima1234/Documents/资料/拆解项目/kirara-ai-master/kirara_ai/workflow/core/execution/executor.py:162)，[条件分支错误调用](/Users/mima1234/Documents/资料/拆解项目/kirara-ai-master/kirara_ai/workflow/core/execution/executor.py:118)。
- [原文本块](/Users/mima1234/Documents/资料/拆解项目/kirara-ai-master/kirara_ai/workflow/implementations/blocks/system/basic.py:10)，[图定义新增 API](/Users/mima1234/Documents/资料/拆解项目/kirara-ai-master/kirara_ai/web/api/workflow/routes.py:93)，[构建节点与 Wire](/Users/mima1234/Documents/资料/拆解项目/kirara-ai-master/kirara_ai/workflow/core/workflow/builder.py:437)。仅静态核 API 写 YAML；本轮未执行 API/YAML。
- [ParamMeta 参数反射](/Users/mima1234/Documents/资料/拆解项目/kirara-ai-master/kirara_ai/workflow/core/block/registry.py:12)，[块信息提取](/Users/mima1234/Documents/资料/拆解项目/kirara-ai-master/kirara_ai/workflow/core/block/registry.py:134)，[输出给 WebUI 的类型 API](/Users/mima1234/Documents/资料/拆解项目/kirara-ai-master/kirara_ai/web/api/block/routes.py:18)。前端源码不在这棵树，未把 API 存在称可视化 UI 实跑。
- [组合规则](/Users/mima1234/Documents/资料/拆解项目/kirara-ai-master/kirara_ai/workflow/core/dispatch/models/dispatch_rules.py:34)，[空组提前返回](/Users/mima1234/Documents/资料/拆解项目/kirara-ai-master/kirara_ai/workflow/core/dispatch/models/dispatch_rules.py:46)，[降序优先级](/Users/mima1234/Documents/资料/拆解项目/kirara-ai-master/kirara_ai/workflow/core/dispatch/registry.py:42)，[首命中选择](/Users/mima1234/Documents/资料/拆解项目/kirara-ai-master/kirara_ai/workflow/core/dispatch/dispatcher.py:32)。RuleGroup/Combined 的源码没有 min-length 限制；空组反例不是假 DTO 特有的拼装条件。
- [作用域谓词](/Users/mima1234/Documents/资料/拆解项目/kirara-ai-master/kirara_ai/memory/scopes/builtin_scopes.py:7)，[query 跨缓存扫描](/Users/mima1234/Documents/资料/拆解项目/kirara-ai-master/kirara_ai/memory/memory_manager.py:100)，[真实历史查询块入口](/Users/mima1234/Documents/资料/拆解项目/kirara-ai-master/kirara_ai/workflow/implementations/blocks/memory/chat_memory.py:63)。这是历史消息 compose/decompose 路径，不是自动事实抽取/可靠删除屏障。

AIRI 对照是当前 `aimy-app/` 的确切源码，不混用工作区旧 `airi-main/`：

- [已有步骤式 WorkflowDefinition](/Users/mima1234/Documents/aimy/aimy-app/services/computer-use-mcp/src/workflows/types.ts:97)，[原执行器](/Users/mima1234/Documents/aimy/aimy-app/services/computer-use-mcp/src/workflows/engine.ts:156)，[approval resume](/Users/mima1234/Documents/aimy/aimy-app/services/computer-use-mcp/src/workflows/engine.ts:921)，[真实注册工具入口](/Users/mima1234/Documents/aimy/aimy-app/services/computer-use-mcp/src/server/register-tools.ts:1189)。源码存在如实登记；电脑操作不属于一期不会被拿来当「源码不存在」。
- [原 OpenAI schema 与 .meta](/Users/mima1234/Documents/aimy/aimy-app/packages/provider-inference/src/providers/cloud/openai/index.ts:14)，[普通设置消费元数据](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/components/scenarios/providers/provider-generation-settings.vue:18)，[普通 Provider 页读取 placeholder](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-pages/src/pages/settings/providers/chat/[providerId].vue:84)。本轮只执行 schema，不挂 Vue 页面。
- [原 Discord 文本 gate](/Users/mima1234/Documents/aimy/aimy-app/integrations/discord-bot/src/adapters/airi-adapter.ts:210)，[guild/DM sessionId](/Users/mima1234/Documents/aimy/aimy-app/integrations/discord-bot/src/adapters/airi-adapter.ts:249)。同 guild 不同 channel 共用 sessionId 是实际当前行为（A14），不据此泛称全部桌面/平台历史隔离失败。

## 4. 对旧报告的校正

1. 「AIRI 没有 workflow」不成立：其 computer-use 服务含步骤式执行、状态、批准暂停/继续与注册工具入口；Kirara 差异限定 Block+Wire 合同与配套管理 API。
2. 「schema 设置表单为 Kirara 独有优势」过宽：AIRI 当前 provider 已有 schema/帮助/默认/禁用及实际 Zod 校验。Kirara 构造器反射/图端口元数据是工程差异；外部 Vue 的编辑体验没被运行。
3. 「统一 IM」不等于 AIRI 缺 IM：Discord 的真实门控/规范化/sessionId 路径存在并已离线执行。本轮没有评定市场和平台数量的可用性。
4. scope/composer/decomposer 不能升级为事实记忆或隔离更强；额外隔离标识串缓存是本轮重现的真实反例。
5. 旧报告关于许可的绝对推广/默认禁止不作为当前候选否决依据。本轮只盘点本地 `pyproject.toml:20` 的 AGPL-3.0-only 与 LICENSE；不作 AGPL 禁商用/语言差异即法律禁止等结论，也没有复制产品代码的实施授权。

## 5. 指纹、覆盖和可交接文件

Kirara 288 个 `.py` + `pyproject.toml`/`LICENSE` 共 290 文件的明示范围指纹：

```text
f1e56e98786bbe968155b0027a135f66014cc43adaf72ae3807c7ead46af4f39
```

算法和逐文件 SHA256 在 `source-fingerprints.json`，没有读取 `.env`、用户数据库或任意配置来作指纹。所有已执行来源的前后 SHA256 一致。**哈希或执行装载不算语义全文阅读**：本轮定向全文 30 文件、部分 12 文件，确切范围在 `read-coverage.json`；AIRI engine/state/strategy虽然原模块执行，语义只计显式已读范围。

- `feature-map.json`：4 切片、既有候选映射、来源/对照锚点、测试 IDs、成本假设、未来最小验收。
- `candidate-map.json`：原 KI01–KI08 共 8 审核记录的建议；KI03/KI05/KI08 本轮没有新增运行测试，明确保留边界，不泛称全部候选已复现。
- `kirara-results.json` / `airi-results.json`：34 条原始观察、输入边界与预期。
- `executed-kirara.json` / `executed-airi.json`：每个实际加载执行的源文件/符号/范围/SHA256，不冒充整应用启动。
- `checks.py` / `airi-checks.cjs`：可复跑离线脚本；`build-package.py` 只生成本目录报告索引。
- `run-summary.json`：实际命令、环境、计数、假 IO、未验证范围与测试装配失败修复记录。

当前最小建议：保留 AIRI 单一聊天/音频/通知/配置链；KI04 按已有相邻能力排重；KI01 继续工程参考；KI06/KI07 记录后置机制差异，等待真实用户可编辑行为/IM需求后再考虑设计完整手册及隔离实现。
