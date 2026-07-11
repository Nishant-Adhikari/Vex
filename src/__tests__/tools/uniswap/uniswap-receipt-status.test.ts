/**
 * Uniswap execution — a MINED-BUT-REVERTED receipt must FAIL, never pass.
 *
 * viem's `waitForTransactionReceipt` RESOLVES on a reverted transaction (it
 * returns the receipt with `status: "reverted"`; it does NOT throw). So awaiting
 * the receipt is not enough — the execution path must assert
 * `receipt.status === "success"`, exactly as the generic wallet send path already
 * does (`tools/internal/wallet/send-execute-evm.ts`).
 *
 * Regression guard for the Robinhood sell bug: an ERC-20 `approve()` that mines
 * REVERTED was silently treated as a successful approval, so the swap was sent
 * with zero allowance and reverted at `transferFrom` (STF / TRANSFER_FROM_FAILED)
 * — masking that the APPROVE is what failed. The swap send had the same gap: a
 * reverted swap was reported as an executed trade.
 */

import { describe, it, expect, vi } from "vitest";
import type { Address, Hex } from "viem";

import { ensureUniswapAllowanceExact } from "@tools/uniswap/erc20.js";
import { sendUniswapTransaction } from "@tools/uniswap/execute.js";
import { ErrorCodes, VexError } from "../../../errors.js";

// A registered Robinhood router (in UNISWAP_KNOWN_SPENDERS) so spender validation
// passes and we reach the receipt check. V3 SwapRouter02 on 4663.
const ROBINHOOD_V3_ROUTER = "0xcaf681a66d020601342297493863e78c959e5cb2" as Address;
const TOKEN = "0x8Ff92566f2e81BDd68EDfAa8cde73942A723796b" as Address;
const OWNER = "0x1111111111111111111111111111111111111111" as Address;
const TX_HASH = `0x${"ab".repeat(32)}` as Hex;

function clients(receiptStatus: "success" | "reverted", currentAllowance = 0n) {
  const waitForTransactionReceipt = vi.fn().mockResolvedValue({ status: receiptStatus });
  const publicClient = {
    readContract: vi.fn().mockResolvedValue(currentAllowance),
    waitForTransactionReceipt,
  } as unknown as Parameters<typeof ensureUniswapAllowanceExact>[0];
  const walletClient = {
    account: { address: OWNER },
    chain: { id: 4663 },
    writeContract: vi.fn().mockResolvedValue(TX_HASH),
    sendTransaction: vi.fn().mockResolvedValue(TX_HASH),
  } as unknown as Parameters<typeof ensureUniswapAllowanceExact>[1];
  return { publicClient, walletClient, waitForTransactionReceipt };
}

describe("ensureUniswapAllowanceExact — reverted approve", () => {
  it("throws APPROVAL_FAILED when the approve tx mines reverted", async () => {
    const { publicClient, walletClient } = clients("reverted");
    await expect(
      ensureUniswapAllowanceExact(publicClient, walletClient, TOKEN, ROBINHOOD_V3_ROUTER, 100n),
    ).rejects.toMatchObject({ code: ErrorCodes.APPROVAL_FAILED });
  });

  it("succeeds when the approve tx mines successfully", async () => {
    const { publicClient, walletClient } = clients("success");
    const result = await ensureUniswapAllowanceExact(
      publicClient,
      walletClient,
      TOKEN,
      ROBINHOOD_V3_ROUTER,
      100n,
    );
    expect(result?.txHash).toBe(TX_HASH);
  });
});

describe("sendUniswapTransaction — reverted swap", () => {
  it("throws SWAP_FAILED when the swap tx mines reverted", async () => {
    const { publicClient, walletClient } = clients("reverted");
    await expect(
      sendUniswapTransaction(
        publicClient as never,
        walletClient as never,
        { to: ROBINHOOD_V3_ROUTER, data: "0x" as Hex, value: 0n },
      ),
    ).rejects.toBeInstanceOf(VexError);
  });
});
