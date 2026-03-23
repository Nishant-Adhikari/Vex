import { describe, it, expect } from "vitest";
import { validateSupportedAssetsResponse, validateDepositResponse, validateQuoteResponse, validateTransactionsResponse } from "../polymarket/bridge/validation.js";

describe("validateSupportedAssetsResponse", () => {
  it("parses assets", () => {
    const r = validateSupportedAssetsResponse({
      supportedAssets: [{ chainId: "1", chainName: "Ethereum", token: { name: "USDC", symbol: "USDC", address: "0x1", decimals: 6 }, minCheckoutUsd: 45 }],
    });
    expect(r).toHaveLength(1);
    expect(r[0].token.symbol).toBe("USDC");
  });
  it("handles empty", () => { expect(validateSupportedAssetsResponse({})).toEqual([]); });
});

describe("validateDepositResponse", () => {
  it("parses addresses", () => {
    const r = validateDepositResponse({ address: { evm: "0xabc", svm: "sol123", btc: "bc1q..." }, note: "test" });
    expect(r.address.evm).toBe("0xabc");
    expect(r.address.svm).toBe("sol123");
    expect(r.note).toBe("test");
  });
});

describe("validateQuoteResponse", () => {
  it("parses quote", () => {
    const r = validateQuoteResponse({ estCheckoutTimeMs: 25000, estInputUsd: 10, estOutputUsd: 9.95, estToTokenBaseUnit: "9950000", quoteId: "0xq1" });
    expect(r.quoteId).toBe("0xq1");
    expect(r.estOutputUsd).toBe(9.95);
  });
  it("throws for non-object", () => { expect(() => validateQuoteResponse(null)).toThrow(); });
});

describe("validateTransactionsResponse", () => {
  it("parses transactions", () => {
    const r = validateTransactionsResponse({
      transactions: [{ fromChainId: "1", fromTokenAddress: "0x1", fromAmountBaseUnit: "1000000", toChainId: "137", toTokenAddress: "0x2", status: "COMPLETED", txHash: "0xtx" }],
    });
    expect(r[0].status).toBe("COMPLETED");
    expect(r[0].txHash).toBe("0xtx");
  });
  it("handles empty", () => { expect(validateTransactionsResponse({})).toEqual([]); });
});
