/**
 * Session-scoped plan-mode IPC contracts (the "HOW" that complements a mission's
 * "WHAT", and that also works in agent sessions).
 *
 * Authority is server-side (engine): `setEnabled`/`accept` verify the session
 * exists; a missing/cross session collapses to `not_found`. The renderer hides
 * controls for UX, but the engine is the gate. `accept` also resumes a
 * plan-acceptance-paused mission run (composed in the IPC handler via the shared
 * resume dispatcher) — `resumed` reports whether a run was resumed.
 */

import { z } from "zod";

const sessionId = z.string().uuid();

/** Snapshot of a session's plan-mode state for the renderer. */
export const planStateSchema = z
  .object({
    enabled: z.boolean(),
    planMd: z.string(),
    accepted: z.boolean(),
    acceptedAt: z.string().nullable(),
    updatedAt: z.string(),
  })
  .strict();
export type PlanState = z.infer<typeof planStateSchema>;

// ── plan.get ────────────────────────────────────────────────────
export const planGetInputSchema = z.object({ sessionId }).strict();
export type PlanGetInput = z.infer<typeof planGetInputSchema>;
/** null when plan-mode was never touched for the session. */
export const planGetResultSchema = planStateSchema.nullable();
export type PlanGetResult = z.infer<typeof planGetResultSchema>;

// ── plan.setEnabled ─────────────────────────────────────────────
export const planSetEnabledInputSchema = z
  .object({ sessionId, enabled: z.boolean() })
  .strict();
export type PlanSetEnabledInput = z.infer<typeof planSetEnabledInputSchema>;
export const planSetEnabledResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("updated"), state: planStateSchema }).strict(),
  z.object({ outcome: z.literal("not_found") }).strict(),
  /**
   * Refused: cannot turn plan-mode OFF while a mission run is paused awaiting
   * plan acceptance — the user must accept the plan (resumes) or stop the
   * mission first. Prevents stranding the paused run in an incoherent state.
   */
  z.object({ outcome: z.literal("blocked_pending_acceptance") }).strict(),
]);
export type PlanSetEnabledResult = z.infer<typeof planSetEnabledResultSchema>;

// ── plan.accept ─────────────────────────────────────────────────
export const planAcceptInputSchema = z
  .object({
    sessionId,
    /**
     * The plan markdown the user actually reviewed. Accept only succeeds if the
     * stored plan still matches (optimistic-concurrency guard) — a concurrent
     * `plan_write` that changed it yields `stale`, never accepting an unreviewed
     * version. Capped at the plan write cap (4000 chars) to bound the renderer
     * boundary, since the stored plan_md is itself capped on write.
     */
    expectedPlanMd: z.string().max(4000),
  })
  .strict();
export type PlanAcceptInput = z.infer<typeof planAcceptInputSchema>;
export const planAcceptResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("accepted"),
      state: planStateSchema,
      /** True when a plan-acceptance-paused mission run was resumed. */
      resumed: z.boolean(),
    })
    .strict(),
  z.object({ outcome: z.literal("not_found") }).strict(),
  z.object({ outcome: z.literal("no_plan") }).strict(),
  /** The plan changed since the user reviewed it — re-review and accept again. */
  z.object({ outcome: z.literal("stale") }).strict(),
]);
export type PlanAcceptResult = z.infer<typeof planAcceptResultSchema>;
