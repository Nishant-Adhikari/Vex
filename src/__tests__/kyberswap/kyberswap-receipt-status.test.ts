/**
 * KyberSwap execution — a MINED-BUT-REVERTED receipt must FAIL, never pass.
 *
 * Same class of bug as the Uniswap path: viem's `waitForTransactionReceipt`
 * RESOLVES on a reverted transaction (`status: "reverted"`, no throw), so a
 * reverted `approve()` was silently treated as a successful approval and a
 * reverted swap was reported as executed. The execution path must assert
 * `receipt.status === "success"`.
 */

import { describe, it, expect, vi } from "vitest";
import type { Address, Hex } from "viem";

import { ensureKyberAllowance, sendKyberTransaction } from "@tools/kyberswap/evm/erc20.js";
import { META_AGGREGATION_ROUTER_V2 } from "@tools/kyberswap/constants.js";
import { ErrorCodes } from "../../errors.js";

const TOKEN = "0x8Ff92566f2e81BDd68EDfAa8cde73942A723796b" as Address;
const OWNER = "0x1111111111111111111111111111111111111111" as Address;
const TX_HASH = `0x${"cd".repeat(32)}` as Hex;

function clients(receiptStatus: "success" | "reverted", currentAllowance = 0n) {
  const publicClient = {
    readContract: vi.fn().mockResolvedValue(currentAllowance),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: receiptStatus, logs: [] }),
  } as unknown as Parameters<typeof ensureKyberAllowance>[0];
  const walletClient = {
    account: { address: OWNER },
    chain: { id: 1 },
    writeContract: vi.fn().mockResolvedValue(TX_HASH),
    sendTransaction: vi.fn().mockResolvedValue(TX_HASH),
  } as unknown as Parameters<typeof ensureKyberAllowance>[1];
  return { publicClient, walletClient };
}

describe("ensureKyberAllowance — reverted approve", () => {
  it("throws APPROVAL_FAILED when the approve tx mines reverted", async () => {
    const { publicClient, walletClient } = clients("reverted");
    await expect(
      ensureKyberAllowance(publicClient, walletClient, TOKEN, META_AGGREGATION_ROUTER_V2, 100n),
    ).rejects.toMatchObject({ code: ErrorCodes.APPROVAL_FAILED });
  });

  it("succeeds when the approve tx mines successfully", async () => {
    const { publicClient, walletClient } = clients("success");
    const result = await ensureKyberAllowance(
      publicClient,
      walletClient,
      TOKEN,
      META_AGGREGATION_ROUTER_V2,
      100n,
    );
    expect(result?.txHash).toBe(TX_HASH);
  });
});

describe("sendKyberTransaction — reverted swap", () => {
  it("throws SWAP_FAILED when the swap tx mines reverted", async () => {
    const { publicClient, walletClient } = clients("reverted");
    await expect(
      sendKyberTransaction(publicClient, walletClient, {
        to: META_AGGREGATION_ROUTER_V2,
        data: "0x" as Hex,
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.SWAP_FAILED });
  });
});
