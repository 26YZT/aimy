
### mem0ai/mem0

- mem0-1: [mem0-ts/package.json:18-28](https://github.com/mem0ai/mem0/blob/b7ad69afda6b6ed030347c66d48a13e4de9dec08/mem0-ts/package.json#L18-L28) — TS hosted default export and OSS subpath are separate
- mem0-2: [mem0-ts/src/oss/src/config/defaults.ts:3-34](https://github.com/mem0ai/mem0/blob/b7ad69afda6b6ed030347c66d48a13e4de9dec08/mem0-ts/src/oss/src/config/defaults.ts#L3-L34) — OpenAI extraction and embedding defaults; local SQLite storage
- mem0-3: [mem0-ts/src/oss/src/vector_stores/memory.ts:40-66](https://github.com/mem0ai/mem0/blob/b7ad69afda6b6ed030347c66d48a13e4de9dec08/mem0-ts/src/oss/src/vector_stores/memory.ts#L40-L66) — memory vector provider uses better-sqlite3 persisted file
- mem0-4: [mem0-ts/src/oss/src/memory/index.ts:846-864](https://github.com/mem0ai/mem0/blob/b7ad69afda6b6ed030347c66d48a13e4de9dec08/mem0-ts/src/oss/src/memory/index.ts#L846-L864) — infer=false stores messages without inference
- mem0-5: [mem0-ts/src/oss/src/memory/index.ts:890-935](https://github.com/mem0ai/mem0/blob/b7ad69afda6b6ed030347c66d48a13e4de9dec08/mem0-ts/src/oss/src/memory/index.ts#L890-L935) — infer=true recall then one model extraction call
- mem0-6: [mem0-ts/src/oss/src/memory/index.ts:1953-2013](https://github.com/mem0ai/mem0/blob/b7ad69afda6b6ed030347c66d48a13e4de9dec08/mem0-ts/src/oss/src/memory/index.ts#L1953-L2013) — update changes vector payload and keeps prior history
- mem0-7: [mem0-ts/src/oss/src/memory/index.ts:2018-2045](https://github.com/mem0ai/mem0/blob/b7ad69afda6b6ed030347c66d48a13e4de9dec08/mem0-ts/src/oss/src/memory/index.ts#L2018-L2045) — delete removes vector but logs previous text; entity cleanup best effort
- mem0-8: [mem0-ts/src/oss/src/storage/SQLiteManager.ts:17-67](https://github.com/mem0ai/mem0/blob/b7ad69afda6b6ed030347c66d48a13e4de9dec08/mem0-ts/src/oss/src/storage/SQLiteManager.ts#L17-L67) — history stores previous/new text; messages retain raw text
- mem0-9: [mem0-ts/src/oss/src/utils/telemetry.ts:13-25](https://github.com/mem0ai/mem0/blob/b7ad69afda6b6ed030347c66d48a13e4de9dec08/mem0-ts/src/oss/src/utils/telemetry.ts#L13-L25) — telemetry enabled unless MEM0_TELEMETRY=false

### MemTensor/MemOS

- MemOS-1: [apps/memos-local-plugin/package.json:87-109](https://github.com/MemTensor/MemOS/blob/a7367d07e55db61099f7b4e2c1108bc5831a24f3/apps/memos-local-plugin/package.json#L87-L109) — MIT package field; Node>=20; native SQLite and Transformers
- MemOS-2: [apps/memos-local-plugin/core/storage/keyword.ts:76-113](https://github.com/MemTensor/MemOS/blob/a7367d07e55db61099f7b4e2c1108bc5831a24f3/apps/memos-local-plugin/core/storage/keyword.ts#L76-L113) — FTS query sanitation with CJK splitting
- MemOS-3: [apps/memos-local-plugin/core/storage/keyword.ts:148-194](https://github.com/MemTensor/MemOS/blob/a7367d07e55db61099f7b4e2c1108bc5831a24f3/apps/memos-local-plugin/core/storage/keyword.ts#L148-L194) — Chinese bigrams and reciprocal rank helper
- MemOS-4: [apps/memos-local-plugin/core/retrieval/ranker.ts:42-59](https://github.com/MemTensor/MemOS/blob/a7367d07e55db61099f7b4e2c1108bc5831a24f3/apps/memos-local-plugin/core/retrieval/ranker.ts#L42-L59) — ranker coupled to reward and plugin types
- MemOS-5: [apps/memos-local-plugin/core/storage/repos/traces.ts:746-789](https://github.com/MemTensor/MemOS/blob/a7367d07e55db61099f7b4e2c1108bc5831a24f3/apps/memos-local-plugin/core/storage/repos/traces.ts#L746-L789) — delete trace and FTS; body patch does not update vectors
- MemOS-6: [apps/memos-local-plugin/core/storage/repos/policies.ts:30-44](https://github.com/MemTensor/MemOS/blob/a7367d07e55db61099f7b4e2c1108bc5831a24f3/apps/memos-local-plugin/core/storage/repos/policies.ts#L30-L44) — policies carry episode feedback and trace source IDs
- MemOS-7: [apps/memos-local-plugin/core/config/defaults.ts:340-356](https://github.com/MemTensor/MemOS/blob/a7367d07e55db61099f7b4e2c1108bc5831a24f3/apps/memos-local-plugin/core/config/defaults.ts#L340-L356) — telemetry and unredacted prompt/completion logs default enabled
- MemOS-8: [apps/memos-local-plugin/core/embedding/providers/local.ts:28-58](https://github.com/MemTensor/MemOS/blob/a7367d07e55db61099f7b4e2c1108bc5831a24f3/apps/memos-local-plugin/core/embedding/providers/local.ts#L28-L58) — cancel stops wait not shared Transformer loading

### kitfunso/hippo-memory

- hippo-memory-1: [package.json:8-15](https://github.com/kitfunso/hippo-memory/blob/beea545715e6f62936f3204cd4a48fc7ef61a722/package.json#L8-L15) — store-kit exported subpath
- hippo-memory-2: [package.json:88-113](https://github.com/kitfunso/hippo-memory/blob/beea545715e6f62936f3204cd4a48fc7ef61a722/package.json#L88-L113) — MIT Node>=22.16 and optional Transformers
- hippo-memory-3: [src/search/rrf.ts:5-54](https://github.com/kitfunso/hippo-memory/blob/beea545715e6f62936f3204cd4a48fc7ef61a722/src/search/rrf.ts#L5-L54) — generic weighted RRF no runtime imports
- hippo-memory-4: [src/db/sqlite.ts:20-27](https://github.com/kitfunso/hippo-memory/blob/beea545715e6f62936f3204cd4a48fc7ef61a722/src/db/sqlite.ts#L20-L27) — node:sqlite DatabaseSync runtime
- hippo-memory-5: [src/core/memory.ts:33-81](https://github.com/kitfunso/hippo-memory/blob/beea545715e6f62936f3204cd4a48fc7ef61a722/src/core/memory.ts#L33-L81) — source parents session supersession and dirty summary fields
- hippo-memory-6: [src/api/promote.ts:43-74](https://github.com/kitfunso/hippo-memory/blob/beea545715e6f62936f3204cd4a48fc7ef61a722/src/api/promote.ts#L43-L74) — supersede writes old and successor atomically through store
- hippo-memory-7: [src/store/rejected-values.ts:122-164](https://github.com/kitfunso/hippo-memory/blob/beea545715e6f62936f3204cd4a48fc7ef61a722/src/store/rejected-values.ts#L122-L164) — reject deletes live/dormant matches then purges mirrors post commit
- hippo-memory-8: [src/store/raw-archive.ts:35-60](https://github.com/kitfunso/hippo-memory/blob/beea545715e6f62936f3204cd4a48fc7ef61a722/src/store/raw-archive.ts#L35-L60) — raw archive stores metadata without content and removes source row
- hippo-memory-9: [src/store/mirrors.ts:212-230](https://github.com/kitfunso/hippo-memory/blob/beea545715e6f62936f3204cd4a48fc7ef61a722/src/store/mirrors.ts#L212-L230) — mirror purge is best effort and can leave files
- hippo-memory-10: [src/trust/reject-flow.ts:50-57](https://github.com/kitfunso/hippo-memory/blob/beea545715e6f62936f3204cd4a48fc7ef61a722/src/trust/reject-flow.ts#L50-L57) — personal rows cannot be rejected by ID; use forget
- hippo-memory-11: [src/embeddings/local.ts:37-53](https://github.com/kitfunso/hippo-memory/blob/beea545715e6f62936f3204cd4a48fc7ef61a722/src/embeddings/local.ts#L37-L53) — default MiniLM and pooling/prefix helpers

### memvid/memvid

- memvid-1: [Cargo.toml:1-13](https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/Cargo.toml#L1-L13) — Apache Rust>=1.85 core
- memvid-2: [Cargo.toml:99-131](https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/Cargo.toml#L99-L131) — optional vector image audio API embedding features
- memvid-3: [src/memvid/mutation.rs:3244-3300](https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/src/memvid/mutation.rs#L3244-L3300) — delete is WAL tombstone not immediate payload erasure
- memvid-4: [src/memvid/mutation.rs:3013-3045](https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/src/memvid/mutation.rs#L3013-L3045) — vacuum keeps active payloads and clears inactive offsets
- memvid-5: [src/types/memory_card.rs:176-219](https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/src/types/memory_card.rs#L176-L219) — memory card contains source frame and URI
- memvid-6: [src/types/memories_track.rs:363-394](https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/src/types/memories_track.rs#L363-L394) — current/time getters skip retraction card and may reveal old value
- memvid-7: [src/memvid/memory.rs:333-338](https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/src/memvid/memory.rs#L333-L338) — clear all cards is a separate API
- memvid-8: [src/text_embed.rs:170-225](https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/src/text_embed.rs#L170-L225) — default text registry English bge-small-en-v1.5
- memvid-9: [src/text_embed.rs:249-260](https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/src/text_embed.rs#L249-L260) — local embedding default offline

### CaviraOSS/LongMemory

- LongMemory-1: [package.json:23-29](https://github.com/CaviraOSS/LongMemory/blob/9ee2c8e1ed42d83eb788afb9ffc3a82b84405da5/package.json#L23-L29) — Node TypeScript library entry
- LongMemory-2: [package.json:82-90](https://github.com/CaviraOSS/LongMemory/blob/9ee2c8e1ed42d83eb788afb9ffc3a82b84405da5/package.json#L82-L90) — native SQLite and ingestion/MCP dependency set
- LongMemory-3: [src/core/engine/ingest_engine.ts:112-157](https://github.com/CaviraOSS/LongMemory/blob/9ee2c8e1ed42d83eb788afb9ffc3a82b84405da5/src/core/engine/ingest_engine.ts#L112-L157) — entity world graph working memory coupled ingest

### getzep/graphiti

- graphiti-1: [pyproject.toml:12-41](https://github.com/getzep/graphiti/blob/0a3b1711b018e5590cf5c44a3ee3e67d6733ee13/pyproject.toml#L12-L41) — Python with default Neo4j and optional embedded Kuzu/FalkorDBLite
- graphiti-2: [graphiti_core/graphiti.py:1332-1346](https://github.com/getzep/graphiti/blob/0a3b1711b018e5590cf5c44a3ee3e67d6733ee13/graphiti_core/graphiti.py#L1332-L1346) — episode source and reference time API
- graphiti-3: [graphiti_core/graphiti.py:2164-2192](https://github.com/getzep/graphiti/blob/0a3b1711b018e5590cf5c44a3ee3e67d6733ee13/graphiti_core/graphiti.py#L2164-L2192) — episode graph deletion flow

### memodb-io/memobase

- memobase-1: [src/server/api/pyproject.toml:1-20](https://github.com/memodb-io/memobase/blob/358c16bbc6d687937d79bc2f984a11c3be8da901/src/server/api/pyproject.toml#L1-L20) — FastAPI pgvector Redis dependencies
- memobase-2: [src/server/docker-compose.yml:1-30](https://github.com/memodb-io/memobase/blob/358c16bbc6d687937d79bc2f984a11c3be8da901/src/server/docker-compose.yml#L1-L30) — Postgres Redis stack

### topoteretes/cognee

- cognee-1: [pyproject.toml:60-108](https://github.com/topoteretes/cognee/blob/0ec7a9fa61c9ff04bf7e02e0d57af363a993a5e1/pyproject.toml#L60-L108) — Lance/Ladybug runtime and macOS version constraints
- cognee-2: [cognee/api/v1/cognify/cognify.py:43-57](https://github.com/topoteretes/cognee/blob/0ec7a9fa61c9ff04bf7e02e0d57af363a993a5e1/cognee/api/v1/cognify/cognify.py#L43-L57) — temporal graph extraction and source tracking tasks
- cognee-3: [cognee/api/v1/add/add.py:220-223](https://github.com/topoteretes/cognee/blob/0ec7a9fa61c9ff04bf7e02e0d57af363a993a5e1/cognee/api/v1/add/add.py#L220-L223) — default local LanceDB and Ladybug
