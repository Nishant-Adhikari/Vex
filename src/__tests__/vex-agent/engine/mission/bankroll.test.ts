/**
 * ETH-equivalent bankroll from proj_balances rows. Native ETH + WETH make up the
 * bankroll (the mission's unit of account); every other held token is an OPEN
 * position, reported separately and excluded from the bankroll figure so an
 * unsold bag never inflates PNL.
 */

import { describe, it, expect, vi } from "vitest";
import {
  computeEthBankroll,
  readEthBankrollOnChain,
  type OnChainBankrollDeps,
} from "@vex-agent/engine/mission/bankroll.js";
import type { BalanceRow } from "@vex-agent/db/repos/balances/types.js";

const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

function bal(over: Partial<BalanceRow>): BalanceRow {
  return {
    walletFamily: "eip155", walletAddress: "0xW", chainId: 4663,
    tokenAddress: NATIVE, tokenSymbol: "ETH", tokenName: "Ether",
    balanceRaw: "0", balanceUsd: null, priceUsd: null, decimals: 18, ...over,
  };
}

describe("computeEthBankroll", () => {
  it("sums native ETH + WETH into the bankroll", () => {
    const r = computeEthBankroll([
      bal({ tokenAddress: NATIVE, tokenSymbol: "ETH", balanceRaw: "10000000000000000", priceUsd: 3000 }), // 0.01
      bal({ tokenAddress: "0x0Bd7", tokenSymbol: "WETH", balanceRaw: "5000000000000000", priceUsd: 3000 }), // 0.005
    ]);
    expect(r.bankrollEth).toBeCloseTo(0.015, 12);
    expect(r.ethPriceUsd).toBe(3000);
    expect(r.openPositions).toHaveLength(0);
  });

  it("treats other tokens as open positions, excluded from the bankroll", () => {
    const r = computeEthBankroll([
      bal({ tokenAddress: NATIVE, tokenSymbol: "ETH", balanceRaw: "10000000000000000", priceUsd: 3000 }),
      bal({ tokenAddress: "0xNOXA", tokenSymbol: "NOXA", balanceRaw: "2000000000000000000", decimals: 18, balanceUsd: 42 }),
    ]);
    expect(r.bankrollEth).toBeCloseTo(0.01, 12); // NOXA excluded
    expect(r.openPositions).toHaveLength(1);
    expect(r.openPositions[0]).toMatchObject({ symbol: "NOXA", address: "0xNOXA", valueUsd: 42 });
    expect(r.openPositions[0]!.amount).toBeCloseTo(2, 9);
  });

  it("ignores zero-balance non-ETH tokens (dust rows)", () => {
    const r = computeEthBankroll([
      bal({ tokenAddress: NATIVE, balanceRaw: "10000000000000000", priceUsd: 3000 }),
      bal({ tokenAddress: "0xDUST", tokenSymbol: "DUST", balanceRaw: "0" }),
    ]);
    expect(r.openPositions).toHaveLength(0);
  });

  it("returns a zero bankroll for no rows", () => {
    const r = computeEthBankroll([]);
    expect(r.bankrollEth).toBe(0);
    expect(r.ethPriceUsd).toBeNull();
  });
});

const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const WALLET = "0x9ed25bdedceB28Adf9E3C7fCa34511e78e47C77f";

function onChainDeps(over: Partial<OnChainBankrollDeps> = {}): OnChainBankrollDeps {
  return {
    resolveDeployment: vi.fn(() => ({ weth: WETH } as never)),
    // native 0.01 ETH (wei) + WETH 0.005 (wei) → bankroll 0.015
    getPublicClient: vi.fn(() => ({
      getBalance: vi.fn(async () => 10_000_000_000_000_000n),
      readContract: vi.fn(async () => 5_000_000_000_000_000n),
    }) as never),
    ...over,
  };
}

describe("readEthBankrollOnChain", () => {
  it("sums live native ETH + WETH into the bankroll (no price/positions)", async () => {
    const r = await readEthBankrollOnChain(WALLET, 4663, onChainDeps());
    expect(r).not.toBeNull();
    expect(r!.bankrollEth).toBeCloseTo(0.015, 12);
    expect(r!.ethPriceUsd).toBeNull();
    expect(r!.openPositions).toHaveLength(0);
  });

  it("returns null when the chain has no Uniswap deployment (unresolved)", async () => {
    const r = await readEthBankrollOnChain(WALLET, 999999, onChainDeps({
      resolveDeployment: vi.fn(() => undefined),
    }));
    expect(r).toBeNull();
  });

  it("is fail-soft — an RPC error yields null", async () => {
    const r = await readEthBankrollOnChain(WALLET, 4663, onChainDeps({
      getPublicClient: vi.fn(() => ({
        getBalance: vi.fn(async () => { throw new Error("rpc down"); }),
        readContract: vi.fn(async () => 0n),
      }) as never),
    }));
    expect(r).toBeNull();
  });
});
