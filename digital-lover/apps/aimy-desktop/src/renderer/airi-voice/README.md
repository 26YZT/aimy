# AIRI voice reuse

> 文档状态：旧独立样机／开发验证工具的就近说明，不是新Aimy产品入口。
> 产物时期：初稿日期未记录；2026-10-11盘点时已存在。精确初稿时间未记录时保持未知。
> 保留原因：保留包使用、版权来源或旧样机技术边界，供定向复核。
> 上下文风险：只说明所在包或旧样机，不代表新Aimy产品已集成、批准或验收。
> 原位置：`digital-lover/apps/aimy-desktop/src/renderer/airi-voice/README.md`；归类整理：2026-10-11。
> 阅读入口：[文档中心](../../../../../../docs/README.md)。历史正文中的“当前、唯一、已锁定、下一步”仅适用于原时期。

These VAD, AudioWorklet, graph lifecycle and transcription-chain sources and original tests are copied from `airi-main/packages/stage-ui/src`, under AIRI's MIT license. No hearing/provider/account/analytics store is imported.

Aimy's VAD patch keeps Silero inference but loads only packaged local assets. It adds a 250 ms sustained high-confidence `speech-confirmed` event, an explicit model lifecycle epoch, disposal and a bounded inference queue. The original constructor default of 256 chunks preserves the retained concurrency regression; the actual product instance uses eight chunks (256 ms of input at 16 kHz). Raw queued PCM is cleared after processing; overflow is surfaced and the product stops capture.

Required assets: `assets/vad/onnx-community/silero-vad/onnx/model.onnx` and the matching Transformers 3.8.1 ONNX/WASM runtime under `assets/vad/runtime/`. The app requires local worklet/module/WASM loading in its CSP. Remote model loading and browser model cache are disabled. Original tests are retained; acoustic quality and device behavior require separate real-device verification.

Run the retained source and Aimy lifecycle tests from the desktop app with `node_modules/.bin/vitest run --config src/renderer/airi-voice/vitest.config.ts`. They use mock inference/device interfaces and do not authorize real capture or imply acoustic acceptance.
