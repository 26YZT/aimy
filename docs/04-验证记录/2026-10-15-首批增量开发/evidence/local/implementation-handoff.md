# LOCAL 实现交接

2026-10-15，20文件，准写权来自根。源码位置全部aimy-app，未改main/index、renderer/main、App、session-store，无安装/模型/用户凭据或真实DB读取。

## 实际行为

- 桌面配置configureLocalOnly后，Provider同步调度/after-await、service方法、chat mapper每次请求、auth-fetch每次401重试、WS connect/auth/send/pull阻云副本。BYOK模型请求保留。根负责session-store早期门与renderer启动安装。
- Provider configs在local-only下是当前窗口私有编辑草稿，不进入Pinia $state或localStorage。原表单沿用，300ms合并。flushProviderConfig(id)/flushProviderConfigurations()等待本窗保存。
- 密钥按照已声明password字段、已知key/token/credential/header字段与嵌套字段分离，URL用户信息/已知凭据query也分离。runtime只临时resolve。旧credentials/configured键不读取/迁移。
- 新localStorage key settings/providers/local-configured-v1为schemaVersion=1单envelope，包含providers/revisions/added。commit先验证并setItem成功，再更新公开状态。损坏/未知schema拒绝覆盖。失败回执保留旧引用。
- 私有准备动作不经synced RPC。只有commitPreparedConfiguration/ensurePreparedProvider发送非敏感配置/ref/expectedRevision给leader；ensure原入口在本窗先验证，不把raw key传RPC。getProviderConfigRevision()覆盖提交config/ref/model及删除再建代次。根已接关闭trace。
- main ProviderSecretVault每app唯一实例；safeStorage加密单文件，0600、原子rename+fsync。引用不可变，因此配置提交失败时旧版本仍可用。IPC sender主frame/活窗能力与await后再次校验。根/品牌负责实际登记。
- 原Provider工厂、validation和catalog接resolve，不改用户聊天模型绑定，getChatProviderInstance(providerId,{reasoning})保持。runtime state fingerprint不含秘密值。

## 验证

- /tmp/.../local/vitest.config.mts，8 node文件70 tests pass。包括原config/mapper/WS纯逻辑及新安全文件、401重试/Provider/mapper末端零发送。
- /tmp/.../local/vitest-browser.config.mts，从/tmp启动导入原stage-ui配置，envDir为空目录。5 Chromium文件13 tests pass，含原onboarding/model catalog回归和新真实双Pinia/BroadcastChannel/store持久化、写失败/新store恢复、真实DeepSeek factory/validation/catalog合成key及WS idle/零产品send。
- 原catalog test同步动作名称变为commitPreparedConfiguration，已更新断言，仍验证无state proposal。
- 定向ESLint 0 errors，6条既有长注释warnings。
- desktop完整vue-tsc多轮：本分支曾整体通过；最后新测试this类型已按根反馈补Storage，根最终统一复跑。
- 首次runtime端口parameter-property被root真实Electron发现strip-only不支持，本agent已改成显式readonly字段，root另修打包externalize路径。

## 证据限制/后续整合

这些是离线合成测试。没有真实safeStorage OS/IPC用户验收、真实模型或完整设备验收。成功配置提交后回收旧ref，remove/reset也回收对应ref；未知RPC结果保留新ref，明确未提交才清新ref。清理失败告警并保留密文，未知结果可能留孤儿引用，不能声称完整物理擦除。其他模块直接改非敏感config的旧调用不等于全部模块版本化验收；首批聊天路线已过实际factory测试。root仍须核独立profile/真实Electron载入/关闭回执并跑最终源码范围回归。

补允写消费闭包：libs/auth-fetch.ts、libs/chat-sync/{cloud-mapper,ws-client}.ts、composables/use-provider-validation.ts、新增相关tests。原因是实际重试/网络边界与原直接表单编辑，不新增框架。

独立审查修复：ensure raw-key RPC旁路、commit已落盘而ack丢失时误删新key、正常更新引用累积，均补实际browser canary/故障测试。SDK包含key错误到日志/state的canary也通过。
