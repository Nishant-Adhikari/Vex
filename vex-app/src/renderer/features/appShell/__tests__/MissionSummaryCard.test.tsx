/**
 * Render tests for the post-mission summary card's two learning surfaces:
 *   1. the Decision Journal renders a trade's PERSISTED rationale (not the
 *      "No recorded rationale" placeholder), and
 *   2. the Retrospective / Lessons section renders the generated summary +
 *      lessons, and stays absent (fail-soft) when there is nothing to show.
 *
 * The data hooks are mocked so the card is exercised as a pure presentation of
 * already-derived values.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { MoveItem } from "@shared/schemas/portfolio-moves.js";
import type {
  MissionResultDto,
  MissionRetrospectiveDto,
} from "@shared/schemas/mission.js";

const mockUseMoves = vi.hoisted(() => vi.fn());
const mockUseRetro = vi.hoisted(() => vi.fn());
const mockUseMessagesTail = vi.hoisted(() => vi.fn());

vi.mock("../../../lib/api/portfolio.js", () => ({ useMoves: mockUseMoves }));
vi.mock("../../../lib/api/mission.js", () => ({
  useMissionRetrospective: mockUseRetro,
}));
vi.mock("../../../lib/api/messages.js", () => ({
  useSessionMessagesTail: mockUseMessagesTail,
}));

const { MissionSummaryCard } = await import("../MissionSummaryCard.js");

const SESSION = "00000000-0000-4000-8000-00000000ffff";

function result(over: Partial<MissionResultDto> = {}): MissionResultDto {
  return {
    missionRunId: "run-1",
    sessionId: SESSION,
    seqNo: 3,
    goalSnippet: "Grow the bankroll",
    startedAt: "2026-07-13T10:00:00+00:00",
    endedAt: "2026-07-13T10:40:00+00:00",
    durationS: 2400,
    bankrollStartEth: 1,
    bankrollEndEth: 1.1,
    pnlEth: 0.1,
    pnlPct: 10,
    ethPriceUsdEnd: 3000,
    trades: 1,
    outcome: "completed",
    stopReason: "goal_reached",
    simulated: false,
    summary: null,
    openPositionsCount: 0,
    ...over,
  };
}

function move(over: Partial<MoveItem> = {}): MoveItem {
  return {
    id: "m1",
    tradeSide: "buy",
    productType: "spot",
    venue: "kyberswap",
    inputToken: "ETH",
    inputTokenSymbol: "ETH",
    inputTokenLocalSymbol: null,
    inputAmount: "0.1",
    outputToken: "VENA",
    outputTokenSymbol: "VENA",
    outputTokenLocalSymbol: null,
    outputAmount: "1000",
    valueUsd: 100,
    captureStatus: "executed",
    instrumentKey: null,
    chain: "robinhood",
    txRef: null,
    walletAddress: null,
    rationale: null,
    createdAt: "2026-07-13T10:05:00+00:00",
    ...over,
  };
}

function retro(over: Partial<MissionRetrospectiveDto> = {}): MissionRetrospectiveDto {
  return {
    summary: "Bought VENA on momentum and exited at target.",
    wentWell: ["Confirmed liquidity before entry"],
    wentWrong: ["Position size was conservative"],
    lessons: ["Require a sell-back liquidity check before any buy"],
    model: "test-model",
    createdAt: "2026-07-13T10:41:00+00:00",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseMessagesTail.mockReturnValue({ data: [] });
  mockUseRetro.mockReturnValue({ data: { ok: true, data: null }, isLoading: false });
  mockUseMoves.mockReturnValue({ data: { ok: true, data: [] } });
});

describe("MissionSummaryCard — Decision Journal rationale", () => {
  it("renders a trade's persisted rationale instead of the placeholder", () => {
    mockUseMoves.mockReturnValue({
      data: {
        ok: true,
        data: [move({ rationale: "Buying VENA: deep liquidity and confirmed sell-back." })],
      },
    });
    render(<MissionSummaryCard result={result()} sessionId={SESSION} />);
    expect(
      screen.getByText(/Buying VENA: deep liquidity and confirmed sell-back\./),
    ).toBeTruthy();
    expect(screen.queryByText(/No recorded rationale/)).toBeNull();
  });

  it("falls back to the placeholder when a trade has no rationale and no reasoning", () => {
    mockUseMoves.mockReturnValue({
      data: { ok: true, data: [move({ rationale: null })] },
    });
    render(<MissionSummaryCard result={result()} sessionId={SESSION} />);
    expect(screen.getByText(/No recorded rationale for this trade\./)).toBeTruthy();
  });
});

describe("MissionSummaryCard — scrollable container", () => {
  it("bounds the card height and scrolls its body so tall content is reachable", () => {
    render(<MissionSummaryCard result={result()} sessionId={SESSION} />);
    // The card is capped to the viewport…
    const card = document.querySelector('[data-vex-area="mission-summary"]');
    expect(card).not.toBeNull();
    expect(card?.className).toContain("max-h-[70vh]");
    // …and its body region scrolls (min-h-0 + overflow-y-auto) rather than
    // pushing the whole card off-screen behind the composer fade.
    const scroll = document.querySelector(
      '[data-vex-area="mission-summary-scroll"]',
    );
    expect(scroll).not.toBeNull();
    expect(scroll?.className).toContain("overflow-y-auto");
    expect(scroll?.className).toContain("min-h-0");
  });
});

describe("MissionSummaryCard — Retrospective section", () => {
  it("leads with the bullet lists and demotes the prose summary to a TL;DR caption", () => {
    mockUseRetro.mockReturnValue({
      data: { ok: true, data: retro() },
      isLoading: false,
    });
    render(<MissionSummaryCard result={result()} sessionId={SESSION} />);
    // Bullet-list labels are present…
    const worked = screen.getByText("What worked");
    const fix = screen.getByText("What to fix");
    const lessons = screen.getByText("Lessons for next mission");
    expect(worked).toBeTruthy();
    expect(fix).toBeTruthy();
    expect(lessons).toBeTruthy();
    // …and the prose summary renders as a demoted, muted TL;DR caption that
    // comes AFTER the bullets in document order (bullets are the star).
    const tldr = screen.getByText(/TL;DR —/);
    expect(tldr.className).toContain("text-[var(--vex-text-3)]");
    expect(tldr.className).toContain("line-clamp-2");
    expect(
      worked.compareDocumentPosition(tldr) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });


  it("renders the retrospective summary + lessons when present", () => {
    mockUseRetro.mockReturnValue({
      data: { ok: true, data: retro() },
      isLoading: false,
    });
    render(<MissionSummaryCard result={result()} sessionId={SESSION} />);
    expect(screen.getByText("Retrospective")).toBeTruthy();
    expect(
      screen.getByText(/Bought VENA on momentum and exited at target\./),
    ).toBeTruthy();
    expect(
      screen.getByText(/Require a sell-back liquidity check before any buy/),
    ).toBeTruthy();
    expect(screen.getByText("Lessons for next mission")).toBeTruthy();
  });

  it("omits the section entirely when there is no retrospective (fail-soft)", () => {
    render(<MissionSummaryCard result={result()} sessionId={SESSION} />);
    expect(screen.queryByText("Retrospective")).toBeNull();
  });

  it("shows a quiet generating hint while the first-view generation is in flight", () => {
    mockUseRetro.mockReturnValue({ data: undefined, isLoading: true });
    render(<MissionSummaryCard result={result()} sessionId={SESSION} />);
    expect(screen.getByText(/Generating lessons from this run/)).toBeTruthy();
  });
});
