# Aimy third-party notices

Aimy continues the inherited Project AIRI application and its existing notices and licenses.

The memory policy in `packages/stage-ui/src/stores/memory/policy.ts` adapts bounded rules from:

- AionsHome: `aion-chat/post_sentinel.py` and `aion-chat/user_profile_policy.py`, MIT. See [original notice](licenses/AionsHome-MIT.txt).
- Ryza: `web/js/longterm.js`, MIT. See [original notice](licenses/Ryza-MIT.txt).

The source fingerprints and the changes made are recorded in the policy module. These adaptations do not import either project's independent backend, database, UI, models, characters, or assets. All other inherited dependency notices remain applicable.

## Optional companion features (2026-10-18)

Bounded adaptations keep AIRI as the application runtime:

- AionsHome: proactive_companionship.py, memory_compression.py, expressive_voice.py and static/voice-call-policy.js. MIT notice remains in licenses/AionsHome-MIT.txt.
- Ryza: memory.js, echo.js and avatar.js. MIT notice remains in licenses/Ryza-MIT.txt. Its echo source attributes earlier rules to Project-N.E.K.O under Apache-2.0. The adaptation retains this attribution and does not claim Ryza originated those rules. See licenses/Apache-2.0.txt for the license text.
- Open-LLM-VTuber backend: conversations/conversation_utils.py, MIT. See licenses/Open-LLM-VTuber-backend-MIT.txt. This does not include the separately licensed frontend, SDK, or character samples.

Local workflow and VRM inspection use independent AIRI-compatible contracts informed by the Kirara and Charakuru studies. No Kirara Python/YAML or Charakuru Kit, Skills, donor or sample assets are included. The source studies are not a general legal clearance for those projects or for future asset distribution.
