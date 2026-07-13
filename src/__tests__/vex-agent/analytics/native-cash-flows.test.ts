/**
 * Native cash-flow DETECTION — pure classification tests (Part 2, TDD).
 *
 * `classifyNativeFlows` turns a wallet's raw native transactions into the
 * external-flow `Flow[]` that TWR needs. The core rule: a native transfer is
 * an EXTERNAL cash flow (deposit/withdrawal) only when the counterparty is NOT
 * an allowlisted DEX router / wrapped-native / system contract — swaps route
 * native value THROUGH the router, so they are internal to trading, not deposits.
 *
 * Direction: `from == wallet` → withdrawal (negative usd); `to == wallet` →
 * deposit (positive usd). USD value = nativeAmount × (per-tx price ?? fallback).
 *
 * The real fetch/pricing wrapper (`getNativeCashFlows`) is network-bound and
 * fail-soft; these tests pin the deterministic classification core.
 */

import { describe, it, expect } from "vitest";

import {
  classifyNativeFlows,
  buildExcludedContracts,
  type RawNativeTx,
} from "@vex-agent/analytics/native-cash-flows.js";

const WALLET = "0x384c7316F53Af22651902cbfAF378C6bE6b4C23e";
const COUNTERPARTY = "0x0000000000000000000000009999999999009592A7"; // external EOA
const ROUTER_V2 = "0x89e5db8b5aa49aa85ac63f691524311aeb649eba"; // robinhood uniswap v2 router02
const ROUTER_V3 = "0xcaf681a66d020601342297493863e78c959e5cb2"; // robinhood uniswap v3 swapRouter02
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"; // robinhood wrapped native

const ONE_ETH = 10n ** 18n;

function tx(over: Partial<RawNativeTx>): RawNativeTx {
  return {
    from: WALLET,
    to: COUNTERPARTY,
    valueWei: ONE_ETH.toString(),
    timestampMs: 1_700_000_000_000,
    success: true,
    priceUsd: 2000,
    ...over,
  };
}

describe("buildExcludedContracts", () => {
  it("includes the chain's Uniswap routers + WETH for Robinhood (4663)", () => {
    const excluded = buildExcludedContracts(4663);
    expect(excluded.has(ROUTER_V2)).toBe(true);
    expect(excluded.has(ROUTER_V3)).toBe(true);
    expect(excluded.has(WETH.toLowerCase())).toBe(true);
  });

  it("is empty for an unknown chain (no config → no exclusions)", () => {
    expect(buildExcludedContracts(999999).size).toBe(0);
  });
});

describe("classifyNativeFlows", () => {
  const excluded = buildExcludedContracts(4663);

  it("classifies an outbound transfer to an EOA as a WITHDRAWAL (negative usd)", () => {
    const flows = classifyNativeFlows({
      walletAddress: WALLET,
      txs: [tx({ from: WALLET, to: COUNTERPARTY, valueWei: (2n * ONE_ETH).toString(), priceUsd: 1775 })],
      excludedContracts: excluded,
    });
    expect(flows).toHaveLength(1);
    expect(flows[0]!.usd).toBeCloseTo(-3550, 6); // -2 ETH * $1775
    expect(flows[0]!.t).toBe(1_700_000_000_000);
  });

  it("classifies an inbound transfer from an EOA as a DEPOSIT (positive usd)", () => {
    const flows = classifyNativeFlows({
      walletAddress: WALLET,
      txs: [tx({ from: COUNTERPARTY, to: WALLET, valueWei: ONE_ETH.toString(), priceUsd: 2000 })],
      excludedContracts: excluded,
    });
    expect(flows).toHaveLength(1);
    expect(flows[0]!.usd).toBeCloseTo(2000, 6);
  });

  it("EXCLUDES a native transfer to the Uniswap router (a swap, not a withdrawal)", () => {
    const flows = classifyNativeFlows({
      walletAddress: WALLET,
      txs: [
        tx({ from: WALLET, to: ROUTER_V2 }),
        tx({ from: WALLET, to: ROUTER_V3 }),
      ],
      excludedContracts: excluded,
    });
    expect(flows).toHaveLength(0);
  });

  it("EXCLUDES a native transfer to WETH (wrap/unwrap, not external cash)", () => {
    const flows = classifyNativeFlows({
      walletAddress: WALLET,
      txs: [tx({ from: WALLET, to: WETH })],
      excludedContracts: excluded,
    });
    expect(flows).toHaveLength(0);
  });

  it("is case-insensitive on the counterparty match", () => {
    const flows = classifyNativeFlows({
      walletAddress: WALLET.toLowerCase(),
      txs: [tx({ from: WALLET.toUpperCase(), to: ROUTER_V2.toUpperCase() })],
      excludedContracts: excluded,
    });
    expect(flows).toHaveLength(0);
  });

  it("skips zero-value transfers (contract calls with no native movement)", () => {
    const flows = classifyNativeFlows({
      walletAddress: WALLET,
      txs: [tx({ valueWei: "0", to: COUNTERPARTY })],
      excludedContracts: excluded,
    });
    expect(flows).toHaveLength(0);
  });

  it("skips failed/reverted transactions", () => {
    const flows = classifyNativeFlows({
      walletAddress: WALLET,
      txs: [tx({ success: false })],
      excludedContracts: excluded,
    });
    expect(flows).toHaveLength(0);
  });

  it("skips self-transfers (wallet -> wallet)", () => {
    const flows = classifyNativeFlows({
      walletAddress: WALLET,
      txs: [tx({ from: WALLET, to: WALLET })],
      excludedContracts: excluded,
    });
    expect(flows).toHaveLength(0);
  });

  it("skips transfers where the wallet is neither side, or the counterparty is null", () => {
    const flows = classifyNativeFlows({
      walletAddress: WALLET,
      txs: [
        tx({ from: COUNTERPARTY, to: ROUTER_V2 }),
        tx({ from: WALLET, to: null }), // contract creation
      ],
      excludedContracts: excluded,
    });
    expect(flows).toHaveLength(0);
  });

  it("uses the fallback native price when a tx carries no per-tx price", () => {
    const flows = classifyNativeFlows({
      walletAddress: WALLET,
      txs: [tx({ from: COUNTERPARTY, to: WALLET, valueWei: ONE_ETH.toString(), priceUsd: null })],
      excludedContracts: excluded,
      fallbackNativePriceUsd: 1500,
    });
    expect(flows).toHaveLength(1);
    expect(flows[0]!.usd).toBeCloseTo(1500, 6);
  });

  it("skips an unpriceable flow (no per-tx price and no fallback) rather than fabricating $0", () => {
    const flows = classifyNativeFlows({
      walletAddress: WALLET,
      txs: [tx({ priceUsd: null })],
      excludedContracts: excluded,
      fallbackNativePriceUsd: null,
    });
    expect(flows).toHaveLength(0);
  });

  it("produces flows suitable for the EVM-3 reconciliation (three 0.2-ETH withdrawals net negative)", () => {
    const txs: RawNativeTx[] = [0, 1, 2].map((i) =>
      tx({
        from: WALLET,
        to: COUNTERPARTY,
        valueWei: (ONE_ETH / 5n).toString(), // 0.2 ETH
        priceUsd: 2000,
        timestampMs: 1_700_000_000_000 + i * 3_600_000,
      }),
    );
    const flows = classifyNativeFlows({ walletAddress: WALLET, txs, excludedContracts: excluded });
    expect(flows).toHaveLength(3);
    const total = flows.reduce((acc, fl) => acc + fl.usd, 0);
    expect(total).toBeCloseTo(-1200, 6); // 3 * 0.2 ETH * $2000 withdrawn
  });
});
