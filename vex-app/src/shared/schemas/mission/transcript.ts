/**
 * Transcript + lineage commands — `rewind`, `restore`, `renew`.
 *
 * Rewind archives the suffix from the Nth-most-recent user message
 * onwards; restore unarchives the latest unrestored rewind
 * checkpoint (LIFO, idempotent on `idempotencyKey`); renew clones
 * a terminal accepted mission into a fresh draft.
 */

import { z } from "zod";
import { sessionIdField, missionIdField } from "./_common.js";

// ── rewind ──────────────────────────────────────────────────────

export const missionRewindInputSchema = z
  .object({
    sessionId: sessionIdField,
    turns: z.number().int().min(1).max(50),
  })
  .strict();
export type MissionRewindInput = z.infer<typeof missionRewindInputSchema>;

export const missionRewindResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("rewound"),
      archivedMessages: z.number().int().nonnegative(),
      cutoffMessageId: z.number().int().positive().nullable(),
      checkpointId: z.string().min(1).nullable(),
      rejectedApprovals: z.number().int().nonnegative(),
      cancelledWakes: z.number().int().nonnegative(),
      missionRunImpact: z.enum(["none", "stopped", "blocked"]),
    })
    .strict(),
  z.object({ outcome: z.literal("noop") }).strict(),
  z
    .object({
      outcome: z.literal("blocked_active_run"),
      reason: z.string(),
    })
    .strict(),
]);
export type MissionRewindResult = z.infer<typeof missionRewindResultSchema>;

// ── restore ─────────────────────────────────────────────────────

export const missionRestoreInputSchema = z
  .object({
    sessionId: sessionIdField,
    /**
     * Client-generated UUID for idempotency. Same key replayed = no-op
     * success with the existing state. Different key = fresh restore
     * of the latest unrestored checkpoint.
     */
    idempotencyKey: z.string().uuid(),
  })
  .strict();
export type MissionRestoreInput = z.infer<typeof missionRestoreInputSchema>;

export const missionRestoreResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("restored"),
      checkpointId: z.string(),
      restoredAt: z.string().datetime({ offset: true }),
      restoredCount: z.number().int().nonnegative(),
      idempotencyKey: z.string(),
    })
    .strict(),
  z
    .object({
      outcome: z.literal("noop_already_restored"),
      checkpointId: z.string(),
      restoredAt: z.string().datetime({ offset: true }),
      restoredCount: z.number().int().nonnegative(),
      idempotencyKey: z.string(),
    })
    .strict(),
  z.object({ outcome: z.literal("no_checkpoint") }).strict(),
  z.object({ outcome: z.literal("session_not_found") }).strict(),
  z
    .object({
      outcome: z.literal("blocked_active_run"),
      missionRunId: z.string(),
      runStatus: z.string(),
    })
    .strict(),
  z
    .object({
      outcome: z.literal("blocked_pending_approval"),
      approvalId: z.string(),
    })
    .strict(),
  z
    .object({
      outcome: z.literal("lease_busy"),
      retryAfterMs: z.number().int().nonnegative().optional(),
    })
    .strict(),
]);
export type MissionRestoreResult = z.infer<typeof missionRestoreResultSchema>;

// ── renew ───────────────────────────────────────────────────────

export const missionRenewInputSchema = z
  .object({
    sessionId: sessionIdField,
    previousMissionId: missionIdField,
  })
  .strict();
export type MissionRenewInput = z.infer<typeof missionRenewInputSchema>;

export const missionRenewResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("renewed"),
      newMissionId: z.string(),
      sourceMissionId: z.string(),
    })
    .strict(),
  z.object({ outcome: z.literal("previous_mission_not_found") }).strict(),
  z
    .object({
      outcome: z.literal("session_mismatch"),
      expectedSessionId: z.string(),
    })
    .strict(),
  z
    .object({
      outcome: z.literal("not_accepted"),
      sourceMissionId: z.string(),
    })
    .strict(),
  z
    .object({
      outcome: z.literal("not_terminal_yet"),
      sourceMissionId: z.string(),
      missionRunId: z.string(),
      runStatus: z.string(),
    })
    .strict(),
  z
    .object({
      outcome: z.literal("session_has_active_run"),
      missionRunId: z.string(),
      runStatus: z.string(),
    })
    .strict(),
]);
export type MissionRenewResult = z.infer<typeof missionRenewResultSchema>;
