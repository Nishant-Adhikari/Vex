/**
 * SessionContext header tests (slice C — a11y labels + canonical selectors).
 *
 * Pins the `session-header` data selector + the labeled group for the active
 * session strip. Stage 4 moved the runtime bar OUT of this header into the
 * BOOK panel; the header now renders no runtime-status group (pinned below).
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SessionListItem } from "@shared/schemas/sessions.js";
import { SessionContext, type SessionContextProps } from "../SessionContext.js";

// JSDOM does not implement `HTMLDialogElement.showModal()` — the dialog
// stays without the `open` attribute and Testing Library's a11y tree hides
// every descendant from `getByRole`. Same polyfill as ReportIssueDialog's
// tests; SessionExportDialog shares the same native-`<dialog>` primitive.
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

const SESSION: SessionListItem = {
  id: "00000000-0000-4000-8000-0000000000e1",
  mode: "agent",
  permission: "restricted",
  title: "Research session",
  initialGoal: null,
  startedAt: "2026-05-26T10:00:00.000Z",
  endedAt: null,
  missionStatus: null,
  pinnedAt: null,
};

function renderCtx(overrides: Partial<SessionContextProps> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(SessionContext, {
        activeSession: SESSION,
        activeSessionId: SESSION.id,
        loading: false,
        error: null,
        ...overrides,
      }),
    ),
  );
}

const exportMarkdown = vi.fn();

beforeEach(() => {
  exportMarkdown.mockReset();
  Object.defineProperty(window, "vex", {
    configurable: true,
    value: { sessions: { exportMarkdown } },
  });
});

describe("SessionContext header (slice C)", () => {
  it("marks the active-session strip with the session-header selector + labeled group", () => {
    const { container } = renderCtx();
    const header = container.querySelector('[data-vex-area="session-header"]');
    expect(header).not.toBeNull();
    expect(header?.getAttribute("role")).toBe("group");
    expect(header?.getAttribute("aria-label")).toBe("Session: Research session");
    expect(screen.getByText("Research session")).not.toBeNull();
    // S3 exception stamps: the default agent mode earns silence; only the
    // deviating `restricted` permission is stamped. (The `mission` mode stamp
    // was removed — mission identity now reads from the MISSION RAIL badge.)
    expect(screen.queryByText("agent")).toBeNull();
    expect(screen.getByText("restricted")).not.toBeNull();
    // Stage 4: the runtime bar moved to the BOOK panel — the header must NOT
    // mount it any more.
    expect(
      container.querySelector('[data-vex-area="runtime-status"]'),
    ).toBeNull();
  });

  it("renders no mission stamp and stays silent for full permission", () => {
    const { container } = renderCtx({
      activeSession: { ...SESSION, mode: "mission", permission: "full" },
    });
    expect(
      container.querySelector('[data-vex-area="session-header"]'),
    ).not.toBeNull();
    // Mission identity moved to the MISSION RAIL badge — the header no longer
    // carries a "mission" stamp, and full permission earns no chrome.
    expect(screen.queryByText("mission")).toBeNull();
    expect(screen.queryByText("restricted")).toBeNull();
  });

  it("does not render the header in the loading or not-found states", () => {
    const loading = renderCtx({ loading: true });
    expect(
      loading.container.querySelector('[data-vex-area="session-header"]'),
    ).toBeNull();
    loading.unmount();

    const notFound = renderCtx({ activeSession: null });
    expect(
      notFound.container.querySelector('[data-vex-area="session-header"]'),
    ).toBeNull();
  });

  it("requires confirmation before exporting and announces a successful save", async () => {
    exportMarkdown.mockResolvedValue({ ok: true, data: { outcome: "saved" } });
    renderCtx();

    fireEvent.click(
      screen.getByRole("button", { name: "Export session as Markdown" }),
    );
    // Privacy-contract confirmation gate: nothing exported yet.
    expect(exportMarkdown).not.toHaveBeenCalled();
    expect(
      await screen.findByText("Export session as Markdown?"),
    ).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(exportMarkdown).toHaveBeenCalledWith({ id: SESSION.id }));
    expect(await screen.findByText("Exported")).not.toBeNull();
  });

  it("keeps native-dialog cancellation silent after confirming", async () => {
    exportMarkdown.mockResolvedValue({ ok: true, data: { outcome: "cancelled" } });
    renderCtx();

    fireEvent.click(
      screen.getByRole("button", { name: "Export session as Markdown" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Export" }));

    await waitFor(() => expect(exportMarkdown).toHaveBeenCalledOnce());
    expect(screen.queryByText("Exported")).toBeNull();
    expect(screen.queryByText("Export failed")).toBeNull();
  });

  it("lets the user cancel the confirmation dialog without exporting", () => {
    renderCtx();

    fireEvent.click(
      screen.getByRole("button", { name: "Export session as Markdown" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(exportMarkdown).not.toHaveBeenCalled();
    expect(screen.queryByText("Export session as Markdown?")).toBeNull();
  });
});
