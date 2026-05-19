import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Result } from "@shared/ipc/result.js";
import type { SessionCreateInput, SessionListItem } from "@shared/schemas/sessions.js";
import type { HealthReport } from "@shared/schemas/system.js";
import { createQueryClient } from "../../../app/queryClient.js";
import { useUiStore } from "../../../stores/uiStore.js";

vi.mock("@hugeicons/react", () => ({
  HugeiconsIcon: () => null,
}));

vi.mock("@hugeicons/core-free-icons", () => ({
  Add01Icon: "Add01Icon",
  AiChat01Icon: "AiChat01Icon",
  AlertCircleIcon: "AlertCircleIcon",
  Archive02Icon: "Archive02Icon",
  ArrowUp01Icon: "ArrowUp01Icon",
  BitcoinWalletIcon: "BitcoinWalletIcon",
  BridgeIcon: "BridgeIcon",
  BubbleChatSparkIcon: "BubbleChatSparkIcon",
  Bug02Icon: "Bug02Icon",
  ChartCandlestickIcon: "ChartCandlestickIcon",
  CheckmarkCircle02Icon: "CheckmarkCircle02Icon",
  Clock03Icon: "Clock03Icon",
  DatabaseLightningIcon: "DatabaseLightningIcon",
  Exchange01Icon: "Exchange01Icon",
  FilterHorizontalIcon: "FilterHorizontalIcon",
  Knowledge01Icon: "Knowledge01Icon",
  PanelLeftCloseIcon: "PanelLeftCloseIcon",
  PanelLeftOpenIcon: "PanelLeftOpenIcon",
  Search01Icon: "Search01Icon",
  Settings02Icon: "Settings02Icon",
  Shield02Icon: "Shield02Icon",
  SparklesIcon: "SparklesIcon",
  StopCircleIcon: "StopCircleIcon",
  Target02Icon: "Target02Icon",
  Wallet01Icon: "Wallet01Icon",
  ZapIcon: "ZapIcon",
}));

vi.mock("@thesvg/react", () => ({
  Docker: () => null,
  Ethereum: () => null,
  Postgresql: () => null,
}));

const { AppShell } = await import("../AppShell.js");

const sessionsListMock = vi.fn<() => Promise<Result<readonly SessionListItem[]>>>();
const sessionsGetMock = vi.fn<
  (input: { readonly id: string }) => Promise<Result<SessionListItem | null>>
>();
const sessionsCreateMock = vi.fn<
  (input: SessionCreateInput) => Promise<Result<SessionListItem>>
>();
const healthMock = vi.fn<() => Promise<Result<HealthReport>>>();

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as unknown as {
    showModal?: () => void;
    close?: () => void;
    show?: () => void;
  };
  if (typeof proto.showModal !== "function") {
    proto.showModal = function showModalPolyfill(this: HTMLDialogElement): void {
      this.setAttribute("open", "");
    };
  }
  if (typeof proto.close !== "function") {
    proto.close = function closePolyfill(this: HTMLDialogElement): void {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  }
  if (typeof proto.show !== "function") {
    proto.show = function showPolyfill(this: HTMLDialogElement): void {
      this.setAttribute("open", "");
    };
  }
});

beforeEach(() => {
  window.localStorage.clear();
  sessionsListMock.mockReset();
  sessionsGetMock.mockReset();
  sessionsCreateMock.mockReset();
  healthMock.mockReset();
  useUiStore.setState({
    sidebarOpen: true,
    currentView: "appShell",
    wizardEntryMode: "setup",
    unlockReturnView: "appShell",
    logBuffer: [],
    sessionModeFilter: "all",
    activeSessionId: null,
  });
  sessionsListMock.mockResolvedValue({ ok: true, data: [] });
  sessionsGetMock.mockResolvedValue({ ok: true, data: null });
  sessionsCreateMock.mockImplementation(async (input) => {
    const row: SessionListItem = {
      id: "a6bf4f85-e645-4df7-9bc5-70ec2eb0bd51",
      mode: input.mode,
      permission: input.permission,
      initialGoal: input.mode === "mission" ? input.initialGoal : null,
      startedAt: localIsoDaysAgo(0),
      endedAt: null,
      missionStatus: null,
    };
    return { ok: true, data: row };
  });
  healthMock.mockResolvedValue({ ok: true, data: makeHealthReport("ok") });
  Object.defineProperty(window, "vex", {
    configurable: true,
    value: {
      sessions: {
        list: sessionsListMock,
        get: sessionsGetMock,
        create: sessionsCreateMock,
      },
      system: {
        health: healthMock,
      },
    },
  });
});

describe("AppShell", () => {
  it("renders the Vex shell hero and local runtime footer", async () => {
    renderShell();

    expect(
      screen.getByRole("heading", { name: /Your chain\. Your rules\./i }),
    ).not.toBeNull();
    expect(screen.getAllByRole("button", { name: /New session/i }).length).toBeGreaterThan(0);
    await screen.findByText("Connected to local runtime");
    expect(screen.getByText("v0.0.0-test")).not.toBeNull();
  });

  it("groups recent sessions into Today, Yesterday, and Older", async () => {
    sessionsListMock.mockResolvedValueOnce({
      ok: true,
      data: makeSessionRows(),
    });

    renderShell();

    await screen.findByText("Today");
    expect(screen.getByText("Yesterday")).not.toBeNull();
    expect(screen.getByText("Older")).not.toBeNull();
    expect(screen.getAllByText("Arbitrum LP Rebalance").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Open BTC Perp Position").length).toBeGreaterThan(0);
  });

  it("filters the sidebar by mission mode", async () => {
    sessionsListMock.mockResolvedValueOnce({
      ok: true,
      data: makeSessionRows(),
    });

    renderShell();
    await screen.findByText("Portfolio Check");

    fireEvent.click(screen.getByRole("tab", { name: "Mission" }));

    expect(screen.getAllByText("Arbitrum LP Rebalance").length).toBeGreaterThan(0);
    expect(screen.queryByText("Portfolio Check")).toBeNull();
  });

  it("collapses and expands the glass sidebar", async () => {
    const view = renderShell();
    const sidebar = view.container.querySelector("[data-vex-area='sessions-sidebar']");

    expect(sidebar?.getAttribute("data-vex-sidebar-open")).toBe("true");
    fireEvent.click(
      screen.getByRole("button", { name: /Collapse sessions sidebar/i }),
    );
    expect(sidebar?.getAttribute("data-vex-sidebar-open")).toBe("false");
    fireEvent.click(
      screen.getByRole("button", { name: /Expand sessions sidebar/i }),
    );
    expect(sidebar?.getAttribute("data-vex-sidebar-open")).toBe("true");
  });

  it("keeps composer text local and stages a draft without session IPC", async () => {
    renderShell();

    const draft = screen.getByLabelText("Session draft") as HTMLTextAreaElement;
    fireEvent.change(draft, {
      target: { value: "Research $TAO liquidity and thesis" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Stage draft" }));

    expect(draft.value).toBe("");
    expect(screen.getAllByText("Draft staged.").length).toBeGreaterThan(0);
    expect(sessionsGetMock).not.toHaveBeenCalled();
  });

  it("creates a mission session with restricted permission", async () => {
    renderShell();

    fireEvent.click(screen.getAllByRole("button", { name: "New session" })[0]!);
    fireEvent.click(screen.getByRole("radio", { name: /Mission/i }));
    fireEvent.change(screen.getByLabelText("Goal"), {
      target: { value: "Rebalance Arbitrum LP range" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(sessionsCreateMock).toHaveBeenCalledTimes(1));
    expect(sessionsCreateMock).toHaveBeenCalledWith({
      mode: "mission",
      permission: "restricted",
      initialGoal: "Rebalance Arbitrum LP range",
    });
  });
});

function renderShell(): ReturnType<typeof render> {
  const client = createQueryClient();
  client.setDefaultOptions({
    queries: {
      retry: false,
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <AppShell />
    </QueryClientProvider>,
  );
}

function makeSessionRows(): readonly SessionListItem[] {
  return [
    {
      id: "fb7bf453-df76-43e9-b756-02c3b717f242",
      mode: "mission",
      permission: "restricted",
      initialGoal: "Arbitrum LP Rebalance",
      startedAt: localIsoDaysAgo(0),
      endedAt: null,
      missionStatus: "running",
    },
    {
      id: "2c7e7135-6d80-443c-b73e-b43717a09425",
      mode: "agent",
      permission: "restricted",
      initialGoal: null,
      startedAt: localIsoDaysAgo(0),
      endedAt: null,
      missionStatus: null,
    },
    {
      id: "cf0788b8-87c7-4eb2-b4b9-4252779f906d",
      mode: "mission",
      permission: "full",
      initialGoal: "Open BTC Perp Position",
      startedAt: localIsoDaysAgo(1),
      endedAt: null,
      missionStatus: "paused_wake",
    },
    {
      id: "db01d1f7-8b1e-4607-a59c-cda6a9ff1024",
      mode: "agent",
      permission: "restricted",
      initialGoal: "Portfolio Check",
      startedAt: localIsoDaysAgo(3),
      endedAt: null,
      missionStatus: null,
    },
  ];
}

function localIsoDaysAgo(days: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function makeHealthReport(overall: HealthReport["overall"]): HealthReport {
  return {
    os: {
      platform: "linux",
      arch: "x64",
      release: "test",
      distro: "test",
      homedir: "/home/test",
      userDataDir: "/tmp/vex-test",
      appVersion: "0.0.0-test",
      electronVersion: "0.0.0-test",
      nodeVersion: "0.0.0-test",
    },
    network: {
      online: true,
      latencyMs: 1,
      probedAt: new Date("2026-05-19T12:00:00.000Z").toISOString(),
    },
    setupComplete: true,
    overall,
  };
}
