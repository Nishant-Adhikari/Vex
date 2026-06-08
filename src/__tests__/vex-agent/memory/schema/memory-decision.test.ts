/**
 * Boundary-schema accept/reject tests for `recordDecisionInputSchema` (S1c).
 *
 * The discriminated union mirrors the DB CHECKs (md_anchor_xor +
 * md_reconcile_type + md_reconcile_fields + md_reject_reason_scope):
 *   - candidate XOR reconcile anchor (`.strict()` rejects the wrong anchor);
 *   - rejectReason required IFF reject/expire;
 *   - outcomeVersion present IFF reconcile.
 */

import { describe, it, expect } from "vitest";

import { recordDecisionInputSchema } from "@vex-agent/memory/schema/memory-decision.js";

const CANDIDATE_ID = "11111111-1111-4111-8111-111111111111";

describe("recordDecisionInputSchema — candidate decisions", () => {
  it("accepts promote with a candidate anchor and applies defaults", () => {
    const res = recordDecisionInputSchema.safeParse({
      decisionType: "promote",
      candidateId: CANDIDATE_ID,
      jobId: 1,
      promotedKnowledgeId: 42,
    });
    expect(res.success).toBe(true);
    if (!res.success) throw new Error("unreachable");
    expect(res.data.decisionVersion).toBe(0);
    expect(res.data.evidenceRefs).toEqual([]);
  });

  it("accepts retain/supersede/merge with a candidate anchor", () => {
    for (const decisionType of ["retain", "supersede", "merge"] as const) {
      expect(
        recordDecisionInputSchema.safeParse({ decisionType, candidateId: CANDIDATE_ID, jobId: 1 })
          .success,
      ).toBe(true);
    }
  });

  it("accepts reject/expire WITH a rejectReason", () => {
    expect(
      recordDecisionInputSchema.safeParse({
        decisionType: "reject",
        candidateId: CANDIDATE_ID,
        jobId: 1,
        rejectReason: "secret_or_live_state",
      }).success,
    ).toBe(true);
    expect(
      recordDecisionInputSchema.safeParse({
        decisionType: "expire",
        candidateId: CANDIDATE_ID,
        jobId: 1,
        rejectReason: "expired_ttl",
      }).success,
    ).toBe(true);
  });

  it("rejects reject/expire WITHOUT a rejectReason", () => {
    expect(
      recordDecisionInputSchema.safeParse({
        decisionType: "reject",
        candidateId: CANDIDATE_ID,
        jobId: 1,
      }).success,
    ).toBe(false);
  });

  it("rejects a non-reject decision carrying a rejectReason (.strict)", () => {
    expect(
      recordDecisionInputSchema.safeParse({
        decisionType: "promote",
        candidateId: CANDIDATE_ID,
        jobId: 1,
        rejectReason: "policy",
      }).success,
    ).toBe(false);
  });

  it("rejects a bad rejectReason value", () => {
    expect(
      recordDecisionInputSchema.safeParse({
        decisionType: "reject",
        candidateId: CANDIDATE_ID,
        jobId: 1,
        rejectReason: "not_a_reason",
      }).success,
    ).toBe(false);
  });

  it("rejects a candidate decision carrying reconcile fields (XOR)", () => {
    expect(
      recordDecisionInputSchema.safeParse({
        decisionType: "promote",
        candidateId: CANDIDATE_ID,
        jobId: 1,
        reconcileEntryId: 7,
      }).success,
    ).toBe(false);
    expect(
      recordDecisionInputSchema.safeParse({
        decisionType: "promote",
        candidateId: CANDIDATE_ID,
        jobId: 1,
        outcomeVersion: 2,
      }).success,
    ).toBe(false);
  });

  it("rejects a missing candidateId / a non-uuid candidateId", () => {
    expect(
      recordDecisionInputSchema.safeParse({ decisionType: "promote", jobId: 1 }).success,
    ).toBe(false);
    expect(
      recordDecisionInputSchema.safeParse({
        decisionType: "promote",
        candidateId: "not-a-uuid",
        jobId: 1,
      }).success,
    ).toBe(false);
  });

  it("rejects a missing jobId", () => {
    expect(
      recordDecisionInputSchema.safeParse({ decisionType: "promote", candidateId: CANDIDATE_ID })
        .success,
    ).toBe(false);
  });
});

describe("recordDecisionInputSchema — reconcile decisions", () => {
  it("accepts reconcile with reconcileEntryId + outcomeVersion (no candidate)", () => {
    const res = recordDecisionInputSchema.safeParse({
      decisionType: "reconcile",
      reconcileEntryId: 9,
      outcomeVersion: 3,
      jobId: 1,
    });
    expect(res.success).toBe(true);
  });

  it("accepts outcomeVersion 0 (initial reconcile)", () => {
    expect(
      recordDecisionInputSchema.safeParse({
        decisionType: "reconcile",
        reconcileEntryId: 9,
        outcomeVersion: 0,
        jobId: 1,
      }).success,
    ).toBe(true);
  });

  it("rejects reconcile WITHOUT outcomeVersion", () => {
    expect(
      recordDecisionInputSchema.safeParse({
        decisionType: "reconcile",
        reconcileEntryId: 9,
        jobId: 1,
      }).success,
    ).toBe(false);
  });

  it("rejects reconcile WITHOUT reconcileEntryId", () => {
    expect(
      recordDecisionInputSchema.safeParse({
        decisionType: "reconcile",
        outcomeVersion: 3,
        jobId: 1,
      }).success,
    ).toBe(false);
  });

  it("rejects reconcile carrying a candidate anchor (XOR, .strict)", () => {
    expect(
      recordDecisionInputSchema.safeParse({
        decisionType: "reconcile",
        reconcileEntryId: 9,
        outcomeVersion: 3,
        candidateId: CANDIDATE_ID,
        jobId: 1,
      }).success,
    ).toBe(false);
  });

  it("rejects reconcile carrying a rejectReason (.strict)", () => {
    expect(
      recordDecisionInputSchema.safeParse({
        decisionType: "reconcile",
        reconcileEntryId: 9,
        outcomeVersion: 3,
        jobId: 1,
        rejectReason: "policy",
      }).success,
    ).toBe(false);
  });
});

describe("recordDecisionInputSchema — discriminator", () => {
  it("rejects an unknown decisionType", () => {
    expect(
      recordDecisionInputSchema.safeParse({
        decisionType: "archive",
        candidateId: CANDIDATE_ID,
        jobId: 1,
      }).success,
    ).toBe(false);
  });
});
