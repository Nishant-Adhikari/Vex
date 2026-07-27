/**
 * SidebarPositionSummary — the wallet position widget that replaced the $VEX
 * price card. Verifies the total/wallet/ETH figures, the empty state, and the
 * fail-soft error line, all over the mocked portfolio bridge.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { SidebarPositionSummary } from "../SidebarPositionSummary.js";

const readMock = vi.fn();

function ok<T>(data: T) {
  return { ok: true as const, data };
}

function portfolio(over: Record<string, unknown> = {}) {
  return {
    scope: "global",
    walletCount: 2,
    liveTotalUsd: 1234.56,
    snapshotTotalUsd: null,
    pnlVsPrev: null,
    snapshotAt: null,
    tokens: [
      { chainId: 1, symbol: "ETH", balanceUsd: 900, amount: 0.5 },
      { chainId: 1, symbol: "USDC", balanceUsd: 334.56, amount: 334.56 },
    ],
    chains: [],
    ...over,
  };
}

function setVex(): void {
  Object.defineProperty(window, "vex", {
    configurable: true,
    writable: true,
    value: { portfolio: { read: readMock } },
  });
}

function Wrapper({ children }: { readonly children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  setVex();
});

afterEach(() => {
  vi.clearAllMocks();
  // @ts-expect-error test cleanup
  delete window.vex;
});

describe("SidebarPositionSummary", () => {
  it("renders total, wallet count, and aggregated ETH balance", async () => {
    readMock.mockResolvedValue(ok(portfolio()));
    render(createElement(SidebarPositionSummary), { wrapper: Wrapper });

    expect(await screen.findByText("$1234.56")).toBeTruthy();
    expect(screen.getByText("2 wallets")).toBeTruthy();
    expect(screen.getByText("0.5 ETH")).toBeTruthy();
  });

  it("omits the ETH line when there is no ETH holding", async () => {
    readMock.mockResolvedValue(
      ok(portfolio({ tokens: [{ chainId: 1, symbol: "USDC", balanceUsd: 10, amount: 10 }] })),
    );
    render(createElement(SidebarPositionSummary), { wrapper: Wrapper });

    await screen.findByText("$1234.56");
    expect(screen.queryByText(/ETH$/)).toBeNull();
  });

  it("shows the empty state with no wallets configured", async () => {
    readMock.mockResolvedValue(ok(portfolio({ walletCount: 0 })));
    render(createElement(SidebarPositionSummary), { wrapper: Wrapper });

    expect(await screen.findByText(/No wallets configured/i)).toBeTruthy();
  });

  it("fails soft to an unavailable line on a bridge error", async () => {
    readMock.mockResolvedValue({
      ok: false as const,
      error: { code: "portfolio.read_failed", message: "boom", correlationId: "t" },
    });
    render(createElement(SidebarPositionSummary), { wrapper: Wrapper });

    await waitFor(() =>
      expect(screen.getByText(/Position data unavailable/i)).toBeTruthy(),
    );
  });
});
