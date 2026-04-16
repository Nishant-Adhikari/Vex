import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { discoverProtocolCapabilities } from "../../../echo-agent/tools/protocols/runtime.js";
import {
  PROTOCOL_ADVERTISED_NAMESPACE_ALLOWLIST,
} from "../../../echo-agent/tools/protocols/catalog.js";

describe("protocol discovery", () => {
  // Snapshot env-gating keys so each test sees a deterministic baseline.
  // Tests that exercise env-gating delete the relevant key explicitly.
  const ENV_KEYS = ["JUPITER_API_KEY", "POLYMARKET_API_KEY"] as const;
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) original[k] = process.env[k];
    process.env.JUPITER_API_KEY = "test-jupiter-key";
    process.env.POLYMARKET_API_KEY = "test-polymarket-key";
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });
  // ── Basic discovery ──────────────────────────────────────────────

  it("returns tools with no filters", () => {
    const result = discoverProtocolCapabilities({});
    expect(result.success).toBe(true);
    expect(result.count).toBeGreaterThan(0);
    expect(result.totalCount).toBeGreaterThanOrEqual(result.count);
    expect(result.hasMore).toBe(result.totalCount > result.count);
  });

  it("returns tools with toolId, description, params", () => {
    const result = discoverProtocolCapabilities({});
    for (const tool of result.tools) {
      expect(tool.toolId).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(Array.isArray(tool.params)).toBe(true);
    }
  });

  // ── Namespace filter ─────────────────────────────────────────────

  it("filters by khalani namespace", () => {
    const result = discoverProtocolCapabilities({ namespace: "khalani" });
    expect(result.count).toBeGreaterThan(0);
    for (const tool of result.tools) {
      expect(tool.namespace).toBe("khalani");
    }
  });

  it("rejects reserved hidden namespaces", () => {
    const result = discoverProtocolCapabilities({ namespace: "0g-compute" });
    expect(result.success).toBe(false);
    expect(result.count).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("returns echobook tools when filtering by echobook namespace", () => {
    const result = discoverProtocolCapabilities({ namespace: "echobook", limit: 50 });
    expect(result.count).toBeGreaterThan(0);
    for (const tool of result.tools) {
      expect(tool.namespace).toBe("echobook");
    }
  });

  it("returns kyberswap tools when filtering by kyberswap namespace", () => {
    const result = discoverProtocolCapabilities({ namespace: "kyberswap" });
    expect(result.count).toBeGreaterThan(0);
    for (const tool of result.tools) {
      expect(tool.namespace).toBe("kyberswap");
    }
  });

  // ── Mutating filter ──────────────────────────────────────────────

  it("excludes mutating by default", () => {
    const result = discoverProtocolCapabilities({ namespace: "khalani" });
    const hasMutating = result.tools.some(t => t.mutating);
    expect(hasMutating).toBe(false);
  });

  it("includes mutating when requested", () => {
    // Explicit limit > 5 because DEFAULT_DISCOVERY_LIMIT=5 may not include the
    // mutating tool depending on manifest order.
    const result = discoverProtocolCapabilities({ namespace: "khalani", includeMutating: true, limit: 50 });
    const hasMutating = result.tools.some(t => t.mutating);
    expect(hasMutating).toBe(true);
  });

  // ── Query matching ───────────────────────────────────────────────

  it("matches by toolId substring", () => {
    const result = discoverProtocolCapabilities({ query: "tokens.search" });
    expect(result.count).toBeGreaterThan(0);
    expect(result.tools[0].toolId).toContain("tokens.search");
  });

  it("matches by description keyword", () => {
    const result = discoverProtocolCapabilities({ query: "balance" });
    expect(result.count).toBeGreaterThan(0);
  });

  it("matches case-insensitively", () => {
    const result = discoverProtocolCapabilities({ query: "BRIDGE", includeMutating: true });
    expect(result.count).toBeGreaterThan(0);
  });

  it("returns empty for non-matching query", () => {
    const result = discoverProtocolCapabilities({ query: "zzz_nonexistent_xyz" });
    expect(result.count).toBe(0);
  });

  // ── Limit ────────────────────────────────────────────────────────

  it("respects limit", () => {
    const result = discoverProtocolCapabilities({ namespace: "khalani", limit: 3 });
    expect(result.count).toBeLessThanOrEqual(3);
    expect(result.tools).toHaveLength(result.count);
    expect(result.totalCount).toBeGreaterThanOrEqual(result.count);
  });

  it("returns all when limit exceeds count", () => {
    // Both calls need explicit limits that exceed actual khalani non-mutating count;
    // DEFAULT_DISCOVERY_LIMIT=5 caps allResult independently of totalCount.
    const allResult = discoverProtocolCapabilities({ namespace: "khalani", limit: 100 });
    const bigLimitResult = discoverProtocolCapabilities({ namespace: "khalani", limit: 200 });
    expect(bigLimitResult.count).toBe(allResult.count);
    expect(bigLimitResult.totalCount).toBe(allResult.totalCount);
  });

  // ── Lifecycle filter ─────────────────────────────────────────────

  it("returns only active tools by default", () => {
    const result = discoverProtocolCapabilities({});
    for (const tool of result.tools) {
      expect(tool.lifecycle).toBe("active");
    }
  });

  // ── Warnings ─────────────────────────────────────────────────────

  it("does not advertise reserved namespaces in generic discovery results", () => {
    const result = discoverProtocolCapabilities({});
    const namespaces = new Set(result.tools.map((tool) => tool.namespace));
    expect(namespaces.has("0g-compute")).toBe(false);
    expect(namespaces.has("0g-storage")).toBe(false);
  });

  it("returns dexscreener tools when filtering by dexscreener namespace", () => {
    const result = discoverProtocolCapabilities({ namespace: "dexscreener", limit: 50 });
    expect(result.count).toBeGreaterThan(0);
    for (const tool of result.tools) {
      expect(tool.namespace).toBe("dexscreener");
    }
  });

  // ── Combined filters ─────────────────────────────────────────────

  it("combines namespace + query", () => {
    const result = discoverProtocolCapabilities({
      namespace: "khalani",
      query: "order",
    });
    expect(result.count).toBeGreaterThan(0);
    for (const tool of result.tools) {
      expect(tool.namespace).toBe("khalani");
    }
  });

  it("combines namespace + mutating + query", () => {
    const result = discoverProtocolCapabilities({
      namespace: "khalani",
      query: "bridge",
      includeMutating: true,
    });
    expect(result.count).toBeGreaterThanOrEqual(1);
    const bridge = result.tools.find(t => t.toolId === "khalani.bridge");
    expect(bridge).toBeDefined();
    expect(bridge!.mutating).toBe(true);
  });

  it("matches alias query for 0g explorer to chainscan", () => {
    const result = discoverProtocolCapabilities({ query: "0g explorer" });
    expect(result.success).toBe(true);
    expect(result.tools[0]?.namespace).toBe("chainscan");
  });

  it("matches polymarket clob from natural language query", () => {
    // Query uses "polymarket orderbook" (namespace + discriminator) instead of the
    // ambiguous "prediction market orderbook" — which now ties polymarket.data.*
    // (via "prediction market" in description) with polymarket.clob.* (via "orderbook").
    // Lexical scoring without IDF can't break that tie; PR3 metadata v1 is the place
    // to disambiguate. The capability-phrase intent in message #5 is the right shape here.
    const result = discoverProtocolCapabilities({ query: "polymarket orderbook" });
    expect(result.success).toBe(true);
    expect(result.tools[0]?.toolId.startsWith("polymarket.clob")).toBe(true);
  });

  it("matches community takeover query to dexscreener", () => {
    const result = discoverProtocolCapabilities({ query: "community takeover" });
    expect(result.success).toBe(true);
    expect(result.tools[0]?.toolId).toBe("dexscreener.communityTakeovers");
  });

  it("matches profile image query to slop app tools", () => {
    const result = discoverProtocolCapabilities({ query: "profile image" });
    expect(result.success).toBe(true);
    expect(result.tools[0]?.namespace).toBe("slop-app");
  });

  // ── Defense in depth: reserved namespaces never leak ─────────────

  it("free-text discovery only ever returns advertised namespaces", () => {
    // Run a few diverse queries — every result must belong to advertised set.
    const queries = ["", "bridge", "swap", "token", "0g", "market"];
    for (const query of queries) {
      const result = discoverProtocolCapabilities({ query, includeMutating: true, limit: 200 });
      for (const tool of result.tools) {
        expect(PROTOCOL_ADVERTISED_NAMESPACE_ALLOWLIST as readonly string[]).toContain(tool.namespace);
      }
    }
  });

  // ── Env-gating contract (audit follow-up) ────────────────────────

  it("hides env-gated tools when their requiresEnv is missing", () => {
    delete process.env.JUPITER_API_KEY;
    const result = discoverProtocolCapabilities({ namespace: "solana", limit: 100 });
    // All solana tools require JUPITER_API_KEY → namespace returns nothing.
    expect(result.count).toBe(0);
  });

  it("returns env-gated tools when their requiresEnv is present", () => {
    const result = discoverProtocolCapabilities({ namespace: "solana", includeMutating: true, limit: 100 });
    expect(result.count).toBeGreaterThan(0);
  });

  it("does not surface gated polymarket clob mutating tools when key missing", () => {
    delete process.env.POLYMARKET_API_KEY;
    const result = discoverProtocolCapabilities({
      namespace: "polymarket",
      query: "buy yes",
      includeMutating: true,
      limit: 100,
    });
    // The mutating clob.buy tool requires POLYMARKET_API_KEY → must be hidden.
    expect(result.tools.some((t) => t.toolId === "polymarket.clob.buy")).toBe(false);
  });

  // ── Facet-driven discovery (audit follow-up) ─────────────────────

  it("matches echobook comment tools via facet hints", () => {
    const result = discoverProtocolCapabilities({
      query: "comment thread",
      namespace: "echobook",
      includeMutating: true,
      limit: 50,
    });
    expect(result.success).toBe(true);
    const ids = result.tools.map((t) => t.toolId);
    expect(ids).toContain("echobook.comments.get");
  });

  it("matches slop.tokens.mine via 'my tokens' facet hint", () => {
    const result = discoverProtocolCapabilities({
      query: "my tokens",
      namespace: "slop",
      limit: 50,
    });
    expect(result.success).toBe(true);
    const ids = result.tools.map((t) => t.toolId);
    expect(ids).toContain("slop.tokens.mine");
  });
});
