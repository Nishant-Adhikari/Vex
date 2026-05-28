---
id: audit.current.quality-findings
kind: audit
paths: ["src/**", "vex-app/**"]
source_commit: cf05003
indexed_at: 2026-05-28
stale_when_paths_change: ["src/**", "vex-app/**", "VEX-INDEX/modules/**/*.md"]
related: [index.structure, module.vex-agent.tools-internal, module.vex-app.preload-shared-contracts]
---

# Current Quality Findings

| ID | Finding | Status | Notes |
|---|---|---|---|
| FINDING-quality-001 | `Structure.md` stale after F1/F2/F3 fixes | fixed-in-index | Refreshed 2026-05-28. |
| FINDING-quality-002 | Migration count drift: docs said 27 migrations | fixed-in-index | Current truth: schema version 027 / 24 SQL files. |
| FINDING-quality-003 | Embedding endpoint drift: docs said Docker Model Runner `:12434` | fixed-in-index | Current bundled compose: llama.cpp on `127.0.0.1:55134/v1`; legacy probes remain. |
| FINDING-quality-004 | `modules/vex-app` absent while README/MANIFEST reserved it | partially-fixed | Seed module docs added; deep Round 3 still needed. |
| FINDING-quality-005 | `src/lib/env.ts` omitted from root env-config index | fixed-in-index | Added to module + manifest freshness triggers. |
| FINDING-quality-006 | `lib-vault-secrets` contradicted lock behavior | fixed-in-index | Lock clears master password, not vault-injected `process.env` keys. |
| FINDING-quality-007 | Protocol/root module open questions had stale entries | fixed-in-index | Solana predict and Polymarket bridge notes corrected. |
| FINDING-quality-008 | Orphan/reserved channel constants can be mistaken for live API | open | `providerListModels`, `providerTest`, `updater.check`; keep indexed as unbridged/reserved. |

Dead-code candidates from Round 2 remain unverified and must not be removed without a separate code audit.
