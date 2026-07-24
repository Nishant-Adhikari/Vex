/**
 * Runtime schemas — durable control plane for active mission runs.
 *
 * Puzzle 03 expands the surface beyond the puzzle-01 stubs:
 *
 *  - `getState` reads the active row from `mission_runs` (statuses
 *    `running` / `paused_approval` / `paused_wake` / `paused_error` /
 *    `paused_user`) plus a bounded lease summary
 *    (`leaseActive` + `leaseExpiresAt`).
 *  - `requestPause` / `requestStop` / `requestResume` / `cancelWake`
 *    each return a per-action discriminated union — the renderer
 *    mutation hook switches on `outcome` to drive the correct UI
 *    transition. No raw owner IDs ever leave main.
 *  - `controlStateEvent` is the broadcast schema for the puzzle-03
 *    event spine — fires after a committed transition so the renderer
 *    invalidates the session's runtime state.
 *
 * Field names match the canonical refs vocabulary in BUG-REPORTING.md
 * §3 so the Phase 2 BugReportSink can stamp `sessionId` /
 * `missionRunId` / `stop_reason` straight from these DTOs.
 */

import { z } from "zod";
import { missionRunStatusSchema } from "./sessions.js";

// ── DTO returned by runtime.getState ────────────────────────────────

export const runtimeStateDtoSchema = z
  .object({
    sessionId: z.string().uuid(),
    /**
     * `true` exactly when an active or paused mission run row exists
     * for the session. Agent-mode sessions (no missions) resolve to
     * `false` with the run-scoped fields all `null`.
     */
    hasActiveRun: z.boolean(),
    missionRunId: z.string().nullable(),
    /** `mission_runs.status` (puzzle 03 widens with `paused_user`). */
    status: missionRunStatusSchema.nullable(),
    stopReason: z.string().nullable(),
    lastCheckpointAt: z.string().datetime({ offset: true }).nullable(),
    startedAt: z.string().datetime({ offset: true }).nullable(),
    /**
     * The run's hard-deadline instant — `started_at + durationMinutes`, derived
     * from the FROZEN contract snapshot exactly as the engine's turn-loop
     * enforcer does (see `mission-deadline.ts` `resolveFrozenDeadlineMs`). Lets
     * the renderer show a live TIME LEFT countdown for a run whose draft has
     * already dropped out mid-run (the draft's `constraints.deadlineAt` is only
     * resolvable pre-start). `null` when no active run or the deadline can't be
     * derived (fail-soft — the timer degrades to elapsed-only, never NaN).
     */
    deadlineAt: z.string().datetime({ offset: true }).nullable(),
    /**
     * The run's effective time-box in whole minutes (the frozen
     * `durationMinutes` → env override → 60 default), i.e. the same value the
     * deadline + token budget are derived from. `null` when no active run.
     */
    durationMinutes: z.number().int().positive().nullable(),
    /**
     * The ENFORCED mission token budget for THIS run
     * (`durationMinutes × AGENT_MISSION_TOKENS_PER_MINUTE`, or an explicit
     * `AGENT_MISSION_TOKEN_BUDGET` override), computed by the shared
     * `resolveMissionTokenBudget` in main-process agent-config — the exact
     * denominator the turn-loop enforcer checks against. `null` when the budget
     * is disabled (0/off/…) or there is no active run.
     */
    tokenBudget: z.number().int().positive().nullable(),
    /**
     * Run-scoped tokens spent so far: `SUM(usage_log.total_tokens)` over the
     * session subtree with `created_at >= started_at` — the SAME run boundary
     * (`missionTokenSince`) the budget enforcer uses, so it resets per run
     * instead of climbing cumulatively across renewals. `null` when no active
     * run or the sum can't be read (fail-soft).
     */
    runTokensUsed: z.number().int().min(0).nullable(),
    /**
     * Run-scoped inference cost so far: `SUM(usage_log.cost)` over the same
     * run boundary as `runTokensUsed`. This is LLM provider billing (not
     * trading PnL). `null` when no active run or unreadable.
     */
    runCostUsd: z.number().min(0).nullable(),
    iterationCount: z.number().int().min(0).nullable(),
    /** `runner_leases` summary — bounded so owner IDs stay internal. */
    leaseActive: z.boolean(),
    leaseExpiresAt: z.string().datetime({ offset: true }).nullable(),
    /**
     * Topmost pending or observed control request kind for the
     * session, or `null` if none. Renderer uses this to gate the
     * pause/stop/resume buttons (`pending_resume` -> disable pause).
     */
    pendingControlKind: z
      .enum(["pause_after_step", "stop_terminal", "resume", "cancel_wake"])
      .nullable(),
  })
  .strict();
export type RuntimeStateDto = z.infer<typeof runtimeStateDtoSchema>;

// ── Inputs ──────────────────────────────────────────────────────────

export const runtimeRequestInputSchema = z
  .object({
    sessionId: z.string().uuid(),
  })
  .strict();
export type RuntimeRequestInput = z.infer<typeof runtimeRequestInputSchema>;

// ── Per-action result discriminated unions ──────────────────────────

export const runtimeRequestPauseResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({ outcome: z.literal("queued"), requestId: z.string().uuid() })
    .strict(),
  z
    .object({
      outcome: z.literal("already_pending"),
      requestId: z.string().uuid(),
    })
    .strict(),
  z.object({ outcome: z.literal("no_active_run") }).strict(),
  z
    .object({
      outcome: z.literal("already_paused"),
      status: missionRunStatusSchema,
    })
    .strict(),
  z
    .object({
      outcome: z.literal("terminal"),
      status: missionRunStatusSchema,
    })
    .strict(),
  /**
   * `status === 'running'` but the lease is NOT active — no runner is
   * observing, so enqueueing `pause_after_step` would be unobservable (it
   * would sit pending forever, same bug class as issue #12's stop dead-end).
   * The run is effectively already parked/idle; the safe next actions are
   * Resume/Retry (reclaim) or Stop (end).
   *
   * IPC-LEVEL CONTRACT, no renderer consumer yet: `runtime.requestPause` has
   * no call-site in the renderer today (`useRequestPause` is defined but
   * unused, and there is no Pause control in the UI). Like the sibling
   * `already_paused` outcome, this is a total-classification result the
   * handler must return; when a Pause control is added, map it to a neutral
   * "run is already parked — nothing to pause" notice, NOT an error. This
   * comment intentionally does NOT claim any current UI mapping.
   */
  z.object({ outcome: z.literal("already_parked") }).strict(),
]);
export type RuntimeRequestPauseResult = z.infer<typeof runtimeRequestPauseResultSchema>;

export const runtimeRequestStopResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({ outcome: z.literal("queued"), requestId: z.string().uuid() })
    .strict(),
  // A paused run is aborted directly (no runner to observe a queued stop).
  z.object({ outcome: z.literal("stopped") }).strict(),
  z
    .object({
      outcome: z.literal("already_terminal"),
      status: missionRunStatusSchema,
    })
    .strict(),
  z.object({ outcome: z.literal("no_active_run") }).strict(),
]);
export type RuntimeRequestStopResult = z.infer<typeof runtimeRequestStopResultSchema>;

export const runtimeRequestResumeResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({ outcome: z.literal("resumed"), runId: z.string() })
    .strict(),
  z
    .object({ outcome: z.literal("already_running"), runId: z.string() })
    .strict(),
  z.object({ outcome: z.literal("no_active_run") }).strict(),
  z
    .object({
      outcome: z.literal("blocked_approval"),
      pendingApprovalId: z.string(),
    })
    .strict(),
  z
    .object({ outcome: z.literal("blocked_error"), reason: z.string() })
    .strict(),
  z
    .object({
      outcome: z.literal("lease_busy"),
      retryAfterMs: z.number().int().nonnegative().optional(),
    })
    .strict(),
]);
export type RuntimeRequestResumeResult = z.infer<typeof runtimeRequestResumeResultSchema>;

export const runtimeCancelWakeResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("cancelled_wake"),
      cancelledCount: z.number().int().min(0),
    })
    .strict(),
  z.object({ outcome: z.literal("no_pending_wake") }).strict(),
]);
export type RuntimeCancelWakeResult = z.infer<typeof runtimeCancelWakeResultSchema>;

// ── Engine -> renderer control-state event ──────────────────────────

export const CONTROL_STATE_EVENT_TYPE = "engine.control.state" as const;

export const controlStateEventSchema = z
  .object({
    type: z.literal(CONTROL_STATE_EVENT_TYPE),
    sessionId: z.string().uuid(),
    /** `mission_runs.id` for the affected run, or `null` for session-only flows. */
    missionRunId: z.string().nullable(),
    /** Current status after the committed transition (or `null` if no run). */
    runStatus: missionRunStatusSchema.nullable(),
    /** Stop reason set by the transition, or `null`. */
    stopReason: z.string().nullable(),
    /** Topmost pending control request kind after the transition. */
    pendingControlKind: z
      .enum(["pause_after_step", "stop_terminal", "resume", "cancel_wake"])
      .nullable(),
    /** Lease summary — owner IDs intentionally NOT exposed. */
    leaseActive: z.boolean(),
    leaseExpiresAt: z.string().datetime({ offset: true }).nullable(),
    correlationId: z.string().nullable(),
  })
  .strict();
export type ControlStateEvent = z.infer<typeof controlStateEventSchema>;
