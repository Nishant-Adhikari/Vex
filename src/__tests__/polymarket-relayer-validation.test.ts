import { describe, it, expect } from "vitest";
import { validateSubmitResponse, validateTransactionsResponse, validateNonceResponse, validateDeployedResponse, validateApiKeysResponse } from "../tools/polymarket/relayer/validation.js";

describe("validateSubmitResponse", () => {
  it("parses response", () => {
    const r = validateSubmitResponse({ transactionID: "uuid-1", transactionHash: "", state: "STATE_NEW" });
    expect(r.transactionID).toBe("uuid-1");
    expect(r.state).toBe("STATE_NEW");
  });
  it("throws for non-object", () => { expect(() => validateSubmitResponse(null)).toThrow(); });
});

describe("validateTransactionsResponse", () => {
  it("parses array", () => {
    const r = validateTransactionsResponse([{
      transactionID: "id1", transactionHash: "0xhash", from: "0x1", to: "0x2",
      proxyAddress: "0x3", data: "0x", nonce: "5", state: "STATE_CONFIRMED", type: "SAFE", owner: "0x1",
      createdAt: "2024-01-01", updatedAt: "2024-01-01",
    }]);
    expect(r[0].state).toBe("STATE_CONFIRMED");
  });
  it("throws for non-array", () => { expect(() => validateTransactionsResponse(null)).toThrow(); });
});

describe("validateNonceResponse", () => {
  it("parses nonce", () => { expect(validateNonceResponse({ nonce: "31" }).nonce).toBe("31"); });
  it("defaults", () => { expect(validateNonceResponse(null).nonce).toBe("0"); });
});

describe("validateDeployedResponse", () => {
  it("parses deployed=true", () => { expect(validateDeployedResponse({ deployed: true }).deployed).toBe(true); });
  it("defaults to false", () => { expect(validateDeployedResponse(null).deployed).toBe(false); });
});

describe("validateApiKeysResponse", () => {
  it("parses keys", () => {
    const r = validateApiKeysResponse([{ apiKey: "key1", address: "0x1", createdAt: "2024-01-01", updatedAt: "2024-01-01" }]);
    expect(r[0].apiKey).toBe("key1");
  });
  it("handles non-array", () => { expect(validateApiKeysResponse(null)).toEqual([]); });
});
