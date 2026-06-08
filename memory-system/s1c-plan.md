# S1c — `memory_jobs` + `memory_job_items` + `memory_decisions` (detailed stage spec)

Parent plan: `memory-system/memory-system-v2.md` §9 S1c (+ §2/§4/§6 contracts; S4/S7 consumers). Cutover map: `audit/memory-cutover-manifest.md`.
Status: DRAFT → Codex gate (`harness-memory-s1c`) → Opus implement → verify → final gate.
Strategy: EDIT-IN-PLACE in `001_initial.sql` (append after line 622, the memory_candidates block). Pre-release, dev reset OK.

## 0. Owner decisions (made 2026-06-08) + scope

- **Q1 = B (batch/sweep jobs).** One `memory_job` processes N pending candidates (cross-candidate dedup/merge → cheaper LLM). Owner choice for scaling.
- **Q2 = A (append-only `memory_decisions`).** One immutable row per decision EVENT; `decision_version` orders re-decisions; full history (audit + §4 "decisions by type" + S7 reconcile).
- **B forces a reservation substrate (Codex):** a batch worker cannot safely hold N candidates across a slow LLM call without a per-item reservation. → **`memory_job_items`** (NOT in the original §8 table list; added because batch requires it). Three new tables total.
- **Goal of S1c:** the async manager's durable WORK SUBSTRATE — schema (3 tables) + repo CRUD primitives (enqueue/claim/heartbeat/markCompleted/markFailed/recoverStale + reserveCandidates + append-only recordDecision). NO worker loop, NO LLM, NO `promote()` — those are **S4**.
- Advisory-only doctrine holds: nothing here feeds sizing/approval/wallet-intent.

## 1. Grounding (verified — 5-agent recon `wtk58tn25`)

- `compact_jobs` (017) is the durable-queue template: SERIAL id; status FSM `pending|running|completed|failed|permanently_failed`; claim = `SELECT id … FOR UPDATE SKIP LOCKED` then `UPDATE … status='running', locked_at/locked_by/heartbeat_at, attempt_count+1` (attempt incremented at CLAIM); `heartbeat` owner-checked (`WHERE id=$1 AND status='running' AND locked_by=$2`); `markFailed` → retry (`next_attempt_at = NOW() + backoff`) or `permanently_failed` when `attempt_count >= max_attempts`; `recoverStaleRunning(thresholdMs)` resets `running` rows with `heartbeat_at < NOW()-threshold` to `pending`; enqueue idempotent via `ON CONFLICT … DO NOTHING` + CTE/UNION; audit cols `inference_provider/inference_model/cost_usd/inference_completed_at`. Repo = `db/repos/compact-jobs/crud.ts`; worker (executor/scheduler/heartbeat-timer/LLM) = `engine/compact-jobs/*`. Constants in `engine/compact-jobs/policy.ts` (`WORKER_STALE_THRESHOLD_MS=120s`, `WORKER_HEARTBEAT_INTERVAL_MS=20s`, `WORKER_MAX_ATTEMPTS=3`, `TRACK2_RETRY_BACKOFF_BASE_MS=30s`).
- `memory_candidates` (001:565-622): UUID id; status `pending|promoted|superseded|merged|rejected|expired|retained` (terminal-outcome axis — NO "processing" state, deliberately); `content_hash`; `uniq_mc_pending_hash` partial unique; `promoted_knowledge_id INTEGER`; point-in-time cols; `evidence_refs` JSONB (FIX-1 immutable anchors). `knowledge_entries.id` is SERIAL → INTEGER FKs.
- DB toolkit: `db/client.ts` (`getPool`, `Executor`, `queryOneWith`/`queryWith`/`executeWith`, `withTransaction(BEGIN/COMMIT/ROLLBACK)`); `db/params.ts` (`jsonb`/`nullableJsonb`/`sanitizeJsonbValue`).
- Lockstep: `memory-candidate-enums.ts` (`as const`+`z.enum`) + `memory-candidate-enums.test.ts` `parseCheckInList()` regex parser (REUSE — extract, do not duplicate). memLog allowlist already has `jobId(id) / decision(enum) / status / statusFrom / statusTo / rejectReason(enum) / attempt(num) / count(num) / candidateId(id) / promotedKnowledgeId(id) / errorCode / errorKind`.
- FK ordering: append after 001:622; all FK targets (sessions, knowledge_entries, memory_candidates) defined earlier. Mirror regen via `copy-migrations.mjs` (gitignored).

## 2. Proposed DDL (append to `001_initial.sql`)

```sql
-- ============================================================
-- Memory v2 — manager work substrate (S1c). Batch consolidation queue.
-- The async memory_manager (S4) claims a memory_job, RESERVES up to N pending
-- memory_candidates via memory_job_items, decides per candidate, and appends one
-- immutable memory_decisions row per decision. Pattern: compact_jobs (DEDICATED
-- table, not shared). Advisory-only: never feeds sizing/approval/wallet-intent.
-- ============================================================

-- Table order: memory_jobs → memory_decisions → memory_job_items
-- (job_items FKs BOTH jobs and decisions, so decisions must exist first — MF4).

-- memory_jobs — durable batch/sweep queue.
CREATE TABLE memory_jobs (
  id                        SERIAL PRIMARY KEY,
  job_kind                  TEXT NOT NULL DEFAULT 'consolidate',
  status                    TEXT NOT NULL DEFAULT 'pending',
  -- R4-MF2: per-batch progress counts (candidates reserved / done / failed) are NOT stored — they are
  -- DERIVED from memory_job_items (GROUP BY item_status) via getJobProgress(), so retry/revive can never
  -- drift them (rules/10 §4: no stored derived state without a perf reason; counts are a cheap indexed
  -- GROUP BY). Only true accumulators (llm_call_count, cost_usd) live on the row.
  reconcile_entry_id        INTEGER REFERENCES knowledge_entries(id) ON DELETE CASCADE,  -- job_kind='reconcile' (S7)
  reconcile_outcome_version INTEGER,
  attempt_count             INTEGER NOT NULL DEFAULT 0,
  max_attempts              INTEGER NOT NULL DEFAULT 3,
  next_attempt_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at                 TIMESTAMPTZ,
  locked_by                 TEXT,
  heartbeat_at              TIMESTAMPTZ,
  last_error                TEXT,
  inference_provider        TEXT,                 -- names only, no secrets
  inference_model           TEXT,
  inference_completed_at    TIMESTAMPTZ,
  cost_usd                  NUMERIC(10,4),
  llm_call_count            INTEGER NOT NULL DEFAULT 0,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at                TIMESTAMPTZ,
  completed_at              TIMESTAMPTZ,
  CONSTRAINT mj_llm_call_count_nonneg CHECK (llm_call_count >= 0),
  CONSTRAINT mj_reconcile_outcome_version_nonneg CHECK (reconcile_outcome_version IS NULL OR reconcile_outcome_version >= 0),  -- MF7
  CONSTRAINT mj_reconcile_fields CHECK (   -- R6-MF1: EXACT — consolidate jobs carry NO reconcile fields
    (job_kind = 'reconcile'   AND reconcile_entry_id IS NOT NULL AND reconcile_outcome_version IS NOT NULL)
    OR
    (job_kind = 'consolidate' AND reconcile_entry_id IS NULL     AND reconcile_outcome_version IS NULL)
  ),
  CONSTRAINT mj_job_kind_valid CHECK (job_kind IN ('consolidate','reconcile')),
  CONSTRAINT mj_status_valid   CHECK (status IN ('pending','running','completed','failed','permanently_failed'))
);
CREATE INDEX idx_mj_status_due ON memory_jobs(status, next_attempt_at) WHERE status IN ('pending','failed');
CREATE INDEX idx_mj_running_heartbeat ON memory_jobs(heartbeat_at) WHERE status = 'running';
-- reconcile idempotency (MF6): EXACTLY ONE reconcile job per (entry, outcome_version) FOREVER —
-- across ALL statuses (not just live). Retry = reset the terminal row (resetReconcileJob), never
-- a second row. Prevents re-reconciling the same outcome_version after completion.
CREATE UNIQUE INDEX uniq_mj_reconcile ON memory_jobs(reconcile_entry_id, reconcile_outcome_version)
  WHERE job_kind = 'reconcile';

-- memory_decisions — append-only audit of every manager decision event.
-- DURABLE append-only audit (R2-MF1): the three IDENTITY references — candidate_id, reconcile_entry_id,
-- job_id — are IMMUTABLE ANCHOR columns with NO foreign key, so a `sessions → memory_candidates
-- ON DELETE CASCADE` (001:567) never nulls them and never trips `md_anchor_xor`. The row is
-- self-contained and survives deletion of its subject. Write-time validity (the anchor ids exist) is
-- enforced by the repo (recordDecision is only called by the S4 manager holding live rows). Only the
-- OUTCOME pointers (promoted/supersedes/merge_target_knowledge_id) keep a live FK (SET NULL) — they
-- point to durable knowledge_entries and are convenient join targets.
CREATE TABLE memory_decisions (
  id                        BIGSERIAL PRIMARY KEY,
  candidate_id              UUID,                 -- anchor (no FK); NULL for reconcile decisions
  reconcile_entry_id        INTEGER,              -- anchor (no FK); set for reconcile decisions (S7)
  job_id                    INTEGER NOT NULL,     -- anchor (no FK); every decision traces to a job
  decision_version          INTEGER NOT NULL DEFAULT 0,
  decision_type             TEXT NOT NULL,
  decision_hash             CHAR(64) NOT NULL,    -- MF5: sha256 of semantic payload; guards mismatched retries
  reject_reason             TEXT,                 -- bounded enum; required iff reject/expire
  promoted_knowledge_id     INTEGER REFERENCES knowledge_entries(id) ON DELETE SET NULL,  -- live outcome link
  supersedes_knowledge_id   INTEGER REFERENCES knowledge_entries(id) ON DELETE SET NULL,
  merge_target_knowledge_id INTEGER REFERENCES knowledge_entries(id) ON DELETE SET NULL,
  outcome_version           INTEGER,              -- S7 reconcile linkage (knowledge_entries.outcome_version)
  evidence_refs             JSONB NOT NULL DEFAULT '[]',  -- FIX-1 snapshot: protocol_* ids + semantic keys, NEVER proj_*
  inference_provider        TEXT,
  inference_model           TEXT,
  cost_usd                  NUMERIC(10,4),
  decided_by                TEXT NOT NULL DEFAULT 'manager',
  decided_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT md_decision_version_nonneg CHECK (decision_version >= 0),
  CONSTRAINT md_outcome_version_nonneg  CHECK (outcome_version IS NULL OR outcome_version >= 0),  -- MF7
  CONSTRAINT md_decision_hash_hex CHECK (decision_hash ~ '^[0-9a-f]{64}$'),                       -- MF5
  CONSTRAINT md_anchor_xor CHECK (   -- R3-MF3: EXACTLY ONE of candidate / reconcile anchor (a row must never hit both unique indexes)
    (candidate_id IS NOT NULL)::int + (reconcile_entry_id IS NOT NULL)::int = 1),
  CONSTRAINT md_reconcile_type CHECK ((decision_type = 'reconcile') = (reconcile_entry_id IS NOT NULL)),  -- R3-MF3: reconcile type ⇔ reconcile anchor
  CONSTRAINT md_reconcile_fields CHECK ((reconcile_entry_id IS NOT NULL) = (outcome_version IS NOT NULL)), -- R2-MF4/R6-MF2: outcome_version present IFF reconcile (closes the NULL-key dedup hole AND forbids it on candidate decisions)
  CONSTRAINT md_reject_reason_scope CHECK ((decision_type IN ('reject','expire')) = (reject_reason IS NOT NULL)),  -- MF7 biconditional
  CONSTRAINT md_evidence_refs_is_array CHECK (jsonb_typeof(evidence_refs) = 'array'),
  CONSTRAINT md_decision_type_valid CHECK (decision_type IN ('promote','supersede','merge','retain','reject','expire','reconcile')),
  CONSTRAINT md_reject_reason_valid CHECK (reject_reason IS NULL OR reject_reason IN
    ('secret_or_live_state','low_confidence','duplicate','insufficient_evidence','superseded_by_existing','expired_ttl','policy')),
  CONSTRAINT md_decided_by_valid CHECK (decided_by IN ('manager','system'))
);
-- candidate-driven idempotency: one decision per (candidate, version) (partial — reconcile has no candidate)
CREATE UNIQUE INDEX uniq_md_candidate_version ON memory_decisions(candidate_id, decision_version)
  WHERE candidate_id IS NOT NULL;
-- reconcile-driven idempotency (MF6): one decision per (entry, outcome_version)
CREATE UNIQUE INDEX uniq_md_reconcile ON memory_decisions(reconcile_entry_id, outcome_version)
  WHERE reconcile_entry_id IS NOT NULL;
CREATE INDEX idx_md_candidate ON memory_decisions(candidate_id, decision_version DESC) WHERE candidate_id IS NOT NULL;
CREATE INDEX idx_md_type      ON memory_decisions(decision_type);   -- §4 "decisions by type"

-- memory_job_items — per-candidate reservation + working state for a batch job.
CREATE TABLE memory_job_items (
  id            SERIAL PRIMARY KEY,
  job_id        INTEGER NOT NULL REFERENCES memory_jobs(id) ON DELETE CASCADE,
  candidate_id  UUID    NOT NULL REFERENCES memory_candidates(id) ON DELETE CASCADE,
  item_status   TEXT NOT NULL DEFAULT 'reserved',
  decision_id   BIGINT REFERENCES memory_decisions(id) ON DELETE RESTRICT,  -- MF4: durable link when item is done
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mji_item_status_valid CHECK (item_status IN ('reserved','processing','done','failed','released')),
  CONSTRAINT mji_done_has_decision CHECK (item_status <> 'done' OR decision_id IS NOT NULL),  -- MF4: no "done" without a decision row
  CONSTRAINT mji_job_candidate_unique UNIQUE (job_id, candidate_id)
);
-- RESERVATION GUARD: a candidate is actively held by AT MOST ONE job at a time.
CREATE UNIQUE INDEX uniq_mji_active_candidate ON memory_job_items(candidate_id)
  WHERE item_status IN ('reserved','processing');
-- one item per decision (MF4)
CREATE UNIQUE INDEX uniq_mji_decision ON memory_job_items(decision_id) WHERE decision_id IS NOT NULL;
CREATE INDEX idx_mji_job_status ON memory_job_items(job_id, item_status);
```

Notes:
- `memory_jobs`/`memory_job_items` = SERIAL (compact_jobs precedent, internal queue). `memory_decisions` = BIGSERIAL (append-only log, defensive). `candidate_id` stays UUID.
- NO embedding columns here (jobs/decisions don't embed). NO point-in-time cols on jobs/decisions — deref via `candidate_id` (S5).
- The reservation guard `uniq_mji_active_candidate` is the batch concurrency primitive: "a candidate is processed by at most one ACTIVE job" is a DB invariant. Both reserve steps (revive + insert) take a `FOR UPDATE … SKIP LOCKED` lock on the candidate rows first (§5), serializing concurrent reservers so the active-unique can never be violated; the `NOT EXISTS(active reservation)` filter + the partial unique are belt-and-suspenders.
- Audit durability (R2-MF1): `memory_decisions` identity refs (candidate_id/reconcile_entry_id/job_id) are immutable ANCHOR columns with NO FK, so the append-only log is never FK-deleted and stays self-contained; only the knowledge outcome pointers are live FKs (SET NULL).

## 3. Enums (lockstep: `as const` + `z.enum` + named SQL CHECK + parser test)

New `src/vex-agent/memory/schema/memory-job-enums.ts`:
`MEMORY_JOB_KIND` (consolidate|reconcile), `MEMORY_JOB_STATUS` (pending|running|completed|failed|permanently_failed), `MEMORY_JOB_ITEM_STATUS` (reserved|processing|done|failed|released).
New `src/vex-agent/memory/schema/memory-decision-enums.ts`:
`MEMORY_DECISION_TYPE` (promote|supersede|merge|retain|reject|expire|reconcile), `MEMORY_DECISION_REJECT_REASON` (secret_or_live_state|low_confidence|duplicate|insufficient_evidence|superseded_by_existing|expired_ttl|policy), `MEMORY_DECISION_ACTOR` (manager|system).
New test(s) reusing `parseCheckInList` (extract it to a shared test util, or import from the s1b test): parse `mj_*_valid` / `mji_*_valid` / `md_*_valid` from 001, assert == TS `as const` == `z.enum().options`; fail-loud on missing constraint; doctrine guard (no execution/sizing vocab; decision types are advisory).

## 4. Zod boundary schemas

New `src/vex-agent/memory/schema/memory-decision.ts`:
- `recordDecisionInputSchema` — the trusted shape the manager (S4) hands to `recordDecision`. **R3-MF3: discriminate on decisionType — `reconcile` requires `reconcileEntryId` + `outcomeVersion` and forbids `candidateId`; every OTHER type requires `candidateId` and forbids `reconcileEntryId`/`outcomeVersion` (XOR, mirrors `md_anchor_xor` + `md_reconcile_type` + `md_reconcile_fields`).** Plus: **jobId (required)**, decisionVersion, decisionType, rejectReason? (required iff reject/expire — mirrors `md_reject_reason_scope`), the knowledge-id targets, evidenceRefs (REUSE `evidenceRefsSchema` from `memory-candidate.ts`, FIX-1 immutable anchors), inference audit. Model as a discriminated union on `decisionType` (or `.strict()` + `.refine` enforcing the XOR + reconcile rules).
- **`decision_hash` (MF5)** is computed deterministically by the repo from the decision's semantic payload (anchor id, decisionVersion/outcomeVersion, decisionType, target knowledge ids, rejectReason, canonicalized evidenceRefs) — REUSE the length-prefixed SHA256 helper style from `knowledge/content-hash.ts`; it is NOT agent input.
- Job enqueue inputs are simple typed inputs (no agent-facing surface) — repo `InsertJobInput` typed in the repo `types.ts`; Zod only where an external/agent boundary exists (none in S1c; the suggest boundary is S2).

## 5. Repos (3 modules; CRUD primitives only — orchestration is S4)

`src/vex-agent/db/repos/memory-jobs/{types.ts,crud.ts,index.ts}`:
- `enqueueConsolidateJob(client?)`; `enqueueReconcileJob(entryId, outcomeVersion, client?)` — **R4-MF1: PURE idempotent insert (mirrors `compact_jobs.enqueueJob`); NEVER mutates an existing row (any status); returns `{ job, inserted }`.** **R5-MF1: the conflict target must name the partial index's columns + predicate, not the index name: `ON CONFLICT (reconcile_entry_id, reconcile_outcome_version) WHERE job_kind = 'reconcile' DO NOTHING`** + CTE/UNION fallback to return the existing row (mirror `memory-candidates/crud.ts:87`). A `failed` reconcile is already in the worker's retry/backoff cycle (auto-retried via `next_attempt_at`) — enqueue must not erase its backoff/attempts.
- `resetReconcileJob(entryId, outcomeVersion, client?)` — **R4-MF1: the EXPLICIT retry of a given-up reconcile (mirrors `compact_jobs.resetPermanentlyFailed`, crud.ts:297): `UPDATE … WHERE reconcile match AND status='permanently_failed' RETURNING …`.** **R5-MF2: reset ALL stale fields, not just status — `status='pending', attempt_count=0, next_attempt_at=NOW(), locked_at=NULL, locked_by=NULL, heartbeat_at=NULL, last_error=NULL, started_at=NULL, completed_at=NULL, inference_completed_at=NULL, inference_provider=NULL, inference_model=NULL, cost_usd=NULL, llm_call_count=0`** so a re-run starts clean. Returns `{ ok } | { not_found }`. Never touches pending/running/failed/completed.
- `claimNextDueJob(workerId, client?)` — `FOR UPDATE SKIP LOCKED` (compact_jobs pattern), inside `withTransaction`; sets running + `locked_by=workerId` + heartbeat + attempt+1.
- `heartbeat(jobId, workerId)` (owner-checked), `markCompleted`, `markFailed(jobId, workerId, errorCode, backoffMs)` (retry/backoff/permanent — owner-checked), `recoverStaleRunning(thresholdMs)` — **MF3: ONE transaction resets each stale `running` job to pending (backoff) AND releases its `reserved|processing` items to `released`; no separate caller step.**
- `bumpJobInference(jobId, {llmCalls?, costUsd?})` (accumulate ONLY the true accumulators — R4-MF2), `getJobProgress(jobId)` (DERIVED counts: `SELECT item_status, COUNT(*) FROM memory_job_items WHERE job_id=$1 GROUP BY item_status` — never drifts on retry/revive), `getJobById`, `listJobsByStatus`.
`src/vex-agent/db/repos/memory-job-items/{types.ts,crud.ts,index.ts}`:
- `reserveCandidatesForJob(jobId, workerId, limit, client?)` — **MF3: owner-checked** (job `status='running' AND locked_by=$workerId`) inside `withTransaction`. **R2-MF2: TWO steps in the one transaction, because two different unique constraints can be hit and `ON CONFLICT` arbitrates only one:**
  1. **revive own dormant items (R3-MF1: must lock candidates too, else the UPDATE can race into `uniq_mji_active_candidate`):** a CTE locks the candidate rows first, then updates only the locked items —
     `WITH lockable AS (SELECT i.id FROM memory_job_items i JOIN memory_candidates c ON c.id=i.candidate_id WHERE i.job_id=$jobId AND i.item_status IN ('released','failed') AND NOT EXISTS(SELECT 1 FROM memory_job_items a WHERE a.candidate_id=i.candidate_id AND a.item_status IN ('reserved','processing')) FOR UPDATE OF c SKIP LOCKED) UPDATE memory_job_items SET item_status='reserved', updated_at=NOW() WHERE id IN (SELECT id FROM lockable) RETURNING candidate_id`. Locking `c` serializes revive vs. concurrent insert on the same candidate.
  2. **lock + insert new** up to the remaining limit: `SELECT c.id FROM memory_candidates c WHERE c.status='pending' AND NOT EXISTS(active reservation for c.id) AND NOT EXISTS(item for ($jobId,c.id)) ORDER BY c.recorded_at LIMIT $rem FOR UPDATE SKIP LOCKED` — **locking the candidate rows serializes concurrent reservers so the active-unique can't be violated** — then `INSERT INTO memory_job_items(job_id, candidate_id) … ON CONFLICT DO NOTHING RETURNING candidate_id` (belt-and-suspenders).
  Returns the reserved candidate ids (revived + newly inserted). **No stored counter to bump (R4-MF2) — batch size/progress is derived via `getJobProgress`.**
- `markItemProcessing(itemId, jobId, workerId)`, **`markItemDone(itemId, jobId, workerId, decisionId)`** and **`markItemFailed(itemId, jobId, workerId, errorCode)`** — **R2-MF3: ALL owner-checked** (verify parent `memory_jobs.status='running' AND locked_by=$workerId` + expected item status in ONE transaction; a stale worker whose claim was reclaimed cannot mutate items). `markItemDone` REQUIRES `decisionId` (CHECK `mji_done_has_decision` + `uniq_mji_decision` enforce it at the DB — MF4). `releaseItemsForJob(jobId)` (reserved/processing → released; used by `recoverStaleRunning` in-txn + on abandon), `listItemsByJob(jobId, status?)`.
`src/vex-agent/db/repos/memory-decisions/{types.ts,crud.ts,index.ts}`:
- `recordDecision(input, client?)` — append-only INSERT; computes `decision_hash`; idempotent on `uniq_md_candidate_version` / `uniq_md_reconcile` (`xmax` upsert). **MF5: on conflict, return `{ decision, inserted:false }` ONLY when the stored `decision_hash` equals the recomputed one; if they differ → return/throw `idempotency_conflict` (a different decision for the same version is a bug, never a silent duplicate).** evidence_refs via `jsonb()`.
- `getDecisionsForCandidate(candidateId)` (history, version DESC), `getLatestDecision(candidateId)`, `getDecisionsForReconcile(entryId)`, `listDecisionsByType(type, limit)`.

All exported fns: explicit return types; precondition-guarded transitions return discriminated unions (`ok | not_found | precondition_failed`, plus `idempotency_conflict` for recordDecision) like `updateCandidateStatus`. Executor pattern `client ?? getPool()`; claim/reserve/recover use `withTransaction`.

## 6. Observability (memLog — second/third real consumers)

Areas `job`, `job_item`, `decision`. Reuse existing allowlist keys: `jobId`, `candidateId`, `status`/`statusFrom`/`statusTo`, `decision` (for decisionType), `rejectReason`, `attempt`, `count` (for batch counts / anchor count), `promotedKnowledgeId`, `errorCode`, `insertResult`. Likely ONE new key: `jobKind` (enum) — add to `MemoryLogMeta` + `META_KEY_CATEGORY` if logged. NO raw errors (use bounded `errorCode`/`rejectReason`). NO cost/model in logs unless added as bounded keys (defer — cost lives in columns, queried for §4 metrics, not logged per-event).

## 7. Scope — S1c vs S4

- **S1c (this stage):** 3 tables; enums + lockstep tests; Zod decision-input schema; repo CRUD primitives (enqueue/claim/heartbeat/markCompleted/markFailed/recoverStale; reserveCandidatesForJob/markItem*/releaseItems; recordDecision/get/list); memLog wiring; integration tests on real pgvector.
- **S4 (later):** the executor loop + scheduler (startup sweep + periodic + threshold) + heartbeat timer; the deterministic + LLM decision stages (OpenRouter); `promote()/insertLongMemory()` (FIX-4 redaction boundary); the actual candidate.status finalization + cross-table transaction; FIX-3 (internal funcs, not ToolDefs). S1c provides the primitives S4 orchestrates.

## 8. Tests / Done-when

- `tsc --noEmit` clean.
- Lockstep enum tests green (mj/mji/md named CHECKs ↔ TS ↔ Zod; fail-loud; doctrine).
- Integration on real pgvector (mirror s1b harness): fresh 001 migrates clean with 3 tables.
  - **claim race:** two `claimNextDueJob` in parallel → exactly one claims a given job.
  - **reservation guard:** two jobs `reserveCandidatesForJob` over the same pending pool → each candidate reserved by exactly one job (no double-reservation); `uniq_mji_active_candidate` enforced.
  - **owner-checked reservation (MF3):** `reserveCandidatesForJob` with a non-owner/non-running job → no rows reserved.
  - **partial progress:** items can be done/failed independently; `getJobProgress` reflects the per-`item_status` counts; a failed item does not block others.
  - **done requires a decision (MF4):** `markItemDone` without a `decisionId` → rejected (CHECK `mji_done_has_decision`); a done item always has exactly one linked decision (`uniq_mji_decision`).
  - **stale recovery is atomic (MF3):** `running` job past threshold → `recoverStaleRunning` resets job to pending AND releases its `reserved|processing` items in one transaction; those candidates re-enter the pool.
  - **retry revive (MF2):** a stale-recovered job re-runs `reserveCandidatesForJob` and re-reserves its OWN previously-`released` candidates (no strand); cross-job double-hold still blocked by `uniq_mji_active_candidate`.
  - **derived progress, no drift (R4-MF2):** `getJobProgress` returns correct counts by `item_status` after a reserve→release→revive cycle (no double-count; counts come from `memory_job_items`, not a stored column).
  - **retry/permanent:** `markFailed` retries with backoff then `permanently_failed` at `max_attempts` (owner-checked).
  - **append-only decisions + hash idempotency (MF5):** `recordDecision` twice with the SAME payload for `(candidate, version)` → second `inserted=false`, one row; twice with a DIFFERENT payload → `idempotency_conflict`; `getDecisionsForCandidate` returns ordered history; `md_reject_reason_scope` biconditional (reject/expire ⟺ reason).
  - **reconcile idempotency across statuses (MF6 + R4-MF1):** a second `enqueueReconcileJob(entry, outcome_version)` returns the existing row with `inserted=false` and DOES NOT mutate it (no backoff/attempt reset) regardless of status; `resetReconcileJob` resets ONLY a `permanently_failed` row; `uniq_md_reconcile` dedupes reconcile decisions.
  - **anchor durability (R2-MF1):** delete a session → its candidates cascade-delete + their job_items cascade-delete, but the `memory_decisions` rows SURVIVE (identity anchors are non-FK; `md_anchor_xor` never trips). The decision history is still queryable by `candidate_id`.
  - **reconcile non-null key (R2-MF4):** a reconcile decision with NULL `outcome_version` is rejected (`md_reconcile_fields`); two reconcile decisions for the same `(entry, outcome_version)` → idempotent (`uniq_md_reconcile`).
  - FK integrity (item.job_id/candidate_id CASCADE; item.decision_id RESTRICT; decision outcome pointers SET NULL) + CHECK rejects (bad enum/reconcile-fields/reject-scope/decision-hash/anchor-xor/reconcile-type/done-has-decision).
- Mirror `vex-app/resources/migrations` synced.

## 9. DECISIONS TO RATIFY (Codex gate)

- **D1 memory_job_items necessity + shape.** Batch (Q1=B) requires a reservation substrate (Codex); model it as a join table with `uniq_mji_active_candidate` (a candidate actively held by ≤1 job) + per-item status for partial progress. Confirm vs folding reservation into `memory_candidates` (rejected: would add worker-mechanics to the outcome table + a "processing" candidate status).
- **D2 id types.** jobs/items SERIAL (compact_jobs precedent), decisions BIGSERIAL (append-only). Candidate stays UUID. Confirm.
- **D3 reconcile fields on memory_jobs now** (reconcile_entry_id/outcome_version + `uniq_mj_reconcile`) vs defer to S7. Recommend: now (cheap, avoids a re-migration; S7 just uses them).
- **D4 evidence_refs snapshot on memory_decisions** (FIX-1 immutable anchors copied at decision time for a self-contained audit) vs deref-via-candidate. Recommend: snapshot (audit survives candidate change/delete).
- **D5 reject_reason as a bounded enum** (no free text → no secret leak; feeds §4 "rejects by reason"). Confirm the starter vocab; is any value missing for S2/S4?
- **D6 decision_version ownership.** Per-candidate monotonic counter (0,1,2…), bumped by the manager on each re-decision (initial=0; S7 reconcile=+1); `uniq_md_candidate_version` enforces idempotency. Confirm this is the §6 "decision version".
- **D7 partial-progress failure semantics** (per-candidate item transaction commits independently; job marks failed/retry/permanent at the job level; all-or-nothing rejected per Codex). Confirm.
- **D8 S1c builds repo primitives incl. claim/heartbeat/reserve/recordDecision; S4 builds the executor loop + LLM + promote().** Confirm the boundary (some recon put claim SQL in S4 — but compact_jobs puts claim in the REPO, worker in engine/; we follow that split).
- **D9 reservation query** (`reserveCandidatesForJob` = revive-CTE + lock-and-insert, both taking `FOR UPDATE … SKIP LOCKED` on `memory_candidates`; the active-reservation partial unique is the hard cross-job guard) — confirm race-safe under concurrent batch jobs.

---

## 10. GATE ROUND 1 — Codex BLOCKED resolutions (2026-06-08, session harness-memory-s1c)

Codex (design consult + gate) confirmed B+A+items is sound and the reservation idea is race-safe given transactional owner-checked reservation + terminal-only candidate status. 7 must-fixes, all folded in:

- **MF1 (resolved §2 memory_decisions).** Append-only audit must not be FK-lost. Codex proposed `candidate_id` RESTRICT + `job_id` NOT NULL RESTRICT; I **deviated to `SET NULL` (both nullable)** because RESTRICT collides with `sessions → memory_candidates ON DELETE CASCADE` (could not delete a session whose candidates have decisions) and reconcile decisions have NO candidate. SET NULL keeps the log append-only/durable + self-contained (decision_hash, targets, evidence snapshot). Added `md_anchor_present` (candidate OR reconcile entry). [Flagged to reviewer in re-gate.]
- **MF2 (resolved §5 reserve).** `reserveCandidatesForJob` revives this job's own `released|failed` items via `ON CONFLICT (job_id,candidate_id) DO UPDATE` (no strand on retry); cross-job hold still blocked by `uniq_mji_active_candidate`.
- **MF3 (resolved §5).** Reservation is owner-checked (`reserveCandidatesForJob(jobId, workerId, …)`, running+locked_by); `recoverStaleRunning` resets job AND releases its items in ONE transaction.
- **MF4 (resolved §2 + §5).** `memory_job_items.decision_id` FK + `mji_done_has_decision` CHECK + `uniq_mji_decision`; `markItemDone(itemId, decisionId)` required → no "done without a decision".
- **MF5 (resolved §2 + §4 + §5).** `decision_hash CHAR(64)` (+hex CHECK); `recordDecision` returns existing only on hash match, else `idempotency_conflict`.
- **MF6 (resolved §2 + §5).** `uniq_mj_reconcile` now `WHERE job_kind='reconcile'` (ALL statuses) + `enqueueReconcileJob` revives terminal rows; `memory_decisions.reconcile_entry_id` + `uniq_md_reconcile` for reconcile-decision idempotency.
- **MF7 (resolved §2).** Nonneg CHECKs for `reconcile_outcome_version` + `outcome_version`; `md_reject_reason_scope` made a biconditional.

Table order changed to memory_jobs → memory_decisions → memory_job_items (items now FK decisions).

## 11. GATE ROUND 2 — Codex BLOCKED resolutions (2026-06-08, harness-memory-s1c)

Codex accepted SET NULL "in principle" but caught 4 sharper bugs in the round-1 fixes; all folded in:

- **R2-MF1 (resolved §2 memory_decisions).** SET NULL + `md_anchor_present` was self-contradictory (a cascade nulling `candidate_id` would then violate the anchor CHECK and FAIL the delete). Fix: the three identity refs (`candidate_id`, `reconcile_entry_id`, `job_id`) are now **immutable ANCHOR columns with NO FK**; `md_anchor_present` checks them; only the knowledge OUTCOME pointers keep a live FK (SET NULL). Write-time validity is a repo invariant.
- **R2-MF2 (resolved §5 reserve).** `ON CONFLICT (job_id,candidate_id)` could not arbitrate the cross-job `uniq_mji_active_candidate` violation. Fix: a single transaction = (1) revive own released|failed items guarded against cross-job active hold, then (2) `SELECT … FOR UPDATE SKIP LOCKED` on `memory_candidates` + insert — locking candidate rows serializes reservers so the active-unique can't be violated; `candidate_count` only counts newly active/revived.
- **R2-MF3 (resolved §5).** `markItemDone`/`markItemFailed` are now owner-checked (`jobId, workerId`, parent running+locked_by) so a reclaimed stale worker can't mutate items.
- **R2-MF4 (resolved §2 + §4).** `md_reconcile_fields` CHECK (`reconcile_entry_id IS NULL OR outcome_version IS NOT NULL`) closes the NULL-key hole in `uniq_md_reconcile`; mirrored in `recordDecisionInputSchema`.

Codex confirmed: table order resolves the FK creation pass; the dual reconcile guards (jobs schedule/retry, decisions audit idempotency) are coherent given non-null outcome versions.

## 12. GATE ROUND 3 — Codex BLOCKED resolutions (2026-06-08, harness-memory-s1c)

Codex confirmed the anchor-column model is sound; 3 sharper edge bugs, all folded in:

- **R3-MF1 (resolved §5 reserve step 1).** The revive `UPDATE` didn't lock `memory_candidates`, so under READ COMMITTED its `NOT EXISTS` could miss an uncommitted concurrent reservation and then deadlock/violate `uniq_mji_active_candidate`. Fix: revive via a CTE that `SELECT … FOR UPDATE OF c SKIP LOCKED` on the candidate rows first, updating only the locked items — same lock discipline as the insert step.
- **R3-MF2 (resolved §5 enqueueReconcileJob).** The all-status `uniq_mj_reconcile` revive must not touch in-flight rows. Fix: `DO UPDATE … WHERE status IN ('failed','permanently_failed')` only; `pending`/`running`/`completed` → returned with `revived=false` (completed excluded by design — idempotent per (entry, outcome_version); a new outcome bumps the version → a new row).
- **R3-MF3 (resolved §2 + §4).** `md_anchor_present` allowed BOTH anchors (a row could hit both unique indexes). Fix: `md_anchor_xor` (exactly one of candidate/reconcile) + `md_reconcile_type` (`decision_type='reconcile' ⇔ reconcile anchor`); Zod becomes a discriminated union on `decisionType`. Test: a row with both anchors, or `reconcile` without a reconcile entry, is rejected.

## 13. GATE ROUND 4 — Codex BLOCKED resolutions (2026-06-08, harness-memory-s1c)

Codex confirmed reservation locking + anchor XOR are coherent; 2 last bugs, folded in:

- **R4-MF1 (resolved §5).** `enqueueReconcileJob` resetting a `failed` row erased its retry/backoff (`failed` is the auto-retry state, not terminal — compact precedent). Fix: `enqueueReconcileJob` is now a PURE idempotent insert (`ON CONFLICT DO NOTHING` + return existing, never mutates, mirrors `compact_jobs.enqueueJob`); a separate explicit `resetReconcileJob` resets ONLY `permanently_failed` (mirrors `compact_jobs.resetPermanentlyFailed`).
- **R4-MF2 (resolved §2 + §5).** The stored `candidate_count/processed_count/failed_count` drift on retry-revive (revived rows double-counted). Fix: DROP those columns — batch progress is DERIVED from `memory_job_items` via `getJobProgress` (cheap indexed GROUP BY; rules/10 §4: no stored derived state without a perf reason). Only true accumulators (`llm_call_count`, `cost_usd`) remain on the row, bumped via `bumpJobInference`.

## 14. GATE ROUND 5 — Codex BLOCKED resolutions (2026-06-08, harness-memory-s1c)

Codex confirmed the core design is sound (pure reconcile enqueue, explicit permanent reset, derived progress, reservation locking, append-only decision idempotency). 2 correctness fixes + spec hygiene, folded in:

- **R5-MF1 (resolved §5).** `ON CONFLICT (uniq_mj_reconcile)` is invalid (can't name an index). Fixed to the partial-index column+predicate form `ON CONFLICT (reconcile_entry_id, reconcile_outcome_version) WHERE job_kind='reconcile' DO NOTHING` (mirrors `memory-candidates/crud.ts:87`).
- **R5-MF2 (resolved §5).** `resetReconcileJob` must clear ALL stale audit/accumulator fields (started_at, completed_at, inference_*, cost_usd, llm_call_count=0), matching `compact_jobs.resetPermanentlyFailed` (crud.ts:297).
- **R5-MF3 (spec hygiene).** Replaced stale cross-references left from earlier rounds in the active spec (Notes §2, §5, §8 tests, §9 D9): `SET NULL`→anchors, `bumpJobProgress`→`getJobProgress`, `md_anchor_present`→`md_anchor_xor`, old `ON CONFLICT DO UPDATE` reservation→revive-CTE/candidate-lock. The §10–§13 round logs intentionally keep the old terms as history.

## 15. GATE ROUND 6 — Codex BLOCKED resolutions (2026-06-08, harness-memory-s1c)

Codex verified all round-5 fixes; 2 last CHECK tightenings (exactness), folded in:

- **R6-MF1 (resolved §2 memory_jobs).** `mj_reconcile_fields` biconditional allowed a `consolidate` job to carry ONE reconcile field. Made EXACT: `(reconcile AND both reconcile fields set) OR (consolidate AND both null)` — consolidate jobs carry NO reconcile fields.
- **R6-MF2 (resolved §2 memory_decisions).** `md_reconcile_fields` let a candidate decision carry `outcome_version`. Made a biconditional: `(reconcile_entry_id IS NOT NULL) = (outcome_version IS NOT NULL)` — `outcome_version` present IFF reconcile decision (matches the §4 Zod rule).

---

## 16. STATUS: DONE (2026-06-08) — plan GREEN (r7) + implementation GREEN (final gate r3)

Implemented + independently verified (tsc clean; 86 non-DB tests; 45 integration on a real pgvector container) + Codex final implementation gate GREEN LIGHT. The plan gate (7 rounds) shaped the schema; the FINAL implementation gate caught 5 code-level bugs the plan review couldn't see — all fixed:

- **FG-1 `recoverStaleRunning`.** A stale FINAL-attempt running job was reset to `pending` → unclaimable (`attempt_count >= max_attempts`) AND unresettable → stranded. Now SPLITS in one txn: `attempt_count >= max_attempts` → `permanently_failed`; else → `pending` (backoff); both release their reserved|processing items.
- **FG-2 `enqueueReconcileJob`.** The mirrored `compact_jobs` CTE/UNION fallback could return no row under a concurrent same-key insert → throw. Replaced with the race-safe xmax pattern: `ON CONFLICT (cols) WHERE … DO UPDATE SET reconcile_entry_id = memory_jobs.reconcile_entry_id RETURNING …, (xmax=0) AS inserted` — a no-op self-update (PURE, no field change) that always returns the row.
- **FG-3 `recordDecision` anchor coherence.** The non-FK anchors had no write-time validity (the migration says the repo owns it). Now runs in a txn: candidate decisions require a `FOR UPDATE`-locked, `running` job that ACTIVELY holds the candidate (reserved|processing job_item); reconcile decisions require the `FOR UPDATE`-locked, `running` matching reconcile job. New result variant `anchor_incoherent`. The lock + running check (final gate r2) closes a TOCTOU vs `recoverStaleRunning`. (Owner-check via workerId = accepted S4 hardening.)
- **FG-4 `markItemDone`.** Could close an item with another candidate's decision. The UPDATE now joins `memory_decisions` requiring `d.job_id=i.job_id AND d.candidate_id=i.candidate_id AND d.reconcile_entry_id IS NULL`.

Regression tests added for all five. Test names carry no internal gate-codes (per owner: self-documenting). NOT committed — awaiting owner.
