/**
 * Tests for compileToolDiscoveryMetadata — inheritance, override, and merge.
 */

import { describe, it, expect } from "vitest";
import { compileToolDiscoveryMetadata } from "../../../echo-agent/tools/protocols/metadata-compile.js";
import type { ProtocolToolManifest } from "../../../echo-agent/tools/protocols/types.js";
import type { ProtocolNamespaceNavigation } from "../../../echo-agent/tools/protocols/navigation/types.js";

// ── Test fixtures ──────────────────────────────────────────────

const MOCK_NAV: ProtocolNamespaceNavigation = {
  namespace: "echobook",
  advertised: true,
  groupId: "0g-ecosystem",
  groupLabel: "0G Ecosystem",
  summary: "EchoBook social trading surface.",
  whenToUse: "Use for social actions.",
  exampleQueries: ['discover_tools(query="feed")'],
  aliases: ["echo book", "social feed"],
  discoveryHints: ["posts feed", "comments"],
  facets: [
    {
      label: "Feeds and comments",
      summary: "Browse feeds, fetch comments.",
      toolPrefixes: ["echobook.feed", "echobook.comments"],
      hints: ["posts feed", "comment thread"],
    },
    {
      label: "Profiles",
      summary: "Inspect profiles.",
      toolPrefixes: ["echobook.profile"],
      hints: ["profile search", "user lookup"],
    },
  ],
};

function makeManifest(overrides: Partial<ProtocolToolManifest> = {}): ProtocolToolManifest {
  return {
    toolId: "echobook.comments.get",
    namespace: "echobook",
    lifecycle: "active",
    description: "Get comments on a post.",
    mutating: false,
    params: [{ key: "postId", type: "number", required: true, description: "Post ID." }],
    exampleParams: { postId: 42 },
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────

describe("compileToolDiscoveryMetadata", () => {
  it("inherits all defaults from namespace and facet when discovery is undefined", () => {
    const manifest = makeManifest();
    const result = compileToolDiscoveryMetadata(manifest, MOCK_NAV);

    expect(result.aliases).toEqual(expect.arrayContaining(["echo book", "social feed"]));
    expect(result.ecosystems).toEqual(["0g"]);
    expect(result.sourceClass).toBe("social");
    expect(result.sideEffectLevel).toBe("none");
    expect(result.operation).toEqual(["research"]);
    expect(result.paramKeywords).toEqual(["postId"]);
    expect(result.exampleIntents).toEqual(expect.arrayContaining(["posts feed", "comment thread"]));
  });

  it("tool discovery.canonicalSummary overrides inherited undefined", () => {
    const manifest = makeManifest({
      discovery: { canonicalSummary: "Fetch threaded comments with depth." },
    });
    const result = compileToolDiscoveryMetadata(manifest, MOCK_NAV);

    expect(result.canonicalSummary).toBe("Fetch threaded comments with depth.");
    expect(result.ecosystems).toEqual(["0g"]);
    expect(result.aliases).toEqual(expect.arrayContaining(["echo book"]));
  });

  it("partial override merges arrays — tool ecosystems extend namespace ecosystems", () => {
    const manifest = makeManifest({
      discovery: { ecosystems: ["ethereum"], aliases: ["0g comments"] },
    });
    const result = compileToolDiscoveryMetadata(manifest, MOCK_NAV);

    expect(result.ecosystems).toEqual(expect.arrayContaining(["0g", "ethereum"]));
    expect(result.aliases).toEqual(expect.arrayContaining(["echo book", "social feed", "0g comments"]));
    expect(result.sourceClass).toBe("social");
  });

  it("tool without matching facet still gets namespace defaults", () => {
    const manifest = makeManifest({
      toolId: "echobook.tradeProof.submit",
      params: [{ key: "txHash", type: "string", required: true, description: "Tx hash." }],
    });
    const result = compileToolDiscoveryMetadata(manifest, MOCK_NAV);

    expect(result.aliases).toEqual(expect.arrayContaining(["echo book", "social feed"]));
    expect(result.ecosystems).toEqual(["0g"]);
    expect(result.exampleIntents).toBeUndefined();
    expect(result.paramKeywords).toEqual(["txHash"]);
  });

  it("mutating tool derives sideEffectLevel: high and operation: execute", () => {
    const manifest = makeManifest({
      toolId: "echobook.comment.create",
      mutating: true,
      params: [
        { key: "postId", type: "number", required: true, description: "Post ID." },
        { key: "content", type: "string", required: true, description: "Comment text." },
      ],
    });
    const result = compileToolDiscoveryMetadata(manifest, MOCK_NAV);

    expect(result.sideEffectLevel).toBe("high");
    expect(result.operation).toEqual(["execute"]);
  });

  it("quote tool derives operation: quote", () => {
    const quoteNav: ProtocolNamespaceNavigation = {
      ...MOCK_NAV,
      namespace: "khalani",
      groupId: "cross-chain",
    };
    const manifest = makeManifest({
      toolId: "khalani.quote.get",
      namespace: "khalani",
      mutating: false,
      params: [],
    });
    const result = compileToolDiscoveryMetadata(manifest, quoteNav);

    expect(result.operation).toEqual(["quote"]);
    expect(result.ecosystems).toEqual(expect.arrayContaining(["evm", "solana", "crosschain"]));
  });

  it("override operation replaces inherited value", () => {
    const manifest = makeManifest({
      discovery: { operation: ["monitor"] },
    });
    const result = compileToolDiscoveryMetadata(manifest, MOCK_NAV);

    expect(result.operation).toEqual(["monitor"]);
  });

  it("preferredFor and avoidFor from discovery pass through", () => {
    const manifest = makeManifest({
      discovery: {
        preferredFor: ["orderbook", "bids asks"],
        avoidFor: ["positions"],
      },
    });
    const result = compileToolDiscoveryMetadata(manifest, MOCK_NAV);

    expect(result.preferredFor).toEqual(["orderbook", "bids asks"]);
    expect(result.avoidFor).toEqual(["positions"]);
  });

  it("deduplicates array values when override repeats inherited entries", () => {
    const manifest = makeManifest({
      discovery: { aliases: ["echo book", "0g social"] },
    });
    const result = compileToolDiscoveryMetadata(manifest, MOCK_NAV);

    const echoBookCount = result.aliases!.filter((a) => a === "echo book").length;
    expect(echoBookCount).toBe(1);
    expect(result.aliases).toEqual(expect.arrayContaining(["echo book", "social feed", "0g social"]));
  });

  it("empty discovery object is treated as no overrides", () => {
    const manifest = makeManifest({ discovery: {} });
    const result = compileToolDiscoveryMetadata(manifest, MOCK_NAV);

    expect(result.ecosystems).toEqual(["0g"]);
    expect(result.sourceClass).toBe("social");
    expect(result.canonicalSummary).toBeUndefined();
  });
});
