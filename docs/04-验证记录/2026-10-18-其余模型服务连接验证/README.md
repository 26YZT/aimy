# 其余模型服务连接验证

日期：2026-10-18（Asia/Shanghai）。状态：逐项验证完成，普通模式已恢复。
来源：用户要求核验剩余服务，并将范围限定为聊天、视觉和语音。
用途：区分已配置、凭据存在、接口连通和实际任务结果。
风险：一次短样本不代表长期稳定性、完整听感或识别准确率已通过。
替代关系：复用本会话最近的 DeepSeek 真实读屏与聊天证据，补充此前未执行的语音真实检查。

## 结果

| 服务 | 当前是否使用 | 本轮证据与结论 |
| --- | --- | --- |
| DeepSeek 聊天 / deepseek-flash | 是 | 加密凭据可取得，当前选择保持。沿用[刚才真实聊天成功证据](../2026-10-18-视觉鉴权与真实聊天/README.md)，本轮未重复生成 |
| DeepSeek 视觉 / deepseek-flash | 是 | 加密凭据可取得，模型选择保持。沿用同一记录的随机校验码读图与聊天结果，本轮未重复发送截图 |
| MiMo 合成 / mimo-v2.5-tts，冰糖 | 是 | 一次真实请求 HTTP 200，输出 122,924 字节 WAV，原始 24 kHz、单声道、16 bit，时长 2.56 秒。可解码且非静音 |
| Apple Speech / zh-CN | 是，当前识别服务 | 原生接口可用，合成 PCM16 输入得到 12 个事件和最终文本。链路连通，本次转写有错字 |
| MiMo 识别 / mimo-v2-omni | 否，已配置备用项 | 一次真实请求 HTTP 400：`Unsupported model mimo-v2-omni`。鉴权模型目录请求成功，当前模型配置已不被服务支持 |
| VOICEVOX | 否 | 配置 `http://localhost:50021/`，`/version` 连接失败，端口无监听。当前配置地址没有可用服务 |
| AivisSpeech | 否 | 配置 `http://localhost:10101/`，`/version` 连接失败，端口无监听。当前配置地址没有可用服务 |

本轮没有修改模型、音色、密钥、角色卡或服务地址。检查结束的选择与检查开始完全相同。
VOICEVOX 和 AivisSpeech 是本地引擎，配置 schema 不包含 API Key。本轮按本地 HTTP 可达性判断。
原始 `inventory.json` 的 requiresCredentials 字段对缺省声明采用 true，仅为诊断默认推断，不能用它断言这两项需要密钥。

## 语音样本

输入短句：`这是Aimy语音连接测试。`
MiMo 合成音频能够解码，RMS 约 0.108，非静音样本比例约 86.5%。没有在机器上播放音频。
[合成测试 WAV](mimo-tts-test.wav) 仅含该合成短句，不含私人录音。
因此通过的是合成接口与音频有效性，不宣称声线自然度、口型或实际播放链已完成人验。

Apple 输入使用该 WAV 解码后的 16 kHz PCM16 流，没有采集真实麦克风。
最终返回：`这是艾米与英灵接测试`。
品牌转成“艾米”可以理解，但“语音连接”转成“与英灵接”存在错字。
这是一次 2.56 秒样本的具体偏差，不能据此计算整体字错率或把语音识别判成完全不可用。

## MiMo 识别问题

原适配器用 `mimo-v2-omni` 请求 `/v1/chat/completions`，服务直接拒绝该模型名。
同一识别配置的 Key 请求 `/v1/models` 返回 HTTP 200，说明其服务地址和目录鉴权可用。
返回名单包含：`mimo-v2.5`、`mimo-v2.5-asr`、`mimo-v2.5-pro`、三个 v2.5 TTS 型号和三个 v2.6 型号，见 `mimo-model-catalog.json`。
该文件是工具中真实响应的归一化记录，不是另一次调用。
本轮没有切换型号或再次推理，不能声称新 ASR 型号已通过。
后续修复需要同时核对新型号支持的接口和请求体，再做最小复测。

## 请求和安全边界

- 新增云端任务请求共 2 次：MiMo 合成成功、MiMo 识别失败，各最多一次。
- 另有一次 MiMo 模型目录 GET 请求，HTTP 200。
- Apple 为一次原生分析，不使用 API Key。VOICEVOX/Aivis 为各一次本地版本请求，未调用合成。
- 未读取账单，无法给出本次准确实扣金额。没有借用此前记忆模型验收预算。
- 工具只接收凭据存在性、状态和受限错误，不显示实际密钥。
- 未采集真实麦克风或屏幕。开始和结束的应用内 microphone/screen 开关均关闭。
- 没有新增、迁移、清空资料，没有改产品源码或安装包。安装包 SHA256 与开始一致。

## 机器检查

真实调用使用原 `useProviderStore` 工厂、`speechStore.speech` 和 `hearingStore.transcription`。
Apple 输入使用原 PCM16 流适配器，没有替换识别器或构造第二套音频运行时。
本地 HTTP 检查使用 `curl --max-time 3` 访问原配置地址的 `/version`，退出码均为 7，`lsof` 无监听结果。
本轮没有产品源码改动，未重复构建或类型检查。
按仓库规则执行 `pnpm lint`，退出 2，既有 UnoCSS 配置缺 `@radix-ui/colors`。日志保留，不把该检查当作服务连通测试结果。

证据：`inventory.json`、`tts-result.json`、`mimo-asr-result.json`、`apple-asr-result.json`、`audio-file-proof.json`、`mimo-model-catalog.json`、`final-results.json` 和 `summary.json`。

本地诊断端口已关闭，普通模式主窗口已恢复。没有持续录音或屏幕采集，没有留下新的服务选择。
