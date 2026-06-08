/**
 * Lockstep guard: SQL CHECK constraints ↔ TS `as const` arrays ↔ Zod options
 * for the `memory_decisions` bounded-vocabulary columns (S1c).
 *
 * Three enums (`decision_type`, `reject_reason`, `decided_by`) each live in TWO
 * places that MUST stay identical:
 *   1. the named CHECK constraints in `db/migrations/001_initial.sql`
 *      (`md_decision_type_valid` / `md_reject_reason_valid` / `md_decided_by_valid`);
 *   2. the `as const` tuples + `z.enum(...)` in
 *      `vex-agent/memory/schema/memory-decision-enums.ts`.
 *
 * `reject_reason` is nullable; its CHECK is written `reject_reason IN (...)`
 * (NULL → the IN evaluates to NULL → CHECK passes), so the shared parser reads
 * it like any other column. Doctrine: decision types are ADVISORY verdicts —
 * no execution/sizing-coupling vocabulary.
 */

import { describe, it, expect } from "vitest";

import {
  MEMORY_DECISION_TYPE,
  MEMORY_DECISION_REJECT_REASON,
  MEMORY_DECISION_ACTOR,
  memoryDecisionTypeSchema,
  memoryDecisionRejectReasonSchema,
  memoryDecisionActorSchema,
} from "@vex-agent/memory/schema/memory-decision-enums.js";
import { MIGRATION_SQL, parseCheckInList, sorted } from "./_lockstep.js";

describe("memory-decision enums ↔ 001_initial.sql CHECK lockstep", () => {
  it("decision_type CHECK equals MEMORY_DECISION_TYPE and schema.options", () => {
    const sqlValues = parseCheckInList(MIGRATION_SQL, "md_decision_type_valid", "decision_type");
    expect(sorted(sqlValues)).toEqual(sorted(MEMORY_DECISION_TYPE));
    expect(sorted(sqlValues)).toEqual(sorted(memoryDecisionTypeSchema.options));
    expect(memoryDecisionTypeSchema.options).toEqual([...MEMORY_DECISION_TYPE]);
  });

  it("reject_reason CHECK equals MEMORY_DECISION_REJECT_REASON and schema.options", () => {
    const sqlValues = parseCheckInList(MIGRATION_SQL, "md_reject_reason_valid", "reject_reason");
    expect(sorted(sqlValues)).toEqual(sorted(MEMORY_DECISION_REJECT_REASON));
    expect(sorted(sqlValues)).toEqual(sorted(memoryDecisionRejectReasonSchema.options));
    expect(memoryDecisionRejectReasonSchema.options).toEqual([...MEMORY_DECISION_REJECT_REASON]);
  });

  it("decided_by CHECK equals MEMORY_DECISION_ACTOR and schema.options", () => {
    const sqlValues = parseCheckInList(MIGRATION_SQL, "md_decided_by_valid", "decided_by");
    expect(sorted(sqlValues)).toEqual(sorted(MEMORY_DECISION_ACTOR));
    expect(sorted(sqlValues)).toEqual(sorted(memoryDecisionActorSchema.options));
    expect(memoryDecisionActorSchema.options).toEqual([...MEMORY_DECISION_ACTOR]);
  });

  it("guards against a missing/renamed constraint (parser is fail-loud)", () => {
    expect(() => parseCheckInList(MIGRATION_SQL, "md_does_not_exist", "decision_type")).toThrow(
      /not found in 001_initial\.sql/,
    );
  });

  // Advisory-only doctrine (memory-system-v2 §6): decision types are advisory
  // verdicts; reject reasons are a closed audit vocabulary. No execution coupling.
  it("decision enums carry no execution-coupling vocabulary (doctrine)", () => {
    const all: readonly string[] = [
      ...MEMORY_DECISION_TYPE,
      ...MEMORY_DECISION_REJECT_REASON,
      ...MEMORY_DECISION_ACTOR,
    ];
    expect(all).not.toContain("execution_constraint");
    expect(all).not.toContain("sizing_hint");
  });
});
