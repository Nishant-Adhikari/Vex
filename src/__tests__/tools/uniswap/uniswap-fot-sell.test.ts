/**
 * V2 sells must use the fee-on-transfer-SUPPORTING router functions.
 *
 * A fee-on-transfer (FoT) token delivers fewer tokens to the pair than were
 * sent, so Uniswap V2's plain `swapExactTokensForETH` / `swapExactTokensForTokens`
 * revert with `UniswapV2: K` — the pair's post-swap reserves break the constant-
 * product invariant. This is indistinguishable, from the outside, from an
 * allowance failure and makes such tokens un-sellable in-band (observed with
 * ROODFI on Robinhood Chain).
 *
 * Uniswap ships `...SupportingFeeOnTransferTokens` variants that settle against
 * the ACTUAL received balances. They are behaviourally identical for non-FoT
 * tokens (received == sent), so using them for every token-input V2 sell is safe
 * and makes FoT exits possible. The native-input BUY path is unaffected.
 */

import { describe, it, expect } from "vitest";
import { decodeFunctionData, getAddress, type Address } from "viem";

import { buildV2SwapTx, type BuildSwapArgs } from "@tools/uniswap/execute.js";
import { UNISWAP_V2_ROUTER_ABI } from "@tools/uniswap/abis.js";
import type { UniswapDeployment } from "@tools/uniswap/deployments.js";
import type { UniswapRoute } from "@tools/uniswap/types.js";

const TOKEN = getAddress("0xc7c9341765C3bEebf0Ea2aB05e69b68991A9A470"); // ROODFI
const VIRTUAL = getAddress("0xc6911796042b15d7Fa4F6CDe69e245DdCd3d9c31");
const WETH = getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
const RECIPIENT = getAddress("0x9ed25bdedceB28Adf9E3C7fCa34511e78e47C77f");

const deployment = {
  v2: { router02: "0x89e5db8b5aa49aa85ac63f691524311aeb649eba" as Address },
} as unknown as UniswapDeployment;

function args(route: UniswapRoute, tokenOutIsNative: boolean, tokenInIsNative = false): BuildSwapArgs {
  return {
    deployment, route, amountIn: 100n, minAmountOut: 90n,
    recipient: RECIPIENT, deadline: 111n, tokenInIsNative, tokenOutIsNative,
  };
}

function fn(data: `0x${string}`): string {
  return decodeFunctionData({ abi: UNISWAP_V2_ROUTER_ABI, data }).functionName;
}

describe("buildV2SwapTx — fee-on-transfer-safe sells", () => {
  it("token → ETH uses swapExactTokensForETHSupportingFeeOnTransferTokens", () => {
    const route: UniswapRoute = { version: "v2", path: [TOKEN, VIRTUAL, WETH], amountOut: 100n };
    const tx = buildV2SwapTx(args(route, /* tokenOutIsNative */ true));
    expect(fn(tx.data)).toBe("swapExactTokensForETHSupportingFeeOnTransferTokens");
    expect(tx.value).toBe(0n);
  });

  it("token → token uses swapExactTokensForTokensSupportingFeeOnTransferTokens", () => {
    const route: UniswapRoute = { version: "v2", path: [TOKEN, WETH], amountOut: 100n };
    const tx = buildV2SwapTx(args(route, /* tokenOutIsNative */ false));
    expect(fn(tx.data)).toBe("swapExactTokensForTokensSupportingFeeOnTransferTokens");
  });

  it("native input (a BUY) is unchanged — swapExactETHForTokens", () => {
    const route: UniswapRoute = { version: "v2", path: [WETH, TOKEN], amountOut: 100n };
    const tx = buildV2SwapTx(args(route, /* tokenOutIsNative */ false, /* tokenInIsNative */ true));
    expect(fn(tx.data)).toBe("swapExactETHForTokens");
    expect(tx.value).toBe(100n);
  });
});
