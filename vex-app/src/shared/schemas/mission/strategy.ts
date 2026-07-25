/**
 * Self-improving strategy loop — transport schemas for the audit + control IPC.
 *
 * Read surface: the currently-active adaptive section, the pending-approval
 * queue, and the full version history (each row carrying the driving mission +
 * lessons + audit diff). Control surface: approve a pending revision, roll back
 * to a prior version, or reset to the human baseline.
 *
 * The bounds mirror the DB/guardrail clamps so a persisted row can never
 * overflow this schema and 500 a read.
 */

import { z } from "zod";

export const STRATEGY_CONTENT_MAX = 4_000;
export const STRATEGY_LESSON_MAX = 280;
export const STRATEGY_LESSON_LIST_MAX = 24;

export const strategyVersionDtoSchema = z
  .object({
    id: z.string().min(1),
    versionNo: z.number().int(),
    content: z.string().max(STRATEGY_CONTENT_MAX),
    status: z.enum(["baseline", "pending", "active", "archived", "rejected"]),
    isBaseline: z.boolean(),
    active: z.boolean(),
    drivingMissionRunId: z.string().nullable(),
    drivingLessons: z
      .array(z.string().max(STRATEGY_LESSON_MAX))
      .max(STRATEGY_LESSON_LIST_MAX),
    rejectionReason: z.string().nullable(),
    /** Diff (old→new), judge verdict, gate results — opaque audit payload. */
    audit: z.record(z.string(), z.unknown()),
    model: z.string().nullable(),
    createdAt: z.string(),
    activatedAt: z.string().nullable(),
  })
  .strict();
export type StrategyVersionDto = z.infer<typeof strategyVersionDtoSchema>;

// ── getStrategy — active version + pending queue snapshot ────────

export const missionGetStrategyInputSchema = z.object({}).strict();
export type MissionGetStrategyInput = z.infer<typeof missionGetStrategyInputSchema>;

export const missionGetStrategyResultSchema = z
  .object({
    active: strategyVersionDtoSchema.nullable(),
    pending: z.array(strategyVersionDtoSchema),
    /** Loop posture surfaced to the audit view. */
    enabled: z.boolean(),
    autoApprove: z.boolean(),
  })
  .strict();
export type MissionGetStrategyResult = z.infer<typeof missionGetStrategyResultSchema>;

// ── listStrategyVersions — full audit history ───────────────────

export const missionListStrategyVersionsInputSchema = z
  .object({ limit: z.number().int().min(1).max(200).optional() })
  .strict();
export type MissionListStrategyVersionsInput = z.infer<
  typeof missionListStrategyVersionsInputSchema
>;

export const missionListStrategyVersionsResultSchema = z
  .object({ versions: z.array(strategyVersionDtoSchema) })
  .strict();
export type MissionListStrategyVersionsResult = z.infer<
  typeof missionListStrategyVersionsResultSchema
>;

// ── approve / rollback — activate a specific version by id ───────

export const missionActivateStrategyInputSchema = z
  .object({ id: z.string().min(1) })
  .strict();
export type MissionActivateStrategyInput = z.infer<
  typeof missionActivateStrategyInputSchema
>;

export const missionActivateStrategyResultSchema = z
  .object({ active: strategyVersionDtoSchema.nullable() })
  .strict();
export type MissionActivateStrategyResult = z.infer<
  typeof missionActivateStrategyResultSchema
>;

// ── resetStrategyBaseline — re-activate the human seed ──────────

export const missionResetStrategyInputSchema = z.object({}).strict();
export type MissionResetStrategyInput = z.infer<
  typeof missionResetStrategyInputSchema
>;

export const missionResetStrategyResultSchema = z
  .object({ active: strategyVersionDtoSchema })
  .strict();
export type MissionResetStrategyResult = z.infer<
  typeof missionResetStrategyResultSchema
>;
