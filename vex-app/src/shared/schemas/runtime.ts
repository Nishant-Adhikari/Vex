/**
 * Runtime schemas — durable control plane for active mission runs.
 *
 * `getState` resolves the active row from `mission_runs` for a given
 * session (statuses `running`/`paused_approval`/`paused_wake`/
 * `paused_error`). The renderer reads this to gate the composer +
 * pause/stop/resume buttons. The control mutations (`requestPause`,
 * `requestStop`, `requestResume`, `cancelWake`) fail closed with
 * `runtime.feature_unavailable` until puzzle 03 lands the DB-backed
 * control plane + runner leases — there is no in-memory shortcut.
 *
 * Field names match the canonical refs vocabulary in
 * `BUG-REPORTING.md §3` so Phase 2 BugReportSink can stamp
 * `sessionId`/`missionRunId`/`stop_reason` straight from this DTO.
 */

import { z } from "zod";
import { missionRunStatusSchema } from "./sessions.js";

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
    /** `mission_runs.status` (puzzle 03 widens this with `paused_user`). */
    status: missionRunStatusSchema.nullable(),
    stopReason: z.string().nullable(),
    lastCheckpointAt: z.string().datetime({ offset: true }).nullable(),
    startedAt: z.string().datetime({ offset: true }).nullable(),
    iterationCount: z.number().int().min(0).nullable(),
  })
  .strict();
export type RuntimeStateDto = z.infer<typeof runtimeStateDtoSchema>;

export const runtimeRequestInputSchema = z
  .object({
    sessionId: z.string().uuid(),
  })
  .strict();
export type RuntimeRequestInput = z.infer<typeof runtimeRequestInputSchema>;

/**
 * Mutating runtime requests return this shape today only as a Zod
 * placeholder for the eventual puzzle-03 surface. Puzzle 1 handlers
 * never return `ok(...)` — they always return
 * `err(runtime.feature_unavailable)`. The schema is exported so the
 * preload + renderer hook surface compiles end-to-end and so puzzle 03
 * can swap the handler bodies without changing the contract.
 */
export const runtimeRequestResultSchema = z
  .object({
    status: z.enum(["queued", "already_terminal", "unavailable"]),
    missionRunId: z.string().nullable(),
    message: z.string(),
  })
  .strict();
export type RuntimeRequestResult = z.infer<typeof runtimeRequestResultSchema>;
