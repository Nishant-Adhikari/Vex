/**
 * Regression: GAS-RESERVE-PROMPT-ONLY
 *
 * NATIVE_GAS_RESERVE_ETH existed in handler-helpers.ts as a named constant but
 * carried no runtime enforcement — a native-spend swap could exhaust the full
 * wallet balance, leaving nothing for future forced-exit or gas. Fix:
 * capNativeAmountForGas() is implemented and exported from handler-helpers.ts,
 * and is called from both the KyberSwap and Uniswap native-spend paths.
 *
 * These tests cover the helper directly (unit), plus source-inspection guards
 * to verify both venues wire it in.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  capNativeAmountForGas,
  NATIVE_GAS_RESERVE_ETH,
} from "@vex-agent/tools/protocols/handler-helpers.js";

// Stable address used for all mock getBalance calls.
const WALLET = "0x1234567890abcdef1234567890abcdef12345678";
const RESERVE_WEI = BigInt(Math.round(NATIVE_GAS_RESERVE_ETH * 1e18));

describe("capNativeAmountForGas — unit", () => {
  it("GAS-RESERVE: requested amount that would exhaust balance is capped at balance - reserve", async () => {
    const balance = BigInt(Math.round(0.01 * 1e18)); // 0.01 ETH
    const mockPublicClient = { getBalance: vi.fn().mockResolvedValue(balance) };

    const requested = balance; // trying to spend all 0.01 ETH
    const result = await capNativeAmountForGas(
      mockPublicClient as Parameters<typeof capNativeAmountForGas>[0],
      WALLET,
      requested,
    );

    // Must return balance - reserve (0.005 ETH), not the full balance.
    expect(result).toBe(balance - RESERVE_WEI);
  });

  it("GAS-RESERVE: requested amount below balance-minus-reserve passes through unchanged", async () => {
    const balance = BigInt(Math.round(0.02 * 1e18)); // 0.02 ETH
    const mockPublicClient = { getBalance: vi.fn().mockResolvedValue(balance) };

    // 0.005 ETH — well below the 0.02-0.005=0.015 ETH safe max
    const requested = BigInt(Math.round(0.005 * 1e18));
    const result = await capNativeAmountForGas(
      mockPublicClient as Parameters<typeof capNativeAmountForGas>[0],
      WALLET,
      requested,
    );

    expect(result).toBe(requested); // unchanged
  });

  it("GAS-RESERVE: when balance <= reserve, returns 0n (cannot safely spend any native)", async () => {
    const balance = BigInt(Math.round(0.003 * 1e18)); // 0.003 ETH — below 0.005 reserve
    const mockPublicClient = { getBalance: vi.fn().mockResolvedValue(balance) };

    const result = await capNativeAmountForGas(
      mockPublicClient as Parameters<typeof capNativeAmountForGas>[0],
      WALLET,
      balance,
    );

    // No safe amount to spend — must return 0n, not a negative or uncapped value.
    expect(result).toBe(0n);
  });

  it("GAS-RESERVE: when getBalance throws, returns requested amount unchanged (fail-soft)", async () => {
    const mockPublicClient = {
      getBalance: vi.fn().mockRejectedValue(new Error("RPC unavailable")),
    };
    const requested = BigInt(Math.round(0.01 * 1e18));
    const result = await capNativeAmountForGas(
      mockPublicClient as Parameters<typeof capNativeAmountForGas>[0],
      WALLET,
      requested,
    );

    // Fail-soft: a balance read failure must not block the swap (prompt-level
    // guard still applies).  Return the original requested amount unchanged.
    expect(result).toBe(requested);
  });

  it("GAS-RESERVE: NATIVE_GAS_RESERVE_ETH is a positive number exported from handler-helpers", () => {
    expect(typeof NATIVE_GAS_RESERVE_ETH).toBe("number");
    expect(NATIVE_GAS_RESERVE_ETH).toBeGreaterThan(0);
  });
});

describe("GAS-RESERVE wiring — source inspection", () => {
  it("GAS-RESERVE: capNativeAmountForGas is wired into KyberSwap native handler", () => {
    const src = readFileSync(
      path.resolve("src/vex-agent/tools/protocols/kyberswap/handlers/swap.ts"),
      "utf-8",
    );
    expect(src).toMatch(/capNativeAmountForGas/);
  });

  it("GAS-RESERVE: capNativeAmountForGas is wired into Uniswap native handler", () => {
    const src = readFileSync(
      path.resolve("src/vex-agent/tools/protocols/uniswap/handlers/swap.ts"),
      "utf-8",
    );
    expect(src).toMatch(/capNativeAmountForGas/);
  });

  it("GAS-RESERVE: NATIVE_GAS_RESERVE_ETH is declared in handler-helpers.ts", () => {
    const src = readFileSync(
      path.resolve("src/vex-agent/tools/protocols/handler-helpers.ts"),
      "utf-8",
    );
    expect(src).toMatch(/NATIVE_GAS_RESERVE_ETH/);
  });
});
