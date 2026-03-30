import { describe, it, expect } from "vitest";
import { validateSwapRouteResponse, validateSwapBuildResponse } from "@tools/kyberswap/aggregator/validation.js";

const VALID_ROUTE_RESPONSE = {
  code: 0,
  message: "ok",
  data: {
    routeSummary: {
      tokenIn: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      amountIn: "1000000000000000000",
      amountInUsd: "2000",
      tokenOut: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      amountOut: "2000000000",
      amountOutUsd: "2000",
      gas: "150000",
      gasPrice: "50000000000",
      gasUsd: "7.50",
      route: [[{
        pool: "0x1234567890123456789012345678901234567890",
        tokenIn: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
        tokenOut: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        swapAmount: "1000000000000000000",
        amountOut: "2000000000",
        exchange: "uniswap-v3",
        poolType: "UniswapV3",
        poolExtra: {},
        extra: null,
      }]],
      routeID: "route-abc-123",
      checksum: "0xabc",
      timestamp: "1234567890",
    },
    routerAddress: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5",
  },
  requestId: "req-123",
};

describe("validateSwapRouteResponse", () => {
  it("rejects non-object", () => {
    expect(() => validateSwapRouteResponse(null)).toThrow();
    expect(() => validateSwapRouteResponse("string")).toThrow();
  });

  it("rejects missing data", () => {
    expect(() => validateSwapRouteResponse({ code: 0 })).toThrow();
  });

  it("parses valid response", () => {
    const result = validateSwapRouteResponse(VALID_ROUTE_RESPONSE);
    expect(result.code).toBe(0);
    expect(result.data.routeSummary.tokenIn).toBe("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE");
    expect(result.data.routeSummary.routeID).toBe("route-abc-123");
    expect(result.data.routerAddress).toBe("0x6131B5fae19EA4f9D964eAc0408E4408b66337b5");
    expect(result.requestId).toBe("req-123");
  });

  it("parses nested route steps", () => {
    const result = validateSwapRouteResponse(VALID_ROUTE_RESPONSE);
    expect(result.data.routeSummary.route).toHaveLength(1);
    expect(result.data.routeSummary.route[0]).toHaveLength(1);
    expect(result.data.routeSummary.route[0][0].exchange).toBe("uniswap-v3");
  });

  it("handles optional fields", () => {
    const withOptionals = {
      ...VALID_ROUTE_RESPONSE,
      data: {
        ...VALID_ROUTE_RESPONSE.data,
        routeSummary: {
          ...VALID_ROUTE_RESPONSE.data.routeSummary,
          l1FeeUsd: "0.5",
          extraFee: { feeAmount: "10", chargeFeeBy: "currency_in", isInBps: true, feeReceiver: "0x1234567890123456789012345678901234567890" },
        },
      },
    };
    const result = validateSwapRouteResponse(withOptionals);
    expect(result.data.routeSummary.l1FeeUsd).toBe("0.5");
    expect(result.data.routeSummary.extraFee?.feeAmount).toBe("10");
  });

  it("handles empty route array", () => {
    const noRoutes = {
      ...VALID_ROUTE_RESPONSE,
      data: {
        ...VALID_ROUTE_RESPONSE.data,
        routeSummary: { ...VALID_ROUTE_RESPONSE.data.routeSummary, route: [] },
      },
    };
    const result = validateSwapRouteResponse(noRoutes);
    expect(result.data.routeSummary.route).toEqual([]);
  });
});

describe("validateSwapBuildResponse", () => {
  const VALID_BUILD = {
    code: 0,
    data: {
      amountIn: "1000000000000000000",
      amountInUsd: "2000",
      amountOut: "2000000000",
      amountOutUsd: "2000",
      gas: "150000",
      gasUsd: "7.50",
      data: "0xabcdef",
      routerAddress: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5",
      transactionValue: "1000000000000000000",
    },
  };

  it("rejects non-object", () => {
    expect(() => validateSwapBuildResponse(null)).toThrow();
  });

  it("parses valid response", () => {
    const result = validateSwapBuildResponse(VALID_BUILD);
    expect(result.data.data).toBe("0xabcdef");
    expect(result.data.transactionValue).toBe("1000000000000000000");
    expect(result.data.routerAddress).toBe("0x6131B5fae19EA4f9D964eAc0408E4408b66337b5");
  });

  it("handles optional additionalCost fields", () => {
    const withCost = {
      ...VALID_BUILD,
      data: { ...VALID_BUILD.data, additionalCostUsd: "0.1", additionalCostMessage: "L1 gas" },
    };
    const result = validateSwapBuildResponse(withCost);
    expect(result.data.additionalCostUsd).toBe("0.1");
    expect(result.data.additionalCostMessage).toBe("L1 gas");
  });
});
