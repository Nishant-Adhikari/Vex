/**
 * Boundary-schema accept/reject tests for `memory_candidates` (S1b).
 *
 * Focus per S1b spec §7:
 * - `evidenceRefsSchema` / `evidenceAnchorSchema` (FIX-1): accept valid immutable
 *   anchors; reject a missing `executionId`, extra keys (incl. `proj_*`-style
 *   projection ids), and non-positive / non-int ids.
 * - `sourceRefsSchema` (MF3): accept pointer-only provenance; reject free-text,
 *   extra keys, and non-pointer payloads.
 * - `candidateSuggestInputSchema`: kind regex + defaults + strict top level.
 */

import { describe, it, expect } from "vitest";

import {
  evidenceAnchorSchema,
  evidenceRefsSchema,
  sourceRefsSchema,
  candidateSuggestInputSchema,
  CANDIDATE_EVIDENCE_REFS_MAX,
  CANDIDATE_SOURCE_REFS_MAX,
} from "@vex-agent/memory/schema/memory-candidate.js";

describe("evidenceAnchorSchema (FIX-1 immutable anchors)", () => {
  it("accepts a minimal anchor (executionId only)", () => {
    expect(evidenceAnchorSchema.safeParse({ executionId: 1 }).success).toBe(true);
  });

  it("accepts a fully-specified anchor with semantic keys", () => {
    const res = evidenceAnchorSchema.safeParse({
      executionId: 42,
      captureItemId: 7,
      instrumentKey: "SOL-PERP",
      positionKey: "pos:abc123",
    });
    expect(res.success).toBe(true);
  });

  it("rejects a missing executionId", () => {
    expect(evidenceAnchorSchema.safeParse({ captureItemId: 7 }).success).toBe(false);
  });

  it("rejects an extra key (proj_*-style projection id)", () => {
    // `.strict()` rejects any unknown key — including the unstable proj_* SERIALs
    // FIX-1 forbids anchoring on.
    expect(
      evidenceAnchorSchema.safeParse({ executionId: 1, projPositionId: 99 }).success,
    ).toBe(false);
    expect(
      evidenceAnchorSchema.safeParse({ executionId: 1, proj_open_position_id: 5 }).success,
    ).toBe(false);
  });

  it("rejects non-positive / non-integer executionId", () => {
    expect(evidenceAnchorSchema.safeParse({ executionId: 0 }).success).toBe(false);
    expect(evidenceAnchorSchema.safeParse({ executionId: -3 }).success).toBe(false);
    expect(evidenceAnchorSchema.safeParse({ executionId: 1.5 }).success).toBe(false);
    expect(evidenceAnchorSchema.safeParse({ executionId: "1" }).success).toBe(false);
  });

  it("rejects an empty / over-long semantic key", () => {
    expect(
      evidenceAnchorSchema.safeParse({ executionId: 1, instrumentKey: "" }).success,
    ).toBe(false);
    expect(
      evidenceAnchorSchema.safeParse({ executionId: 1, positionKey: "x".repeat(257) }).success,
    ).toBe(false);
  });
});

describe("evidenceRefsSchema (bounded anchor array)", () => {
  it("accepts an empty array and arrays of valid anchors", () => {
    expect(evidenceRefsSchema.safeParse([]).success).toBe(true);
    expect(
      evidenceRefsSchema.safeParse([{ executionId: 1 }, { executionId: 2, captureItemId: 3 }])
        .success,
    ).toBe(true);
  });

  it("rejects an array containing an invalid anchor", () => {
    expect(
      evidenceRefsSchema.safeParse([{ executionId: 1 }, { captureItemId: 2 }]).success,
    ).toBe(false);
  });

  it(`rejects more than ${CANDIDATE_EVIDENCE_REFS_MAX} anchors`, () => {
    const tooMany = Array.from({ length: CANDIDATE_EVIDENCE_REFS_MAX + 1 }, (_, i) => ({
      executionId: i + 1,
    }));
    expect(evidenceRefsSchema.safeParse(tooMany).success).toBe(false);
  });
});

describe("sourceRefsSchema (MF3 strict pointer-only provenance)", () => {
  it("accepts pointer-only payloads (messageIds / toolCallIds / both / empty)", () => {
    expect(sourceRefsSchema.safeParse({}).success).toBe(true);
    expect(sourceRefsSchema.safeParse({ messageIds: [1, 2, 3] }).success).toBe(true);
    expect(sourceRefsSchema.safeParse({ toolCallIds: ["call_abc", "tc-1.2:3"] }).success).toBe(
      true,
    );
    expect(
      sourceRefsSchema.safeParse({ messageIds: [10], toolCallIds: ["call_x"] }).success,
    ).toBe(true);
  });

  it("rejects free-text provenance (extra key)", () => {
    expect(
      sourceRefsSchema.safeParse({ note: "the user said to remember this" }).success,
    ).toBe(false);
    expect(
      sourceRefsSchema.safeParse({ transcript: "a free-form provenance blob" }).success,
    ).toBe(false);
  });

  it("rejects an extra key alongside valid pointers", () => {
    expect(
      sourceRefsSchema.safeParse({ messageIds: [1], source: "manual" }).success,
    ).toBe(false);
  });

  it("rejects non-pointer values (free-text or bad-shape ids)", () => {
    // messageIds must be positive ints — strings / negatives / floats rejected.
    expect(sourceRefsSchema.safeParse({ messageIds: ["1"] }).success).toBe(false);
    expect(sourceRefsSchema.safeParse({ messageIds: [-1] }).success).toBe(false);
    expect(sourceRefsSchema.safeParse({ messageIds: [1.5] }).success).toBe(false);
    // toolCallIds must match the bounded token charset — whitespace/free-text rejected.
    expect(sourceRefsSchema.safeParse({ toolCallIds: ["has spaces"] }).success).toBe(false);
    expect(
      sourceRefsSchema.safeParse({ toolCallIds: ["the user mentioned X"] }).success,
    ).toBe(false);
  });

  it(`rejects more than ${CANDIDATE_SOURCE_REFS_MAX} pointers`, () => {
    const tooMany = Array.from({ length: CANDIDATE_SOURCE_REFS_MAX + 1 }, (_, i) => i + 1);
    expect(sourceRefsSchema.safeParse({ messageIds: tooMany }).success).toBe(false);
  });
});

describe("candidateSuggestInputSchema", () => {
  const base = { kind: "trade_lesson", title: "Lesson title", summary: "A short summary." };

  it("accepts a minimal valid input and applies defaults", () => {
    const res = candidateSuggestInputSchema.safeParse(base);
    expect(res.success).toBe(true);
    if (!res.success) throw new Error("unreachable");
    expect(res.data.contentMd).toBe("");
    expect(res.data.entities).toEqual([]);
    expect(res.data.tags).toEqual([]);
    expect(res.data.sourceRefs).toEqual({});
    expect(res.data.evidenceRefs).toEqual([]);
    expect(res.data.importance).toBe(5);
  });

  it("accepts a fully-specified input incl. evidence + source pointers + point-in-time", () => {
    const res = candidateSuggestInputSchema.safeParse({
      ...base,
      contentMd: "details",
      entities: ["SOL"],
      tags: ["risk"],
      sourceRefs: { messageIds: [1, 2], toolCallIds: ["call_a"] },
      evidenceRefs: [{ executionId: 1, instrumentKey: "SOL-PERP" }],
      confidence: 0.75,
      importance: 8,
      eventTime: "2026-06-08T00:00:00.000Z",
      observedAt: "2026-06-08T01:00:00.000Z",
    });
    expect(res.success).toBe(true);
  });

  it("rejects an invalid kind (not snake_case)", () => {
    expect(candidateSuggestInputSchema.safeParse({ ...base, kind: "BadKind" }).success).toBe(
      false,
    );
    expect(candidateSuggestInputSchema.safeParse({ ...base, kind: "kebab-case" }).success).toBe(
      false,
    );
    expect(candidateSuggestInputSchema.safeParse({ ...base, kind: "1leading" }).success).toBe(
      false,
    );
  });

  it("rejects confidence / importance out of range", () => {
    expect(candidateSuggestInputSchema.safeParse({ ...base, confidence: 1.5 }).success).toBe(
      false,
    );
    expect(candidateSuggestInputSchema.safeParse({ ...base, importance: 0 }).success).toBe(false);
    expect(candidateSuggestInputSchema.safeParse({ ...base, importance: 11 }).success).toBe(false);
  });

  it("rejects an unknown top-level key (.strict)", () => {
    expect(
      candidateSuggestInputSchema.safeParse({ ...base, source: "user_confirmed" }).success,
    ).toBe(false);
    expect(
      candidateSuggestInputSchema.safeParse({ ...base, embedding: [0.1, 0.2] }).success,
    ).toBe(false);
  });
});
