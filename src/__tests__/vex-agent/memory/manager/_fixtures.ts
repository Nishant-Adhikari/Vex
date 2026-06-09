/**
 * Shared non-DB fixtures for the memory_manager unit tests. NOT a test file
 * (underscore prefix). Builds a fully-typed `MemoryCandidate` with sensible
 * pending defaults that individual tests override per case.
 */

import type { MemoryCandidate } from "@vex-agent/db/repos/memory-candidates/index.js";

export function makeCandidate(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  const now = new Date().toISOString();
  return {
    id: "11111111-1111-1111-1111-111111111111",
    sessionId: "sess-1",
    proposedBy: "parent",
    kind: "strategy_lesson",
    title: "Paid boost plus buyer dominance signals a real chance",
    summary: "When a token has a paid dexscreener boost, buyer dominance, and rising m5 volume it has a real chance.",
    contentMd: "Detailed reasoning about the pre-buy signals observed.",
    entities: ["dexscreener"],
    tags: ["microcap"],
    sourceRefs: { messageIds: [1, 2, 3] },
    evidenceRefs: [{ executionId: 5, captureItemId: 9, instrumentKey: "BONK" }],
    outcome: null,
    source: "hypothesis",
    confidence: 0.7,
    importance: 7,
    sensitivity: "normal",
    evidenceStrength: "none",
    retrievalVisibility: "not_consolidated",
    retrievalUntil: null,
    status: "pending",
    retainUntil: null,
    embeddingModel: "test-model",
    embeddingDim: 8,
    contentHash: "a".repeat(64),
    eventTime: null,
    observedAt: null,
    recordedAt: now,
    availableAtDecisionTime: null,
    promotedKnowledgeId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
