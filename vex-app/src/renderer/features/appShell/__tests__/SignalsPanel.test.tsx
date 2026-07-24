/**
 * SignalsPanel render tests (Signals section, minimal).
 *
 * Verifies: today's signals render as rows with their display features + a
 * DexScreener link and NO raw provider jsonb; each row carries a Grade button;
 * clicking Grade calls the grade IPC and renders the returned verdict; a DB
 * error still renders (fail-soft) with an error banner and no rows.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

const mockSetAppShellView = vi.hoisted(() => vi.fn());

vi.mock("../../../stores/uiStore.js", () => ({
  useUiStore: (selector: (s: { setAppShellView: typeof mockSetAppShellView }) => unknown) =>
    selector({ setAppShellView: mockSetAppShellView }),
}));

const { SignalsPanel } = await import("../SignalsPanel.js");

function ok<T>(data: T) {
  return { ok: true as const, data };
}
function errResult(message: string) {
  return {
    ok: false as const,
    error: {
      code: "internal.unexpected",
      domain: "signals",
      message,
      retryable: true,
      userActionable: false,
      redacted: true,
    },
  };
}

const listTodayMock = vi.fn();
const gradeMock = vi.fn();

function setVex(): void {
  Object.defineProperty(window, "vex", {
    configurable: true,
    writable: true,
    value: { signals: { listToday: listTodayMock, grade: gradeMock } },
  });
}

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}
function freshClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

const SIGNAL = {
  id: 12,
  source: "trendradar",
  chain: "solana",
  contract: "So11111111111111111111111111111111111111112",
  symbol: "WIF",
  action: "watch",
  score: 87,
  todayMentions: 140,
  yesterdayMentions: 40,
  velocityPct: 250,
  liquidityUsd: 1_200_000,
  volume24hUsd: 8_000_000,
  priceUsd: 2.31,
  priceChange24hPct: 18.4,
  marketCapUsd: 2_000_000_000,
  dexscreenerUrl: "https://dexscreener.com/solana/abc",
  narratives: ["dogs"],
  riskFlags: ["low_liquidity"],
  feedGeneratedAt: "2026-07-23T10:00:00.000Z",
  ingestedAt: "2026-07-23T10:05:00.000Z",
  grade: null,
  gradeVerdict: null,
  gradeRationale: null,
  gradedAt: null,
};

afterEach(() => {
  vi.clearAllMocks();
  // @ts-expect-error — test cleanup
  delete window.vex;
});

describe("SignalsPanel", () => {
  it("renders a signal row with its features + DexScreener link and a Grade button", async () => {
    listTodayMock.mockResolvedValue(ok([SIGNAL]));
    setVex();
    const { container } = render(createElement(SignalsPanel), {
      wrapper: makeWrapper(freshClient()),
    });

    await waitFor(() => {
      expect(screen.getByText("WIF")).not.toBeNull();
    });
    expect(container.querySelector('[data-vex-signal-id="12"]')).not.toBeNull();
    expect(screen.getByText("low_liquidity")).not.toBeNull();
    expect(screen.getByText("DexScreener")).not.toBeNull();
    // The row carries a compact local ingest stamp ("Mon DD · HH:MM"); the
    // exact hour is tz-dependent, so assert the format, not the value.
    expect(screen.getByText(/[A-Z][a-z]{2} \d{1,2} · \d{2}:\d{2}/)).not.toBeNull();
    // The per-row Grade button exists.
    expect(
      screen.getByRole("button", { name: /Grade WIF/i }),
    ).not.toBeNull();
  });

  it("renders the persisted auto-grade badge on load (no click needed)", async () => {
    listTodayMock.mockResolvedValue(
      ok([
        {
          ...SIGNAL,
          grade: 81,
          gradeVerdict: "runner",
          gradeRationale: "Auto-graded on ingest.",
          gradedAt: "2026-07-23T10:06:00.000Z",
        },
      ]),
    );
    setVex();
    render(createElement(SignalsPanel), { wrapper: makeWrapper(freshClient()) });

    await waitFor(() => {
      expect(screen.getByText("WIF")).not.toBeNull();
    });
    // Badge + rationale come straight from the persisted DTO — the manual
    // Grade button was never clicked (gradeMock never called).
    expect(screen.getByText(/Runner · 81/)).not.toBeNull();
    expect(screen.getByText("Auto-graded on ingest.")).not.toBeNull();
    expect(gradeMock).not.toHaveBeenCalled();
  });

  it("grades a signal on click and renders the verdict", async () => {
    listTodayMock.mockResolvedValue(ok([SIGNAL]));
    gradeMock.mockResolvedValue(
      ok({
        id: 12,
        grade: 74,
        verdict: "runner",
        rationale: "Deep liquidity, strong momentum.",
      }),
    );
    setVex();
    render(createElement(SignalsPanel), { wrapper: makeWrapper(freshClient()) });

    await waitFor(() => {
      expect(screen.getByText("WIF")).not.toBeNull();
    });
    fireEvent.click(screen.getByRole("button", { name: /Grade WIF/i }));

    await waitFor(() => {
      expect(gradeMock).toHaveBeenCalledWith({ id: 12 });
    });
    await waitFor(() => {
      expect(screen.getByText(/Runner · 74/)).not.toBeNull();
    });
    expect(screen.getByText("Deep liquidity, strong momentum.")).not.toBeNull();
  });

  it("stays fail-soft: a grade error shows inline, list still rendered", async () => {
    listTodayMock.mockResolvedValue(ok([SIGNAL]));
    gradeMock.mockResolvedValue(errResult("model unavailable"));
    setVex();
    render(createElement(SignalsPanel), { wrapper: makeWrapper(freshClient()) });

    await waitFor(() => {
      expect(screen.getByText("WIF")).not.toBeNull();
    });
    fireEvent.click(screen.getByRole("button", { name: /Grade WIF/i }));

    await waitFor(() => {
      expect(screen.getByText(/grade failed/i)).not.toBeNull();
    });
    // The list is still there — grading never blocks it.
    expect(screen.getByText("WIF")).not.toBeNull();
  });

  it("renders an error banner (and no rows) when the list load fails", async () => {
    listTodayMock.mockResolvedValue(errResult("Unable to load signals."));
    setVex();
    render(createElement(SignalsPanel), { wrapper: makeWrapper(freshClient()) });

    await waitFor(() => {
      expect(screen.getByText("Unable to load signals.")).not.toBeNull();
    });
    expect(screen.queryByText("WIF")).toBeNull();
  });

  it("Back returns to the chat view", async () => {
    listTodayMock.mockResolvedValue(ok([]));
    setVex();
    render(createElement(SignalsPanel), { wrapper: makeWrapper(freshClient()) });
    fireEvent.click(screen.getByRole("button", { name: /Back to chat/i }));
    expect(mockSetAppShellView).toHaveBeenCalledWith("session");
  });
});
