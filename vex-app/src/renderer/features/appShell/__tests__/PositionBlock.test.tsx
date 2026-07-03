/**
 * POSITION block — pins the zero-balance display rules:
 *
 *   - token rows whose USD would render as `$0.00` (|USD| < 0.005, i.e.
 *     below formatUsd's 2-decimal rounding threshold) never render,
 *   - the threshold matches formatUsd exactly: 0.004 hides, 0.006 shows,
 *   - the 8-row cap and "+N more" tail count only displayable rows,
 *   - when the wallet has tokens but ALL of them round to $0.00, a single
 *     muted "No priced balances." line replaces the list (the truly-empty
 *     "No token balances." copy is reserved for zero token rows),
 *   - totals stay untouched — they reflect the full portfolio.
 *
 * `usePortfolio` is mocked — this suite owns the block's display rules,
 * not the query wiring.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type {
  PortfolioDto,
  PositionTokenDto,
} from "@shared/schemas/portfolio.js";

const mockUsePortfolio = vi.hoisted(() => vi.fn());

vi.mock("../../../lib/api/portfolio.js", () => ({
  usePortfolio: mockUsePortfolio,
}));

const { PositionBlock } = await import("../book/PositionBlock.js");

function token(
  symbol: string,
  balanceUsd: number,
  chainId: number | null = 1,
): PositionTokenDto {
  return { chainId, symbol, balanceUsd };
}

function portfolio(overrides: Partial<PortfolioDto> = {}): PortfolioDto {
  return {
    scope: "global",
    walletCount: 2,
    liveTotalUsd: 123.45,
    snapshotTotalUsd: null,
    pnlVsPrev: null,
    snapshotAt: null,
    tokens: [],
    ...overrides,
  };
}

function mockPortfolio(dto: PortfolioDto): void {
  mockUsePortfolio.mockReturnValue({
    isLoading: false,
    isError: false,
    data: { ok: true, data: dto },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PositionBlock zero-balance display", () => {
  it("hides token rows that would render as $0.00", () => {
    mockPortfolio(
      portfolio({
        tokens: [
          token("SOL", 12.3),
          token("GABECUBE", 0),
          token("AWSTIN", 0.0001),
        ],
      }),
    );
    const { container } = render(<PositionBlock activeSessionId={null} />);

    expect(screen.getByText("SOL")).not.toBeNull();
    expect(screen.queryByText("GABECUBE")).toBeNull();
    expect(screen.queryByText("AWSTIN")).toBeNull();
    // No figure anywhere on the block reads $0.00.
    expect(screen.queryByText("$0.00")).toBeNull();
    expect(container.querySelectorAll("li")).toHaveLength(1);
  });

  it("aligns the cut with formatUsd rounding: 0.004 hides, 0.006 shows as $0.01", () => {
    mockPortfolio(
      portfolio({
        tokens: [token("DUST", 0.004), token("EDGE", 0.006)],
      }),
    );
    render(<PositionBlock activeSessionId={null} />);

    expect(screen.queryByText("DUST")).toBeNull();
    expect(screen.getByText("EDGE")).not.toBeNull();
    expect(screen.getByText("$0.01")).not.toBeNull();
    expect(screen.queryByText("$0.00")).toBeNull();
  });

  it("shows 'No priced balances.' when every token rounds to $0.00", () => {
    mockPortfolio(
      portfolio({
        tokens: [token("GABECUBE", 0), token("AWSTIN", -0.002)],
      }),
    );
    const { container } = render(<PositionBlock activeSessionId={null} />);

    expect(container.querySelectorAll("li")).toHaveLength(0);
    expect(screen.getByText("No priced balances.")).not.toBeNull();
    // The truly-empty copy stays reserved for a portfolio with NO token rows.
    expect(screen.queryByText("No token balances.")).toBeNull();
  });

  it("keeps 'No token balances.' for a portfolio with no token rows at all", () => {
    mockPortfolio(portfolio({ tokens: [] }));
    render(<PositionBlock activeSessionId={null} />);

    expect(screen.getByText("No token balances.")).not.toBeNull();
    expect(screen.queryByText("No priced balances.")).toBeNull();
  });

  it("caps at 8 rows and counts '+N more' AFTER filtering zero balances", () => {
    // 12 rows fetched: 10 displayable + 2 zero. Pre-filter counting would
    // say "+4 more"; the correct tail is 10 - 8 = "+2 more".
    const priced = Array.from({ length: 10 }, (_, i) =>
      token(`TOK${i}`, 5 + i),
    );
    const dust = [token("ZERO1", 0), token("ZERO2", 0.001)];
    mockPortfolio(portfolio({ tokens: [...priced, ...dust] }));
    const { container } = render(<PositionBlock activeSessionId={null} />);

    expect(container.querySelectorAll("li")).toHaveLength(8);
    expect(screen.getByText("+2 more")).not.toBeNull();
    expect(screen.queryByText("+4 more")).toBeNull();
  });

  it("keeps the live total on the FULL portfolio even when rows filter out", () => {
    mockPortfolio(
      portfolio({
        liveTotalUsd: 987.65,
        tokens: [token("GABECUBE", 0)],
      }),
    );
    render(<PositionBlock activeSessionId={null} />);

    expect(screen.getByText("$987.65")).not.toBeNull();
    expect(screen.getByText("No priced balances.")).not.toBeNull();
  });
});
