# 真实模型验收入口验证

日期：2026-10-16（Asia/Shanghai）。状态：入口工程验证完成；正式配置窗口待用户手工保存测试密钥，未执行付费验收。来源：当前aimy-app、固定AIRI对照产物、用户V2案例及本轮机器证据。用途：承接8例真实模型对照。风险：模拟响应不证明语义理解、陪伴质量或优于原AIRI，不是发布验收。

> **配置追查更正：** 正式Library目录曾被凭据校验误拦，已修复并通过22项检查。当前仍无可用配置绑定；截图Thinking Mode为Auto，需改为Disable后重新核对。原临时目录测试不等于正式配置成功。

## 交付结果

保留已确认8例V2、官方deepseek-flash非思考模式、一次累计¥10。用户原文SHA256为`37fa26c0f5ea08e4fb6b3c6b9691640c805231af31562f9cf0b036cb7c9e6bdc`。产品仍为`/Users/mima1234/Documents/aimy/aimy-app`，未混入旧Aimy。真实模型调用0次，正式账本开窗前为0次/¥0，未读取真实凭据。普通桌面构建无验收driver/虚拟时钟；测试驱动只注入受控副本。

[完整模拟结果](qualification-summary.json)：8例×原AIRI/Aimy两臂，36条输入、54次本机HTTPS固定响应、54条已结算模拟账目、18次正常进程退出。案例5两臂均退出重启；案例7/8均换空白新会话。实际运行报告见[run-result](qualification-run-result.json)。无评分、无优胜判断。

## 真实验收入口

正式资料固定在`/Users/mima1234/Library/Application Support/Aimy-Acceptance/first-memory-v1`。同一`ledger.json`承接原AIRI、Aimy、记忆整理、重试及后续试聊；重开/重跑不清零。模型输出缺usage或费用不确定则暂停。价格按官方高峰上界保守核算，执行前24小时价格复核；不是平台真实账单。

设置复用AIRI现有DeepSeek页和系统安全存储。配置窗口关闭调试端口，保存只登记公开配置及不含明文的引用。配置期间网络与付费gate拒绝模型请求，保存不会自动执行。原有配置页可能显示“Configuration validation failed”：此阶段禁止联网，所以不能以该提示判断密钥是否有效；只填写API Key并离开输入框，无需点击Continue Anyway或连接测试。有效性留给显式真实验收判断。

受控执行核验案例/原文/完整产物摘要、配置修订、单条密文、费用预留及最终请求正文摘要。只允许固定官方文本端点；非2xx和网络错误不回显敏感内容。每个case独立资料，只接收指定的一条密文，不复制旧profile。正式批次与模拟批次共享已核验构建，不共享密钥、资料或账本。

命令从aimy-app执行，使用已安装工具，不重新安装：

```sh
node_modules/.bin/tsx apps/stage-tamagotchi/scripts/acceptance/live-cli.ts status
node_modules/.bin/tsx apps/stage-tamagotchi/scripts/acceptance/live-cli.ts configure
```

本轮只执行configure。后续明确开始付费对照时才执行`run --execute`，并沿用本账本；正式评分/人验另行记录。入口源码、详细边界与恢复方式见[实施手册](../../05-实施手册/2026-10-16-真实模型验收入口/README.md)。

## 检查与证据

- 最终定向Vitest：10文件146项通过，含预算、请求证明、凭据绑定、完整产物/host修订、网络、TLS及子进程失败清理。命令：`node_modules/.bin/vitest run --config /tmp/aimy-live-entry-20261016/integration-vitest.config.mjs`，见[日志](checks/integration-tests-final.log)。
- Provider重复初始化：真实Pinia/同步插件新增3项，连同既有local-only6项共9项通过。Provider全目录80/81，剩余token rotation expected2/actual3在临时恢复旧分支后仍失败，见[前后对照](checks/aimy-repeat-provider-existing-original-branch.log)。不称全仓测试通过。
- 定向ESLint、scripts strict tsc、driver vue-tsc、desktop/stage-ui消费闭包类型检查通过。普通core-agent及桌面构建通过，实际构建关闭.env加载和联网，未安装升级依赖。见[普通构建检查](checks/ordinary-build-check.json)。
- 全仓`moeru-lint .`/ESLint被文档工作区缺`@radix-ui/colors`阻断；根turbo typecheck被未安装可选场景工作区工具阻断。调用根检查时显式关闭pnpm运行前自动安装，未补依赖或改配置隐藏问题。日志分别为[lint](checks/root-moeru-lint-required.log)、[typecheck](checks/root-typecheck-required.log)。
- 假密钥实际原生窗口输入、自动保存与正常退出通过；重开仍配置就绪，零请求且预算状态原样保留，调试端口关闭。见[保存回执](checks/native-save-result.json)、[重开回执](checks/setup-restart-result-4.json)。早期首次保存亦为0请求/0账目，见[首次记录](checks/setup-qualification-result.json)。
- 真实Electron本机TLS正反例：指定证书HTTP200，错误钉选握手拒绝且不发HTTP；见[原生TLS证据](checks/native-tls-positive-negative.json)。

## 发现的问题与处理

1. 已有Provider重复初始化返回Vue Proxy，真实跨窗口同步插件无法structuredClone。只将该返回分支改为独立cloneDeep对象；修复前3条真实插件回归失败，修复后通过。
2. 配置窗口启动失败时旧工具过早退出留下子进程。现先等待正常退出，超时终止自有进程，日志关闭并释放锁后才传播错误；4条真实子进程回归包含忽略SIGINT的进程。
3. Electron certificate.fingerprint实际格式与原mock假定不同；改为从PEM计算SHA256。另外原AIRI channel服务启动会安装证书验证器，故仅模拟host在renderer就绪时重新钉选本机fixture。正式host不安装该例外。错误证书持续拒绝，不关闭系统证书验证。
4. host修订实际重新编译到不可变版本目录，完整产物校验后归档旧绑定，不重写摘要绕过校验，不重新复制桌面。14项构建验证含两轮真实Vite编译和旧版本可验证。

两次TLS失败模拟账本保留暂停、unknown记录，没有重置。最后一套独立合成工程fixture通过；它不是给正式验收增加额度。正式批次始终只有一个¥10账本。并发源码变动导致build3拒绝复制，失败日志/压缩manifest保留，仅删除本轮生成的无效clone释放磁盘。临时native保存脚本曾在成功保存后误调用未使用的CDP client，已按实际host/公开回执复核并另做独立重开测试，没有把脚本报错伪装为原始成功结果。

机器详细附件在`/tmp/aimy-live-entry-20261016`，根docs保存选定原字节记录与公开摘要。不纳入密文vault、个人profile或任何真实密钥。Git未暂存、提交或推送。原生操作期间曾锁屏，用户解锁后已继续实际输入检查。

## 下一步

用户在已打开的独立DeepSeek设置页手工填测试密钥。只读取公开保存状态，不截图或读取真实密码框，不用付费探测证明保存。随后接续真实对照的评分准备和显式执行；真实结果、人验、全语音/人物/看屏体验及分发仍未通过。

## 10月16日配置截图追查：正式目录修正

用户反馈DeepSeek页显示验证失败，Thinking Mode为Auto。核对发现此前临时目录验证未覆盖正式Library路径：live-credential.ts笼统拒绝所有含Library的目录，正式保存回执报LIVE_CREDENTIAL_PATH_DENIED。此前“配置入口就绪”的结论在正式凭据绑定环节不完整，不能以窗口打开或模拟目录通过代替。

现仅放行当前用户规范化home下的固定`Library/Application Support/Aimy-Acceptance/first-memory-v1`，仍校验专用profile标记和单条密文，其他Library目录继续拒绝。新回归先失败后通过，连同既有检查22项通过，lint/strict tsc/diff-check通过。实际重编译host为`ec501d0d-0259-4dd7-94d9-3392c2f2669e`，原进程正常退出后以修复版本重开，未迁移/清空数据或更改账本。

正式公开状态已从PATH_DENIED变为NOT_CONFIGURED，已产生revision4的失效回执，说明路径问题解除，但选定配置尚未满足绑定条件。截图Auto与固定非思考模式不符；下一步请用户选择Disable，再只读公开就绪回执，不读取真实密钥/密码框或付费探测。UI自动连通性验证仍被配置模式阻断，不据此判断密钥有效性。核对时正式账目0条，余额¥10。

## 同日配置确认

用户将Thinking Mode改为Disable后，再次只读公开status：`configured=true`，`priceCurrent=true`，正式账目0条、已计费0、预留0、余额¥10。验收绑定已就绪，无需重填密钥。页面红色验证失败来自配置阶段禁止联网，不能用于判断密钥有效性；密钥有效性与真实模型效果尚未联网验证。助手未读取或回显明文，未发模型请求。
