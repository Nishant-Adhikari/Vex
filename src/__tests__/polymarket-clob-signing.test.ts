import { describe, it, expect } from "vitest";
import { buildClobOrder } from "../polymarket/clob/signing.js";

describe("buildClobOrder", () => {
  const BASE = { maker: "0x1234567890123456789012345678901234567890", signer: "0x1234567890123456789012345678901234567890", tokenId: "12345", makerAmount: "100000000", takerAmount: "50000000", side: "BUY" as const, feeRateBps: "30" };

  it("returns all required fields", () => {
    const order = buildClobOrder(BASE);
    expect(order.maker).toBe(BASE.maker);
    expect(order.signer).toBe(BASE.signer);
    expect(order.taker).toBe("0x0000000000000000000000000000000000000000");
    expect(order.tokenId).toBe("12345");
    expect(order.makerAmount).toBe("100000000");
    expect(order.takerAmount).toBe("50000000");
    expect(order.side).toBe("BUY");
    expect(order.feeRateBps).toBe("30");
    expect(typeof order.salt).toBe("number");
  });

  it("generates random salt", () => {
    const a = buildClobOrder(BASE);
    const b = buildClobOrder(BASE);
    // Highly unlikely to be the same
    expect(a.salt).not.toBe(b.salt);
  });

  it("defaults nonce and expiration to '0'", () => {
    const order = buildClobOrder(BASE);
    expect(order.nonce).toBe("0");
    expect(order.expiration).toBe("0");
  });

  it("accepts custom nonce and expiration", () => {
    const order = buildClobOrder({ ...BASE, nonce: "5", expiration: "1735689600" });
    expect(order.nonce).toBe("5");
    expect(order.expiration).toBe("1735689600");
  });

  it("defaults signatureType to 0 (EOA)", () => {
    const order = buildClobOrder(BASE);
    expect(order.signatureType).toBe(0);
  });

  it("maps SELL side", () => {
    const order = buildClobOrder({ ...BASE, side: "SELL" });
    expect(order.side).toBe("SELL");
  });
});
