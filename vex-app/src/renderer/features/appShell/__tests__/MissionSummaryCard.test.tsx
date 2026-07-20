/**
 * MissionSummaryCard — ONE card, BOTH surfaces.
 *
 * A finished mission is reported in the session view (right after the run
 * ends) and in the Missions ledger. These tests pin that both are the same
 * component at two densities, because the failure mode being prevented is
 * silent: someone "improves" one surface, the two designs drift, and the
 * operator has to learn to read a mission summary twice.
 *
 * Two assertions here must survive any refactor of this file:
 *
 *   1. The displayed PnL derives from the LEDGER RECORD (`pnlEth` x
 *      `ethPriceUsdEnd`) — never from the agent's prose.
 *   2. Dismissal mutates NO mission or ledger record — it writes view state
 *      and nothing else.
 *
 * Both are anchored on real defects. See `MissionHistory.test.tsx` for the
 * Mission #9 case that motivated (1).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

import type { MissionResultDto } from "@shared/schemas/mission.js";
import {
  useEditMission,
  useMissionContinue,
  useMissionDiff,
  useMissionDraft,
  useMissionLiveSync,
  useMissionRenew,
  useMissionResults,
  useMissionRetry,
  useMissionSessionResult,
  useMissionStart,
  useMissionStop,
  useRenewableMissionSource,
} from "../../../lib/api/mission.js";
import { useAvailableWallets } from "../../../lib/api/wallet-inventory.js";
import { useRuntimeState } from "../../../lib/api/runtime.js";
import { useIsChatSubmitting } from "../../../lib/api/chat.js";
import { useSessionPlan } from "../../../lib/api/sessions.js";
import { useUiStore } from "../../../stores/uiStore.js";
import { MissionHistory } from "../MissionHistory.js";
import { MissionControls } from "../MissionControls.js";

vi.mock("../../../lib/api/mission.js", () => ({
  useMissionResults: vi.fn(),
  useMissionSessionResult: vi.fn(),
  useRenewableMissionSource: vi.fn(),
  useMissionDraft: vi.fn(),
  useMissionDiff: vi.fn(),
  useMissionLiveSync: vi.fn(),
  useMissionStart: vi.fn(),
  useMissionContinue: vi.fn(),
  useMissionRetry: vi.fn(),
  useEditMission: vi.fn(),
  useMissionStop: vi.fn(),
  useMissionRenew: vi.fn(),
}));
vi.mock("../../../lib/api/wallet-inventory.js", () => ({ useAvailableWallets: vi.fn() }));
vi.mock("../../../lib/api/runtime.js", () => ({ useRuntimeState: vi.fn() }));
vi.mock("../../../lib/api/chat.js", () => ({ useIsChatSubmitting: vi.fn() }));
vi.mock("../../../lib/api/sessions.js", () => ({ useSessionPlan: vi.fn() }));

const SESSION = "00000000-0000-4000-8000-0000000000d1";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}

/**
 * Mission #9 as the ledger actually recorded it: a -$0.57 loss the agent
 * described as "about 33 cents" because it netted the trade legs and forgot
 * the gas.
 */
function missionNine(overrides: Partial<MissionResultDto> = {}): MissionResultDto {
  return {
    missionRunId: "run-9",
    seqNo: 9,
    goalSnippet: "grow ETH on Base",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:15:00.000Z",
    durationS: 900,
    bankrollStartEth: 0.1097,
    bankrollEndEth: 0.10938,
    pnlEth: -0.00031936869485788,
    pnlPct: -0.29,
    ethPriceUsdEnd: 1782.65,
    trades: 2,
    outcome: "completed",
    stopReason: "goal_reached",
    openPositionsCount: 0,
    stopSummary: "- Looked at 12 trending coins\n- Bought one that was climbing",
    ...overrides,
  };
}

const idleMutation = { isPending: false, mutateAsync: vi.fn() };

/** The ledger list surface. */
function renderLedger(results: readonly MissionResultDto[]): void {
  vi.mocked(useAvailableWallets).mockReturnValue({
    data: { ok: true, data: { evm: [{ address: "0xAbC" }] } },
  } as never);
  vi.mocked(useMissionResults).mockReturnValue({
    isPending: false,
    isError: false,
    data: { ok: true, data: results },
  } as never);
  render(createElement(MissionHistory), { wrapper });
}

/**
 * The session view surface, in the state that follows a finished run: no
 * active run, no draft, a terminal accepted mission to renew from, and a
 * finalized ledger row to report.
 */
function renderSessionView(result: MissionResultDto | null): void {
  vi.mocked(useRuntimeState).mockReturnValue({
    data: {
      ok: true,
      data: { hasActiveRun: false, status: null, pendingControlKind: null, stopReason: null },
    },
  } as never);
  vi.mocked(useMissionDraft).mockReturnValue({ data: { ok: true, data: null } } as never);
  vi.mocked(useMissionDiff).mockReturnValue({ data: undefined } as never);
  vi.mocked(useSessionPlan).mockReturnValue({
    data: { ok: true, data: { enabled: false, accepted: false, planMd: "" } },
  } as never);
  vi.mocked(useRenewableMissionSource).mockReturnValue({
    data: { ok: true, data: { missionId: "m-done" } },
  } as never);
  vi.mocked(useMissionSessionResult).mockReturnValue({
    data: { ok: true, data: result },
  } as never);
  vi.mocked(useIsChatSubmitting).mockReturnValue(false as never);
  vi.mocked(useMissionLiveSync).mockReturnValue(undefined as never);
  for (const m of [
    useMissionStart,
    useMissionContinue,
    useMissionRetry,
    useEditMission,
    useMissionStop,
    useMissionRenew,
  ]) {
    vi.mocked(m).mockReturnValue(idleMutation as never);
  }
  render(createElement(MissionControls, { sessionId: SESSION }), { wrapper });
}

const cards = () => screen.getAllByRole("region", { name: /Mission #\d+ summary/ });
const card = () => cards()[0] as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  useUiStore.setState({ dismissedMissionRunIds: [] });
});

afterEach(() => {
  cleanup();
  useUiStore.setState({ dismissedMissionRunIds: [] });
});

describe("one card, both surfaces", () => {
  it("renders the same summary card component in the session view and the ledger", () => {
    renderSessionView(missionNine());
    const hero = card();
    expect(hero.dataset.vexDensity).toBe("hero");
    cleanup();

    renderLedger([missionNine()]);
    const compact = card();

    // Same component marker, same accessible name — the density is the only
    // difference between the two surfaces.
    expect(compact.dataset.vexArea).toBe(hero.dataset.vexArea);
    expect(compact.dataset.vexArea).toBe("mission-summary");
    expect(compact.dataset.vexDensity).toBe("compact");
    expect(compact.getAttribute("aria-label")).toBe(hero.getAttribute("aria-label"));
  });

  it("shows the identical ledger-derived figures at both densities", () => {
    renderSessionView(missionNine());
    const heroText = within(card()).getByText(/-\$0\.57/).textContent;
    cleanup();

    renderLedger([missionNine()]);

    expect(within(card()).getByText(/-\$0\.57/).textContent).toBe(heroText);
  });

  it("gives every ledger entry a card rather than a bespoke row", () => {
    renderLedger([missionNine(), missionNine({ missionRunId: "run-8", seqNo: 8 })]);

    expect(cards()).toHaveLength(2);
  });
});

describe("the displayed PnL derives from the ledger record", () => {
  // MUST SURVIVE. The agent is not a source of money figures.
  it.each(["hero", "ledger"] as const)(
    "ignores a summary that contradicts the ledger (%s)",
    (surface) => {
      const contradicting = missionNine({
        stopSummary:
          "- Ended down about 33 cents — basically flat; the small loss was just the buy/sell spread",
      });
      if (surface === "hero") renderSessionView(contradicting);
      else renderLedger([contradicting]);

      // -0.00031936869485788 ETH x $1782.65 = -$0.5693 -> -$0.57.
      expect(within(card()).getByText(/-\$0\.57/)).toBeTruthy();
      // "33 cents" survives ONLY as prose, never as the headline figure.
      expect(within(card()).queryByText(/^\$?-?0?\.?33$/)).toBeNull();
    },
  );

  it("falls back to a dash rather than letting prose become the only number", () => {
    // No close price -> no honest USD figure exists.
    renderLedger([missionNine({ ethPriceUsdEnd: null, stopSummary: "- Made about a dollar" })]);

    expect(within(card()).queryByText(/\$0\.57/)).toBeNull();
  });

  it("still shows the ledger figure when the agent wrote no summary at all", () => {
    renderSessionView(missionNine({ stopSummary: null }));

    expect(within(card()).getByText(/-\$0\.57/)).toBeTruthy();
  });
});

describe("the summary is never gated on the outcome", () => {
  // A real run finished `failed` / `no_viable_opportunity` and still wrote a
  // valid summary. That is precisely the run whose account the operator most
  // needs, so it must render.
  it.each(["hero", "ledger"] as const)("renders a failed run's prose (%s)", (surface) => {
    const failed = missionNine({
      outcome: "failed",
      stopReason: "no_viable_opportunity",
      stopSummary: "- Nothing met the entry rules, so no trade was placed",
    });
    if (surface === "hero") renderSessionView(failed);
    else renderLedger([failed]);

    expect(
      within(card()).getByText("Nothing met the entry rules, so no trade was placed"),
    ).toBeTruthy();
  });
});

describe("the density variant keeps the card whole", () => {
  it.each(["hero", "ledger"] as const)("keeps the dismiss affordance (%s)", (surface) => {
    if (surface === "hero") renderSessionView(missionNine());
    else renderLedger([missionNine()]);

    const hide = within(card()).getByRole("button", {
      name: "Hide mission #9 from this list",
    });
    expect(hide.tagName).toBe("BUTTON");
    // Labelled as hiding, never as destroying — the record survives.
    for (const destructive of ["delete", "remove", "archive"]) {
      expect((hide.getAttribute("aria-label") ?? "").toLowerCase()).not.toContain(destructive);
    }
  });

  it("dismisses from the session view without a confirmation step", () => {
    renderSessionView(missionNine());

    fireEvent.click(
      within(card()).getByRole("button", { name: "Hide mission #9 from this list" }),
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("region", { name: /Mission #9 summary/ })).toBeNull();
    // The Renew control the card sat above is untouched.
    expect(screen.getByRole("button", { name: "Renew mission" })).toBeTruthy();
  });
});

describe("dismissal mutates no mission or ledger record", () => {
  // MUST SURVIVE. Dismiss is not delete: `mission_results` and `mission_runs`
  // are an audit trail of real-money trades.
  it.each(["hero", "ledger"] as const)("leaves the ledger DTO untouched (%s)", (surface) => {
    const results = [missionNine()];
    const before = structuredClone(results);
    if (surface === "hero") renderSessionView(results[0] as MissionResultDto);
    else renderLedger(results);

    fireEvent.click(
      within(card()).getByRole("button", { name: "Hide mission #9 from this list" }),
    );

    expect(results).toEqual(before);
    expect(results).toHaveLength(1);
    // The ONLY thing that changed is view state.
    expect(useUiStore.getState().dismissedMissionRunIds).toEqual(["run-9"]);
  });

  it("hides the run on both surfaces from one dismissal, and restores both", () => {
    renderSessionView(missionNine());
    fireEvent.click(
      within(card()).getByRole("button", { name: "Hide mission #9 from this list" }),
    );
    cleanup();

    // The ledger honours the same view state...
    renderLedger([missionNine()]);
    expect(screen.queryByRole("region", { name: /Mission #9 summary/ })).toBeNull();
    expect(screen.getByText(/nothing has been deleted/)).toBeTruthy();

    // ...and Show hidden brings it back, because nothing was destroyed.
    fireEvent.click(screen.getByRole("button", { name: "Show hidden" }));
    expect(screen.getByRole("region", { name: /Mission #9 summary/ })).toBeTruthy();
  });

  it("keeps counting a dismissed run in the register totals", () => {
    renderLedger([missionNine(), missionNine({ missionRunId: "run-8", seqNo: 8 })]);

    fireEvent.click(
      within(card()).getByRole("button", { name: "Hide mission #9 from this list" }),
    );

    // Two missions ran. Hiding one changes what is on screen, never what is
    // true. `selector: "span"` disambiguates the stat label from the <h1>.
    const stat = screen.getByText("Missions", { selector: "span" });
    expect(stat.parentElement?.textContent).toContain("2");
    expect(screen.getByText(/hidden — still counted above/)).toBeTruthy();
  });
});

describe("a still-running row has no summary to show", () => {
  it("withholds the card in the session view until the run finalizes", () => {
    renderSessionView(missionNine({ outcome: "running" }));

    expect(screen.queryByRole("region", { name: /Mission #9 summary/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Renew mission" })).toBeTruthy();
  });

  it("renders the controls unchanged when the session has no result at all", () => {
    renderSessionView(null);

    expect(screen.queryByRole("region", { name: /summary/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Renew mission" })).toBeTruthy();
  });
});
