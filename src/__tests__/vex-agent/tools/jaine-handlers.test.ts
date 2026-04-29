import { describe, it, expect } from "vitest";
import { JAINE_HANDLERS } from "../../../vex-agent/tools/protocols/0g/jaine/handlers.js";
import { JAINE_TOOLS } from "../../../vex-agent/tools/protocols/0g/jaine/manifest.js";

describe("jaine handlers", () => {
  // ── Handler coverage ─────────────────────────────────────────────

  it("has a handler for every manifest toolId", () => {
    const handlerKeys = new Set(Object.keys(JAINE_HANDLERS));
    const manifestIds = JAINE_TOOLS.map(t => t.toolId);
    const missing = manifestIds.filter(id => !handlerKeys.has(id));
    expect(missing).toEqual([]);
  });

  it("has no extra handlers without manifests", () => {
    const manifestIds = new Set(JAINE_TOOLS.map(t => t.toolId));
    const handlerKeys = Object.keys(JAINE_HANDLERS);
    const extra = handlerKeys.filter(key => !manifestIds.has(key));
    expect(extra).toEqual([]);
  });

  it("handler count matches manifest count (24)", () => {
    expect(Object.keys(JAINE_HANDLERS)).toHaveLength(24);
  });

  it("jaine.token.info fails with invalid address", async () => {
    const result = await JAINE_HANDLERS["jaine.token.info"]!(
      { address: "USDC" },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Invalid address");
  });

  it("every handler is a function", () => {
    for (const [, handler] of Object.entries(JAINE_HANDLERS)) {
      expect(typeof handler).toBe("function");
    }
  });

  // ── Required param validation ────────────────────────────────────

  // Pools
  it("jaine.pools.forToken fails without token", async () => {
    const result = await JAINE_HANDLERS["jaine.pools.forToken"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("token");
  });

  it("jaine.pools.forPair fails without tokenA and tokenB", async () => {
    const result = await JAINE_HANDLERS["jaine.pools.forPair"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("tokenA");
  });

  it("jaine.pools.forPair fails with only tokenA", async () => {
    const result = await JAINE_HANDLERS["jaine.pools.forPair"]!(
      { tokenA: "0x1234567890abcdef1234567890abcdef12345678" },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("tokenB");
  });

  it("jaine.pools.forPair fails with invalid address", async () => {
    const result = await JAINE_HANDLERS["jaine.pools.forPair"]!(
      { tokenA: "not-an-address", tokenB: "0x1234567890abcdef1234567890abcdef12345678" },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Invalid address");
  });

  // Pool
  it("jaine.pool.info fails without poolId", async () => {
    const result = await JAINE_HANDLERS["jaine.pool.info"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("poolId");
  });

  it("jaine.pool.days fails without poolId", async () => {
    const result = await JAINE_HANDLERS["jaine.pool.days"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("poolId");
  });

  it("jaine.pool.hours fails without poolId", async () => {
    const result = await JAINE_HANDLERS["jaine.pool.hours"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("poolId");
  });

  it("jaine.pool.swaps fails without poolId", async () => {
    const result = await JAINE_HANDLERS["jaine.pool.swaps"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("poolId");
  });

  it("jaine.pool.mints fails without poolId", async () => {
    const result = await JAINE_HANDLERS["jaine.pool.mints"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("poolId");
  });

  it("jaine.pool.burns fails without poolId", async () => {
    const result = await JAINE_HANDLERS["jaine.pool.burns"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("poolId");
  });

  it("jaine.pool.collects fails without poolId", async () => {
    const result = await JAINE_HANDLERS["jaine.pool.collects"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("poolId");
  });

  // Token
  it("jaine.token.info fails without address", async () => {
    const result = await JAINE_HANDLERS["jaine.token.info"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("address");
  });

  // Swap
  it("jaine.swap.quote fails without required params", async () => {
    const result = await JAINE_HANDLERS["jaine.swap.quote"]!(
      { tokenIn: "USDC" },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("jaine.swap.sell fails without required params", async () => {
    const result = await JAINE_HANDLERS["jaine.swap.sell"]!(
      { tokenIn: "USDC", tokenOut: "w0G" },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("jaine.swap.buy fails without required params", async () => {
    const result = await JAINE_HANDLERS["jaine.swap.buy"]!(
      { tokenIn: "USDC", tokenOut: "w0G" },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  // Allowance
  it("jaine.allowance.approve fails without token and spender", async () => {
    const result = await JAINE_HANDLERS["jaine.allowance.approve"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("token");
  });

  it("jaine.allowance.approve fails with invalid spender", async () => {
    const result = await JAINE_HANDLERS["jaine.allowance.approve"]!(
      { token: "0x1234", spender: "invalid" },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("router or nft");
  });

  it("jaine.allowance.revoke fails without token and spender", async () => {
    const result = await JAINE_HANDLERS["jaine.allowance.revoke"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("token");
  });

  // W0G
  it("jaine.w0g.wrap fails without amount", async () => {
    const result = await JAINE_HANDLERS["jaine.w0g.wrap"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("amount");
  });

  it("jaine.w0g.unwrap fails without amount", async () => {
    const result = await JAINE_HANDLERS["jaine.w0g.unwrap"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("amount");
  });

  // ── Read-only handlers (no wallet needed) ────────────────────────

  it("jaine.tokens.list returns core tokens", async () => {
    const result = await JAINE_HANDLERS["jaine.tokens.list"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(data.count).toBeGreaterThan(0);
    expect(Array.isArray(data.tokens)).toBe(true);
    expect(data.tokens[0].symbol).toBeDefined();
    expect(data.tokens[0].address).toBeDefined();
  });

  it("jaine.meta returns subgraph health", async () => {
    const result = await JAINE_HANDLERS["jaine.meta"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(data.block).toBeDefined();
    expect(data.deployment).toBeDefined();
    expect(typeof data.hasIndexingErrors).toBe("boolean");
  });
});
