import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionCreateInput } from "@shared/schemas/sessions.js";

interface MockStoreState {
  readonly setActiveSessionId: (id: string | null) => void;
  readonly setAppShellView: (view: string) => void;
  readonly setPendingFirstMessage: (value: {
    sessionId: string;
    message: string;
  }) => void;
  readonly setReviewModal: (value: string) => void;
  readonly setSigningState: (value: string) => void;
}

const spies = vi.hoisted(() => ({
  setActiveSessionId: vi.fn(),
  setAppShellView: vi.fn(),
  setPendingFirstMessage: vi.fn(),
  setReviewModal: vi.fn(),
  setSigningState: vi.fn(),
  mutateAsync: vi.fn(),
}));

const storeState: MockStoreState = {
  setActiveSessionId: spies.setActiveSessionId,
  setAppShellView: spies.setAppShellView,
  setPendingFirstMessage: spies.setPendingFirstMessage,
  setReviewModal: spies.setReviewModal,
  setSigningState: spies.setSigningState,
};

vi.mock("../../../stores/uiStore.js", () => ({
  useUiStore: <T,>(selector: (state: MockStoreState) => T): T =>
    selector(storeState),
}));

vi.mock("../../../lib/api/sessions.js", () => ({
  useCreateSession: () => ({
    isPending: false,
    mutateAsync: spies.mutateAsync,
  }),
}));

// Import AFTER the mocks so the module wiring resolves to them.
import { SessionPresets } from "../SessionPresets.js";
import { MISSION_PRESETS } from "../missionPresets.js";

describe("SessionPresets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spies.mutateAsync.mockResolvedValue({ ok: true, data: { id: "sess-1" } });
  });

  it("lists the PONS Scalper preset with its one-line description", () => {
    render(<SessionPresets />);
    expect(screen.getByText("PONS Scalper")).not.toBeNull();
    expect(
      screen.getByText(/Sellability-gated PONS runner scalp/i),
    ).not.toBeNull();
  });

  it("creates a mission draft from the preset goal and opens the contract screen", async () => {
    render(<SessionPresets />);

    fireEvent.click(
      screen.getByRole("button", { name: /Launch preset: PONS Scalper/i }),
    );

    await waitFor(() => {
      expect(spies.mutateAsync).toHaveBeenCalledTimes(1);
    });

    // 1. Reuses the create-session mutation as a MISSION with the preset's
    //    permission and null wallets (backend applies the primary wallet).
    const input = spies.mutateAsync.mock.calls[0]?.[0] as SessionCreateInput;
    expect(input.mode).toBe("mission");
    expect(input.name).toBe("PONS Scalper");
    expect(input.permission).toBe("full");
    expect(input.selectedEvmWalletId).toBeNull();
    expect(input.selectedSolanaWalletId).toBeNull();
    // Carries the preset's authoritative structured seed so main can pre-fill
    // the mission contract (no "Still Missing" fields).
    if (input.mode !== "mission") throw new Error("expected mission input");
    expect(input.missionDraftSeed).toEqual(MISSION_PRESETS[0]?.draft);
    expect(input.missionDraftSeed?.title).toBe("PONS Scalper");
    expect(input.missionDraftSeed?.riskProfile).toBe("aggressive");
    expect(input.missionDraftSeed?.allowedChains).toEqual(["Robinhood Chain"]);

    // 2. Hands the preset goal to the new session's composer (same draft path).
    await waitFor(() => {
      expect(spies.setPendingFirstMessage).toHaveBeenCalledWith({
        sessionId: "sess-1",
        message: MISSION_PRESETS[0]?.goal,
      });
    });

    // 3. Activates the session and routes to the mission contract screen.
    expect(spies.setActiveSessionId).toHaveBeenCalledWith("sess-1");
    expect(spies.setAppShellView).toHaveBeenCalledWith("session");
    expect(spies.setReviewModal).toHaveBeenCalledWith("mission");
  });

  it("never auto-accepts or auto-runs the mission — only seeds + navigates", async () => {
    render(<SessionPresets />);

    fireEvent.click(
      screen.getByRole("button", { name: /Launch preset: PONS Scalper/i }),
    );

    await waitFor(() => {
      expect(spies.setReviewModal).toHaveBeenCalledWith("mission");
    });

    // The launcher touches ONLY create + the hand-off/navigation store actions.
    // There is no accept/run call surface here at all — assert the mutation was
    // the sole side-effecting call and the review modal was merely opened.
    expect(spies.mutateAsync).toHaveBeenCalledTimes(1);
    expect(spies.setReviewModal).toHaveBeenCalledTimes(1);
    expect(spies.setReviewModal).not.toHaveBeenCalledWith("none");
  });

  it("surfaces an error and does not navigate when creation fails", async () => {
    spies.mutateAsync.mockResolvedValueOnce({
      ok: false,
      error: { message: "wallet locked" },
    });

    render(<SessionPresets />);
    fireEvent.click(
      screen.getByRole("button", { name: /Launch preset: PONS Scalper/i }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("wallet locked");
    expect(spies.setActiveSessionId).not.toHaveBeenCalled();
    expect(spies.setReviewModal).not.toHaveBeenCalled();
  });
});
