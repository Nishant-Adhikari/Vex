/**
 * Lineage commands — `renew`, `getRenewableSource`.
 *
 * Renew clones a terminal accepted mission into a fresh draft.
 *
 * Phase 7: `getRenewableSource` is a read-only resolver the renderer
 * calls before dispatching `renew` so the engine receives an explicit
 * `previousMissionId`. Latest-run semantics — see
 * `getRenewableSourceForSession` in `vex-app/src/main/database/missions-db.ts`.
 */

import { z } from "zod";
import { sessionIdField, missionIdField } from "./_common.js";

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

// ── getRenewableSource ──────────────────────────────────────────

export const missionGetRenewableSourceInputSchema = z
  .object({
    sessionId: sessionIdField,
  })
  .strict();
export type MissionGetRenewableSourceInput = z.infer<
  typeof missionGetRenewableSourceInputSchema
>;

/**
 * `null` when no terminal accepted mission exists for the session;
 * otherwise the missionId the renderer hands back to `mission.renew`.
 */
export const missionGetRenewableSourceResultSchema = z
  .object({ missionId: z.string().min(1) })
  .strict()
  .nullable();
export type MissionGetRenewableSourceResult = z.infer<
  typeof missionGetRenewableSourceResultSchema
>;
