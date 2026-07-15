/**
 * Economic-side classification for Uniswap swaps.
 *
 * The agent buys a token by calling `uniswap.swap.sell(WETH → TOKEN)` and sells
 * by calling `uniswap.swap.buy(TOKEN → WETH)`, so the tool's own `side` mislabels
 * those legs. `classifyEconomicSide` records the ECONOMIC direction from the token
 * legs (native-in → buy, native-out → sell, token↔token → tool `side`) — the value
 * that feeds `_tradeCapture.tradeSide`, the MOVES label, and the exit engine's
 * cost-basis. A native leg is either the `eth`/`native` sentinel (`isNative`) OR
 * the chain's wrapped-native (WETH) ERC-20 address passed directly. These
 * assertions lock the mapping regardless of which tool routed it.
 */

import { describe, it, expect } from "vitest";
import { classifyEconomicSide } from "@vex-agent/tools/protocols/uniswap/handlers/swap.js";

const WETH = "0x4200000000000000000000000000000000000006";
const TOKEN = "0x8Ff92566f2e81BDd68EDfAa8cde73942A723796b";
const OTHER = "0xc6911796042b15d7Fa4F6CDe69e245DdCd3d9c31";

describe("classifyEconomicSide", () => {
  it("native → token is a BUY even when routed via uniswap.swap.sell", () => {
    expect(
      classifyEconomicSide({
        tokenIn: { address: WETH, isNative: true },
        tokenOut: { address: TOKEN, isNative: false },
        wrappedNative: WETH,
        side: "sell",
      }),
    ).toBe("buy");
  });

  it("native → token is a BUY when routed via uniswap.swap.buy", () => {
    expect(
      classifyEconomicSide({
        tokenIn: { address: WETH, isNative: true },
        tokenOut: { address: TOKEN, isNative: false },
        wrappedNative: WETH,
        side: "buy",
      }),
    ).toBe("buy");
  });

  it("token → native is a SELL even when routed via uniswap.swap.buy", () => {
    expect(
      classifyEconomicSide({
        tokenIn: { address: TOKEN, isNative: false },
        tokenOut: { address: WETH, isNative: true },
        wrappedNative: WETH,
        side: "buy",
      }),
    ).toBe("sell");
  });

  it("token → native is a SELL when routed via uniswap.swap.sell", () => {
    expect(
      classifyEconomicSide({
        tokenIn: { address: TOKEN, isNative: false },
        tokenOut: { address: WETH, isNative: true },
        wrappedNative: WETH,
        side: "sell",
      }),
    ).toBe("sell");
  });

  it("token ↔ token (neither leg native) falls back to the tool's side", () => {
    expect(
      classifyEconomicSide({
        tokenIn: { address: OTHER, isNative: false },
        tokenOut: { address: TOKEN, isNative: false },
        wrappedNative: WETH,
        side: "buy",
      }),
    ).toBe("buy");
    expect(
      classifyEconomicSide({
        tokenIn: { address: OTHER, isNative: false },
        tokenOut: { address: TOKEN, isNative: false },
        wrappedNative: WETH,
        side: "sell",
      }),
    ).toBe("sell");
  });

  // Regression: the WETH ERC-20 address (not the eth/native sentinel) must still
  // classify as native — a WETH-funded buy routed via `uniswap.swap.sell` is a BUY,
  // and case differences in the address must not defeat the match.
  it("wrapped-native (WETH) address in is a BUY even with isNative:false", () => {
    expect(
      classifyEconomicSide({
        tokenIn: { address: WETH.toUpperCase(), isNative: false },
        tokenOut: { address: TOKEN, isNative: false },
        wrappedNative: WETH,
        side: "sell",
      }),
    ).toBe("buy");
  });

  it("wrapped-native (WETH) address out is a SELL even with isNative:false", () => {
    expect(
      classifyEconomicSide({
        tokenIn: { address: TOKEN, isNative: false },
        tokenOut: { address: WETH, isNative: false },
        wrappedNative: WETH,
        side: "buy",
      }),
    ).toBe("sell");
  });
});
