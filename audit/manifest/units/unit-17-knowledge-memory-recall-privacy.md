### 2.17 Work Unit 17 — Knowledge, memory, recall, privacy

#### Files & LOC

- `src/vex-agent/knowledge/**`
  - area total from slice: 4 files, 399 LOC
- `src/vex-agent/memory/**`
  - area total from slice: 4 files, 478 LOC
- `src/vex-agent/db/repos/knowledge.ts` 24 LOC
- `src/vex-agent/db/repos/knowledge/**`
- `src/vex-agent/db/repos/session-memories/crud.ts` 465 LOC — **god-file/refactor candidate**
- `src/vex-agent/db/repos/search.ts` 75 LOC
- `src/vex-agent/db/repos/recall-cache.ts` 156 LOC
- `src/vex-agent/db/repos/tool-output-blobs.ts` 172 LOC
- `src/vex-agent/db/migrations/010_tool_embeddings.sql`
- `src/vex-agent/db/migrations/016_session_memories.sql` 140 LOC

Tests:

- `src/__tests__/integration/memory/long-mission.test.ts` 1,003 LOC — **test god-file**
- Memory/knowledge tests under `src/__tests__/vex-agent/{memory,knowledge}/**`.

#### Responsibility

- Store and recall knowledge/memory.
- Manage session memories and embeddings.
- Export knowledge without raw embeddings.
- Cache search/fetch/recall/tool-output data.
- Support memory policy and live-state exclusions.

#### Mechanisms/patterns

- pgvector with stored model/dim.
- Runtime checks for embedding length.
- Recall filters by `embedding_model` and `embedding_dim`.
- Typmod-free vectors allow model migration.
- Knowledge export avoids raw embeddings.
- TTL/lazy cleanup for caches.
- Redaction helpers reused for memory policies.

#### Dependencies & data-flow

Entry points:

- Engine memory/knowledge tools.
- Renderer knowledge/memory panels.
- Embedding client for vectors.
- DB repos for memory/search/blob cache.

Imports/dependencies:

- DB client/repos.
- Embedding client/config.
- Memory redaction/policy modules.
- Renderer APIs for display/status.

Side effects:

- Writes local sensitive text and vectors.
- Stores cached web/search/tool outputs.
- Exports knowledge data.
- Recall queries over pgvector.

#### Security surface

- Memory text, embeddings, tool outputs, and search results are user-sensitive.
- Embedding endpoint can exfiltrate content if remote.
- Soft delete does not guarantee immediate cache/blob erasure.
- Support/logging must not include raw memory or embeddings.

#### Hotspots

- `session-memories/crud.ts` 465 LOC.
- `knowledge.ts` facade basename conflicts with `knowledge/` directory.
- Search/recall/tool-output caches can outlive user expectations.
- Full deletion/export/reset semantics are not established.

`console.*` density:

- Embeddings client logs input length, not text. Audit knowledge/memory paths for direct console under global count.

#### Tests

Covered:

- Memory/knowledge unit tests.
- Long mission integration.
- Embeddings dimension tests.
- DB repo tests.
- Knowledge export/lineage signals.

Not covered / unclear:

- GDPR-style erasure across caches/captures/blob/vault/backups.
- Remote embedding provider opt-in policy.
- Support bundle exclusion for memory text.
- Recall cache cleanup timing.

#### Open risks/smells

- Define user-data deletion semantics.
- Audit embedding endpoint locality.
- Split large session memory CRUD.
- Resolve naming ambiguity around `knowledge.ts` and `knowledge/`.

