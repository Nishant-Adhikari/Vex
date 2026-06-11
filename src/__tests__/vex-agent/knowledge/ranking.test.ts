import { describe, it, expect } from "vitest";
import { scoreRecallCandidate, type RecallCandidate } from "@vex-agent/knowledge/ranking.js";

const NOW = new Date("2026-04-06T12:00:00Z");

function candidate(overrides: Partial<RecallCandidate>): RecallCandidate {
  return {
    id: 1,
    kind: "memo",
    title: "test",
    summary: "test summary",
    contentMd: "test content",
    similarity: 0.5,
    confidence: null,
    status: "active",
    pinned: false,
    validUntil: null,
    validFrom: NOW,
    updatedAt: NOW,
    sourceRefs: {},
    tags: [],
    ...overrides,
  };
}

describe("scoreRecallCandidate", () => {
  // ── Boost contributions ──────────────────────────────────────

  it("pinned beats higher-similarity unpinned", () => {
    // pinned boost is 0.20; unpinned similarity diff of 0.1 should not overcome it
    const pinned = candidate({ id: 1, similarity: 0.6, pinned: true });
    const unpinned = candidate({ id: 2, similarity: 0.7, pinned: false });
    expect(scoreRecallCandidate(pinned, NOW)).toBeGreaterThan(scoreRecallCandidate(unpinned, NOW));
  });

  it("recency boost prefers newer for equal similarity", () => {
    const old = candidate({
      id: 1,
      similarity: 0.5,
      updatedAt: new Date("2026-03-01T00:00:00Z"), // ~36 days old
    });
    const fresh = candidate({
      id: 2,
      similarity: 0.5,
      updatedAt: NOW,
    });
    expect(scoreRecallCandidate(fresh, NOW)).toBeGreaterThan(scoreRecallCandidate(old, NOW));
  });

  it("confidence boost prefers higher confidence for equal similarity", () => {
    const lowConf = candidate({ id: 1, similarity: 0.5, confidence: 0.1 });
    const highConf = candidate({ id: 2, similarity: 0.5, confidence: 0.9 });
    expect(scoreRecallCandidate(highConf, NOW)).toBeGreaterThan(scoreRecallCandidate(lowConf, NOW));
  });

  it("null confidence does not crash", () => {
    const a = candidate({ id: 1, confidence: null });
    const b = candidate({ id: 2, confidence: 0.5 });
    expect(Number.isFinite(scoreRecallCandidate(a, NOW))).toBe(true);
    expect(Number.isFinite(scoreRecallCandidate(b, NOW))).toBe(true);
  });

  // ── No kind weight (regression guard) ────────────────────────

  it("does not boost or penalize based on kind value", () => {
    // Two candidates: identical except kind. Score must be identical.
    const a = candidate({ id: 1, kind: "risk_rule" });
    const b = candidate({ id: 2, kind: "memo" });
    expect(scoreRecallCandidate(a, NOW)).toBe(scoreRecallCandidate(b, NOW));
  });

  // ── Score sanity ─────────────────────────────────────────────

  it("similarity is clamped to [0,1]", () => {
    const negative = candidate({ id: 1, similarity: -0.5 });
    const over = candidate({ id: 2, similarity: 1.5 });
    expect(scoreRecallCandidate(negative, NOW)).toBeGreaterThanOrEqual(0);
    expect(scoreRecallCandidate(over, NOW)).toBeLessThanOrEqual(1 + 0.15 + 0.1 + 0.2);
  });

  it("score includes raw similarity component", () => {
    // No boosts beyond similarity itself
    const c = candidate({
      id: 1,
      similarity: 0.7,
      pinned: false,
      confidence: null,
      updatedAt: new Date("2020-01-01T00:00:00Z"), // very old, decay ≈ 0
    });
    const score = scoreRecallCandidate(c, NOW);
    // similarity 0.7 + tiny recency decay (negligible) + 0 confidence + 0 pinned
    expect(score).toBeGreaterThanOrEqual(0.7);
    expect(score).toBeLessThan(0.71); // recency decay near 0 after 6 years
  });

  it("defaults `now` to the current time when omitted", () => {
    const fresh = candidate({ id: 1, similarity: 0.5, updatedAt: new Date() });
    const score = scoreRecallCandidate(fresh);
    // similarity 0.5 + full recency boost 0.15 (just updated)
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThanOrEqual(0.65 + 1e-9);
  });
});
