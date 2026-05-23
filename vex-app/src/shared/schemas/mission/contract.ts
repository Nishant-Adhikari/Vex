/**
 * Contract surface commands — `acceptContract`, `getDiff`,
 * `updateDraft`. Each command pair (input + result) maps 1:1 against
 * the engine outcome literal so the renderer's mutation hook can
 * `switch` on `outcome` to drive UI state.
 */

import { z } from "zod";
import { sessionIdField, missionIdField } from "./_common.js";

// ── acceptContract ──────────────────────────────────────────────

export const missionAcceptContractInputSchema = z
  .object({
    sessionId: sessionIdField,
    missionId: missionIdField,
    /** Hash the renderer computed + showed to the user (sha-256 hex). */
    contractHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type MissionAcceptContractInput = z.infer<
  typeof missionAcceptContractInputSchema
>;

export const missionAcceptContractResultSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        outcome: z.literal("accepted"),
        missionId: z.string(),
        acceptedContractHash: z.string(),
        acceptedAt: z.string().datetime({ offset: true }),
        acceptedBy: z.string(),
        contractHashVersion: z.number().int().min(1),
      })
      .strict(),
    z.object({ outcome: z.literal("mission_not_found") }).strict(),
    z
      .object({
        outcome: z.literal("session_mismatch"),
        expectedSessionId: z.string(),
      })
      .strict(),
    z
      .object({
        outcome: z.literal("hash_mismatch"),
        providedHash: z.string(),
        currentHash: z.string(),
      })
      .strict(),
    z
      .object({
        outcome: z.literal("status_blocked"),
        currentStatus: z.string(),
      })
      .strict(),
    z
      .object({
        outcome: z.literal("run_active"),
        missionRunId: z.string(),
        runStatus: z.string(),
      })
      .strict(),
  ],
);
export type MissionAcceptContractResult = z.infer<
  typeof missionAcceptContractResultSchema
>;

// ── getDiff ─────────────────────────────────────────────────────

export const missionGetDiffInputSchema = z
  .object({
    sessionId: sessionIdField,
    missionId: missionIdField,
  })
  .strict();
export type MissionGetDiffInput = z.infer<typeof missionGetDiffInputSchema>;

export const missionGetDiffResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("ready"),
      missionId: z.string(),
      sessionId: z.string(),
      currentHash: z.string(),
      contractHashVersion: z.number().int().min(1),
      acceptedHash: z.string().nullable(),
      acceptedAt: z.string().datetime({ offset: true }).nullable(),
      acceptedBy: z.string().nullable(),
      acceptedContractHashVersion: z.number().int().min(1).nullable(),
      isAccepted: z.boolean(),
      isDirty: z.boolean(),
    })
    .strict(),
  z.object({ outcome: z.literal("mission_not_found") }).strict(),
  z
    .object({
      outcome: z.literal("session_mismatch"),
      expectedSessionId: z.string(),
    })
    .strict(),
]);
export type MissionGetDiffResult = z.infer<typeof missionGetDiffResultSchema>;

// ── updateDraft (fail-closed in phase 6) ─────────────────────────

export const missionUpdateDraftInputSchema = z
  .object({ sessionId: sessionIdField })
  .strict();
export type MissionUpdateDraftInput = z.infer<
  typeof missionUpdateDraftInputSchema
>;

/**
 * Phase 6 leaves the host-side updateDraft path fail-closed because
 * no UI calls it yet (the structured setup form lands in phase 7+).
 * The model-driven `mission_draft_update` tool path is unaffected.
 *
 * The result schema keeps the same `outcome` discriminator shape as
 * the live commands so the renderer can switch identically once the
 * handler ships.
 */
export const missionUpdateDraftResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("unavailable") }).strict(),
]);
export type MissionUpdateDraftResult = z.infer<
  typeof missionUpdateDraftResultSchema
>;
