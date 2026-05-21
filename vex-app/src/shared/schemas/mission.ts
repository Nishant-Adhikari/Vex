/**
 * Mission schemas — draft + contract + command surface.
 *
 * `getDraft` is read-only and reads the latest `status = 'draft'` row
 * from `missions` for a session. The mapper validates each JSONB column
 * (`constraints_json`, `success_criteria_json`, `stop_conditions_json`)
 * through this file's Zod shapes — unparseable payloads collapse to a
 * safe default with a structural log line so the renderer never sees
 * raw passthrough.
 *
 * Every mutating command (`updateDraft`, `acceptContract`, `start`,
 * `continue`, `recover`, `rewind`, `restore`, `renew`, `stop`) and
 * `getDiff` fail closed with `mission.feature_unavailable` until
 * puzzle 04 lands host-only acceptance + the command runtime. The
 * Result-typed contracts ship now so the renderer hook surface +
 * preload bridge compile against the eventual shape.
 *
 * Field names match the canonical refs vocabulary in
 * `BUG-REPORTING.md §3` (`sessionId`, `missionId`).
 */

import { z } from "zod";

export const MISSION_DRAFT_TITLE_MAX = 200;
export const MISSION_DRAFT_GOAL_MAX = 4000;
export const MISSION_DRAFT_LIST_MAX = 32;
export const MISSION_DRAFT_LIST_ITEM_MAX = 500;

/**
 * Renderer-visible mission lifecycle status. Mirrors the DB CHECK in
 * `missions.status`, extended with the runtime statuses the renderer
 * uses to render badges. Puzzle 04 may add `ready` once the host-only
 * acceptance gate exists; for now the read-only handler only returns
 * `draft` rows.
 */
export const missionStatusSchema = z.enum([
  "draft",
  "ready",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type MissionStatus = z.infer<typeof missionStatusSchema>;

/**
 * Allowlist for `missions.constraints_json`. JSONB column is freeform
 * by DB schema but the renderer only consumes a small set of fields;
 * unknown keys are dropped silently by the mapper. `.passthrough()` is
 * intentionally avoided — every key that crosses the boundary must be
 * named here.
 */
export const missionConstraintsSchema = z
  .object({
    maxSpendUsd: z.number().nullable().optional(),
    maxLossUsd: z.number().nullable().optional(),
    maxIterations: z.number().int().min(0).nullable().optional(),
    deadlineAt: z.string().datetime({ offset: true }).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();
export type MissionConstraints = z.infer<typeof missionConstraintsSchema>;

/** One string entry in `success_criteria_json` / `stop_conditions_json`. */
export const missionListEntrySchema = z
  .string()
  .trim()
  .min(1)
  .max(MISSION_DRAFT_LIST_ITEM_MAX);

export const missionDraftDtoSchema = z
  .object({
    missionId: z.string(),
    sessionId: z.string().uuid(),
    status: missionStatusSchema,
    title: z.string().max(MISSION_DRAFT_TITLE_MAX).nullable(),
    goal: z.string().max(MISSION_DRAFT_GOAL_MAX).nullable(),
    constraints: missionConstraintsSchema,
    successCriteria: z.array(missionListEntrySchema).max(MISSION_DRAFT_LIST_MAX),
    stopConditions: z.array(missionListEntrySchema).max(MISSION_DRAFT_LIST_MAX),
    riskProfile: z.string().max(64).nullable(),
    allowedChains: z.array(z.string().max(64)).max(MISSION_DRAFT_LIST_MAX),
    allowedProtocols: z.array(z.string().max(64)).max(MISSION_DRAFT_LIST_MAX),
    allowedWallets: z.array(z.string().max(128)).max(MISSION_DRAFT_LIST_MAX),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    approvedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export type MissionDraftDto = z.infer<typeof missionDraftDtoSchema>;

export const missionGetDraftInputSchema = z
  .object({
    sessionId: z.string().uuid(),
  })
  .strict();
export type MissionGetDraftInput = z.infer<typeof missionGetDraftInputSchema>;

export const missionGetDraftResultSchema = missionDraftDtoSchema.nullable();
export type MissionGetDraftResult = z.infer<typeof missionGetDraftResultSchema>;

/**
 * Generic input shape for mission commands. Puzzle 04 may add
 * command-specific fields (e.g. `rewind.turns`, `restore.checkpointId`,
 * `acceptContract.contractHash`); the puzzle-1 fail-closed handler
 * doesn't read them — it only echoes the sessionId in its error
 * message so the renderer can label the disabled action.
 */
export const missionCommandInputSchema = z
  .object({
    sessionId: z.string().uuid(),
  })
  .strict();
export type MissionCommandInput = z.infer<typeof missionCommandInputSchema>;

export const missionCommandResultSchema = z
  .object({
    status: z.enum(["queued", "already_terminal", "unavailable"]),
    missionRunId: z.string().nullable(),
    message: z.string(),
  })
  .strict();
export type MissionCommandResult = z.infer<typeof missionCommandResultSchema>;
