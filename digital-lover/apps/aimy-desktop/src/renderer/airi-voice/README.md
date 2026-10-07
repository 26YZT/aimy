# AIRI voice reuse

These VAD, AudioWorklet, graph lifecycle and transcription-chain sources and original tests are copied from `airi-main/packages/stage-ui/src`, under AIRI's MIT license. No hearing/provider/account/analytics store is imported.

Aimy's VAD patch keeps Silero inference but loads only packaged local assets. It adds a 250 ms sustained high-confidence `speech-confirmed` event, an explicit model lifecycle epoch, disposal and a bounded inference queue. The original constructor default of 256 chunks preserves the retained concurrency regression; the actual product instance uses eight chunks (256 ms of input at 16 kHz). Raw queued PCM is cleared after processing; overflow is surfaced and the product stops capture.

Required assets: `assets/vad/onnx-community/silero-vad/onnx/model.onnx` and the matching Transformers 3.8.1 ONNX/WASM runtime under `assets/vad/runtime/`. The app requires local worklet/module/WASM loading in its CSP. Remote model loading and browser model cache are disabled. Original tests are retained; acoustic quality and device behavior require separate real-device verification.

Run the retained source and Aimy lifecycle tests from the desktop app with `node_modules/.bin/vitest run --config src/renderer/airi-voice/vitest.config.ts`. They use mock inference/device interfaces and do not authorize real capture or imply acoustic acceptance.
