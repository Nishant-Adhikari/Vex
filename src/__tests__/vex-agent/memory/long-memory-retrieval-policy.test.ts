/**
 * Unit tests for the long-memory RETRIEVAL policy (S3) — the pure scoring,
 * blend, and dual-trace ranking. No DB, no embeddings.
 *
 * Doctrine guards proven here:
 *  - a confirmed knowledge entry outranks a candidate at EQUAL raw similarity,
 *    including the worst case (a fresh + pinned HYPOTHESIS knowledge entry still
 *    beats a max-similarity candidate at the same raw similarity);
 *  - inferred/hypothesis knowledge ranks below observed but is NOT excluded;
 *  - candidates below the minimum similarity are dropped;
 *  - the candidate cap is enforced and the dropped count is returned (no silent
 *    truncation).
 */

import { describe, it, expect } from "vitest";

import {
  blendAndRank,
  scoreKnowledge,
  scoreCandidate,
  CANDIDATE_DUAL_TRACE_WEIGHT,
  SOURCE_SOFT_WEIGHT,
  LONG_MEMORY_CANDIDATE_MIN_SIMILARITY,
  LONG_MEMORY_CANDIDATE_MAX,
  type LongMemoryKnowledgeResult,
  type LongMemoryCandidateResult,
} from "@vex-agent/memory/long-memory-retrieval-policy.js";
import type { KnowledgeSource } from "@vex-agent/memory/long-memory-source-policy.js";

// ── Builders ──────────────────────────────────────────────────────

function knowledge(
  overrides: Partial<Omit<LongMemoryKnowledgeResult, "score" | "source">> = {},
): Omit<LongMemoryKnowledgeResult, "score"> {
  return {
    source: "long_memory",
    id: 1,
    kind: "risk_rule",
    title: "K",
    summary: "s",
    contentMd: "",
    similarity: 0.8,
    sourceTier: "observed",
    maturityState: "established",
    tags: [],
    validUntil: null,
    evidenceRefs: {},
    rerankScore: 0.8,
    ...overrides,
  };
}

function candidate(
  overrides: Partial<Omit<LongMemoryCandidateResult, "score" | "source" | "notConsolidated">> = {},
): Omit<LongMemoryCandidateResult, "score"> {
  return {
    source: "memory_candidate",
    id: "11111111-1111-1111-1111-111111111111",
    kind: "trade_lesson",
    title: "C",
    summary: "s",
    contentMd: "",
    similarity: 0.8,
    notConsolidated: true,
    sourceTier: "observed",
    tags: [],
    evidenceRefs: [],
    retrievalUntil: null,
    ...overrides,
  };
}

// ── The hard invariant ────────────────────────────────────────────

describe("long-memory retrieval policy — weight invariant", () => {
  it("keeps CANDIDATE_DUAL_TRACE_WEIGHT strictly below SOURCE_SOFT_WEIGHT ≤ 1", () => {
    expect(CANDIDATE_DUAL_TRACE_WEIGHT).toBeLessThan(SOURCE_SOFT_WEIGHT);
    expect(SOURCE_SOFT_WEIGHT).toBeLessThanOrEqual(1);
  });
});

// ── Scorers ───────────────────────────────────────────────────────

describe("scoreKnowledge — source-tier de-weight", () => {
  it("keeps full weight for observed and user_confirmed", () => {
    expect(scoreKnowledge({ rerankScore: 1, sourceTier: "observed" })).toBe(1);
    expect(scoreKnowledge({ rerankScore: 1, sourceTier: "user_confirmed" })).toBe(1);
  });

  it("de-weights inferred and hypothesis by SOURCE_SOFT_WEIGHT", () => {
    expect(scoreKnowledge({ rerankScore: 1, sourceTier: "inferred" })).toBeCloseTo(SOURCE_SOFT_WEIGHT, 10);
    expect(scoreKnowledge({ rerankScore: 1, sourceTier: "hypothesis" })).toBeCloseTo(SOURCE_SOFT_WEIGHT, 10);
  });
});

describe("scoreCandidate — flat dual-trace de-weight (no boosts)", () => {
  it("is similarity × CANDIDATE_DUAL_TRACE_WEIGHT with no recency/confidence/pinned terms", () => {
    expect(scoreCandidate({ similarity: 1 })).toBeCloseTo(CANDIDATE_DUAL_TRACE_WEIGHT, 10);
    expect(scoreCandidate({ similarity: 0.5 })).toBeCloseTo(0.5 * CANDIDATE_DUAL_TRACE_WEIGHT, 10);
  });
});

// ── Confirmed wins at equal similarity (incl. worst case) ─────────

describe("blendAndRank — confirmed knowledge outranks a candidate at equal raw similarity", () => {
  it("ranks an observed entry above a candidate at the same similarity", () => {
    const { results } = blendAndRank(
      [knowledge({ id: 10, similarity: 0.7, rerankScore: 0.7, sourceTier: "observed" })],
      [candidate({ similarity: 0.7 })],
    );
    expect(results.map((r) => r.source)).toEqual(["long_memory", "memory_candidate"]);
  });

  it("worst case: a fresh+pinned HYPOTHESIS knowledge entry still beats a max-similarity candidate at the SAME raw similarity", () => {
    // A hypothesis entry is the weakest knowledge tier (× SOURCE_SOFT_WEIGHT).
    // Even so, because its rerank base score already carries recency + pinned
    // boosts AND the tier weight (0.7) > the candidate weight (0.6), it must win
    // at equal raw similarity. Model "fresh + pinned" via a base score above the
    // raw similarity (rerank adds recency≤0.15 + pinned 0.20).
    const sim = 0.9;
    const hypothesis = knowledge({
      id: 20,
      similarity: sim,
      // sim + max recency (0.15) + pinned (0.20) = the fresh+pinned ceiling.
      rerankScore: sim + 0.15 + 0.2,
      sourceTier: "hypothesis",
    });
    const maxSimCandidate = candidate({ id: "cand-max", similarity: sim });

    const { results } = blendAndRank([hypothesis], [maxSimCandidate]);
    expect(results[0]!.source).toBe("long_memory");
    expect(results[1]!.source).toBe("memory_candidate");

    // Even the BARE de-weighted hypothesis (no boosts) at equal sim still wins,
    // because 0.7 > 0.6.
    const bareHypothesis = knowledge({ id: 21, similarity: sim, rerankScore: sim, sourceTier: "hypothesis" });
    const blendBare = blendAndRank([bareHypothesis], [candidate({ id: "cand-bare", similarity: sim })]);
    expect(blendBare.results[0]!.source).toBe("long_memory");
  });

  it("lets a MUCH-higher-similarity fresh candidate surface above a weak knowledge entry", () => {
    const weakKnowledge = knowledge({ id: 30, similarity: 0.2, rerankScore: 0.2, sourceTier: "observed" });
    const strongCandidate = candidate({ id: "cand-strong", similarity: 0.95 });
    const { results } = blendAndRank([weakKnowledge], [strongCandidate]);
    // 0.95 × 0.6 = 0.57 > 0.2 × 1 = 0.2 → the candidate surfaces first.
    expect(results[0]!.source).toBe("memory_candidate");
  });
});

// ── Inferred/hypothesis ranks below observed but is not excluded ──

describe("blendAndRank — provenance ordering without exclusion", () => {
  it("ranks observed above inferred above hypothesis at equal raw similarity, all present", () => {
    const sim = 0.8;
    const tiers: KnowledgeSource[] = ["observed", "inferred", "hypothesis"];
    const entries = tiers.map((tier, i) =>
      knowledge({ id: 100 + i, similarity: sim, rerankScore: sim, sourceTier: tier }),
    );
    const { results } = blendAndRank(entries, []);

    expect(results).toHaveLength(3);
    const orderedTiers = results.map((r) => (r.source === "long_memory" ? r.sourceTier : r.source));
    expect(orderedTiers).toEqual(["observed", "inferred", "hypothesis"]);
  });
});

// ── Candidate gating + cap (no silent truncation) ────────────────

describe("blendAndRank — candidate gating and cap", () => {
  it("drops candidates below the minimum similarity", () => {
    const below = candidate({ id: "below", similarity: LONG_MEMORY_CANDIDATE_MIN_SIMILARITY - 0.01 });
    const above = candidate({ id: "above", similarity: LONG_MEMORY_CANDIDATE_MIN_SIMILARITY + 0.01 });
    const { results } = blendAndRank([], [below, above]);

    const candidateIds = results
      .filter((r): r is LongMemoryCandidateResult => r.source === "memory_candidate")
      .map((r) => r.id);
    expect(candidateIds).toEqual(["above"]);
  });

  it("enforces the cap and returns the dropped count (no silent truncation)", () => {
    const many = Array.from({ length: LONG_MEMORY_CANDIDATE_MAX + 2 }, (_, i) =>
      candidate({ id: `c-${i}`, similarity: 0.9 - i * 0.01 }),
    );
    const { results, droppedCandidates } = blendAndRank([], many);

    const kept = results.filter((r) => r.source === "memory_candidate");
    expect(kept).toHaveLength(LONG_MEMORY_CANDIDATE_MAX);
    expect(droppedCandidates).toBe(2);
    // The strongest candidates are the ones kept.
    expect(kept.map((r) => r.id)).toEqual(["c-0", "c-1", "c-2"]);
  });

  it("does not count below-min candidates as cap drops", () => {
    const weak = Array.from({ length: 5 }, (_, i) =>
      candidate({ id: `weak-${i}`, similarity: 0.1 }),
    );
    const { results, droppedCandidates } = blendAndRank([], weak);
    expect(results).toHaveLength(0);
    expect(droppedCandidates).toBe(0);
  });
});
