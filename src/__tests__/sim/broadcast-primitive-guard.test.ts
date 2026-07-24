/**
 * LAYER B safety proof: the low-level broadcast primitives
 * (`sendUniswapTransaction`, `sendKyberTransaction`) NEVER reach
 * `walletClient.sendTransaction` when the active mission run is simulator mode.
 *
 * The spy on `sendTransaction` is the ground-truth assertion the task requires:
 * under `runWithMissionMode("simulator", ...)` it must never be invoked; under
 * `"live"` it is. This holds even if a caller bug routed a simulator swap all
 * the way down to the primitive (belt-and-suspenders behind the handler
 * paper-fill).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// Receipt wait is mocked so the LIVE path can complete without a real RPC.
vi.mock("@tools/evm-chains/receipt-guard.js", () => ({
  waitForSuccessfulReceipt: vi.fn(async () => ({ logs: [] })),
}));

const { sendUniswapTransaction } = await import("@tools/uniswap/execute.js");
const { sendKyberTransaction } = await import("@tools/kyberswap/evm/erc20.js");
const { runWithMissionMode } = await import("../../lib/mission-mode.js");

function makeWallet() {
  const sendTransaction = vi.fn(async () => `0x${"ab".repeat(32)}`);
  const walletClient = { account: {}, chain: {}, sendTransaction } as never;
  const publicClient = {} as never;
  return { sendTransaction, walletClient, publicClient };
}

const uniTx = { to: "0x0000000000000000000000000000000000000001", data: "0x", value: 0n } as never;
const kyberTx = { to: "0x0000000000000000000000000000000000000001", data: "0x", value: 0n };

describe("layer B — sendUniswapTransaction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("SIMULATOR: never calls sendTransaction and throws", async () => {
    const { sendTransaction, walletClient, publicClient } = makeWallet();
    await expect(
      runWithMissionMode("simulator", () =>
        sendUniswapTransaction(publicClient, walletClient, uniTx),
      ),
    ).rejects.toThrow(/SIMULATOR/);
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("LIVE: does call sendTransaction", async () => {
    const { sendTransaction, walletClient, publicClient } = makeWallet();
    await runWithMissionMode("live", () =>
      sendUniswapTransaction(publicClient, walletClient, uniTx),
    );
    expect(sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("NO mission context: behaves live (manual/agent swap) and broadcasts", async () => {
    const { sendTransaction, walletClient, publicClient } = makeWallet();
    await sendUniswapTransaction(publicClient, walletClient, uniTx);
    expect(sendTransaction).toHaveBeenCalledTimes(1);
  });
});

describe("layer B — sendKyberTransaction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("SIMULATOR: never calls sendTransaction and throws", async () => {
    const { sendTransaction, walletClient, publicClient } = makeWallet();
    await expect(
      runWithMissionMode("simulator", () =>
        sendKyberTransaction(publicClient, walletClient, kyberTx),
      ),
    ).rejects.toThrow(/SIMULATOR/);
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("LIVE: does call sendTransaction", async () => {
    const { sendTransaction, walletClient, publicClient } = makeWallet();
    await runWithMissionMode("live", () =>
      sendKyberTransaction(publicClient, walletClient, kyberTx),
    );
    expect(sendTransaction).toHaveBeenCalledTimes(1);
  });
});
