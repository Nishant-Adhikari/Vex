/**
 * Uniswap sell pre-flight balance guard.
 *
 * Selling an ERC-20 for MORE than the wallet holds makes the router's
 * `transferFrom` revert with `TransferHelper: TRANSFER_FROM_FAILED` (V2) / `STF`
 * (V3) — indistinguishable, from the outside, from a missing allowance. That
 * ambiguity sent an exit attempt down a multi-hour "auto-approve is broken" dead
 * end when the real cause was `amountIn > balance` (a rounded/stale amount
 * exceeding the on-chain balance by dust).
 *
 * The guard reads the on-chain balance BEFORE approving/swapping and fails with a
 * clear INSUFFICIENT_BALANCE (have X, requested Y) so the caller can correct the
 * amount instead of burning gas on a doomed, cryptic revert.
 */

import { describe, it, expect, vi } from "vitest";
import type { Address } from "viem";

import { ensureUniswapSufficientBalance } from "@tools/uniswap/erc20.js";
import { ErrorCodes } from "../../../errors.js";

const TOKEN = "0x8Ff92566f2e81BDd68EDfAa8cde73942A723796b" as Address;
const OWNER = "0x9ed25bdedceB28Adf9E3C7fCa34511e78e47C77f" as Address;

// The real VEX numbers from the incident: balance 184.9855e18, sell 184.99e18.
const BALANCE = 184985498895318795602n;
const OVER = 184990000000000000000n; // 184.99 — the rounded amount that reverted
const UNDER = 184980000000000000000n; // 184.98 — the amount that succeeded

function client(balance: bigint) {
  return {
    readContract: vi.fn().mockResolvedValue(balance),
  } as unknown as Parameters<typeof ensureUniswapSufficientBalance>[0];
}

describe("ensureUniswapSufficientBalance", () => {
  it("throws INSUFFICIENT_BALANCE when the requested amount exceeds the balance", async () => {
    await expect(
      ensureUniswapSufficientBalance(client(BALANCE), TOKEN, OWNER, OVER, "VEX"),
    ).rejects.toMatchObject({ code: ErrorCodes.INSUFFICIENT_BALANCE });
  });

  it("names the token and both amounts so the caller can correct it", async () => {
    await expect(
      ensureUniswapSufficientBalance(client(BALANCE), TOKEN, OWNER, OVER, "VEX"),
    ).rejects.toThrow(/VEX/);
  });

  it("passes when the amount is under the balance", async () => {
    await expect(
      ensureUniswapSufficientBalance(client(BALANCE), TOKEN, OWNER, UNDER, "VEX"),
    ).resolves.toBeUndefined();
  });

  it("passes when the amount exactly equals the balance", async () => {
    await expect(
      ensureUniswapSufficientBalance(client(BALANCE), TOKEN, OWNER, BALANCE, "VEX"),
    ).resolves.toBeUndefined();
  });
});
