import { describe, it, expect } from "vitest";
import { SOLANA_JUPITER_HANDLERS } from "../../../echo-agent/tools/protocols/solana-jupiter/handlers.js";
import { SOLANA_JUPITER_TOOLS } from "../../../echo-agent/tools/protocols/solana-jupiter/manifest.js";

describe("solana-jupiter handlers", () => {
  // ── Handler coverage — every manifest has a handler ──────────────

  it("has a handler for every manifest toolId", () => {
    const handlerKeys = new Set(Object.keys(SOLANA_JUPITER_HANDLERS));
    const manifestIds = SOLANA_JUPITER_TOOLS.map(t => t.toolId);

    const missing = manifestIds.filter(id => !handlerKeys.has(id));
    expect(missing).toEqual([]);
  });

  it("has no extra handlers without manifests", () => {
    const manifestIds = new Set(SOLANA_JUPITER_TOOLS.map(t => t.toolId));
    const handlerKeys = Object.keys(SOLANA_JUPITER_HANDLERS);

    const extra = handlerKeys.filter(key => !manifestIds.has(key));
    expect(extra).toEqual([]);
  });

  it("handler count matches manifest count", () => {
    expect(Object.keys(SOLANA_JUPITER_HANDLERS)).toHaveLength(SOLANA_JUPITER_TOOLS.length);
  });

  // ── Handler type — all are async functions ──────────────────────

  it("every handler is a function", () => {
    for (const [toolId, handler] of Object.entries(SOLANA_JUPITER_HANDLERS)) {
      expect(typeof handler).toBe("function");
    }
  });

  // ── Required param validation (handlers should fail on missing) ──

  it("solana.tokens.search fails without query", async () => {
    const result = await SOLANA_JUPITER_HANDLERS["solana.tokens.search"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("query");
  });

  it("solana.predict.market fails without marketId", async () => {
    const result = await SOLANA_JUPITER_HANDLERS["solana.predict.market"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("marketId");
  });

  it("solana.swap.quote fails without required params", async () => {
    const result = await SOLANA_JUPITER_HANDLERS["solana.swap.quote"]!(
      { inputToken: "SOL" },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("solana.predict.buy fails without required params", async () => {
    const result = await SOLANA_JUPITER_HANDLERS["solana.predict.buy"]!(
      { marketId: "abc" },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("solana.predict.buy rejects invalid side", async () => {
    const result = await SOLANA_JUPITER_HANDLERS["solana.predict.buy"]!(
      { marketId: "abc", side: "maybe", amountUsdc: 10 },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("yes");
    expect(result.output).toContain("no");
  });

  it("solana.predict.buy rejects typo side silently treated as NO before fix", async () => {
    const result = await SOLANA_JUPITER_HANDLERS["solana.predict.buy"]!(
      { marketId: "abc", side: "Yes!", amountUsdc: 10 },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("yes");
  });

  it("solana.lend.deposit fails without required params", async () => {
    const result = await SOLANA_JUPITER_HANDLERS["solana.lend.deposit"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("solana.predict.event fails without eventId", async () => {
    const result = await SOLANA_JUPITER_HANDLERS["solana.predict.event"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("eventId");
  });

  it("solana.prices fails without mints", async () => {
    const result = await SOLANA_JUPITER_HANDLERS["solana.prices"]!(
      { mints: "" },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("mints");
  });

  it("solana.predict.search fails without query", async () => {
    const result = await SOLANA_JUPITER_HANDLERS["solana.predict.search"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("query");
  });
});
