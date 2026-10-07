# Third-party sources

This repository includes the dependencies and assets consumed by Aimy. It does not include the complete AIRI reference checkout or unrelated development templates.

## AIRI code

The reused packages and locally adapted audio/session sources come from AIRI. Their original MIT copyright notice and license are retained in [airi-upstream-LICENSE](digital-lover/packages/airi-upstream-LICENSE). Source comparisons and product adaptations are recorded in [AIRI复用修订记录](digital-lover/docs/AIRI复用修订记录.md) and the corresponding source manifests.

The `@proj-airi/*` package names remain for source compatibility. These packages are required by the Aimy build and are distinct from the complete `airi-main/` reference repository, which is excluded.

## Prototype character

VRoid Sample A is authored by VRoid Project and is included as a labelled prototype asset. The original embedded conditions and source are retained in [asset-record.json](digital-lover/assets/prototype/asset-record.json), including the original VRoid Hub conditions URL. It is not Aimy's final official character or a final product asset approval.

## Local voice activity detection

Silero VAD ONNX weights and the matching ONNX Runtime use the source/license records in [assets/vad](digital-lover/assets/vad/). The original [Silero license](digital-lover/assets/vad/LICENSE.silero) and [ONNX Runtime license](digital-lover/assets/vad/LICENSE.onnxruntime) are retained. This model detects speech activity; it does not provide Chinese speech recognition.

Other package dependencies are declared in their manifests and pinned in `digital-lover/pnpm-lock.yaml`; their original licenses apply to those dependencies.
