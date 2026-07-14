/**
 * Economic-side classification for Uniswap swaps.
 *
 * The agent buys a token by calling `uniswap.swap.sell(WETH → TOKEN)` and sells
 * by calling `uniswap.swap.buy(TOKEN → WETH)`, so the tool's own `side` mislabels
 * those legs. `classifyEconomicSide` records the ECONOMIC direction from the token
 * legs (native-in → buy, native-out → sell, token↔token → tool `side`) — the value
 * that feeds `_tradeCapture.tradeSide`, the MOVES label, and the exit engine's
 * cost-basis. These assertions lock the mapping regardless of which tool routed it.
 */

import { describe, it, expect } from "vitest";
import { classifyEconomicSide } from "@vex-agent/tools/protocols/uniswap/handlers/swap.js";

describe("classifyEconomicSide", () => {
  it("native → token is a BUY even when routed via uniswap.swap.sell", () => {
    expect(
      classifyEconomicSide({
        tokenInIsNative: true,
        tokenOutIsNative: false,
        side: "sell",
      }),
    ).toBe("buy");
  });

  it("native → token is a BUY when routed via uniswap.swap.buy", () => {
    expect(
      classifyEconomicSide({
        tokenInIsNative: true,
        tokenOutIsNative: false,
        side: "buy",
      }),
    ).toBe("buy");
  });

  it("token → native is a SELL even when routed via uniswap.swap.buy", () => {
    expect(
      classifyEconomicSide({
        tokenInIsNative: false,
        tokenOutIsNative: true,
        side: "buy",
      }),
    ).toBe("sell");
  });

  it("token → native is a SELL when routed via uniswap.swap.sell", () => {
    expect(
      classifyEconomicSide({
        tokenInIsNative: false,
        tokenOutIsNative: true,
        side: "sell",
      }),
    ).toBe("sell");
  });

  it("token ↔ token (neither leg native) falls back to the tool's side", () => {
    expect(
      classifyEconomicSide({
        tokenInIsNative: false,
        tokenOutIsNative: false,
        side: "buy",
      }),
    ).toBe("buy");
    expect(
      classifyEconomicSide({
        tokenInIsNative: false,
        tokenOutIsNative: false,
        side: "sell",
      }),
    ).toBe("sell");
  });
});
