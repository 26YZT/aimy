# 候选能力接入：实现与验证

日期：2026-10-18（Asia/Shanghai）。状态：本轮实现已接实际入口，111项自动化与隔离原生启动/退出检查通过；原生点按、真实模型/设备和人验另列未测。来源：用户本轮批准、先行功能/技术合同、当前源码、独立复核及合成资料测试。用途：区分代码接入、工程正确性与真实陪伴效果。风险：不支持用这些测试宣称优于AIRI；10月16日真实记忆验收失败仍有效。

## 交付与边界

主工程仍是 `/Users/mima1234/Documents/aimy/aimy-app`。按[先行功能文档](../../05-实施手册/2026-10-18-候选能力接入/功能文档.md)和[技术文档](../../05-实施手册/2026-10-18-候选能力接入/技术文档.md)实施；[实际文件与接口](../../05-实施手册/2026-10-18-候选能力接入/实际文件与接口.md)列出真实消费者。保留AIRI桌面、聊天、Provider、本地保存、音频与角色运行链，未启动候选独立服务。

| 方向 | 已接入的结果 | 不能据此声称 |
|---|---|---|
| 主动续聊 | 当前话题延后计划、原子领取、安静时段/每日轮数、取消/来源变更/重启记录 | 电脑离线也准点提醒；真实主动表达自然；精确金额上限 |
| 记忆回顾 | 完整有效事实按日/周/月组织、可追踪来源、来源更改后失效 | 语义压缩、模型反思或已修好之前的召回/日期问题 |
| 语音 | 独立译播、受支持SSML表达校验、短句收尾、实际播放回声转草稿 | 所有Provider支持导演/译播；真实音质或麦克风误识别已验收 |
| 互动 | Live2D区域/动作组权重、动作间隔、避免重复、保留SDK排除规则 | 正式角色动作自然、物理/表情完整通过 |
| 本地规则 | 组合条件/优先级/有限类型图，真实事件选择续聊/回顾/安静 | 通用图编辑器、任意代码、外部IM服务 |
| VRM导入 | 文件大小/容器/外部引用检查、能力报告、原loader预览/写读、失败保留重试 | Kit生成、角色资产授权、仅靠字段就证明视觉质量 |

新增自动行为默认关；用户保存后才生效。已安装 `Aimy体验版.app` 仍是10月16日快照，本轮没有替换或读取私人profile。零真实模型调用，无新增费用；原8例活动账本未更改。

## 工程证据

去重后共 **111项自动化测试通过**：64逻辑 + 27状态/运行 + 12语音 + 1设置UI + 2资产浏览器 + 5原orchestrator独立回归；重复运行及先红后绿不累计。

| 检查 | 结果/证据 |
|---|---|
| 纯逻辑与真实模块边界 | 64/64；`evidence/root/node-final-report.json`。覆盖工作流、VRM、运动策略、语音转换、VAD、回声、受控生成/呈现 |
| IndexedDB/Pinia/实际聊天hook | 27/27；`evidence/root/browser-final-report.json`。真实浏览器，默认关、多窗口设置、恢复/冲突/保存失败、分页/切scope、取消、初始化重试/并发/在途退出 |
| 原角色orchestrator回归 | 9/9，其中4项已包含在64中；`evidence/root/orchestrator-regression-final.log`，新增独立计数5 |
| 真实设置组件 | 1/1；`evidence/root/ui-browser-qa-2.log`。真实i18n、控件、保存/坏规则；5个卡片截图已逐张查看，无截断遮挡；未加载正式角色的空态明确 |
| 语音实际consumer/草稿/验收预算回归 | 12/12；最终JSON见 `evidence/root/voice-final-report.json`；使用合成Provider/LLM/音频边界，未真实发请求 |
| VRM实际loader/选择器 | 2/2；`evidence/assets/storage-green.log`。真实Chromium/WebGL/IndexedDB：上传→报告→取消→保存失败→重试→原缩略图保存，以及aa/happy形变权重 |
| TypeScript | stage-tamagotchi、stage-ui、stage-ui-live2d、stage-pages完整vue-tsc分别exit 0 |
| 定向lint | 无错误；保留控制字符校验及既有注释warning，见日志，不称零warning |
| 普通桌面构建 | exit 0；`evidence/root/desktop-build-final.log`。main/preload/renderer均构建，i18n本地构建通过；不是安装包发布 |
| 全仓typecheck | 未通过：未安装的model-driver-mediapipe工作区依赖缺失（tasks-vision、three等）；未改tsconfig或安装掩盖 |
| 全仓lint | 未完成：继承docs/uno.config.ts缺 `@radix-ui/colors` 导致配置加载退出。实际改动范围单独lint |
| Diff空白检查 | `git diff --check -- aimy-app` exit 0；未暂存、提交、推送 |

本轮真实浏览器验证使用独立命名空间/合成资料；不读取现有私人聊天。测试故意注入失败可能产生预期的错误日志，不等于在报告中忽略失败。UI空白长图是测试iframe截图裁切，已改逐卡片滚动截图并补入与正式入口一致的CSS reset，未通过修改产品布局掩盖问题。

## 独立复核中修复的问题

1. 自定义Microsoft/Azure实例：SSML资格和导演识别统一definitionId；先失败再通过。双向WS实例同样改用definitionId，防止误走普通合成。
2. Live2D随机动作：保留SDK对加载失败、当前活动/预约动作的排除；无可用动作不推进间隔，暂停/销毁不播放。
3. VRM保存：原addDisplayModel提前发布且吞失败；改为存储成功才发布，失败留报告并可重试。超大Blob在arrayBuffer前拒绝，测试零读取。
4. 设置失败和初始化：加载失败可重试；并发初始化等待同一过程。Pinia立即通知造成重复acquire已被真实store测试复现并修复；在途退出不再晚到安装hook/timer。
5. 续聊/回顾集成：纠正错误speaking字段；自己的朗读不误撤销自身；全revision分页避免第51条之后来源误失效；切scope/修改来源拒旧结果；可选存储故障不阻断原聊天。

上述先红后绿日志按原字节保留在evidence。最终日志独立于失败历史，不覆盖旧证据。

## 复跑

从 `aimy-app/` 调用已安装工具，避免pnpm运行前自动安装。保存的config包含本机绝对依赖路径，是本机精确复跑入口；换机器需按锁文件安装依赖并解析本机路径，不能当作可移植CI配置。

```sh
./node_modules/.bin/vitest run --config ../docs/04-验证记录/2026-10-18-候选能力接入/evidence/root/vitest-node.config.mts
./node_modules/.bin/vitest run --config ../docs/04-验证记录/2026-10-18-候选能力接入/evidence/root/vitest-browser.config.mts
./node_modules/.bin/vitest run --config ../docs/04-验证记录/2026-10-18-候选能力接入/evidence/root/vitest-ui.config.mts
./node_modules/.bin/vitest run --config ../docs/04-验证记录/2026-10-18-候选能力接入/evidence/root/vitest-voice.config.mts
./node_modules/.bin/vitest run --config ../docs/04-验证记录/2026-10-18-候选能力接入/evidence/assets/browser.config.mts
./node_modules/.bin/vitest run --config ../docs/04-验证记录/2026-10-18-候选能力接入/evidence/proactive/vitest-regression.config.mts
./node_modules/.bin/tsx scripts/inspect-vrm.ts '../docs/02-调研参考/2026-10-14-其余项目对照证据/charakuru/authored-capabilities.vrm'
git diff --check -- .
```

类型检查在每个改动包目录分别执行 `./node_modules/.bin/vue-tsc --noEmit`。普通桌面构建在 `apps/stage-tamagotchi/` 调用已安装electron-vite的 `build({envDir:false})`，精确入口保存为 `evidence/root/product-build.mjs`。完整命令和退出码另见check-manifest.json；本轮没安装/升级依赖。

## 尚待真实验证

主动续聊是否合时宜、译播准确度/延时、导演实际听感、真实麦克风回声与打断、正式模型点击动作/物理、完整陪伴人验均未通过本轮fixture自动获得结论。VRM loader实测的是自制合成资产的口型和表情权重，没有假称完整90帧物理与视觉质量。前批记忆真实失败仍需单独修复/复测。

## 原生启动补记

最终普通构建在全新 `/tmp/aimy-round2-native-profile` 启动，原stage挂载并创建1个canvas，`/settings/companion`路由注册且实际lazy chunk加载。7项新增增强开关均为false，revision=0，计划/回顾为空、运行error为空。调用正常 `app.quit` 后约2.18秒退出，有will-quit回执，没有强杀或残留自建进程。见 [result.json](evidence/native/result.json)。

测试外网始终由OS sandbox拒绝，Unix/loopback供Electron运行；Chromium与main fetch另有限制。外网socket probe被拒绝，上游云请求被拦截，无模型调用。第一次启动因Unix IPC/内层sandbox冲突失败，日志保留；第二次仅对测试进程关闭Chromium内层sandbox，外层OS隔离保持。没有改产品sandbox策略或安装App。

CUA应用清单无法定位这个sandbox测试Electron，**原生点按未执行**，不能据此断言锁屏。stage/canvas存在不代表正式角色视觉质量通过；新设置组件交互在独立真实浏览器中验证，原生此次仅验证注册/加载和默认状态。
