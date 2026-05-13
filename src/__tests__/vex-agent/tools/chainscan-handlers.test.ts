import { describe, it, expect } from "vitest";
import { CHAINSCAN_HANDLERS } from "../../../vex-agent/tools/protocols/0g/chainscan/handlers.js";
import { CHAINSCAN_TOOLS } from "../../../vex-agent/tools/protocols/0g/chainscan/manifest.js";

describe("chainscan handlers", () => {
  // ── Handler coverage ─────────────────────────────────────────────

  it("has a handler for every manifest toolId", () => {
    const handlerKeys = new Set(Object.keys(CHAINSCAN_HANDLERS));
    const manifestIds = CHAINSCAN_TOOLS.map(t => t.toolId);
    const missing = manifestIds.filter(id => !handlerKeys.has(id));
    expect(missing).toEqual([]);
  });

  it("has no extra handlers without manifests", () => {
    const manifestIds = new Set(CHAINSCAN_TOOLS.map(t => t.toolId));
    const handlerKeys = Object.keys(CHAINSCAN_HANDLERS);
    const extra = handlerKeys.filter(key => !manifestIds.has(key));
    expect(extra).toEqual([]);
  });

  it("handler count matches manifest count (20)", () => {
    expect(Object.keys(CHAINSCAN_HANDLERS)).toHaveLength(20);
  });

  it("every handler is a function", () => {
    for (const [, handler] of Object.entries(CHAINSCAN_HANDLERS)) {
      expect(typeof handler).toBe("function");
    }
  });

  // ── Required param validation ────────────────────────────────────

  // Account
  it("chainscan.account.balance fails without address", async () => {
    const result = await CHAINSCAN_HANDLERS["chainscan.account.balance"]!(
      {},
      { sessionPermission: "restricted", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("address");
  });

  it("chainscan.account.balanceMulti fails without addresses", async () => {
    const result = await CHAINSCAN_HANDLERS["chainscan.account.balanceMulti"]!(
      {},
      { sessionPermission: "restricted", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("addresses");
  });

  it("chainscan.account.transactions fails without address", async () => {
    const result = await CHAINSCAN_HANDLERS["chainscan.account.transactions"]!(
      {},
      { sessionPermission: "restricted", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("address");
  });

  it("chainscan.account.tokenTransfers fails without address", async () => {
    const result = await CHAINSCAN_HANDLERS["chainscan.account.tokenTransfers"]!(
      {},
      { sessionPermission: "restricted", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("address");
  });

  it("chainscan.account.nftTransfers fails without address", async () => {
    const result = await CHAINSCAN_HANDLERS["chainscan.account.nftTransfers"]!(
      {},
      { sessionPermission: "restricted", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("address");
  });

  it("chainscan.account.tokenBalance fails without address and contractAddress", async () => {
    const result = await CHAINSCAN_HANDLERS["chainscan.account.tokenBalance"]!(
      {},
      { sessionPermission: "restricted", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("address");
  });

  it("chainscan.account.tokenBalance fails with only address", async () => {
    const result = await CHAINSCAN_HANDLERS["chainscan.account.tokenBalance"]!(
      { address: "0x1234567890abcdef1234567890abcdef12345678" },
      { sessionPermission: "restricted", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("contractAddress");
  });

  // Transaction
  it("chainscan.tx.status fails without txHash", async () => {
    const result = await CHAINSCAN_HANDLERS["chainscan.tx.status"]!(
      {},
      { sessionPermission: "restricted", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("txHash");
  });

  it("chainscan.tx.receipt fails without txHash", async () => {
    const result = await CHAINSCAN_HANDLERS["chainscan.tx.receipt"]!(
      {},
      { sessionPermission: "restricted", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("txHash");
  });

  // Contract
  it("chainscan.contract.abi fails without address", async () => {
    const result = await CHAINSCAN_HANDLERS["chainscan.contract.abi"]!(
      {},
      { sessionPermission: "restricted", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("address");
  });

  it("chainscan.contract.source fails without address", async () => {
    const result = await CHAINSCAN_HANDLERS["chainscan.contract.source"]!(
      {},
      { sessionPermission: "restricted", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("address");
  });

  it("chainscan.contract.creation fails without addresses", async () => {
    const result = await CHAINSCAN_HANDLERS["chainscan.contract.creation"]!(
      {},
      { sessionPermission: "restricted", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("addresses");
  });

  // Decode
  it("chainscan.decode.byHashes fails without hashes", async () => {
    const result = await CHAINSCAN_HANDLERS["chainscan.decode.byHashes"]!(
      {},
      { sessionPermission: "restricted", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("hashes");
  });

  it("chainscan.decode.raw fails without contracts and inputs", async () => {
    const result = await CHAINSCAN_HANDLERS["chainscan.decode.raw"]!(
      {},
      { sessionPermission: "restricted", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("contracts");
  });

  it("chainscan.decode.raw fails with only contracts", async () => {
    const result = await CHAINSCAN_HANDLERS["chainscan.decode.raw"]!(
      { contracts: "0x1234567890abcdef1234567890abcdef12345678" },
      { sessionPermission: "restricted", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("inputs");
  });

  // Token
  it("chainscan.token.supply fails without contractAddress", async () => {
    const result = await CHAINSCAN_HANDLERS["chainscan.token.supply"]!(
      {},
      { sessionPermission: "restricted", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("contractAddress");
  });

  // Statistics
  it("chainscan.stats.holders fails without contract", async () => {
    const result = await CHAINSCAN_HANDLERS["chainscan.stats.holders"]!(
      {},
      { sessionPermission: "restricted", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("contract");
  });

  it("chainscan.stats.transfers fails without contract", async () => {
    const result = await CHAINSCAN_HANDLERS["chainscan.stats.transfers"]!(
      {},
      { sessionPermission: "restricted", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("contract");
  });

  it("chainscan.stats.participants fails without contract", async () => {
    const result = await CHAINSCAN_HANDLERS["chainscan.stats.participants"]!(
      {},
      { sessionPermission: "restricted", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("contract");
  });
});
