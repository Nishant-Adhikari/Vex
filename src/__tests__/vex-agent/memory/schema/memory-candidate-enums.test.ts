/**
 * Lockstep guard: SQL CHECK constraints ↔ TS `as const` arrays ↔ Zod options
 * for the `memory_candidates` bounded-vocabulary columns (S1b).
 *
 * Five candidate enums (`proposed_by`, `sensitivity`, `evidence_strength`,
 * `retrieval_visibility`, `status`) plus the REUSED `source` provenance vocab
 * each live in TWO places that MUST stay identical:
 *   1. the named CHECK constraints in `db/migrations/001_initial.sql`
 *      (`mc_*_valid`), which the DB enforces at write time;
 *   2. the `as const` tuples + `z.enum(...)` in
 *      `vex-agent/memory/schema/memory-candidate-enums.ts` (and, for `source`,
 *      `vex-agent/memory/long-memory-source-policy.ts`).
 *
 * This test parses the `IN (...)` value list out of each named CHECK in the
 * SOURCE migration and asserts it equals the corresponding TS array AND the Zod
 * `.options`. Mirrors `long-memory-enums.test.ts`. Doctrine: the advisory-only
 * `source` set is exactly the four knowledge tiers, and candidates carry NO
 * influence/execution-coupling vocabulary.
 */

import { describe, it, expect } from "vitest";
import {
  CANDIDATE_PROPOSED_BY,
  CANDIDATE_SENSITIVITY,
  CANDIDATE_EVIDENCE_STRENGTH,
  CANDIDATE_RETRIEVAL_VISIBILITY,
  CANDIDATE_STATUS,
  candidateProposedBySchema,
  candidateSensitivitySchema,
  candidateEvidenceStrengthSchema,
  candidateRetrievalVisibilitySchema,
  candidateStatusSchema,
} from "@vex-agent/memory/schema/memory-candidate-enums.js";
import {
  KNOWLEDGE_SOURCES,
  knowledgeSourceSchema,
} from "@vex-agent/memory/long-memory-source-policy.js";
import { MIGRATION_SQL, parseCheckInList, sorted } from "./_lockstep.js";

describe("memory-candidate enums ↔ 001_initial.sql CHECK lockstep", () => {
  it("proposed_by CHECK equals CANDIDATE_PROPOSED_BY and schema.options", () => {
    const sqlValues = parseCheckInList(MIGRATION_SQL, "mc_proposed_by_valid", "proposed_by");
    expect(sorted(sqlValues)).toEqual(sorted(CANDIDATE_PROPOSED_BY));
    expect(sorted(sqlValues)).toEqual(sorted(candidateProposedBySchema.options));
    expect(candidateProposedBySchema.options).toEqual([...CANDIDATE_PROPOSED_BY]);
  });

  it("sensitivity CHECK equals CANDIDATE_SENSITIVITY and schema.options", () => {
    const sqlValues = parseCheckInList(MIGRATION_SQL, "mc_sensitivity_valid", "sensitivity");
    expect(sorted(sqlValues)).toEqual(sorted(CANDIDATE_SENSITIVITY));
    expect(sorted(sqlValues)).toEqual(sorted(candidateSensitivitySchema.options));
    expect(candidateSensitivitySchema.options).toEqual([...CANDIDATE_SENSITIVITY]);
  });

  it("evidence_strength CHECK equals CANDIDATE_EVIDENCE_STRENGTH and schema.options", () => {
    const sqlValues = parseCheckInList(
      MIGRATION_SQL,
      "mc_evidence_strength_valid",
      "evidence_strength",
    );
    expect(sorted(sqlValues)).toEqual(sorted(CANDIDATE_EVIDENCE_STRENGTH));
    expect(sorted(sqlValues)).toEqual(sorted(candidateEvidenceStrengthSchema.options));
    expect(candidateEvidenceStrengthSchema.options).toEqual([...CANDIDATE_EVIDENCE_STRENGTH]);
  });

  it("retrieval_visibility CHECK equals CANDIDATE_RETRIEVAL_VISIBILITY and schema.options", () => {
    const sqlValues = parseCheckInList(
      MIGRATION_SQL,
      "mc_retrieval_visibility_valid",
      "retrieval_visibility",
    );
    expect(sorted(sqlValues)).toEqual(sorted(CANDIDATE_RETRIEVAL_VISIBILITY));
    expect(sorted(sqlValues)).toEqual(sorted(candidateRetrievalVisibilitySchema.options));
    expect(candidateRetrievalVisibilitySchema.options).toEqual([
      ...CANDIDATE_RETRIEVAL_VISIBILITY,
    ]);
  });

  it("status CHECK equals CANDIDATE_STATUS and schema.options", () => {
    const sqlValues = parseCheckInList(MIGRATION_SQL, "mc_status_valid", "status");
    expect(sorted(sqlValues)).toEqual(sorted(CANDIDATE_STATUS));
    expect(sorted(sqlValues)).toEqual(sorted(candidateStatusSchema.options));
    expect(candidateStatusSchema.options).toEqual([...CANDIDATE_STATUS]);
  });

  it("source CHECK reuses KNOWLEDGE_SOURCES and knowledgeSourceSchema.options", () => {
    const sqlValues = parseCheckInList(MIGRATION_SQL, "mc_source_valid", "source");
    expect(sorted(sqlValues)).toEqual(sorted(KNOWLEDGE_SOURCES));
    expect(sorted(sqlValues)).toEqual(sorted(knowledgeSourceSchema.options));
    expect(knowledgeSourceSchema.options).toEqual([...KNOWLEDGE_SOURCES]);
  });

  it("guards against a missing/renamed constraint (parser is fail-loud)", () => {
    expect(() => parseCheckInList(MIGRATION_SQL, "mc_does_not_exist", "status")).toThrow(
      /not found in 001_initial\.sql/,
    );
  });

  // Advisory-only doctrine (memory-system-v2 §6): candidates carry NO
  // influence/execution-coupling vocabulary — those values live (bounded) on
  // knowledge_entries.influence_scope, never on a candidate column.
  it("candidates carry no influence-scope column (doctrine: no execution coupling)", () => {
    expect(() =>
      parseCheckInList(MIGRATION_SQL, "mc_influence_scope_valid", "influence_scope"),
    ).toThrow(/not found in 001_initial\.sql/);
    const sourceValues = parseCheckInList(MIGRATION_SQL, "mc_source_valid", "source");
    expect(sourceValues).not.toContain("execution_constraint");
    expect(sourceValues).not.toContain("sizing_hint");
  });
});
