import { describe, it, expect } from "vitest";

import { formatSessionEpisodeRecallBlock } from "../../../../echo-agent/engine/prompts/session-memory.js";
import type { RecallHit } from "../../../../echo-agent/db/repos/session-episodes.js";

function makeHit(overrides: Partial<RecallHit["episode"]> = {}, similarity = 0.8): RecallHit {
  return {
    similarity,
    episode: {
      id: 1,
      sessionId: "session-X",
      memoryScopeKey: "scope-1",
      episodeKind: "decision",
      summaryEn: "User decided to hold SOL through the next rebalance.",
      facts: {},
      decisions: {},
      openLoops: {},
      entities: [],
      toolOutcomes: {},
      sourceSurface: "echo_agent",
      sourceSession: "session-X",
      sourceStartMessageId: 10,
      sourceEndMessageId: 20,
      episodeHash: "h".repeat(64),
      embeddingModel: "test-model",
      embeddingDim: 4,
      createdAt: "2026-04-01T00:00:00Z",
      ...overrides,
    },
  };
}

describe("session-memory", () => {
  it("returns empty string when there are no hits", () => {
    expect(formatSessionEpisodeRecallBlock([])).toBe("");
  });

  it("renders a compact bullet list with heading and preamble", () => {
    const block = formatSessionEpisodeRecallBlock([makeHit()]);
    expect(block).toContain("[Session episode recall]");
    expect(block).toContain("- [decision]");
    expect(block).toContain("(session:session-X, sim:0.80)");
  });

  it("caps the number of items to maxItems", () => {
    const hits = Array.from({ length: 12 }, (_, i) =>
      makeHit({ id: i + 1, summaryEn: `fact number ${i + 1}` }, 0.9),
    );
    const block = formatSessionEpisodeRecallBlock(hits, { maxItems: 3 });
    const matches = block.match(/^- /gm) ?? [];
    expect(matches).toHaveLength(3);
  });

  it("truncates long summaries with an ellipsis", () => {
    const long = "x".repeat(500);
    const block = formatSessionEpisodeRecallBlock([makeHit({ summaryEn: long })], {
      summaryTruncate: 60,
    });
    expect(block).toContain("…");
    expect(block.length).toBeLessThan(long.length);
  });

  it("drops the block entirely when nothing fits under totalCharsCap", () => {
    const hits = Array.from({ length: 5 }, (_, i) =>
      makeHit({ id: i + 1, summaryEn: "A".repeat(200) }, 0.9),
    );
    const block = formatSessionEpisodeRecallBlock(hits, { totalCharsCap: 10 });
    expect(block).toBe("");
  });

  it("falls back to em-dash when sourceSession is null", () => {
    const block = formatSessionEpisodeRecallBlock([makeHit({ sourceSession: null })]);
    expect(block).toContain("(session:—,");
  });
});
