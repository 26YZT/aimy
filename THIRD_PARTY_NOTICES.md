# Third-party sources

The current Aimy product is in `aimy-app/`. It inherits the Project AIRI v0.12.0-beta.5 application and monorepo. The original MIT license remains in [aimy-app/LICENSE](aimy-app/LICENSE). Bounded adaptations and their notices are listed in [aimy-app/THIRD_PARTY_NOTICES.md](aimy-app/THIRD_PARTY_NOTICES.md).

Inherited dependencies, fonts, character assets, model weights and SDKs retain their own licenses. The AIRI code license does not grant blanket redistribution rights for these resources.

Separate local reference checkouts and unrelated development templates are excluded from publication. Original third-party design reference screenshots and local build inventories also remain local. Publication details are recorded in [the sync check](docs/91-管理记录/2026-10-21-GitHub仓库同步检查.md).

## Historical prototype

The following records apply to the frozen `digital-lover/` prototype. It is not the current product entry point.

## AIRI code

The reused packages and locally adapted audio/session sources come from AIRI. Their original MIT copyright notice and license are retained in [airi-upstream-LICENSE](digital-lover/packages/airi-upstream-LICENSE). Source comparisons and product adaptations are recorded in [AIRI复用修订记录](docs/90-历史归档/旧Aimy样机/运行与来源/AIRI复用修订记录.md) and the corresponding source manifests.

The `@proj-airi/*` package names remain for source compatibility. These packages are required by the Aimy build and are distinct from the complete `airi-main/` reference repository, which is excluded.

## Prototype character

VRoid Sample A is authored by VRoid Project and is included as a labelled prototype asset. The original embedded conditions and source are retained in [asset-record.json](digital-lover/assets/prototype/asset-record.json), including the original VRoid Hub conditions URL. It is not Aimy's final official character or a final product asset approval.

## Local voice activity detection

Silero VAD ONNX weights and the matching ONNX Runtime use the source/license records in [assets/vad](digital-lover/assets/vad). The original [Silero license](digital-lover/assets/vad/LICENSE.silero) and [ONNX Runtime license](digital-lover/assets/vad/LICENSE.onnxruntime) are retained. This model detects speech activity; it does not provide Chinese speech recognition.

Other package dependencies are declared in their manifests and pinned in `digital-lover/pnpm-lock.yaml`; their original licenses apply to those dependencies.
