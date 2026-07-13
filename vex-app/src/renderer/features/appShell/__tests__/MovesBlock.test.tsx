/**
 * MOVES ledger — pins the token-display grammar that replaced raw base58
 * mint rows (the rejected "buy So1111…" feed):
 *
 *   - well-known mints resolve to tickers (native SOL mint → SOL) with the
 *     full mint preserved on the tooltip,
 *   - address-like strings (long alnum base58/hex) truncate via the canonical
 *     `truncateAddress` shape (`7jk8Ub…rmYK`), full mint on the tooltip,
 *   - short token strings render as uppercase symbols,
 *   - stamps give `productType` priority: bridge → BRIDGE·VENUE (plain BRIDGE
 *     without a venue), send/transfer → TRANSFER; otherwise the tolerant
 *     `tradeSide` derives: buy → BUY, sell → SELL, null (neutral Solana
 *     swap) → SWAP,
 *   - leg amounts render ONLY for dotted-decimal strings (compact ≤6
 *     significant digits); raw base-unit integers (legacy wei/lamports) and
 *     nulls render nothing,
 *   - the pulse ring is bound ONLY to a pending (in-flight) fill,
 *   - rows whose `chain`+`txRef` resolve through `moveExplorerUrl` render as
 *     external links (href + target=_blank + rel="noopener noreferrer");
 *     unresolvable rows stay non-interactive,
 *   - the 10-row display window, fetched-total count badge, and empty/error
 *     copy hold.
 *
 * `useMoves` is mocked — this suite owns the block's display rules, not the
 * query wiring.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { MoveItem } from "@shared/schemas/portfolio-moves.js";

const mockUseMoves = vi.hoisted(() => vi.fn());
const mockUseMissionSessionResult = vi.hoisted(() => vi.fn());

vi.mock("../../../lib/api/portfolio.js", () => ({
  useMoves: mockUseMoves,
}));

vi.mock("../../../lib/api/mission.js", () => ({
  useMissionSessionResult: mockUseMissionSessionResult,
}));

const { MovesBlock, computeDeployedEth, deployedPct } = await import(
  "../book/MovesBlock.js"
);

const SESSION = "00000000-0000-4000-8000-00000000eeee";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const LONG_MINT = "7jk8UbH339rCgnohpBvqiss4a7bXWmicMPCUCFmDrmYK";

function move(overrides: Partial<MoveItem> & { readonly id: string }): MoveItem {
  return {
    tradeSide: null,
    productType: null,
    venue: null,
    inputToken: null,
    inputAmount: null,
    outputToken: null,
    outputAmount: null,
    valueUsd: null,
    captureStatus: "executed",
    instrumentKey: null,
    chain: "solana",
    txRef: null,
    createdAt: "2026-07-02T10:21:00+00:00",
    ...overrides,
  };
}

function mockMoves(data: readonly MoveItem[]): void {
  mockUseMoves.mockReturnValue({
    isLoading: false,
    data: { ok: true, data },
  });
}

/** Default: no finalized mission result → no ETH seed source (Deployed alone). */
function mockSeed(bankrollStartEth: number | null): void {
  mockUseMissionSessionResult.mockReturnValue({
    data:
      bankrollStartEth === null
        ? { ok: true, data: null }
        : { ok: true, data: { bankrollStartEth } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSeed(null);
});

describe("MovesBlock ledger display", () => {
  it("resolves known mints to tickers and truncates address-like mints", () => {
    mockMoves([
      move({
        id: "1",
        tradeSide: "buy",
        inputToken: SOL_MINT,
        outputToken: LONG_MINT,
      }),
    ]);
    render(<MovesBlock sessionId={SESSION} />);

    // Known mint → ticker, full mint kept on the tooltip.
    const sol = screen.getByText("SOL");
    expect(sol.getAttribute("title")).toBe(SOL_MINT);
    // Address-like → truncateAddress shape, full mint on the tooltip.
    const truncated = screen.getByText("7jk8Ub…rmYK");
    expect(truncated.getAttribute("title")).toBe(LONG_MINT);
    // The raw base58 run never prints in full.
    expect(screen.queryByText(LONG_MINT)).toBeNull();
  });

  it("renders short strings as uppercase symbols and null legs as ?", () => {
    mockMoves([move({ id: "1", inputToken: "wif", outputToken: null })]);
    render(<MovesBlock sessionId={SESSION} />);
    expect(screen.getByText("WIF")).not.toBeNull();
    expect(screen.getByText("?")).not.toBeNull();
  });

  it("stamps BUY / SELL / SWAP from the tolerant tradeSide", () => {
    mockMoves([
      move({ id: "1", tradeSide: "buy" }),
      move({ id: "2", tradeSide: "sell" }),
      move({ id: "3", tradeSide: null }),
    ]);
    render(<MovesBlock sessionId={SESSION} />);
    expect(screen.getByText("BUY")).not.toBeNull();
    expect(screen.getByText("SELL")).not.toBeNull();
    expect(screen.getByText("SWAP")).not.toBeNull();
  });

  it("stamps a bridge move BRIDGE·VENUE (productType beats tradeSide), plain BRIDGE without a venue", () => {
    mockMoves([
      // Venue-qualified: a Relay bridge never renders as SWAP again.
      move({ id: "1", productType: "bridge", venue: "relay", tradeSide: null }),
      move({ id: "2", productType: "bridge", venue: "khalani", tradeSide: null }),
      // Legacy tolerance: bridge row without a venue → plain BRIDGE.
      move({ id: "3", productType: "bridge", venue: null }),
      move({ id: "4", productType: "send" }),
    ]);
    render(<MovesBlock sessionId={SESSION} />);
    expect(screen.getByText("BRIDGE·RELAY")).not.toBeNull();
    expect(screen.getByText("BRIDGE·KHALANI")).not.toBeNull();
    expect(screen.getByText("BRIDGE")).not.toBeNull();
    expect(screen.getByText("TRANSFER")).not.toBeNull();
    expect(screen.queryByText("SWAP")).toBeNull();
  });

  it("renders dotted-decimal amounts on the legs (≤6 significant digits) and hides raw/null amounts", () => {
    mockMoves([
      move({
        id: "1",
        productType: "bridge",
        venue: "relay",
        inputToken: "ETH",
        inputAmount: "0.001714",
        outputToken: "ETH",
        outputAmount: "0.001693900188686176",
      }),
      // Legacy raw base-unit integer (wei) + null → both legs stay amount-less.
      move({
        id: "2",
        inputToken: "wif",
        inputAmount: "1714000000000000",
        outputToken: "sol",
        outputAmount: null,
      }),
    ]);
    render(<MovesBlock sessionId={SESSION} />);
    expect(screen.getByText("0.001714 ETH")).not.toBeNull();
    // Compacted to 6 significant digits.
    expect(screen.getByText("0.0016939 ETH")).not.toBeNull();
    // Raw wei never prints; the legacy legs render exactly as before.
    expect(screen.queryByText(/1714000000000000/)).toBeNull();
    expect(screen.getByText("WIF")).not.toBeNull();
    expect(screen.getByText("SOL")).not.toBeNull();
  });

  it("binds the pulse ring ONLY to a pending fill", () => {
    mockMoves([
      move({ id: "1", captureStatus: "open" }),
      move({ id: "2", captureStatus: "executed" }),
    ]);
    const { container } = render(<MovesBlock sessionId={SESSION} />);
    expect(container.querySelectorAll(".vex-pulse-dot")).toHaveLength(1);
  });

  it("links a row with a resolvable chain+txRef to its block explorer", () => {
    mockMoves([
      move({ id: "1", chain: "solana", txRef: "5sigSolana" }),
      move({ id: "2", chain: "ethereum", txRef: "0xdeadbeef" }),
    ]);
    render(<MovesBlock sessionId={SESSION} />);

    const links = screen.getAllByRole("link", {
      name: "Open transaction on block explorer",
    });
    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute("href")).toBe(
      "https://explorer.solana.com/tx/5sigSolana",
    );
    expect(links[1]?.getAttribute("href")).toBe(
      "https://etherscan.io/tx/0xdeadbeef",
    );
    // main routes window.open through shell.openExternal — the anchor still
    // pins the safe-open contract for any environment that honours it.
    for (const link of links) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });

  it("keeps rows without a resolvable explorer URL non-interactive", () => {
    mockMoves([
      // No txRef → no link, even on a mapped chain.
      move({ id: "1", chain: "solana", txRef: null }),
      // Unknown chain → no link, even with a txRef.
      move({ id: "2", chain: "unknown-venue", txRef: "0xdeadbeef" }),
    ]);
    const { container } = render(<MovesBlock sessionId={SESSION} />);
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("a")).toBeNull();
  });

  it("shows only the 10 newest rows and badges the fetched total", () => {
    mockMoves(
      Array.from({ length: 25 }, (_, i) => move({ id: String(i) })),
    );
    const { container } = render(<MovesBlock sessionId={SESSION} />);
    expect(container.querySelectorAll("li")).toHaveLength(10);
    expect(screen.getByText("25")).not.toBeNull();
  });

  it("keeps the empty and error copy", () => {
    mockMoves([]);
    const { unmount } = render(<MovesBlock sessionId={SESSION} />);
    expect(screen.getByText(/No moves yet/)).not.toBeNull();
    unmount();

    mockUseMoves.mockReturnValue({
      isLoading: false,
      data: { ok: false, error: { code: "INTERNAL", message: "boom" } },
    });
    render(<MovesBlock sessionId={SESSION} />);
    expect(screen.getByText(/Couldn’t load moves|Couldn't load moves/)).not.toBeNull();
  });

  it("keeps the ETH amount + symbol but DROPS the traded token's quantity", () => {
    mockMoves([
      move({
        id: "1",
        tradeSide: "buy",
        inputToken: "ETH",
        inputAmount: "0.01",
        outputToken: "vena",
        outputAmount: "31100.1",
      }),
    ]);
    render(<MovesBlock sessionId={SESSION} />);
    // ETH leg keeps its amount; the traded token shows the SYMBOL only.
    expect(screen.getByText("0.01 ETH")).not.toBeNull();
    expect(screen.getByText("VENA")).not.toBeNull();
    // The raw token quantity is gone.
    expect(screen.queryByText(/31100/)).toBeNull();
  });

  it("tops the ledger with a Seed · Deployed summary when a seed exists", () => {
    mockSeed(0.1);
    mockMoves([
      move({ id: "1", tradeSide: "buy", inputToken: "ETH", inputAmount: "0.03" }),
      move({ id: "2", tradeSide: "buy", inputToken: "ETH", inputAmount: "0.01" }),
      // Sells and non-ETH-funded buys don't count toward Deployed.
      move({ id: "3", tradeSide: "sell", inputToken: "vena", inputAmount: "500.0" }),
    ]);
    render(<MovesBlock sessionId={SESSION} />);
    expect(screen.getByText("Seed")).not.toBeNull();
    // formatEth floors at 4 decimals: 0.1 → "0.1000", 0.04 → "0.0400".
    expect(screen.getByText("0.1000 ETH")).not.toBeNull();
    expect(screen.getByText("Deployed")).not.toBeNull();
    // 0.03 + 0.01 = 0.04 deployed; 0.04 / 0.10 = 40%.
    expect(screen.getByText("0.0400 ETH")).not.toBeNull();
    expect(screen.getByText(/\(40%\)/)).not.toBeNull();
  });

  it("drops the Seed label + percent when there is no seed source", () => {
    mockSeed(null);
    mockMoves([
      move({ id: "1", tradeSide: "buy", inputToken: "ETH", inputAmount: "0.02" }),
    ]);
    render(<MovesBlock sessionId={SESSION} />);
    expect(screen.queryByText("Seed")).toBeNull();
    expect(screen.getByText("Deployed")).not.toBeNull();
    // Deployed figure (formatEth floor): 0.02 → "0.0200".
    expect(screen.getByText("0.0200 ETH")).not.toBeNull();
    // No denominator → no parenthetical percent.
    expect(screen.queryByText(/%\)/)).toBeNull();
  });
});

describe("computeDeployedEth / deployedPct (pure)", () => {
  it("sums the ETH input leg of BUYs only, skipping sells, non-ETH, and raw amounts", () => {
    const moves = [
      move({ id: "1", tradeSide: "buy", inputToken: "ETH", inputAmount: "0.03" }),
      move({ id: "2", tradeSide: "buy", inputToken: "ETH", inputAmount: "0.01" }),
      // Sell → ignored.
      move({ id: "3", tradeSide: "sell", inputToken: "ETH", inputAmount: "0.05" }),
      // Non-ETH-funded buy → ignored.
      move({ id: "4", tradeSide: "buy", inputToken: "usdc", inputAmount: "10.0" }),
      // Legacy raw base-unit integer (no dot) → ignored.
      move({ id: "5", tradeSide: "buy", inputToken: "ETH", inputAmount: "1000000000" }),
    ];
    expect(computeDeployedEth(moves)).toBeCloseTo(0.04, 12);
  });

  it("returns 0 for no qualifying buys", () => {
    expect(computeDeployedEth([])).toBe(0);
    expect(
      computeDeployedEth([move({ id: "1", tradeSide: "sell" })]),
    ).toBe(0);
  });

  it("computes deployed / seed as a percent, null on a bad denominator", () => {
    expect(deployedPct(0.04, 0.1)).toBeCloseTo(40, 12);
    expect(deployedPct(0.04, 0)).toBeNull();
    expect(deployedPct(0.04, null)).toBeNull();
    expect(deployedPct(0.04, -1)).toBeNull();
  });
});
