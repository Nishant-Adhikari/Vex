/**
 * Lockstep guard: SQL CHECK constraints ↔ TS `as const` arrays ↔ Zod options
 * for the `memory_jobs` / `memory_job_items` bounded-vocabulary columns (S1c).
 *
 * Three enums (`job_kind`, job `status`, `item_status`) each live in TWO places
 * that MUST stay identical:
 *   1. the named CHECK constraints in `db/migrations/001_initial.sql`
 *      (`mj_job_kind_valid` / `mj_status_valid` / `mji_item_status_valid`);
 *   2. the `as const` tuples + `z.enum(...)` in
 *      `vex-agent/memory/schema/memory-job-enums.ts`.
 *
 * This test parses the `IN (...)` value list out of each named CHECK and asserts
 * it equals the TS array AND the Zod `.options`. Doctrine: these are worker
 * mechanics only — no execution/sizing-coupling vocabulary.
 */

import { describe, it, expect } from "vitest";

import {
  MEMORY_JOB_KIND,
  MEMORY_JOB_STATUS,
  MEMORY_JOB_ITEM_STATUS,
  memoryJobKindSchema,
  memoryJobStatusSchema,
  memoryJobItemStatusSchema,
} from "@vex-agent/memory/schema/memory-job-enums.js";
import { MIGRATION_SQL, parseCheckInList, sorted } from "./_lockstep.js";

describe("memory-job enums ↔ 001_initial.sql CHECK lockstep", () => {
  it("job_kind CHECK equals MEMORY_JOB_KIND and schema.options", () => {
    const sqlValues = parseCheckInList(MIGRATION_SQL, "mj_job_kind_valid", "job_kind");
    expect(sorted(sqlValues)).toEqual(sorted(MEMORY_JOB_KIND));
    expect(sorted(sqlValues)).toEqual(sorted(memoryJobKindSchema.options));
    expect(memoryJobKindSchema.options).toEqual([...MEMORY_JOB_KIND]);
  });

  it("job status CHECK equals MEMORY_JOB_STATUS and schema.options", () => {
    const sqlValues = parseCheckInList(MIGRATION_SQL, "mj_status_valid", "status");
    expect(sorted(sqlValues)).toEqual(sorted(MEMORY_JOB_STATUS));
    expect(sorted(sqlValues)).toEqual(sorted(memoryJobStatusSchema.options));
    expect(memoryJobStatusSchema.options).toEqual([...MEMORY_JOB_STATUS]);
  });

  it("item_status CHECK equals MEMORY_JOB_ITEM_STATUS and schema.options", () => {
    const sqlValues = parseCheckInList(MIGRATION_SQL, "mji_item_status_valid", "item_status");
    expect(sorted(sqlValues)).toEqual(sorted(MEMORY_JOB_ITEM_STATUS));
    expect(sorted(sqlValues)).toEqual(sorted(memoryJobItemStatusSchema.options));
    expect(memoryJobItemStatusSchema.options).toEqual([...MEMORY_JOB_ITEM_STATUS]);
  });

  it("guards against a missing/renamed constraint (parser is fail-loud)", () => {
    expect(() => parseCheckInList(MIGRATION_SQL, "mj_does_not_exist", "status")).toThrow(
      /not found in 001_initial\.sql/,
    );
  });

  // Advisory-only doctrine (memory-system-v2 §6): the queue carries worker
  // mechanics only — never execution/sizing-coupling vocabulary.
  it("job enums carry no execution-coupling vocabulary (doctrine)", () => {
    const all: readonly string[] = [
      ...MEMORY_JOB_KIND,
      ...MEMORY_JOB_STATUS,
      ...MEMORY_JOB_ITEM_STATUS,
    ];
    expect(all).not.toContain("execution_constraint");
    expect(all).not.toContain("sizing_hint");
  });
});
