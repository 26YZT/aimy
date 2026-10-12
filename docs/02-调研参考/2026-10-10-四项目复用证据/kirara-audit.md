# Kirara AI → AIRI / Aimy 只读调查

> 文档状态：定向调研参考，绑定当时来源；不是选型决定或实施授权。
> 产物时期：2026-10-10，正文明确日期。精确初稿时间未记录时保持未知。
> 保留原因：保留项目kirara-audit.md模块与缺陷可追踪证据。
> 上下文风险：不可把隔离函数复现/静态语法通过当完整服务、真实设备、模型、许可发行或AIRI集成通过；复现脚本是证据不是应用开发入口。
> 原位置：`digital-lover/docs/调研/2026-10-10-四项目复用证据/kirara-audit.md`；归类整理：2026-10-11。
> 阅读入口：[文档中心](../../README.md)。历史正文中的“当前、唯一、已锁定、下一步”仅适用于原时期。

调查日期：2026-10-10。源码：`/Users/mima1234/Documents/资料/kirara-ai-master`。接入目标：原版完整 AIRI 桌面 `/Users/mima1234/Documents/airi-main`；不面向 aimy 旧历史样机。

## 结论

Kirara 是 **Python 聊天机器人 / 工作流服务框架**，不是桌面虚拟伴侣。最有价值的是 **条件路由、可配置工作流、MCP 工具选取、消息适配器、LLM 调用追踪**。Aimy 的近期重点（自然持续陪伴、可靠长期记忆、低延迟语音、角色表现、授权看屏）没有哪一项可由该仓库整块直接补齐。

建议等级：**备选独立服务 / 中期参考，不列为 Aimy 首批核心依赖**。将来确定需要 Telegram / 企业微信 / QQ 外部入口，或复杂用户自定义流程时再接。不要将其默认聊天和记忆服务整体放到 AIRI 聊天主链路，否则增加 Python 服务、第二套模型配置 / 聊天历史 / 调度器，且现有记忆可靠性与接口完成状态存在实质问题。

主 Agent 已在线核验 GitHub 默认分支 `master` 的 HEAD 为 `8295a5deda0b289a3f70d946064b6c9a3e1b0753`，最后提交 2025-06-28；289 个可比源码 / 脚本 / 样式 / HTML 文件的 Git blob SHA 与本地全部一致，树未截断。因此这些代码问题适用于本次核验的当前默认 HEAD；维护年龄约 15 个月不能误写成本地与当前代码不一致。这里没有核验每个外部插件市场项目或 WebUI 的当前代码。

## 规模、模块与实际调用链

全目录 345 文件；288 Python 文件，29,684 行（含测试）；主源码 221 文件、22,147 行，`tests/` 67 文件、7,537 行，静态识别 255 个 `test_*` 函数。未发现该资料目录下任何 `AGENTS.md`。`pyproject.toml` 包版本 3.3.0a2，声明 Python >=3.10；无锁文件。依赖包含 FastAPI + Quart + Hypercorn、Pydantic 2、SQLAlchemy / Alembic、Redis、MCP SDK、requests / aiohttp / curl_cffi、聊天平台 SDK、语言服务器与测试工具，作为桌面本地 sidecar 不算轻量。

| 模块 | 规模 | 实际职责 |
|---|---:|---|
| `workflow/` | 50 文件 / 3,969 行 | Block 输入输出类型、builder、DAG 执行、条件 / 循环、消息 / 模型 / 记忆 / MCP / 游戏模块 |
| `web/` | 44 / 5,436 | FastAPI 外壳挂 Quart 管理 API；模型、平台、工作流、插件、媒体、MCP、追踪、认证 |
| `plugins/` | 37 / 4,590 | 13 个实际注册的模型适配器、Telegram / QQ / 企业微信 / HTTP、FRPC；Voyage 被 import 但 `on_load` 未见 register |
| `memory/` | 17 / 1,379 | member / group / global 作用域，会话条目组合 / 反解，JSON 文件 / Redis 持久化 |
| `mcp_module/` | 4 / 807 | MCP **客户端** 生命周期、stdio / SSE、tools / prompts / resources 缓存与调用 |
| `llm/` | 11 / 799 | 通用 chat / embedding / rerank 契约、能力位、模型 / 后端选择 |
| `im/` | 7 / 942 | 统一消息元素、聊天发送者、平台适配器生命周期 |
| `media/` | 12 / 1,108 | 图片 / 音频 / 文件注册、引用与清理 |
| `tracing/` | 6 / 803 | 请求耗时、token、错误与可选内容，SQLite 持久化，实时推送 |
| 其他 | — | IoC 容器、事件总线、配置、数据库迁移、应用入口 |

真实启动：`kirara_ai/__main__.py` → `entry.init_application()` 读取相对路径 `./data/config.yaml` → 注册容器、SQLite、媒体、LLM / IM / MCP、记忆与追踪 → import 内置 / 启用外部 Python 插件 → 加载工作流 / 规则 / 模型 → 启 Web 服务和适配器（`entry.py:115-250`）。不是一组可直接被 Vue / TypeScript import 的库。

真实聊天：IMAdapter → `WorkflowDispatcher.dispatch` 按优先级执行**首条匹配规则**（`workflow/core/dispatch/dispatcher.py:32-62`）→ 为请求创建 scope / workflow / executor → Block 线程池执行 → 消息发送。默认角色工作流查询 group 记忆、拼 prompt、同步 `llm.chat`、`<break>` 分段输出并存一条会话（`workflow/implementations/factories/default_factory.py:88-120`）。它是按消息触发的 bot 编排，不是持续感知 / 生活状态 / 主动陪伴循环。

## README 声明与代码边界

| 能力 | 代码确认 | 对 Aimy 的含义 |
|---|---|---|
| 多平台聊天 | Telegram、QQ、企业微信、HTTP 在仓库有真实适配器；README 自己标 Discord / 飞书为重构中、OneBot 为外部插件 | 外部入口有潜在增量，但平台账号、回调公网、实际发送和插件兼容未验证 |
| 模型管理 | 13 个注册后端；统一 chat / embed / rerank 类型，BYOK 配置 | 与 AIRI 已有 provider 层重叠；不建议搬过去作为第二套模型设置 |
| 自定义工作流 | typed Block + builder + 执行器 + YAML 注册 + 管理 API 存在 | 是最值得学习的能力；条件 / 循环 / 超时实现有缺陷，需修复后才适合复用 |
| MCP | stdio 和 SSE 客户端确有实现；可按 enabled_tools 构建调用工具列表 | 不是给 AIRI 直接连接的 MCP server；要暴露自己的 workflow 为工具还需额外 facade。未见 Streamable HTTP 实现；roots callback 明确 NotImplemented |
| “记忆” / 多轮 | 保留最近 100 条 MemoryEntry，每条可含一轮 user / assistant / tool 内容；member/group/global + extra_identifier；JSON/Redis | 是会话缓存，不是长期个人记忆系统。未见事实抽取、语义检索、向量数据库、记忆冲突/遗忘/来源/置信度/用户管理闭环 |
| embedding / rerank | 有 provider 契约与 adapter | 不代表 RAG 已实现；未发现文档导入 → chunk → 索引 → 检索 → 引用的内建链路 |
| 语音 | VoiceMessage 媒体载体 / 部分 IM 发送能力存在；Audio 能力枚举与模型猜测存在 | 不等于完整 TTS/ASR/Realtime 对话；仓库无可直接复用的语音 turn / 打断 / 口型 / 表情链路 |
| 人格 | system prompt 和 `<break>` 分段规则 | prompt 模板不是关系发展或主动陪伴状态机 |
| WebUI | 管理 API 完整；该源码包 `web/` 没有实际前端文件，运行时从 npm 下载 `kirara-ai-webui`（`web/utils.py:83-133`） | README 截图不能当成已本地审查的前端；该前端代码、可视化体验未审查 |
| 授权看屏 / 角色表现 | 未发现桌面截图授权、摄像头、Live2D / VRM、动作控制模块 | 对 Aimy 这些能力没有直接增量 |

## 可复用单元与 AIRI 接法

1. **外部消息网关：中期首选复用方向，成本中到高。** 独立运行经修复的 Kirara，仅保留需要的 IM adapter 和路由，新增专用 bridge Block，将标准消息交给 AIRI / Aimy 会话服务并接收最终回复。AIRI 继续拥有角色、模型设置、语音与唯一记忆；Kirara 不再并行生成第二份回复 / 记忆。需建立 canonical user / session / source IDs，避免目前 ChatSender 只有 user_id/group_id、没有 adapter/account 命名空间造成碰撞。平台服务公网依赖不符合完全本地场景，因此必须是用户明确开启的入口。

2. **可配置场景工作流：作为设计参考成本中，直接复用后端成本高。** 适用“收到某类消息 → 取资料 → 选允许工具 → 返回结果”。可以参照 Block schema / type compatibility / rule priority，按 AIRI 原生事件与工具体系重新实现独立需求。若复用该 Python 引擎，则需修执行器、并发/取消/超时、请求状态、持久化，并新增任务 API；现成 `/v1/chat` 是整轮阻塞文本接口，`/v2/chat` 不是 SSE token 流且有完成状态 bug，不能直接接低延迟语音主链路。

3. **MCP 生命周期 / 工具描述：参考价值中，整块复用价值低。** 可借鉴启用列表、工具 schema、结果转换；Aimy 只开放用户授权的只读能力。stdio 是任意子进程执行入口，Python CodeBlock 是原进程 `exec`，外部插件是 `pip install` + import，均无安全沙箱。不能把模型“允许调用工具”当作用户授权；不应打开电脑自动操作能力。现有实现需要新授权层和资源限制，不能宣称开箱即用。

4. **调用追踪：成本中。** 可参考 request_id / 状态 / duration / token / 可选记录内容，或作为单独服务保留查询 API。Aimy 原生结构化事件层中实现更省进程开销；需检查敏感聊天和截图内容的保留、删除策略，不宜连整套管理后台与数据库一并搬入。

5. **记忆与模型适配器：不优先复制。** 会话作用域和媒体引用设计可学习，但此实现不能满足可靠长期记忆；AIRI 已有模型 / 语音主链路，移植会引入重叠和同步请求瓶颈。优先在 AIRI 唯一记忆接口上接真正的长期记忆能力。

以上是架构 / 工作量相对判断，没有创建 adapter、修改 AIRI 或启动服务。直接复用代码的许可评估必须先完成。

## 代码问题（按影响排序，含触发与证据）

### K1 · P1 · 默认 / 示例 JWT 密钥可预测，首次设密码不生成新密钥

- 路径：`/Users/mima1234/Documents/资料/kirara-ai-master/kirara_ai/config/global_config.py:111` 默认空字符串；`config.yaml.example:19` 固定公开示例密钥。
- 链路：`web/app.py:223-227` 直接交给 AuthService；`web/auth/routes.py:23-26` 首次登录只存密码并发 token，未变更密钥；只有 `web/auth/routes.py:47-51` 改密码才随机化；`web/auth/utils.py:23-30` HS256 encode/decode 只要求 token 有效。
- 触发：用户新建 / 保持默认配置，或照抄示例没有修改 secret_key，且管理服务可被攻击者访问。知道空值 / 公开示例值即可制作有效管理 token，设置密码本身不能修复；默认绑定 loopback 减小暴露面，不消除本机访问风险，主动开放公网 / FRPC 时影响更大。
- 影响：越过密码进入管理 API；这些 API 可以管理插件和 stdio MCP（`plugin_manager/plugin_loader.py:209-225`、`web/api/mcp/routes.py:207-238`），最终影响可达主机权限范围。
- 检查类型：静态完整调用链，未攻击用户服务、未读取实际配置。建议首次启动随机生成并持久化，拒绝空值 / 示例值。

### K2 · P1 · extra_identifier 的记忆隔离失效

- 路径：`/Users/mima1234/Documents/资料/kirara-ai-master/kirara_ai/memory/memory_manager.py:100-115`。
- 触发：同一 sender 的 A、B 两个工作流各自 store 不同 extra_identifier，再 query A。
- 原因：先计算正确 `A-<scope>` 并 load，接着 `for scope_key, entries in self.memories.items()` 扫描所有 cache，仅根据 sender 判断，不按已请求 key / extra_identifier 过滤。
- 影响：A 的 prompt 读入 B 的私密历史，和 UI 承诺“不同标识符互相隔离”相反（`workflow/implementations/blocks/memory/chat_memory.py:51-56`）。还会把不同 scope 中同一 sender 内容混入并产生重复；行为随进程预热改变。
- 纯 stdlib 定向复现：query `A` 实际返回 `workflow-A-secret` 与 `workflow-B-secret`，结果为 true。

### K3 · P1 · 正常关闭不排空持久化队列，最后对话可能丢失

- 路径：`/Users/mima1234/Documents/资料/kirara-ai-master/kirara_ai/memory/persistences/base.py:36-57`；调用方 `memory/memory_manager.py:121-128`。
- 触发：后台正在写较慢磁盘，主线程 enqueue 最后一轮后正常 shutdown。
- 原因：`stop()` 先 `running=False` 再 join；worker 的 while 条件在下一轮直接退出；没有 `queue.join()` / drain。MemoryManager.shutdown 自己 enqueue 所有 cache 后马上 stop，同样不能保证完成。发生写错误时也未 `task_done`。
- 影响：用户看到成功回复但正常退出 / 重启后缺失最后记忆，达不到 Aimy 的可靠持久化要求。
- 复现：用两个 Event 精确控制第一笔写入，在其阻塞时排第二笔并 stop；实际仅写 `first`、队列剩 `final-chat` 1 项。没有依赖磁盘速度或人工 sleep。

### K4 · P2 · 冷启动后的“清空记忆”没有清除磁盘

- 路径：`/Users/mima1234/Documents/资料/kirara-ai-master/kirara_ai/memory/memory_manager.py:137-146`。
- 触发：进程重启后尚未 query/store，直接执行 clear_memory 命令。
- 原因：该 scope 不在 cache 就 return，未向 persistence 保存空列表。
- 影响：用户以为历史清空，下一次 query 又载入旧记录；用于隐私删除尤其不可接受。定向复现确认磁盘 stub 旧条目保留。clear_memory 亦没有 extra_identifier 参数，不能准确清指定工作流的记忆。

### K5 · P2 · 条件 / 循环 Block 有输入时直接 TypeError

- 路径：`/Users/mima1234/Documents/资料/kirara-ai-master/kirara_ai/workflow/core/execution/executor.py:118` 和 `:146`。
- 触发：ConditionBlock / LoopBlock 通过 wire 收到非空 kwargs（正常用法）。
- 原因：`loop.run_in_executor(executor, block.execute, **inputs)`；该 API 接受位置参数而不接受 execute 的关键字参数。普通 Block `:172-174` 已使用 functools.partial，这两处没有。
- 影响：自定义工作流条件分支、循环功能无法正常执行。
- 复现：两处均报 `BaseEventLoop.run_in_executor() got an unexpected keyword argument 'value'`。
- 相关未复现风险：循环普通子节点会因 `results` 中已有名称被 `_can_execute(:205-208)` 跳过后续轮次；所谓 `.parallel` 实际执行器在 `:103-110` 逐个 await，不能据 builder 名称推定并发；线程池 context 在 timeout 后仍 wait 正在运行的同步调用，不保证取消。这些需另做完整集成验证。

### K6 · P2 · 最后一轮禁止工具调用的要求被 OpenAI adapter 忽略

- 路径：`/Users/mima1234/Documents/资料/kirara-ai-master/kirara_ai/plugins/llm_preset_adapters/openai_adapter.py:133-134`；上游调用要求 `workflow/implementations/blocks/llm/chat.py:252-254`。
- 触发：ChatCompletionWithTools 到 max_iterations 最后一轮时给请求设 `tool_choice='none'`。
- 原因：adapter 总是根据 tools 是否存在发 `auto`，忽略 req.tool_choice。
- 影响：最后一轮仍可产生 / 执行工具调用，达到迭代上限后返回的 response 可能只有 tool_calls、没有最终给用户的答案，且本来希望停工具的轮次仍发生副作用。
- 复现：用 fake requests 捕获 adapter 的实际请求，无联网；输入 `none`，发送 `auto`。

### K7 · P2 · HTTP v2 从不进入完成 / 失败终态

- 路径：`/Users/mima1234/Documents/资料/kirara-ai-master/kirara_ai/plugins/im_http_legacy_adapter/adapter.py:77`、`:194-200`、`:217-225`。
- 触发：客户端 `/v2/chat` 后按 README 轮询 `/v2/chat/response` 等待 DONE/FAILED。
- 原因：V2Request.done 唯一赋值是 False；后台 dispatch create_task 没有完成 / 错误 handler，不设置 done 或 result_status，也不保证最终 set event。
- 影响：正常回复始终 SUCCESS；读走最后一次增量再轮询会无限等 event；若无匹配工作流或异常无回复，首轮便等待；任务 600 秒清理不会唤醒该 waiter。该接口不适合作为 AIRI 的完成协议直接使用。
- 检查类型：全库 AST 赋值检查确认只有 `self.done = False`；未启动 HTTP 服务。

### K8 · P2 · 模型能力匹配方向反了

- 路径：`/Users/mima1234/Documents/资料/kirara-ai-master/kirara_ai/llm/llm_manager.py:190-195`；`llm/model_types.py:60-64`。
- 触发：请求 TextChat 能力，已配置模型同时支持 TextChat + ImageInput / FunctionCalling。
- 原因：执行 `requested_ability.is_capable(configured_model_ability)`，而 bitmask 实现比较 `(self.value & ability) == ability`，即要求“所请求能力包含全部模型能力”；应验证模型的 bitmask 包含所需 bitmask。
- 影响：能力更多的模型反而不在选择器列表中，自动选择可能报告没有可用模型。纯位运算：TextChat=14，14 & (14|16)=14 != 30。

附加静态缺陷（未列入主结论）：OpenAI embedding payload 用 `text` 字段（`plugins/llm_preset_adapters/openai_adapter.py:239`），对应 mock 服务也使用同一字段（`tests/llm_adapters/mock_app/models/openai.py:127-132`），测试不能证明真实 OpenAI API 兼容；需主 Agent 核对官方 input 契约后再作为正式问题。`pyproject` 声明 Python >=3.10，但执行器 `asyncio.timeout` 依赖 3.11 API，未运行 Python 3.10 验证。

## 许可

`/Users/mima1234/Documents/资料/kirara-ai-master/pyproject.toml:20` 明确 `AGPL-3.0-only`，根 `LICENSE` 是 GNU Affero GPL v3。许可允许商业使用本身，不等于允许将代码直接复制到闭源 Aimy 且不履行其义务。直接复制模块、修改 / 分发、组合形成衍生作品，以及用户通过网络交互时的源代码提供义务都需按最终架构核验。

独立服务是技术解耦方案，**不能仅凭“HTTP / MCP 跨进程”就断言免除 AGPL 或保证 Aimy 可闭源**。若希望闭源商业交付，应先确定 Aimy 开源策略、与权利人讨论单独授权，或按公开接口 / 非版权理念自行实现；不应把架构建议当法律定论。各外部插件 / 模型 SDK / WebUI 许可也需单独盘点。本报告不联网；官方许可解释由主 Agent 统一核验。

## 已做与未验证

已做：目录 / 依赖 / 测试入口盘点；上述模块入口与核心调用链人工阅读；288 个 Python 文件全部 `ast.parse` 通过，无语法错误；6 类 stdlib 定向检查（记忆隔离、冷清空、关闭队列、条件 / 循环、tool_choice、HTTP done 赋值）。检查从 AST 抽取已阅读的方法，注入 stub，不执行任何仓库顶层 import / 初始化。

复现脚本：`/tmp/aimy-four-projects-20261010/kirara-directed-checks.py`；机器可读结果：`/tmp/aimy-four-projects-20261010/kirara-directed-results.json`。

未做：未安装任何依赖；未跑项目 pytest（部分 fixture 会实际起 mock HTTP 服务，不能把静态 255 个测试函数当作 255 passed）；未启主服务 / MCP / FRPC / 真实模型；未读个人配置 / 凭证 / 聊天；未访问平台账号；未验证 macOS 桌面打包、低延迟语音、UI、重启持久化的完整产品流程；未改来源或 aimy。源码审查不是逐行形式证明，也不是完整安全审计。
