/**
 * Equivalence battery for the Zod conversion of the KyberSwap Aggregator
 * response validators (codex-002 Phase 2). Every expectation is derived from
 * the ORIGINAL hand-written logic and proves behavior preservation:
 *
 *   - valid responses parse to identical shapes;
 *   - partial/missing inputs land the EXACT defaults (optional → undefined,
 *     poolExtra/extra → null, extraFee fields → "" / undefined);
 *   - wrong-typed required fields throw VexError(KYBER_API_ERROR) with the
 *     exact field-path message;
 *   - non-record roots / non-record `data` / non-record route step /
 *     non-record routeSummary throw a PLAIN Error with the exact message
 *     (NOT a VexError) — the mixed-pattern boundary;
 *   - nested `route` mapping: non-array path → [], element-wise step parse,
 *     bad step element throws (steps are required, not filtered);
 *   - `code` (asNumber) ACCEPTS ±Infinity and REJECTS NaN — proving we did
 *     NOT regress to Zod 4 `z.number()` (which would reject Infinity).
 */

import { describe, it, expect } from "vitest";
import { VexError, ErrorCodes } from "../../errors.js";
import {
  validateSwapRouteResponse,
  validateSwapBuildResponse,
} from "@tools/kyberswap/aggregator/validation.js";

const ADDR_IN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const ADDR_OUT = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const ROUTER = "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5";
const POOL = "0x1234567890123456789012345678901234567890";

function validStep() {
  return {
    pool: POOL,
    tokenIn: ADDR_IN,
    tokenOut: ADDR_OUT,
    swapAmount: "1000000000000000000",
    amountOut: "2000000000",
    exchange: "uniswap-v3",
    poolType: "UniswapV3",
    poolExtra: { foo: 1 },
    extra: null,
  };
}

function validRouteResponse() {
  return {
    code: 0,
    message: "ok",
    data: {
      routeSummary: {
        tokenIn: ADDR_IN,
        amountIn: "1000000000000000000",
        amountInUsd: "2000",
        tokenOut: ADDR_OUT,
        amountOut: "2000000000",
        amountOutUsd: "2000",
        gas: "150000",
        gasPrice: "50000000000",
        gasUsd: "7.50",
        route: [[validStep()]],
        routeID: "route-abc-123",
        checksum: "0xabc",
        timestamp: "1234567890",
      },
      routerAddress: ROUTER,
    },
    requestId: "req-123",
  };
}

function validBuildResponse() {
  return {
    code: 0,
    data: {
      amountIn: "1000000000000000000",
      amountInUsd: "2000",
      amountOut: "2000000000",
      amountOutUsd: "2000",
      gas: "150000",
      gasUsd: "7.50",
      data: "0xabcdef",
      routerAddress: ROUTER,
      transactionValue: "1000000000000000000",
    },
  };
}

// ---------------------------------------------------------------------------
// validateSwapRouteResponse
// ---------------------------------------------------------------------------

describe("validateSwapRouteResponse — equivalence", () => {
  it("parses a fully valid response identically", () => {
    const r = validateSwapRouteResponse(validRouteResponse());
    expect(r.code).toBe(0);
    expect(r.message).toBe("ok");
    expect(r.requestId).toBe("req-123");
    expect(r.data.routerAddress).toBe(ROUTER);
    const s = r.data.routeSummary;
    expect(s.tokenIn).toBe(ADDR_IN);
    expect(s.routeID).toBe("route-abc-123");
    expect(s.checksum).toBe("0xabc");
    expect(s.timestamp).toBe("1234567890");
    expect(s.route).toHaveLength(1);
    expect(s.route[0]).toHaveLength(1);
    expect(s.route[0][0].exchange).toBe("uniswap-v3");
    expect(s.route[0][0].poolExtra).toEqual({ foo: 1 });
    expect(s.route[0][0].extra).toBeNull();
  });

  it("lands exact defaults for missing optionals (message/requestId/timestamp/l1FeeUsd → undefined)", () => {
    const raw = validRouteResponse();
    delete (raw as Record<string, unknown>).message;
    delete (raw as Record<string, unknown>).requestId;
    delete (raw.data.routeSummary as Record<string, unknown>).timestamp;
    const r = validateSwapRouteResponse(raw);
    expect(r.message).toBeUndefined();
    expect(r.requestId).toBeUndefined();
    expect(r.data.routeSummary.timestamp).toBeUndefined();
    expect(r.data.routeSummary.l1FeeUsd).toBeUndefined();
    // extraFee absent → parseExtraFee(undefined) → undefined.
    expect(r.data.routeSummary.extraFee).toBeUndefined();
  });

  it("empty-string optionals coerce to undefined (asOptionalString)", () => {
    const raw = validRouteResponse();
    (raw as Record<string, unknown>).message = "";
    (raw.data.routeSummary as Record<string, unknown>).timestamp = "";
    const r = validateSwapRouteResponse(raw);
    expect(r.message).toBeUndefined();
    expect(r.data.routeSummary.timestamp).toBeUndefined();
  });

  it("route step defaults poolExtra/extra to null when absent", () => {
    const raw = validRouteResponse();
    const step = raw.data.routeSummary.route[0][0] as Record<string, unknown>;
    delete step.poolExtra;
    delete step.extra;
    const r = validateSwapRouteResponse(raw);
    expect(r.data.routeSummary.route[0][0].poolExtra).toBeNull();
    expect(r.data.routeSummary.route[0][0].extra).toBeNull();
  });

  it("parseExtraFee: record present → feeAmount defaults to '' and bad enum/bool/string → undefined", () => {
    const raw = validRouteResponse();
    (raw.data.routeSummary as Record<string, unknown>).extraFee = {
      feeAmount: 123, // non-string → ""
      chargeFeeBy: "bogus", // not in enum → undefined
      isInBps: "yes", // non-boolean → undefined
      feeReceiver: 5, // non-string → undefined
    };
    const r = validateSwapRouteResponse(raw);
    expect(r.data.routeSummary.extraFee).toEqual({
      feeAmount: "",
      chargeFeeBy: undefined,
      isInBps: undefined,
      feeReceiver: undefined,
    });
  });

  it("parseExtraFee: valid record preserves enum/boolean/strings", () => {
    const raw = validRouteResponse();
    (raw.data.routeSummary as Record<string, unknown>).extraFee = {
      feeAmount: "10",
      chargeFeeBy: "currency_out",
      isInBps: true,
      feeReceiver: POOL,
    };
    const r = validateSwapRouteResponse(raw);
    expect(r.data.routeSummary.extraFee).toEqual({
      feeAmount: "10",
      chargeFeeBy: "currency_out",
      isInBps: true,
      feeReceiver: POOL,
    });
  });

  it("parseExtraFee: non-record extraFee → undefined", () => {
    const raw = validRouteResponse();
    (raw.data.routeSummary as Record<string, unknown>).extraFee = "not-an-object";
    const r = validateSwapRouteResponse(raw);
    expect(r.data.routeSummary.extraFee).toBeUndefined();
  });

  it("route: non-array root → [], non-array path element → []", () => {
    const raw1 = validRouteResponse();
    (raw1.data.routeSummary as Record<string, unknown>).route = "nope";
    expect(validateSwapRouteResponse(raw1).data.routeSummary.route).toEqual([]);

    const raw2 = validRouteResponse();
    (raw2.data.routeSummary as Record<string, unknown>).route = [123, [validStep()]];
    const r2 = validateSwapRouteResponse(raw2);
    expect(r2.data.routeSummary.route).toHaveLength(2);
    expect(r2.data.routeSummary.route[0]).toEqual([]); // non-array path → []
    expect(r2.data.routeSummary.route[1]).toHaveLength(1);
  });

  // PLAIN Error (NOT VexError) on structural/root mismatches — mixed pattern.
  it("non-record root → plain Error with exact message (NOT VexError)", () => {
    for (const bad of [null, "string", 5, undefined, [1, 2]]) {
      let caught: unknown;
      try {
        validateSwapRouteResponse(bad);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(VexError);
      expect((caught as Error).message).toBe("Expected KyberSwap route response object");
    }
  });

  it("non-record data → plain Error with exact message (NOT VexError)", () => {
    let caught: unknown;
    try {
      validateSwapRouteResponse({ code: 0, data: "nope" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(VexError);
    expect((caught as Error).message).toBe("Expected KyberSwap route response data");
  });

  it("non-record routeSummary → plain Error (NOT VexError)", () => {
    const raw = validRouteResponse();
    (raw.data as Record<string, unknown>).routeSummary = "nope";
    let caught: unknown;
    try {
      validateSwapRouteResponse(raw);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(VexError);
    expect((caught as Error).message).toBe("routeSummary must be an object");
  });

  it("non-record route step → plain Error (NOT VexError)", () => {
    const raw = validRouteResponse();
    (raw.data.routeSummary as Record<string, unknown>).route = [["not-an-object"]];
    let caught: unknown;
    try {
      validateSwapRouteResponse(raw);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(VexError);
    expect((caught as Error).message).toBe("route step must be an object");
  });

  // VexError(KYBER_API_ERROR) on required scalar field failures.
  it("missing required scalar fields throw VexError(KYBER_API_ERROR) with exact field message", () => {
    const cases: Array<[(raw: ReturnType<typeof validRouteResponse>) => void, string]> = [
      [(r) => { delete (r.data.routeSummary as Record<string, unknown>).tokenIn; }, "routeSummary.tokenIn"],
      [(r) => { delete (r.data.routeSummary as Record<string, unknown>).routeID; }, "routeSummary.routeID"],
      [(r) => { delete (r.data.routeSummary as Record<string, unknown>).checksum; }, "routeSummary.checksum"],
      [(r) => { delete (r.data as Record<string, unknown>).routerAddress; }, "data.routerAddress"],
      [(r) => { delete (r.data.routeSummary.route[0][0] as Record<string, unknown>).pool; }, "route.pool"],
      [(r) => { delete (r.data.routeSummary.route[0][0] as Record<string, unknown>).exchange; }, "route.exchange"],
    ];
    for (const [mutate, field] of cases) {
      const raw = validRouteResponse();
      mutate(raw);
      let caught: unknown;
      try {
        validateSwapRouteResponse(raw);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(VexError);
      expect((caught as VexError).code).toBe(ErrorCodes.KYBER_API_ERROR);
      expect((caught as VexError).message).toBe(`Invalid KyberSwap Aggregator response: missing ${field}`);
    }
  });

  it("empty-string required field throws VexError (asString rejects '')", () => {
    const raw = validRouteResponse();
    (raw.data.routeSummary as Record<string, unknown>).tokenIn = "";
    let caught: unknown;
    try {
      validateSwapRouteResponse(raw);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(VexError);
    expect((caught as VexError).message).toBe("Invalid KyberSwap Aggregator response: missing routeSummary.tokenIn");
  });

  // Zod-4 numeric gotcha — `code` used asNumber.
  it("code ACCEPTS ±Infinity (asNumber parity; NOT z.number())", () => {
    const rawPos = validRouteResponse();
    (rawPos as Record<string, unknown>).code = Infinity;
    expect(validateSwapRouteResponse(rawPos).code).toBe(Infinity);

    const rawNeg = validRouteResponse();
    (rawNeg as Record<string, unknown>).code = -Infinity;
    expect(validateSwapRouteResponse(rawNeg).code).toBe(-Infinity);
  });

  it("code REJECTS NaN and non-number with VexError(missing code)", () => {
    for (const bad of [NaN, "0", null, undefined]) {
      const raw = validRouteResponse();
      (raw as Record<string, unknown>).code = bad;
      let caught: unknown;
      try {
        validateSwapRouteResponse(raw);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(VexError);
      expect((caught as VexError).code).toBe(ErrorCodes.KYBER_API_ERROR);
      expect((caught as VexError).message).toBe("Invalid KyberSwap Aggregator response: missing code");
    }
  });
});

// ---------------------------------------------------------------------------
// validateSwapBuildResponse
// ---------------------------------------------------------------------------

describe("validateSwapBuildResponse — equivalence", () => {
  it("parses a fully valid response identically", () => {
    const r = validateSwapBuildResponse(validBuildResponse());
    expect(r.code).toBe(0);
    expect(r.data.amountIn).toBe("1000000000000000000");
    expect(r.data.data).toBe("0xabcdef");
    expect(r.data.routerAddress).toBe(ROUTER);
    expect(r.data.transactionValue).toBe("1000000000000000000");
  });

  it("lands exact defaults for missing optionals", () => {
    const r = validateSwapBuildResponse(validBuildResponse());
    expect(r.message).toBeUndefined();
    expect(r.requestId).toBeUndefined();
    expect(r.data.additionalCostUsd).toBeUndefined();
    expect(r.data.additionalCostMessage).toBeUndefined();
  });

  it("preserves additionalCost optionals when present", () => {
    const raw = validBuildResponse();
    (raw.data as Record<string, unknown>).additionalCostUsd = "0.1";
    (raw.data as Record<string, unknown>).additionalCostMessage = "L1 gas";
    const r = validateSwapBuildResponse(raw);
    expect(r.data.additionalCostUsd).toBe("0.1");
    expect(r.data.additionalCostMessage).toBe("L1 gas");
  });

  it("non-record root → plain Error with exact message (NOT VexError)", () => {
    for (const bad of [null, "string", 5, [1]]) {
      let caught: unknown;
      try {
        validateSwapBuildResponse(bad);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(VexError);
      expect((caught as Error).message).toBe("Expected KyberSwap build response object");
    }
  });

  it("non-record data → plain Error with exact message (NOT VexError)", () => {
    let caught: unknown;
    try {
      validateSwapBuildResponse({ code: 0, data: 5 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(VexError);
    expect((caught as Error).message).toBe("Expected KyberSwap build response data");
  });

  it("missing required scalar fields throw VexError(KYBER_API_ERROR) with exact field message", () => {
    const fields: Array<[string, string]> = [
      ["amountIn", "data.amountIn"],
      ["data", "data.data"],
      ["routerAddress", "data.routerAddress"],
      ["transactionValue", "data.transactionValue"],
    ];
    for (const [key, field] of fields) {
      const raw = validBuildResponse();
      delete (raw.data as Record<string, unknown>)[key];
      let caught: unknown;
      try {
        validateSwapBuildResponse(raw);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(VexError);
      expect((caught as VexError).code).toBe(ErrorCodes.KYBER_API_ERROR);
      expect((caught as VexError).message).toBe(`Invalid KyberSwap Aggregator response: missing ${field}`);
    }
  });

  it("code ACCEPTS Infinity, REJECTS NaN", () => {
    const rawInf = validBuildResponse();
    (rawInf as Record<string, unknown>).code = Infinity;
    expect(validateSwapBuildResponse(rawInf).code).toBe(Infinity);

    const rawNaN = validBuildResponse();
    (rawNaN as Record<string, unknown>).code = NaN;
    let caught: unknown;
    try {
      validateSwapBuildResponse(rawNaN);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(VexError);
    expect((caught as VexError).message).toBe("Invalid KyberSwap Aggregator response: missing code");
  });
});
