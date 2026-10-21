# REVIEW-LEGACY：kirara-ai / Charakuru 影响汇总的定向复核

日期：2026-10-14（Asia/Shanghai）。状态：独立只读复核；不是重新全量拆解、选型或实施。完整读完 439 行 kirara 报告、475 行 Charakuru 报告，定向检查下列源码/发行包文字。未运行任何发行包脚本、服务、模型、IM账号、Blender；未安装依赖、未改仓库/Git；唯一产出为本文件。

来源版本：kirara `pyproject.toml:7,13,20` 为 `3.3.0a2` / Python≥3.10 / AGPL-3.0-only；Charakuru现存发行包 `package.json:3` 为1.0.4，`/tmp/charakuru-extract/ck.zip` 11,159,648字节，SHA256 `2438dff64e5573cd80bf8691c49713be96d4c46a4cd1dcce52108c4da83ba290`，与原报告相同。AIRI对照只使用当前 `/Users/mima1234/Documents/aimy/aimy-app/`，未混旧 `airi-main/`。

## 十条复核结论

1. **保留：kirara 的 scope × composer × decomposer 是真实接线的消息记忆抽象；必须保留“不是可靠长期事实记忆”的限制。** `init_memory_system` 注册member/group/global、default composer及两种decomposer；`ChatMemoryStore` 将用户/LLM/中间步骤组合成一条MemoryEntry，query再解回消息。默认最多100条。可借“作用域与消息编码解耦”规则，不能据此替Aimy选定事实模型、作用域或持久化结构。
   证据：[entry.py:73](/Users/mima1234/Documents/资料/拆解项目/kirara-ai-master/kirara_ai/entry.py:73)（73–87）、[builtin_composes.py:20](/Users/mima1234/Documents/资料/拆解项目/kirara-ai-master/kirara_ai/memory/composes/builtin_composes.py:20)（20–56/63–94）、[chat_memory.py:121](/Users/mima1234/Documents/资料/拆解项目/kirara-ai-master/kirara_ai/workflow/implementations/blocks/memory/chat_memory.py:121)（121–159）、[global_config.py:102](/Users/mima1234/Documents/资料/拆解项目/kirara-ai-master/kirara_ai/config/global_config.py:102)（102–105）。

2. **修正：“query扫描全部scope key”和“成员/群/全局隔离成熟”都写得过满。** 实际先懒加载请求的一个scope_key，再扫描**已经装入 `self.memories` 的所有缓存条目**，不是枚举磁盘/Redis的全部键。扫描过滤只调用 `scope.is_in_scope(entry.sender,sender)`，没有按当前scope_key/extra_identifier过滤。`extra_identifier` 文案承诺工作流间隔离，但query中未落实该边界；默认sender/scope键也无platform/adapter命名空间。故可指出缓存状态会改变跨key查询范围、存在隔离缺口；本轮未实跑真实多平台污染。
   证据：[memory_manager.py:100](/Users/mima1234/Documents/资料/拆解项目/kirara-ai-master/kirara_ai/memory/memory_manager.py:100)（100–119）、[builtin_scopes.py:10](/Users/mima1234/Documents/资料/拆解项目/kirara-ai-master/kirara_ai/memory/scopes/builtin_scopes.py:10)（10–55）、[sender.py:25](/Users/mima1234/Documents/资料/拆解项目/kirara-ai-master/kirara_ai/im/sender.py:25)（25–34/80–88）、[chat_memory.py:51](/Users/mima1234/Documents/资料/拆解项目/kirara-ai-master/kirara_ai/workflow/implementations/blocks/memory/chat_memory.py:51)（51–57/79）。

3. **保留“有文件/Redis持久化”；修正为源码实现存在，不能写成耐久/恢复成熟。** 文件 `open(...,'w')` 全量JSON覆盖；Redis `set`整scope。Async wrapper把列表引用放queue，worker循环由running控制；stop先设false、join线程再flush，没有 `queue.join()` 排空已排写入。`MemoryManager.shutdown`先排所有save再stop，静态上存在未排空风险。`clear_memory`只处理已在cache的无extra_identifier键。它不能直接作为Aimy重启、纠正、删除可靠性的验收证据。
   证据：[file_persistence.py:26](/Users/mima1234/Documents/资料/拆解项目/kirara-ai-master/kirara_ai/memory/persistences/file_persistence.py:26)（26–58）、[redis_persistence.py:28](/Users/mima1234/Documents/资料/拆解项目/kirara-ai-master/kirara_ai/memory/persistences/redis_persistence.py:28)（28–52）、[persistences/base.py:36](/Users/mima1234/Documents/资料/拆解项目/kirara-ai-master/kirara_ai/memory/persistences/base.py:36)（36–58）、[memory_manager.py:121](/Users/mima1234/Documents/资料/拆解项目/kirara-ai-master/kirara_ai/memory/memory_manager.py:121)（121–146）。

4. **保留但收窄：“内置记忆query未接语义/向量召回”，不能扩成“kirara完全没有嵌入能力”。** memory.query只有sender scope过滤和timestamp排序，无embed调用/相似度评分/向量索引。另一方面LLM层真实有 `LLMEmbeddingProtocol`、`LLMReRankProtocol`，Voyage/OpenAI/Ollama适配有embed实现。因此正确比较是“有embedding/rerank供应商能力，未与默认记忆查询组成可靠语义记忆”，不是项目整体不存在向量相关代码。
   证据：[memory_manager.py:100](/Users/mima1234/Documents/资料/拆解项目/kirara-ai-master/kirara_ai/memory/memory_manager.py:100)（100–119）、[llm/adapter.py:21](/Users/mima1234/Documents/资料/拆解项目/kirara-ai-master/kirara_ai/llm/adapter.py:21)（21–27）、[voyage_adapter.py:75](/Users/mima1234/Documents/资料/拆解项目/kirara-ai-master/kirara_ai/plugins/llm_preset_adapters/voyage_adapter.py:75)（75–90）、[openai_adapter.py:217](/Users/mima1234/Documents/资料/拆解项目/kirara-ai-master/kirara_ai/plugins/llm_preset_adapters/openai_adapter.py:217)（217–256）、[ollama_adapter.py:171](/Users/mima1234/Documents/资料/拆解项目/kirara-ai-master/kirara_ai/plugins/llm_preset_adapters/ollama_adapter.py:171)（171–193）。

5. **必须修正“AIRI IM只有配置模块，所以多平台接入完全缺失”。** 当前AIRI仓实际含独立Discord/Telegram/Satori integrations。Discord入口构造adapter并start，adapter将平台消息带session override发AIRI `input:text`、消费AIRI输出回channel，具备start/stop；Telegram入口initDb/startTelegramBot；Satori入口连接client、注册标准动作、启动periodic loop。它们属于独立integration，不等于已在Aimy桌面默认启用或所有平台功能验收通过。kirara的统一adapter/registry和管理台仍可比较，但应从**组织/覆盖/管理体验差异**出发，而不是“从零补IM”。一期无IM需求的后置裁决可保留。
   证据：[Discord入口:12](/Users/mima1234/Documents/aimy/aimy-app/integrations/discord-bot/src/index.ts:12)（12–25）、[DiscordAdapter:160](/Users/mima1234/Documents/aimy/aimy-app/integrations/discord-bot/src/adapters/airi-adapter.ts:160)（160–170/249–271/306–330）、[Telegram入口:36](/Users/mima1234/Documents/aimy/aimy-app/integrations/telegram-bot/src/index.ts:36)（36–37）、[Satori入口:21](/Users/mima1234/Documents/aimy/aimy-app/integrations/satori-bot/src/index.ts:21)（21–42）。

6. **必须修正“node / web / shared 三套runtime”。** 这些是源码实现目录；`shared/index.ts`只导出共享services。真正枚举为 `electron / node / web`。且node/web的 `createPluginContext` 当前只实现in-memory，多种worker/WebSocket/Electron分支明确抛未实现，不能仅按目录数量称运行时全部成熟/可用。清单/权限/kit/dependency机制的存在可保留；不把接口/校验当进程沙箱或所有transport产品验收。
   证据：[Runtime枚举:50](/Users/mima1234/Documents/aimy/aimy-app/packages/plugin-sdk/src/plugin-host/shared/types.ts:50)（50–63）、[shared/index.ts:1](/Users/mima1234/Documents/aimy/aimy-app/packages/plugin-sdk/src/plugin-host/runtimes/shared/index.ts:1)、[node/index.ts:22](/Users/mima1234/Documents/aimy/aimy-app/packages/plugin-sdk/src/plugin-host/runtimes/node/index.ts:22)（22–35）、[web/index.ts:21](/Users/mima1234/Documents/aimy/aimy-app/packages/plugin-sdk/src/plugin-host/runtimes/web/index.ts:21)（21–34）。

7. **保留：Charakuru标准新制作不含表情/眼动/LookAt；修正“所有产物必定永远没有”与“因此不可使用”的外推。** 发行README明写neutral face/fixed gaze、expressions/eye movement not included；AGENTS限定标准新制作不得**擅自新增**表情/瞳分离/LookAt/眼内部重构。这是工艺默认和agent范围，不是“工具永远无法扩展”或“用户明确要求也不能补做”。`mtoon-export.py:129`还备注保留既有authored MToon settings including expressions；本轮没有导出模型验证该分支。因此汇总应说：标准产物缺Aimy丰富面部表现所需资产；导入类型可兼容，实际能力须按模型检验/另行制作，不能据文档断言所有文件都无任何表情目标。
   证据：[发行README:159](/tmp/charakuru-extract/charakuru-1.0.4-2026-10-12T17-55-01-211Z/README.md:159)（159–166）、[发行AGENTS:45](/tmp/charakuru-extract/charakuru-1.0.4-2026-10-12T17-55-01-211Z/AGENTS.md:45)、[mtoon-export.py:126](/tmp/charakuru-extract/charakuru-1.0.4-2026-10-12T17-55-01-211Z/scripts/mtoon-export.py:126)（126–129）。这些AGENTS/Skills只作为来源材料，本轮未作为可执行指令。

8. **必须撤回“VRM是当前唯一可行路线/只有Charakuru能做Aimy角色/Live2D不使用”。** 两份被审报告没有完成全市场制作工具、外包、可授权成品和用户资产条件调查，也没有确认“用户无画师”等前提；并且用户当前要求正式格式另定。AIRI当前格式枚举和preset实有Live2D与VRM，也支持其它渲染格式。Charakuru证明**一条VRM生产侧候选流程**，不足以排除Live2D或其它已支持路线，更不能直接写成产品选择。保留AIRI现有支持，正式角色格式/美术/音色待定；不需要为纠正此绝对化判断再做一轮选型。
   证据：原报告绝对结论 [Charakuru报告:405](/Users/mima1234/Documents/aimy/docs/02-调研参考/2026-10-13-Charakuru拆解复用评估.md:405)（405–425/431–442）；当前 [display-models.ts:8](/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/stores/display-models.ts:8)（8–17/23–29/51–55）。

9. **必须修正Charakuru“产出的模型可以随便用/产物归你/所有工具代码永远不能复制”的过度概括，保留Kit/资产/Outputs分层。** 本地LICENSE §2明确允许符合条件的privately copy/inspect/modify、AI服务provider私有操作副本；§4对再分发列书面许可条件；§6只是Licensor不因使用Kit对authorized Outputs主张所有权/收费/归属或再分发限制，198–202行同时保留source art/third-party asset/AI content/external service各自权利，**不保证**所有权或商用清权；§8对donor/样例另设限制。故当前个人自用研究不应因将来商业假设一刀切拒绝；只交付合规Outputs与把Kit/Skills/donor打进产品，是不同动作。主agent已做的GPL/AGPL官方复核应替换kirara报告的法律绝对化段落；本文件不另扩大法律判断。
   证据：[Charakuru LICENSE:77](/tmp/charakuru-extract/charakuru-1.0.4-2026-10-12T17-55-01-211Z/LICENSE:77)（77–99）、[LICENSE:156](/tmp/charakuru-extract/charakuru-1.0.4-2026-10-12T17-55-01-211Z/LICENSE:156)（156–168）、[LICENSE:184](/tmp/charakuru-extract/charakuru-1.0.4-2026-10-12T17-55-01-211Z/LICENSE:184)（184–202）、[LICENSE:224](/tmp/charakuru-extract/charakuru-1.0.4-2026-10-12T17-55-01-211Z/LICENSE:224)（224–240）、[README:174](/tmp/charakuru-extract/charakuru-1.0.4-2026-10-12T17-55-01-211Z/README.md:174)。

10. **统一证据措辞：旧报告“实测”“稳定”“零差距直接能用”降为对应源码/文档证据；价格/真实成品仍待验。** Charakuru报告 §5 开头说“AIRI现状全部实测”，但恢复任务主要是只读拆解；本轮未创建成品、未导入Aimy、未跑90帧验证，也没测实际功耗、表情口型、Tripo账号消耗。应保留生产流程与单一知识入口/显式交接/确定性脚本原则；不能把“有导入VRM的代码”写为“此工具产物已验收”，也不能把10-13费用估算写成当前已验证报价。
    证据：[旧报告:347](/Users/mima1234/Documents/aimy/docs/02-调研参考/2026-10-13-Charakuru拆解复用评估.md:347)、[发行AGENTS:63](/tmp/charakuru-extract/charakuru-1.0.4-2026-10-12T17-55-01-211Z/AGENTS.md:63)（63/81–84：技术检查≠外观合格）、[发行AGENTS:71](/tmp/charakuru-extract/charakuru-1.0.4-2026-10-12T17-55-01-211Z/AGENTS.md:71)（71–73：VRM/Blend与正本关联）。

## 无需重做的已确认事项

- kirara记忆抽象、100条默认上限、文件/Redis后端、缺少内置向量记忆调用链已经可从当前源码确定；只需更正范围与成熟度，不再全量重拆。
- AIRI独立IM integrations与runtime枚举的遗漏已有精确源码证据；无需登录平台或启服务才能改正旧报告。
- Charakuru本地1.0.4 ZIP字节一致，README/AGENTS标准表情限制及LICENSE Outputs/Kit/资产分层已核；不需要重新下载或运行脚本。
- “VRM唯一可行”是证据不足的建议，应撤回为候选，不能以重新调研为由延后本轮汇总。

本轮的新增证据均为静态源码/本地发行包文字和ZIP哈希；没有新增运行验收。以上发现只影响调研口径与复用建议，不授权实现、角色制作、外部发信或发布。
