---
id: index.flows
kind: flow-index
paths: ["VEX-INDEX/flows/**/*.md", "VEX-INDEX/Structure.md"]
source_commit: cf05003
indexed_at: 2026-05-28
stale_when_paths_change: ["VEX-INDEX/Structure.md", "VEX-INDEX/flows/**/*.md"]
related: [index.structure, index.modules]
---

# Flow Index

Each flow doc names the trigger, lists steps with `path:line symbol` anchors, calls out invariants, and enumerates known failure modes. Use `FLOW-*.md` for end-to-end navigation across module docs.

- `FLOW-chat-turn` — `flows/FLOW-chat-turn.md`. User chat submit → engine turn loop → stream → transcript. Covers F1 provider gate, F4 caveat, F5 polling fallback.
- `FLOW-mission-start` — `flows/FLOW-mission-start.md`. `/mission start` (or contract accept) → engine `prepareMissionStart` → background mission runner with self-defer + restricted gates.
- `FLOW-approval-restricted` — `flows/FLOW-approval-restricted.md`. Dispatcher gate (mutating, restricted, unapproved) → `paused_approval` row → `ApprovalCard` (F3) → resolve → engine resume.
- `FLOW-wake-resume` — `flows/FLOW-wake-resume.md`. `loop_defer` enqueue → wake worker supervisor (F2) → per-tick provider gate → claim+resume.
- `FLOW-compaction-tracks` — `flows/FLOW-compaction-tracks.md`. Pressure or `/compact now` → Track 1 atomic transaction → Track 2 async chunker (provider-gated, registry-bypass finding).
- `FLOW-onboarding-config-write` — `flows/FLOW-onboarding-config-write.md`. Wizard step submit → `withEnvWriteLock` → writer → `loadProviderDotenv({overwrite:true})` → `resetProvider()` (F1).

Interim canonical wiring summary lives in `Structure.md → Integration wiring map` and stays useful for one-screen orientation.
