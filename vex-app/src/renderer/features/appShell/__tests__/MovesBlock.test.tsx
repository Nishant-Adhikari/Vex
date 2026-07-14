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
import { render, screen, fireEvent } from "@testing-library/react";
import type { MoveItem } from "@shared/schemas/portfolio-moves.js";
import type { PortfolioDto, PositionTokenDto } from "@shared/schemas/portfolio.js";

const mockUseMoves = vi.hoisted(() => vi.fn());
const mockUsePortfolioScoped = vi.hoisted(() => vi.fn());
const mockUseMissionSessionResult = vi.hoisted(() => vi.fn());

vi.mock("../../../lib/api/portfolio.js", () => ({
  useMoves: mockUseMoves,
  usePortfolioScoped: mockUsePortfolioScoped,
}));

vi.mock("../../../lib/api/mission.js", () => ({
  useMissionSessionResult: mockUseMissionSessionResult,
}));

const {
  MovesBlock,
  computeDeployedEth,
  computeDeployedUsd,
  deployedPct,
  deriveEthPriceUsd,
  formatUsdCompact,
  impliedEthPriceUsd,
  moveUsd,
} = await import("../book/MovesBlock.js");

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

function portfolioDto(tokens: readonly PositionTokenDto[]): PortfolioDto {
  return {
    scope: "session",
    walletCount: 1,
    liveTotalUsd: 0,
    snapshotTotalUsd: null,
    pnlVsPrev: null,
    snapshotAt: null,
    tokens: [...tokens],
    chains: [],
  };
}

/** Mock the session portfolio read with an explicit token set. */
function mockPortfolio(tokens: readonly PositionTokenDto[]): void {
  mockUsePortfolioScoped.mockReturnValue({
    data: { ok: true, data: portfolioDto(tokens) },
  });
}

/** A single priced ETH holding → portfolio-derived spot of `price` USD/ETH. */
function ethHolding(price: number): PositionTokenDto {
  return { chainId: 1, symbol: "ETH", balanceUsd: price, amount: 1 };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSeed(null);
  // Default: an empty portfolio → no portfolio-derived ETH price. Tests that
  // exercise the portfolio-price path opt in via mockPortfolio([ethHolding(…)]).
  mockPortfolio([]);
  window.localStorage.clear();
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

describe("MovesBlock USD ⇄ ETH display toggle", () => {
  // A neutral swap (not a BUY) so its priced leg doesn't also land in the
  // Deployed sum — keeps the `$…` leg figure unique in the DOM.
  function pricedSwap(): MoveItem {
    return move({
      id: "1",
      tradeSide: null,
      inputToken: "ETH",
      inputAmount: "0.01",
      outputToken: "vena",
      valueUsd: 19.9,
    });
  }

  it("defaults to USD — the unit leg shows the compact USD notional, not ETH", () => {
    mockMoves([pricedSwap()]);
    render(<MovesBlock sessionId={SESSION} />);
    expect(screen.getByText("$19.90")).not.toBeNull();
    expect(screen.queryByText("0.01 ETH")).toBeNull();
    // The switch advertises the ACTION it performs (flip to ETH).
    expect(
      screen.getByRole("button", { name: "Show amounts in ETH" }),
    ).not.toBeNull();
  });

  it("toggles to ETH and back, persisting the choice to localStorage", () => {
    mockMoves([pricedSwap()]);
    render(<MovesBlock sessionId={SESSION} />);

    // USD → ETH.
    fireEvent.click(screen.getByRole("button", { name: "Show amounts in ETH" }));
    expect(screen.getByText("0.01 ETH")).not.toBeNull();
    expect(screen.queryByText("$19.90")).toBeNull();
    expect(window.localStorage.getItem("vex.moves.displayMode")).toBe("eth");

    // ETH → USD.
    fireEvent.click(screen.getByRole("button", { name: "Show amounts in USD" }));
    expect(screen.getByText("$19.90")).not.toBeNull();
    expect(window.localStorage.getItem("vex.moves.displayMode")).toBe("usd");
  });

  it("rehydrates the persisted ETH mode on mount", () => {
    window.localStorage.setItem("vex.moves.displayMode", "eth");
    mockMoves([pricedSwap()]);
    render(<MovesBlock sessionId={SESSION} />);
    expect(screen.getByText("0.01 ETH")).not.toBeNull();
    expect(screen.queryByText("$19.90")).toBeNull();
  });

  it("in USD mode a priced move shows $…, an unpriced move falls back to ETH", () => {
    mockMoves([
      pricedSwap(),
      // Unpriced (valueUsd null) → the leg keeps its ETH figure.
      move({
        id: "2",
        tradeSide: null,
        inputToken: "ETH",
        inputAmount: "0.02",
        outputToken: "wif",
        valueUsd: null,
      }),
    ]);
    render(<MovesBlock sessionId={SESSION} />);
    expect(screen.getByText("$19.90")).not.toBeNull();
    expect(screen.getByText("0.02 ETH")).not.toBeNull();
  });

  it("in USD mode SEED converts via the implied ETH price and DEPLOYED sums buys' valueUsd", () => {
    mockSeed(0.1);
    mockMoves([
      // Priced BUY: 0.02 ETH ⇒ $38 → implied price $1900/ETH; adds to Deployed.
      move({
        id: "1",
        tradeSide: "buy",
        inputToken: "ETH",
        inputAmount: "0.02",
        outputToken: "vena",
        valueUsd: 38,
      }),
      // Second priced BUY so Deployed ($57) differs from either leg figure.
      move({
        id: "2",
        tradeSide: "buy",
        inputToken: "ETH",
        inputAmount: "0.01",
        outputToken: "wif",
        valueUsd: 19,
      }),
    ]);
    render(<MovesBlock sessionId={SESSION} />);
    // Seed 0.1 ETH × $1900 = $190.
    expect(screen.getByText("$190.00")).not.toBeNull();
    // Deployed = sum of the buys' valueUsd (38 + 19 = 57).
    expect(screen.getByText("$57.00")).not.toBeNull();
    // Per-leg USD figures render on each buy's unit leg.
    expect(screen.getByText("$38.00")).not.toBeNull();
    expect(screen.getByText("$19.00")).not.toBeNull();
    // Percent stays the ETH-based ratio: (0.02 + 0.01) / 0.1 = 30%.
    expect(screen.getByText(/\(30%\)/)).not.toBeNull();
  });

  it("in USD mode with nothing priced, SEED and DEPLOYED fall back to ETH", () => {
    mockSeed(0.1);
    mockMoves([
      move({ id: "1", tradeSide: "buy", inputToken: "ETH", inputAmount: "0.04" }),
    ]);
    render(<MovesBlock sessionId={SESSION} />);
    // No priced move → implied price null → Seed/Deployed keep ETH figures.
    expect(screen.getByText("0.1000 ETH")).not.toBeNull();
    expect(screen.getByText("0.0400 ETH")).not.toBeNull();
    expect(screen.queryByText("$NaN")).toBeNull();
  });

  it("in USD mode an unpriced move (valueUsd null) converts via the PORTFOLIO ETH price", () => {
    // The Robinhood path: moves carry no valueUsd, but the portfolio holds a
    // priced ETH line ($1800/ETH) → the ETH leg converts to USD.
    mockPortfolio([ethHolding(1800)]);
    mockMoves([
      move({
        id: "1",
        tradeSide: null,
        inputToken: "ETH",
        inputAmount: "0.02",
        outputToken: "vena",
        valueUsd: null,
      }),
    ]);
    render(<MovesBlock sessionId={SESSION} />);
    // 0.02 ETH × $1800 = $36.00 — the row is no longer dead in USD mode.
    expect(screen.getByText("$36.00")).not.toBeNull();
    expect(screen.queryByText("0.02 ETH")).toBeNull();
  });

  it("in USD mode DEPLOYED converts the ETH sum via the PORTFOLIO price when buys are unpriced", () => {
    mockSeed(0.1);
    mockPortfolio([ethHolding(1800)]);
    mockMoves([
      // Unpriced buys (Robinhood) → deployedUsd sum is 0, so DEPLOYED converts
      // the ETH-denominated sum (0.02 + 0.01 = 0.03 ETH) at the portfolio price.
      move({ id: "1", tradeSide: "buy", inputToken: "ETH", inputAmount: "0.02", valueUsd: null }),
      move({ id: "2", tradeSide: "buy", inputToken: "ETH", inputAmount: "0.01", valueUsd: null }),
    ]);
    render(<MovesBlock sessionId={SESSION} />);
    // Seed 0.1 ETH × $1800 = $180.00.
    expect(screen.getByText("$180.00")).not.toBeNull();
    // Deployed 0.03 ETH × $1800 = $54.00.
    expect(screen.getByText("$54.00")).not.toBeNull();
    // Percent stays the ETH-based ratio: 0.03 / 0.1 = 30%.
    expect(screen.getByText(/\(30%\)/)).not.toBeNull();
  });

  it("prefers the PORTFOLIO price over the implied price for per-move USD", () => {
    // A priced move would imply $1990/ETH, but the portfolio's real spot
    // ($1800) is authoritative for the unpriced sibling row.
    mockPortfolio([ethHolding(1800)]);
    mockMoves([
      move({
        id: "1",
        tradeSide: null,
        inputToken: "ETH",
        inputAmount: "0.02",
        outputToken: "wif",
        valueUsd: null,
      }),
    ]);
    render(<MovesBlock sessionId={SESSION} />);
    // 0.02 × $1800 = $36.00 (portfolio spot), not an implied figure.
    expect(screen.getByText("$36.00")).not.toBeNull();
  });
});

describe("computeDeployedUsd / impliedEthPriceUsd / formatUsdCompact (pure)", () => {
  it("sums the valueUsd of BUYs only, skipping sells and nulls", () => {
    const moves = [
      move({ id: "1", tradeSide: "buy", valueUsd: 19.9 }),
      move({ id: "2", tradeSide: "buy", valueUsd: 38 }),
      // Sell → ignored.
      move({ id: "3", tradeSide: "sell", valueUsd: 100 }),
      // Unpriced buy → skipped (not counted as 0-then-added, just skipped).
      move({ id: "4", tradeSide: "buy", valueUsd: null }),
    ];
    expect(computeDeployedUsd(moves)).toBeCloseTo(57.9, 12);
    expect(computeDeployedUsd([])).toBe(0);
  });

  it("derives the implied ETH→USD price from the first priced move with an ETH leg", () => {
    const moves = [
      // Unpriced → skipped.
      move({ id: "1", tradeSide: "buy", inputToken: "ETH", inputAmount: "0.01", valueUsd: null }),
      // Priced BUY: 0.02 ETH in ⇒ $38 → $1900/ETH.
      move({ id: "2", tradeSide: "buy", inputToken: "ETH", inputAmount: "0.02", valueUsd: 38 }),
    ];
    expect(impliedEthPriceUsd(moves)).toBeCloseTo(1900, 9);
    // A SELL prices off its ETH OUTPUT leg too.
    expect(
      impliedEthPriceUsd([
        move({ id: "1", tradeSide: "sell", inputToken: "vena", outputToken: "ETH", outputAmount: "0.05", valueUsd: 95 }),
      ]),
    ).toBeCloseTo(1900, 9);
    // No priced move / no ETH leg → null.
    expect(impliedEthPriceUsd([])).toBeNull();
    expect(
      impliedEthPriceUsd([move({ id: "1", tradeSide: "buy", inputToken: "usdc", inputAmount: "10.0", valueUsd: 10 })]),
    ).toBeNull();
  });

  it("formats compact USD and returns null for non-finite input", () => {
    expect(formatUsdCompact(19.9)).toBe("$19.90");
    expect(formatUsdCompact(1200)).toBe("$1.2k");
    expect(formatUsdCompact(3_400_000)).toBe("$3.4m");
    expect(formatUsdCompact(0)).toBe("$0.00");
    expect(formatUsdCompact(null)).toBeNull();
    expect(formatUsdCompact(Number.NaN)).toBeNull();
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

describe("deriveEthPriceUsd (pure)", () => {
  function dto(tokens: readonly PositionTokenDto[]): PortfolioDto {
    return {
      scope: "session",
      walletCount: 1,
      liveTotalUsd: 0,
      snapshotTotalUsd: null,
      pnlVsPrev: null,
      snapshotAt: null,
      tokens: [...tokens],
      chains: [],
    };
  }

  it("derives the ETH spot from the ETH holding (balanceUsd / amount)", () => {
    expect(
      deriveEthPriceUsd(dto([{ chainId: 1, symbol: "ETH", balanceUsd: 178.4, amount: 0.1 }])),
    ).toBeCloseTo(1784, 9);
    // Case-insensitive symbol match; other tokens are ignored.
    expect(
      deriveEthPriceUsd(
        dto([
          { chainId: 1, symbol: "USDC", balanceUsd: 50, amount: 50 },
          { chainId: 1, symbol: "eth", balanceUsd: 3600, amount: 2 },
        ]),
      ),
    ).toBeCloseTo(1800, 9);
  });

  it("returns null when there is no usable ETH price", () => {
    // No portfolio at all.
    expect(deriveEthPriceUsd(null)).toBeNull();
    // No ETH line.
    expect(
      deriveEthPriceUsd(dto([{ chainId: 1, symbol: "USDC", balanceUsd: 50, amount: 50 }])),
    ).toBeNull();
    // Unpriced ETH holding (balanceUsd null — the very bug on Robinhood moves).
    expect(
      deriveEthPriceUsd(dto([{ chainId: 1, symbol: "ETH", balanceUsd: null, amount: 1 }])),
    ).toBeNull();
    // Zero / null amount → no divisor.
    expect(
      deriveEthPriceUsd(dto([{ chainId: 1, symbol: "ETH", balanceUsd: 1800, amount: 0 }])),
    ).toBeNull();
    expect(
      deriveEthPriceUsd(dto([{ chainId: 1, symbol: "ETH", balanceUsd: 1800, amount: null }])),
    ).toBeNull();
  });
});

describe("moveUsd (pure)", () => {
  it("uses the move's own valueUsd when present", () => {
    expect(moveUsd(move({ id: "1", valueUsd: 19.9 }), 1800)).toBeCloseTo(19.9, 12);
    // valueUsd wins even when a price could convert the leg.
    expect(
      moveUsd(move({ id: "1", inputToken: "ETH", inputAmount: "0.02", valueUsd: 19.9 }), 1800),
    ).toBeCloseTo(19.9, 12);
  });

  it("converts the ETH leg at the price when valueUsd is null", () => {
    expect(
      moveUsd(move({ id: "1", inputToken: "ETH", inputAmount: "0.02", valueUsd: null }), 1800),
    ).toBeCloseTo(36, 12);
    // SELL prices off the ETH OUTPUT leg.
    expect(
      moveUsd(
        move({ id: "1", tradeSide: "sell", inputToken: "vena", outputToken: "ETH", outputAmount: "0.05", valueUsd: null }),
        1800,
      ),
    ).toBeCloseTo(90, 12);
  });

  it("returns null (→ ETH fallback) when there is no valueUsd and no price / no ETH leg", () => {
    // No price at all.
    expect(
      moveUsd(move({ id: "1", inputToken: "ETH", inputAmount: "0.02", valueUsd: null }), null),
    ).toBeNull();
    // Price present but no parseable ETH leg (raw wei).
    expect(
      moveUsd(move({ id: "1", inputToken: "ETH", inputAmount: "1000000000", valueUsd: null }), 1800),
    ).toBeNull();
    // Price present but the leg isn't ETH.
    expect(
      moveUsd(move({ id: "1", inputToken: "usdc", inputAmount: "10.0", valueUsd: null }), 1800),
    ).toBeNull();
  });
});
