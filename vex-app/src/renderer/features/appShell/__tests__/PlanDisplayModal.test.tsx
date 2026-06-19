/**
 * PlanDisplayModal — the relocated plan review surface.
 *
 * Mirrors `SessionPlanCard.test.tsx`: the API hooks are mocked so the modal's
 * display/accept/resume logic is exercised directly. Pins:
 *   - read-only under suppressAccept (no standalone Accept),
 *   - standalone "Accept plan" echoes the reviewed markdown as expectedPlanMd,
 *   - "Resume mission" when accepted but parked for acceptance.
 *
 * The native <dialog> is polyfilled (jsdom has no showModal/close).
 */

import { beforeAll, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

type AcceptData = { ok: true; data: { outcome: string } } | undefined;
const mockUseSessionPlan = vi.fn();
const mockAcceptPlan: {
  mutate: ReturnType<typeof vi.fn>;
  isPending: boolean;
  isError: boolean;
  data: AcceptData;
} = { mutate: vi.fn(), isPending: false, isError: false, data: undefined };
const mockRequestResume = { mutate: vi.fn(), isPending: false };

vi.mock("../../../lib/api/sessions.js", () => ({
  useSessionPlan: (...a: unknown[]) => mockUseSessionPlan(...a),
  useAcceptPlan: () => mockAcceptPlan,
}));
vi.mock("../../../lib/api/runtime.js", () => ({
  useRequestResume: () => mockRequestResume,
}));
vi.mock("../../../lib/markdown/MarkdownContent.js", () => ({
  MarkdownContent: ({ text }: { text: string }) => (
    <div data-testid="plan-md">{text}</div>
  ),
}));

const { PlanDisplayModal } = await import("../PlanDisplayModal.js");

const SESSION = "00000000-0000-4000-8000-00000000aa02";

type PlanState = { enabled: boolean; planMd: string; accepted: boolean };
function planQuery(over: Partial<PlanState>) {
  return {
    data: {
      ok: true as const,
      data: { enabled: false, planMd: "", accepted: false, ...over },
    },
    isFetching: false,
    refetch: vi.fn(),
  };
}

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as unknown as {
    showModal?: () => void;
    close?: () => void;
  };
  if (typeof proto.showModal !== "function") {
    proto.showModal = function (this: HTMLDialogElement): void {
      this.setAttribute("open", "");
    };
  }
  if (typeof proto.close !== "function") {
    proto.close = function (this: HTMLDialogElement): void {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  mockAcceptPlan.isPending = false;
  mockAcceptPlan.isError = false;
  mockAcceptPlan.data = undefined;
  mockRequestResume.isPending = false;
  mockUseSessionPlan.mockReturnValue(planQuery({}));
});

function renderModal(
  props: Partial<{ missionStatus: string | null; suppressAccept: boolean }> = {},
): void {
  render(
    <PlanDisplayModal
      sessionId={SESSION}
      open
      onOpenChange={() => {}}
      {...props}
    />,
  );
}

describe("PlanDisplayModal", () => {
  it("shows a pending plan and accepts it with the exact reviewed content", () => {
    mockUseSessionPlan.mockReturnValue(
      planQuery({ enabled: true, planMd: "# Plan\nstep one", accepted: false }),
    );
    renderModal();
    expect(screen.getByText("Pending your acceptance")).toBeTruthy();
    expect(screen.getByTestId("plan-md").textContent).toContain("step one");
    fireEvent.click(screen.getByText("Accept plan"));
    expect(mockAcceptPlan.mutate).toHaveBeenCalledWith({
      sessionId: SESSION,
      expectedPlanMd: "# Plan\nstep one",
    });
  });

  it("withholds the standalone Accept under suppressAccept (read-only)", () => {
    mockUseSessionPlan.mockReturnValue(
      planQuery({ enabled: true, planMd: "# Plan\nstep one", accepted: false }),
    );
    renderModal({ suppressAccept: true });
    // Still renders the plan, but no standalone accept action.
    expect(screen.getByTestId("plan-md")).toBeTruthy();
    expect(screen.queryByText("Accept plan")).toBeNull();
    expect(
      screen.queryByText(/Accept this plan together with the contract/i),
    ).not.toBeNull();
  });

  it("offers Resume when accepted but the run is still parked", () => {
    mockUseSessionPlan.mockReturnValue(
      planQuery({ enabled: true, planMd: "# Plan", accepted: true }),
    );
    renderModal({ missionStatus: "paused_plan_acceptance" });
    expect(screen.getByText("Accepted")).toBeTruthy();
    expect(screen.queryByText("Accept plan")).toBeNull();
    fireEvent.click(screen.getByText("Resume mission"));
    expect(mockRequestResume.mutate).toHaveBeenCalledWith({
      sessionId: SESSION,
    });
  });

  it("does NOT offer Resume for an accepted plan when the run is not parked", () => {
    mockUseSessionPlan.mockReturnValue(
      planQuery({ enabled: true, planMd: "# Plan", accepted: true }),
    );
    renderModal({ missionStatus: "running" });
    expect(screen.queryByText("Resume mission")).toBeNull();
  });

  it("surfaces a failure notice for each non-success standalone-accept outcome", () => {
    const cases: ReadonlyArray<[string, RegExp]> = [
      ["stale", /Plan changed — review again/i],
      ["no_plan", /No plan authored yet/i],
      ["not_found", /Couldn't accept:.*no longer exists/i],
    ];
    for (const [outcome, copy] of cases) {
      mockUseSessionPlan.mockReturnValue(
        planQuery({ enabled: true, planMd: "# Plan\nstep one", accepted: false }),
      );
      mockAcceptPlan.data = { ok: true, data: { outcome } };
      const { unmount } = render(
        <PlanDisplayModal sessionId={SESSION} open onOpenChange={() => {}} />,
      );
      expect(screen.queryByText(copy)).not.toBeNull();
      unmount();
    }
  });

  it("surfaces a notice when the standalone-accept mutation rejects (transport error)", () => {
    mockUseSessionPlan.mockReturnValue(
      planQuery({ enabled: true, planMd: "# Plan\nstep one", accepted: false }),
    );
    mockAcceptPlan.isError = true;
    renderModal();
    expect(
      screen.queryByText(/Couldn't accept the plan — something went wrong/i),
    ).not.toBeNull();
  });

  it("does NOT surface a standalone-accept notice under suppressAccept", () => {
    mockUseSessionPlan.mockReturnValue(
      planQuery({ enabled: true, planMd: "# Plan\nstep one", accepted: false }),
    );
    // Even if a stale outcome leaked into the cache, the suppressed surface
    // (contract modal owns the unified accept) shows no standalone notice.
    mockAcceptPlan.data = { ok: true, data: { outcome: "stale" } };
    renderModal({ suppressAccept: true });
    expect(screen.queryByText(/Plan changed — review again/i)).toBeNull();
  });
});
