# 首批本地 owner、来源与传输合同只读复核

日期：2026-10-15（Asia/Shanghai）。范围：当前 aimy-app 与根 docs。仅写本 /tmp 目录；未改源码、未安装/升级、未启动产品/模型/设备、未读取运行数据/真实凭据、未调用 git status。此文为主代理整合交接包的审查输入，不是实施授权或测试通过证据。

## 1. 可以保留的原版能力

- stage-ui/database/storage.ts:6–11 已有 unstorage memory 默认驱动、local/outbox 的 IndexedDB mount。`local` base 为 `airi-local`，不是数据库名。已安装 unstorage IndexedDB driver 默认使用 idb-keyval 的 `keyval-store/keyval`（未设置 dbName/storeName）。
- stage-ui/database/repos/chat-sessions.repo.ts:29–48 已有 await 的 get/saveSession/index；原版 commitUserMessage（session-store.ts:341–367）会 await 持久队列并核 session generation、稳定消息 ID，重试现存消息不重复添加。
- session-store.ts:162–172 的 enqueuePersist 已保持串行，失败传回调用者。它不是跨多个 IDB key 的事务，也不是所有窗口独占证明；原版 synced actions:1737–1757 负责将提交/删除等命令转给 leader。
- 原版 getCurrentUserId/CharacterId（session-store.ts:136–142）沿 auth.userId（auth.ts:86–87，缺省 local）与 card.activeCardId（airi-card.ts:98，缺省 default）。使用同一身份来源，不能另造第二身份库。
- 原版 consciousness.ts:21–23/107–113 提供有效聊天 provider/model 和同步清理旧 provider 模型的 watcher；provider.ts:915–965 提供配置驱动实例缓存和协议无关 GenerationProvider。不复制候选服务商框架。
- core/runtime/chat-orchestrator-runtime.ts:741–759 已先 durable user commit 后回调，但该回调未 await；普通新消息持久成功与 Memory 入队之间仍有 crash gap。
- 原版请求支持 chat-completions 与 responses、native continuation 及协议切换/重试；保留协议渲染器与工具迭代，不另造聊天服务。
- 桌面已存在 main/window 生命周期事件、microphone/screen capture 流与主进程退出钩子。首批只接资源保护、取消/回执，不重写语音或增加主动看屏功能。

## 2. 存储与回执需要补的窄适配

### 同一 store 的原子更新

在现有 stage-ui/database/storage.ts 中集中定义原 local store 标识、`toLocalPhysicalKey` 和 `updateRawLocal<T>`。新增 MemoryRepo 只调用该适配器和原 storage 读接口。

`idb-keyval.update(key, synchronousUpdater, sameStore)` 已安装 6.3.0，内部 readwrite 事务 get→put，Promise 采用 transaction.oncomplete 才完成。updater 必须同步，不能把模型、IO 或 await 放入事务。原 unstorage IndexedDB driver 仅暴露 get/set/remove，没有 update；`getItemRaw` 后 `setItemRaw` 不能称 CAS。

MemoryRepo 用一个 scope envelope key 原子修改：事实、来源状态、提取 jobs、屏障、modelPolicy/autoSave、幂等回执、清理 jobs、ownerLease/fencing token。先核 mutationId+payload digest，再核 expectedRevision+lease。响应必须在同 key transaction complete 后返回 revision/epoch；失败不能提示保存成功。不同 key（原聊天记录↔MemoryEnvelope）操作仍分步恢复，不能声称全局事务。

物理 key 必须对照 unstorage 的 normalizeKey/base/mount 规则，而非随处拼接。当前方案的逻辑 `local:aimy/memory/v1/{principal}/{character}` 会对应 `airi-local:aimy:memory:v1:{encodedPrincipal}:{encodedCharacter}`；需真实 IDB 双向读写测试证明 converter 与 driver 一致。adapter 不新建数据库、不迁移/清空旧运行数据；禁止 clear() 大范围擦库。

### 聊天与 Memory 入队 gap

建议扩展原 `types/chat-session.ts` 的 `ChatSessionRecord`：新增 optional `memoryJournal`，其中来源版本/事件与这次消息 snapshot 一起进入原 saveSession 的同 key 写。session-store 对应维护每会话 journal，同一 leader 串行更新，新增返回状态纳入同步。

来源标记包含 eligibilityActivationId、source identity/revision/hash、commit operationId、pending enqueue 状态。启用策略先原子写 MemoryEnvelope 的 activationId；**只有启用后的新本人输入**产生标记。旧记录无 marker 不参与。重启恢复仅扫描这些标记与持久 session 索引，向 MemoryEnvelope 幂等补入未接收版本，再回写 journal ack。任何一步 crash 后可重复执行，不能重新抽取整个旧历史。若 session 索引丢失会影响发现，应把 createSession/记录索引故障作为恢复负例，不能假设时间戳游标永远够用。

实现可选用 session record 内 source journal，避免改 core ChatHistoryItem；若最终选择将字段放消息上，实际定义在 `core-agent/src/types/chat.ts:78–100`，stage-ui/types/chat.ts 只是 reexport，允许区必须相应调整。

更正/删除/最终转写需要 owner 提供明确的 durable receipt，包括 operationId、session/source revision、persistedAt/status；`persistSession` 当前返回 void，需补描述而非靠“函数叫 async”推断。

`deleteMessage:385–397` 调 setSessionMessages→replaceSessionMessages:321–325→void persistSession；当前 await deleteMessage 仅等过滤，并不等磁盘。把 mutation 改为 await 原 persist pipeline 并核身份/session generation；失败/状态不明保持 pending/partial，不丢编辑输入。Barrier 先落 MemoryEnvelope，再做原 chat mutation，再清理派生并完成同一 cleanupJob；不自动授权 memory-and-known-sources 或删除整会话。

## 3. 分开 MemoryScope、ChatRequestScope 与 typed source

```ts
// Proposed host-owned contracts; not implemented.
type MemoryScope = { principalId: string; characterId: string }
type ChatRequestScope = MemoryScope & { sessionId: string }
type SourceBase = MemoryScope & {
  sourceId: string; sourceRevision: number; contentHash: string
  authoredAt: number; committedAt: number; author: 'user'
}
type SourceRef =
  | (SourceBase & { kind: 'chat-message'; sessionId: string; messageId: string; activationId: string; channel: 'text' | 'voice-final' })
  | (SourceBase & { kind: 'onboarding-answer'; submissionId: string; fieldId: string; initializationRevision: number })
  | (SourceBase & { kind: 'profile-correction'; correctionId: string; factId: string })
```

每个来源 ID、revision、hash、author 与 scope 都由 owner 从已持久输入生成并核查；模型只交本次允许 source IDs 的候选，不能自封 user/source 或修改权限。chat role=user 也不是内容永真证明：引用他人、虚构情节、示例、否定和条件话语仍需候选语义验证。unknown schema/非有限数/跨scope/越权字段拒绝。

retry 保持原来源血缘而非把新 messageId 当又一份用户事实；fork/import 保持历史展示但不自动激活旧来源；ASR 未 final 不入队，final 更换推进 sourceRevision/hash，空 final 删除/取消须走同一失效屏障。

首次档案不需要 sessionId。原 onboarding/core extraSteps:157–165 放在 provider configuration 后、model selection 前。auth.ts:87 可得到 local principal；card.ts:98 默认 default，initialize:878–900 创建/修复有效卡。**提交须路由到 Stage leader**，在 App.vue:273–284 原 auth/card 初始化之后的 memory-ready 门核 canonical scope；不能由 onboarding follower 凭瞬时 local/default 抢写。身份/角色在保存间变化则拒旧快照，UI 保留草稿供重试，不伪造聊天消息。

初始化明确选项直接做结构校验并将 source+事实写同 envelope；自由文本先 source+job 同 key 落盘，模型可用后再提取，不阻塞现有基本配置后的聊天。全部跳过不写空白用户事实、不猜偏好；档案与关于我为同一事实库视图，不建 profile 第二库。

## 4. 默认跟随/可覆盖的模型合同

在同 MemoryEnvelope.policy 下持久 `modelPolicy: {mode:'follow-chat'} | {mode:'override';providerId;modelId;reasoningMode?;sampling?}`，配置只存 provider ref/型号/可见参数，真实密钥只由原 Provider 边界+拟建安全桥管理。

- follow-chat 在**提取任务实际开始时**解析已选聊天 provider/model；不是永远锁定来源发言当时的模型。初始化发生在 model selection 之前时 job 可等配置，不凭空补模型。
- 提取是独立请求、专用 Prompt、无电脑工具/side effects，和聊天共用 model 并不等于复用聊天历史正文；只发送必要的新本人来源及相关事实。
- dispatch 时捕获 routePolicyRevision、providerConfigRevision、providerId/model、mode/参数、memoryEpoch、sourceRefs、sessionGeneration/ownerLease。job 持久可审计的非敏感执行描述；密钥/完整包含凭据的 config/headers 不入 job/日志。
- `getChatProviderInstance` 内部有 async metadata/loading；返回后再核路线与配置版本。路由/Provider 删除/模型改变/身份变更使旧执行失效并取消，不把旧输出提交到新job。
- override 不可用时明确提示“记忆整理模型不可用”，保留 job/聊天；不静默切换服务商导致意外费用。用户可恢复跟随。调路由不另建事实库，也不重扫旧历史。
- 现有 consciousness.getChatProviderInstance 会按**当前聊天选择**决定 reasoning，不能直接拿来给独立 override 假装选项正确；用 provider.ts:956 参数端口构造 memory 请求自身选项。
- 验收模型 deepseek-flash、总额 ¥10 仅未来验收范围；配置跟随/预算批准不等于本轮开始付费调用。

## 5. 请求投影、native 失效与真实发送 guard

原 runtimeContextProviders:290 是无 scope 的同步函数数组，不适合长期事实；新增 `resolveRequestContext(ChatRequestScope, TurnRef, query, signal)` 端口，在真正 Conversation 构造前读取 Memory projection。不改 composedMessage hook 副本冒称注入（runtime:890–908 明确其只用于诊断）。

guard token 至少关联 principal/character、sessionGeneration、memoryEpoch/revision、source versions、owner lease、app/resource epoch、model route revision。最终 transport 和事件呈现/assistant持久提交都核资格。

必须接的实际链：
1. core/types/llm.ts：增加非序列化 guard/invalidated 合同和 request correlation memoryEpoch。
2. runtime/llm-service.ts:82–101：prepareStringContent 和 tools 都有 await；当前 :91 abort 检查早于 :93/96 tools await。增加所有异步准备后 guard，并让失效错误不走 transient retry。
3. runtime/chat-completions.ts:41–97 与 responses.ts:189–241：每个 prepareStep/resolveStep 后重核，并在 providerConfig fetch 字段变更时保留 guarded fetch。
4. 最终 fetch wrapper 每次真正 HTTP 前重核（包括重试和 RequestSwitch），直接在 guard 通过后同步调用既有 provider fetch/global fetch；不得只核首个 streamText()。
5. mutation发生则取消旧请求；丢旧 Conversation/messages/items/body/options/native 数据，再从有效历史和当前 Memory 重建。有限重试，否则提示重新发送，不能循环重构到预算耗尽。

原 createContinuationScope(request-context.ts:47–49) 仅 provider、baseURL、model、conversationId，需纳入 memoryEpoch。chat messages:178–190、responses:82–89 先匹配native，否则回到 portable projectRound；**只改scope会把相同旧事实从portable再送出去**。请求副本必须过滤已屏蔽源用户消息、依赖被删事实的旧assistant/providerTranscript/generationTranscript/摘要/缓存；source依赖未知则保守不回放该派生旧turn。保留原聊天显示与数据维护语义，不以此自动物理擦除全文。

当前 buildContext:572–577 优先 generationTranscript、其次 providerTranscript；都纳入 source dependency invalidation。回复中同义事实是否准确不能靠字符串删词保证，真实模型测试仍必须做。已在屏障前送出的远端请求无法撤回；承诺本地停止交付/提交及屏障后拒绝新旧payload，不能承诺外部模型已遗忘。

## 6. LOCAL/LIFE 共同前置的现有链与增量

LOCAL：provider-config.ts:50–53 是当前本地配置持久化，:368–450 登录时可 cloud pull/push 完整 provider.config，:460–462 会自动开始；session-store:829 reconcile、:1209 pushMessageToCloud、:1268 drainOutbox 也是真实云同步入口。不能只关 UI 或仅靠匿名身份。拟增集中 local policy gate，在调度和最后网络边界均阻断 Aimy 额外云同步（包括已有pending outbox/周期回调/登录恢复），保留用户配置模型必要调用；既有outbox保留冻结，不自动删除/回放。

安全桥是**拟新增**：main `services/aimy/provider-secrets.ts`（safeStorage 加密写 userData 下独立文件、原子替换、sender/window capability校验，无明文回退）；shared `eventa/aimy-provider-secrets.ts`；renderer `bridges/provider-secrets.ts`；stage-ui `services/provider-secret-storage.ts` 窄平台端口。renderer/main.ts 在 createPinia/createApp 之前配置桥，provider config持久记录只保存 secretRef，runtime request按受控端口取临时secret。非敏感配置继续原 store；不搬所有请求到main或另造服务。选项界面和模型配置同步不能把 runtime secret 再写回localStorage或同步全state。

LIFE：main/services/electron/window.ts:56–61 已发show/hide/min/restore/focus/blur；renderer/stores/stage-window-lifecycle.ts:20–25 的 stagePaused 只min暂停动画，不能直接当资源权限开关。新增资源策略门单独依据 hide/min/quit/user-off 撤epoch，失焦不撤；收起聊天窗不等于隐藏主舞台。

main/index.ts:418–470 的 handleAppExit 已等待 emitAppBeforeQuit，但缺 renderer 有限停止/落盘握手；bootkit/lifecycle.ts:22–25 顺序await hooks，无timeout。接拟增 shutdown operation/receipt，先同步撤新调用资格、renderer cancel/释放采集、flush 已提交持久队列，再返回有限回执；超时不伪报全部停止/保存。

audio settings:29–45 的 holding subscription 仅其中一个消费者；voice、手动录音、电平等订阅都要经统一资源门。底层 packages/audio/src/browser/sources.ts:109–127 已在 getUserMedia resolve 后注册cleanup并检查scope abort，可先复用，禁止重复造media源。useVisionScreenCapture:58–65 已停tracks、:130–143 仍有异步start；ambient和system-audio-lipsync也要纳入关闭保护，不扩本批为看屏产品化/语音优化。

## 7. 必须扩充的任务文件允许区（相对 aimy-app）

| 任务 | 已有、需允许的准确文件 | 拟新增准确文件（仅方案） |
|---|---|---|
| BASE-01 | `.tool-versions`；`apps/stage-tamagotchi/src/main/windows/**`；`src/renderer/pages/about.vue`、`pages/onboarding.vue`；实际命中locale/上游署名。可见托盘词条从已有windows/tray和i18n局部追踪 | 无新运行框架 |
| LIFE-01 | `apps/stage-tamagotchi/src/main/index.ts`、`main/services/electron/window.ts`、`main/services/electron/media-permissions.ts`、`main/libs/bootkit/lifecycle.ts`、`shared/eventa/index.ts`、`renderer/App.vue`、`renderer/stores/stage-window-lifecycle.ts`、`renderer/composables/use-vision-screen-capture.ts`、`renderer/composables/use-screen-ambient-light.ts`、`renderer/features/live2d/system-audio-lipsync.ts`；`packages/stage-ui/src/stores/settings/audio-device.ts`、`stores/voice.ts`、`composables/audio/voice-controller.ts`；已有实际录音/电平consumer（由全调用清单补exact path） | `apps/stage-tamagotchi/src/main/services/aimy/resource-policy.ts`；`src/shared/eventa/aimy-lifecycle.ts`；`src/renderer/bridges/resource-policy.ts`；`packages/stage-ui/src/services/resource-policy.ts` |
| LOCAL-01 | `stage-ui/src/stores/providers/config.ts`、`stores/providers/provider.ts`、`stores/chat.ts`、`stores/chat/session-store.ts`、`services/inference-service-providers.ts`；`apps/stage-tamagotchi/src/main/index.ts`、`src/renderer/main.ts`、`src/shared/eventa/index.ts` | `stage-ui/src/services/local-data-policy.ts`、`services/provider-secret-storage.ts`；main/shared/renderer安全桥如上一节 |
| SRC-01 | `stage-ui/src/stores/chat.ts`、`stores/chat/session-store.ts`、`database/repos/chat-sessions.repo.ts`、`types/chat-session.ts`；core `runtime/chat-orchestrator-runtime.ts`、`runtime/request-context.ts`、`runtime/llm-service.ts`、`runtime/chat-completions.ts`、`runtime/responses.ts`、`messages/chat-completions.ts`、`types/llm.ts`；如果原消息类型加字段，再加core `types/chat.ts` | `stage-ui/src/stores/memory/sources.ts`、`source-journal.ts`、`types/memory.ts` |
| MEM-01 | `stage-ui/src/database/storage.ts`（必要，此前漏）及上述chat-session接点 | `database/repos/memory.repo.ts`、`stores/memory/service.ts`、`store.ts`、`types/memory.ts` |
| MEM-02 | `stage-ui/src/stores/providers/provider.ts`、`stores/modules/consciousness.ts`（仅读取/必要窄端口）与 `stores/chat.ts`；原Prompt/常量入口 | `stores/memory/model-policy.ts`、`extraction.ts`、`budget.ts`、`validators.ts`、`sources.ts` |
| MEM-03 | 原 `stage-pages/src/pages/settings/memory/index.vue`、`pages/settings/modules/memory-long-term.vue`、导航/locale准确触点由UI审查补齐；`apps/stage-tamagotchi/src/renderer/pages/onboarding.vue`、`renderer/App.vue`；`stage-ui/src/components/scenarios/dialogs/onboarding/types.ts`与barrel exports若需要；core原request/messages/llm合同 | `stage-ui/src/stores/memory/retrieval.ts`、`projection.ts`、`mutations.ts`、`profile.ts`；首认识组件由UI审查定名 |

所有新增/改动需对应必要的同目录 .test.ts/.browser.test.ts 与公共export；此表不是要求全部文件改。SRC、MEM写同chat/core区域必须同writer顺序整合，不允许并发改同文件。原 `src/shared/eventa.ts` 不存在，实际是 `src/shared/eventa/index.ts`。原任务MEM-01允许区只有新repo/stores而漏storage adapter；LOCAL漏provider.ts与renderer/main桥注入；SRC漏repo/ChatSessionRecord；MEM漏onboarding入口，需修正旧手册。

## 8. 不升级的可复现环境建议

现场只运行版本读取：Node v24.20.0、pnpm11.24.0。根和核心包均无 engines；.tool-versions写Node26.7.0/pnpm11.24.0。已安装Vitest4.1.11 engines为^20||^22||>=24；Vite8.2.2与electron-vite5.0.0 engines为^20.19||>=22.12，现有Node24.20满足这些已核工具。

建议BASE获实施授权后先记录当前Node二进制/现有lock指纹，**验证现有24.20**的定向typecheck/desktop build，再将开发声明对齐24.20.0及pnpm11.24.0。当前没有足够依据要求安装Node26.7或升级依赖。若具体插件/原生模块测试失败，记录真正失败再收窄调整；不自动install/up/dedupe/prune。本轮未改声明或锁文件，以上不是构建已经通过。

## 9. 已核可用的未来定向命令与最低证据

执行目录 `.../aimy/aimy-app`。只验证配置/脚本/测试文件存在，**本轮没有执行以下产品测试**：

```sh
pnpm -F @proj-airi/core-agent typecheck
pnpm -F @proj-airi/stage-ui typecheck
pnpm -F @proj-airi/stage-pages typecheck
pnpm -F @proj-airi/stage-tamagotchi typecheck
pnpm exec vitest run --project @proj-airi/core-agent packages/core-agent/src/runtime/llm-service.test.ts packages/core-agent/src/runtime/chat-completions.test.ts packages/core-agent/src/runtime/responses.test.ts
pnpm exec vitest run --config packages/stage-ui/vitest.config.ts --project node src/database/repos/chat-sessions.repo.test.ts src/stores/providers/config.test.ts
pnpm exec vitest run --config packages/stage-ui/vitest.config.ts --project browser src/stores/chat/session-store-lifecycle.browser.test.ts src/stores/settings/audio-device.browser.test.ts
pnpm exec vitest run --config apps/stage-tamagotchi/vitest.node.config.ts src/main/services/electron/media-permissions.test.ts src/main/libs/bootkit/lifecycle.test.ts
pnpm build:tamagotchi
```

core-agent/package.json **没有 test:run**，不得写 `pnpm -F @proj-airi/core-agent test:run`。root `test:run`还跑其他apps/服务/所有browser，首批先定向。stage-ui/desktop Vitest config会loadEnv('test', cwd(), '')，执行前使用隔离合成测试环境，禁止借测试回显真实配置；fake-media browser配置不算真实设备验证。

新增模块须补有意义的负例：真实IDB事务abort与回读、新进程同profile恢复、多窗口旧lease拒写；commit之后kill在Memory enqueue之前恢复；model switch/config delay/override失效；ASR旧版本/重试/fork/import不重提取；初始化跳过/无session/身份改变；memory barrier后native与portable和真正HTTP均无旧内容；guard在async准备/每步/重试/实际fetch/呈现/提交全部覆盖；关闭采集后的迟到授权停track；安全存储失败不明文fallback；本地模式登录/旧outbox/周期回调对Aimy cloud无请求；预算试次保留失败与unknown用量预留。

必须分开报告源码核对、合成路由测试、真实IDB/新进程、真实模型、真人试聊结果。用户八例只作素材，原AIRI与增量同模型/同prompt边界/同虚拟时间/隔离profile对照，不能把期望答案送入模型。

## 10. 收口须保留的风险

单key事务不替代跨来源一致性；leader不会自动修复所有磁盘回执；scope hash不会自动删掉portable旧事实；同模型/独立模型不自动保证语义更好；昵称、计划、去世状态、梦想要候选状态/时效与真人评分；8例尚不能证明全部记忆鲁棒性。此审查仅为明确工程合同与文件界限，产品未实施。
