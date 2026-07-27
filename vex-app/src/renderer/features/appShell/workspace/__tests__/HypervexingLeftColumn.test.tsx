/**
 * Earn-card non-clip regression (fix/hypervexing-exit-focus, item c): jsdom
 * does not lay out flexbox, so the CSS mechanism itself (`shrink-0` on the
 * HLP vault / Staking cards, `overflow-y-auto` on the scrolling column) is
 * the only testable proxy for "the Ask Vex action never clips, the column
 * scrolls instead" — without it, the cards silently absorb flex-shrink and
 * compress below their content height in a constrained room.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/api/chat.js", () => ({
  useSubmitChat: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../../../../lib/api/usage.js", () => ({
  useSessionUsageTotals: () => ({ data: undefined }),
}));
vi.mock("../../book/HyperliquidRiskBlock.js", () => ({
  HyperliquidRiskProposalPanel: () => null,
}));
vi.mock("../HypervexingRiskSetup.js", () => ({
  HypervexingRiskSetup: () => null,
}));

const { HypervexingLeftColumn } = await import("../HypervexingLeftColumn.js");

const SESSION = "00000000-0000-4000-8000-000000000001";

describe("HypervexingLeftColumn earn cards", () => {
  it("keeps the HLP vault and Staking cards from flex-shrinking, and the column scrollable", () => {
    render(
      <HypervexingLeftColumn
        account={null}
        upnl={null}
        sessionId={SESSION}
        selectedCoin="BTC"
      />,
    );
    const hlpCard = screen
      .getByRole("button", { name: "Ask Vex about HLP" })
      .closest("div");
    const stakingCard = screen
      .getByRole("button", { name: "Ask Vex about staking" })
      .closest("div");
    expect(hlpCard?.className).toContain("shrink-0");
    expect(stakingCard?.className).toContain("shrink-0");

    const column = screen.getByText("Account").closest("aside");
    expect(column?.className).toContain("overflow-y-auto");
  });
});
