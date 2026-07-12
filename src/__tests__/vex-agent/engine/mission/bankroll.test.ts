/**
 * ETH-equivalent bankroll from proj_balances rows. Native ETH + WETH make up the
 * bankroll (the mission's unit of account); every other held token is an OPEN
 * position, reported separately and excluded from the bankroll figure so an
 * unsold bag never inflates PNL.
 */

import { describe, it, expect } from "vitest";
import { computeEthBankroll } from "@vex-agent/engine/mission/bankroll.js";
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
