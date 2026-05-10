/**
 * Schemas for the `vex.database.*` IPC surface (M6).
 *
 * Result envelope is success-only — migration FAILURE is surfaced as
 * `err({ code: "data.migration_failed", domain: "database", details: { failedAt } })`,
 * NOT as `ok({ kind: "failed" })`. Two parallel error channels would
 * confuse callers and break `Result<T, VexError>` semantics (codex turn 1
 * RED #1).
 */

import { z } from "zod";

export const migrateInputSchema = z.object({}).strict();
export type MigrateInput = z.infer<typeof migrateInputSchema>;

export const migrateResultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("applied"),
      applied: z.number().int().nonnegative(),
      files: z.array(z.string()).readonly(),
      message: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("noop"),
      message: z.string(),
    })
    .strict(),
]);
export type MigrateResult = z.infer<typeof migrateResultSchema>;

export const migrateProgressPhaseSchema = z.enum(["planned", "start", "applied"]);
export type MigrateProgressPhase = z.infer<typeof migrateProgressPhaseSchema>;

export const migrateProgressSchema = z
  .object({
    phase: migrateProgressPhaseSchema,
    index: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    version: z.number().int().nonnegative(),
    file: z.string(),
    ts: z.number(),
  })
  .strict();
export type MigrateProgress = z.infer<typeof migrateProgressSchema>;
