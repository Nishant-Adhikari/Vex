/**
 * MissionHistory — the Missions ledger view. These tests pin the ETH|USD
 * denomination behaviour (issue #17):
 *   1. USD is the default, and a priced run renders its PnL (and the cumulative
 *      figure) in USD;
 *   2. flipping the toggle to ETH re-denominates in place (persisted uiStore
 *      preference, real store transition);
 *   3. FAIL-SOFT — a run with no captured close price falls back to ETH even
 *      under USD, never a blank or `$NaN`.
 *
 * The two data hooks are mocked; the PnL math itself is covered by
 * missionHistoryModel.test.ts. Here we drive the component off their output.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { MissionResultDto } from "@shared/schemas/mission.js";

const useMissionResultsMock = vi.fn();
const useAvailableWalletsMock = vi.fn();

vi.mock("../../../lib/api/mission.js", () => ({
  useMissionResults: () => useMissionResultsMock(),
}));
vi.mock("../../../lib/api/wallet-inventory.js", () => ({
  useAvailableWallets: () => useAvailableWalletsMock(),
}));

const { MissionHistory } = await import("../MissionHistory.js");
const { useUiStore } = await import("../../../stores/uiStore.js");

function result(over: Partial<MissionResultDto> = {}): MissionResultDto {
  return {
    missionRunId: "run-1",
    sessionId: "session-1",
    seqNo: 1,
    goalSnippet: "grow ETH",
    startedAt: "2026-07-12T18:00:00.000Z",
    endedAt: "2026-07-12T19:00:00.000Z",
    durationS: 3600,
    bankrollStartEth: 0.01,
    bankrollEndEth: 0.011,
    pnlEth: 0.001,
    pnlPct: 10,
    ethPriceUsdEnd: 3000,
    trades: 2,
    outcome: "completed",
    stopReason: "goal_reached",
    summary: null,
    openPositionsCount: 0,
    simulated: false,
    ...over,
  };
}

function mockResults(results: readonly MissionResultDto[]): void {
  useMissionResultsMock.mockReturnValue({
    isPending: false,
    isError: false,
    data: { ok: true, data: results },
  });
}

beforeEach(() => {
  useMissionResultsMock.mockReset();
  useAvailableWalletsMock.mockReset();
  // A primary EVM wallet is present (the view reads evm[0]).
  useAvailableWalletsMock.mockReturnValue({
    data: {
      ok: true,
      data: {
        evm: [{ id: "evm_1", family: "evm", address: "0xAbc", label: "Main", vault: false }],
        solana: [],
      },
    },
  });
  // Reset the persisted denomination to its default before each test.
  useUiStore.setState({ pnlCurrency: "usd", appShellView: "missionHistory" });
});

describe("MissionHistory — PnL denomination", () => {
  it("defaults to USD and renders a priced run's PnL + cumulative in USD", () => {
    mockResults([result({ pnlEth: 0.001, ethPriceUsdEnd: 3000 })]);
    render(<MissionHistory />);

    // Column header switches to USD.
    expect(screen.getByText("PnL (USD)")).toBeTruthy();
    // Per-row + cumulative both value 0.001 ETH @ $3000 = +$3.00.
    expect(screen.getAllByText("+$3.00").length).toBeGreaterThanOrEqual(2);
    // No raw ETH figure while USD is active and priced.
    expect(screen.queryByText("+0.0010 ETH")).toBeNull();
  });

  it("re-denominates to ETH when the toggle is flipped (real store transition)", () => {
    mockResults([result({ pnlEth: 0.001, ethPriceUsdEnd: 3000 })]);
    render(<MissionHistory />);

    fireEvent.click(screen.getByRole("radio", { name: "ETH" }));

    expect(useUiStore.getState().pnlCurrency).toBe("eth");
    expect(screen.getByText("PnL (ETH)")).toBeTruthy();
    expect(screen.getAllByText("+0.0010 ETH").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("+$3.00")).toBeNull();
  });

  it("FAILS SOFT to ETH for a run with no close price, even under USD", () => {
    mockResults([result({ pnlEth: 0.001, ethPriceUsdEnd: null })]);
    render(<MissionHistory />);

    // USD is still selected...
    expect(useUiStore.getState().pnlCurrency).toBe("usd");
    // ...but the unpriced row renders ETH with an explanatory hint, never $NaN.
    const cell = screen.getByTitle("No close price recorded — showing ETH");
    expect(within(cell.closest("td") as HTMLElement).getByText("+0.0010 ETH")).toBeTruthy();
    expect(screen.queryByText("$NaN")).toBeNull();
  });
});
