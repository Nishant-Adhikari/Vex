/**
 * Approval runtime — locked-tx snapshot phase.
 *
 * The tx locks the `approval_intents`, `approval_queue`, AND `sessions` rows
 * (`FOR UPDATE OF i, q, s`) and decides which path the post-tx side-effects
 * will run. Locking `sessions s` serializes the LIVE permission read
 * (`s.permission`) against a concurrent permission-downgrade tx, so the
 * approve-time re-enforcement (B-001) compares the enqueue snapshot against a
 * permission value that cannot change underneath this approve until it commits.
 * The TTL gate uses DB-side `NOW()` so an approve that races the TTL boundary
 * observes a single committed truth.
 *
 * Codex puzzle-5 phase-3 review point 4 — atomic TTL gate inside the same
 * locked tx as the queue CAS.
 *
 * Returns a private discriminated-union snapshot; the public entry points
 * in `../approval-runtime.ts` map this to the IPC contract.
 *
 * Compatibility façade: the implementation now lives in `./snapshot/`. The
 * row-shaping + read-only lock/load + DB-NOW helpers (`compare.ts`,
 * `render.ts`), the discriminated-union types (`types.ts`), and the
 * ORDERING-OWNER builders that hold every queue/intent CAS (`build.ts`) are
 * split per concern; this file re-exports the identical public surface so
 * callers see no difference.
 */

export type {
  IntentSnapshotRow,
  ApproveSnapshot,
  RejectSnapshot,
} from "./snapshot/types.js";
export {
  buildApproveSnapshot,
  buildRejectSnapshot,
} from "./snapshot/build.js";
