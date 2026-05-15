/**
 * ComposeBootstrap renderer tests.
 *
 * Verifies the cancellation contract from PR3 (preserved verbatim
 * after redesign) plus the per-kind error UX added in this iteration
 * (port_collision, unhealthy, failed) plus the happy path
 * (running → ready + Continue → migrations).
 *
 * Selectors `data-vex-compose-cancel` and `data-vex-compose-cancelling`
 * are part of the public contract — pinning these prevents the cancel
 * UX from regressing during future visual refactors.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const mockCompose = vi.fn();
const mockCancel = vi.fn();
const mockOnComposeLog = vi.fn().mockReturnValue(() => {});
const mockSetCurrentView = vi.fn();

vi.mock("../../../stores/uiStore.js", () => ({
  useUiStore: (selector: (s: { setCurrentView: (v: string) => void }) => unknown) =>
    selector({ setCurrentView: mockSetCurrentView }),
}));

const { ComposeBootstrap } = await import("../ComposeBootstrap.js");

function arrangeBridge(): void {
  Object.defineProperty(window, "vex", {
    configurable: true,
    value: {
      docker: {
        composeUpAbortable: mockCompose,
        onComposeLog: mockOnComposeLog,
      },
    },
  });
}

beforeEach(() => {
  mockCompose.mockReset();
  mockCancel.mockReset();
  mockSetCurrentView.mockReset();
  arrangeBridge();
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "vex");
});

describe("ComposeBootstrap — cancellation (PR3 contract)", () => {
  it("shows the Cancel button while compose-up is in flight", () => {
    mockCompose.mockReturnValue({
      promise: new Promise(() => {}),
      cancel: mockCancel,
    });
    const view = render(<ComposeBootstrap />);
    const button = view.container.querySelector("[data-vex-compose-cancel]");
    expect(button).not.toBeNull();
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("calls the cancel handle when the Cancel button is clicked", () => {
    mockCompose.mockReturnValue({
      promise: new Promise(() => {}),
      cancel: mockCancel,
    });
    const view = render(<ComposeBootstrap />);
    const button = view.container.querySelector(
      "[data-vex-compose-cancel]",
    ) as HTMLButtonElement;
    fireEvent.click(button);
    expect(mockCancel).toHaveBeenCalledTimes(1);
  });

  it("transitions to a disabled Cancelling button immediately after click", () => {
    mockCompose.mockReturnValue({
      promise: new Promise(() => {}),
      cancel: mockCancel,
    });
    const view = render(<ComposeBootstrap />);
    const button = view.container.querySelector(
      "[data-vex-compose-cancel]",
    ) as HTMLButtonElement;
    fireEvent.click(button);
    const cancelling = view.container.querySelector(
      "[data-vex-compose-cancelling]",
    ) as HTMLButtonElement | null;
    expect(cancelling).not.toBeNull();
    expect(cancelling!.disabled).toBe(true);
  });

  it("renders 'Startup cancelled.' + Retry when the promise resolves to internal.cancelled", async () => {
    mockCompose.mockReturnValue({
      promise: Promise.resolve({
        ok: false,
        error: {
          code: "internal.cancelled",
          domain: "docker",
          message: "Operation cancelled.",
          retryable: true,
          userActionable: false,
          redacted: true,
          correlationId: "11111111-2222-4333-8444-555555555555",
        },
      }),
      cancel: mockCancel,
    });
    const view = render(<ComposeBootstrap />);
    await waitFor(() => {
      expect(view.container.textContent).toMatch(/Startup cancelled\./);
    });
    const retry = Array.from(view.container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Retry"),
    );
    expect(retry).toBeTruthy();
    const cancel = view.container.querySelector("[data-vex-compose-cancel]");
    expect(cancel).toBeNull();
  });

  it("does NOT auto-cancel from effect cleanup (StrictMode race guard)", () => {
    mockCompose.mockReturnValue({
      promise: new Promise(() => {}),
      cancel: mockCancel,
    });
    const view = render(<ComposeBootstrap />);
    view.unmount();
    expect(mockCancel).not.toHaveBeenCalled();
  });
});

describe("ComposeBootstrap — terminal kinds", () => {
  it("kind=running → 'All services ready' tile + Continue button (Continue advances to migrations)", async () => {
    mockCompose.mockReturnValue({
      promise: Promise.resolve({
        ok: true,
        data: {
          kind: "running",
          composeOutPath: "/tmp/compose.yml",
          installId: "vex-1031ec52-40c8-4951-8e94-b55702346ba6",
          message: "Vex stack is running (pg :55432, embeddings :55134, dim=768).",
        },
      }),
      cancel: mockCancel,
    });
    const view = render(<ComposeBootstrap />);
    await waitFor(() => {
      expect(view.container.textContent).toMatch(/All services ready/);
    });
    const continueBtn = Array.from(
      view.container.querySelectorAll("button"),
    ).find((b) => b.textContent?.includes("Continue"));
    expect(continueBtn).toBeTruthy();
    fireEvent.click(continueBtn!);
    expect(mockSetCurrentView).toHaveBeenCalledWith("migrations");
  });

  it("kind=reused → 'Stack reused' tile + Continue button", async () => {
    mockCompose.mockReturnValue({
      promise: Promise.resolve({
        ok: true,
        data: {
          kind: "reused",
          composeOutPath: "/tmp/compose.yml",
          installId: "vex-1031ec52",
          message: "Existing compose project is healthy.",
        },
      }),
      cancel: mockCancel,
    });
    const view = render(<ComposeBootstrap />);
    await waitFor(() => {
      expect(view.container.textContent).toMatch(/Stack reused/);
    });
    const continueBtn = Array.from(
      view.container.querySelectorAll("button"),
    ).find((b) => b.textContent?.includes("Continue"));
    expect(continueBtn).toBeTruthy();
  });

  it("kind=port_collision → port collision body + Retry button (NOT Continue)", async () => {
    mockCompose.mockReturnValue({
      promise: Promise.resolve({
        ok: true,
        data: {
          kind: "port_collision",
          composeOutPath: "/tmp/compose.yml",
          installId: "vex-1031ec52",
          message: "Port 55432 is already in use by another process.",
        },
      }),
      cancel: mockCancel,
    });
    const view = render(<ComposeBootstrap />);
    await waitFor(() => {
      expect(view.container.textContent).toMatch(/Port already in use/);
    });
    expect(view.container.textContent).toMatch(/Port 55432/);
    const retry = Array.from(view.container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Retry") || b.textContent?.includes("Try again"),
    );
    expect(retry).toBeTruthy();
  });

  it("kind=unhealthy → unhealthy body + retry CTA", async () => {
    mockCompose.mockReturnValue({
      promise: Promise.resolve({
        ok: true,
        data: {
          kind: "unhealthy",
          composeOutPath: "/tmp/compose.yml",
          installId: "vex-1031ec52",
          message: "Postgres started but failed pg_isready within 30s.",
        },
      }),
      cancel: mockCancel,
    });
    const view = render(<ComposeBootstrap />);
    await waitFor(() => {
      expect(view.container.textContent).toMatch(
        /Service started but health probe failed/,
      );
    });
  });

  it("kind=failed → failed body + 'Show recent logs' disclosure", async () => {
    mockCompose.mockReturnValue({
      promise: Promise.resolve({
        ok: true,
        data: {
          kind: "failed",
          composeOutPath: "/tmp/compose.yml",
          installId: "vex-1031ec52",
          message: "docker daemon stopped mid-run.",
        },
      }),
      cancel: mockCancel,
    });
    const view = render(<ComposeBootstrap />);
    await waitFor(() => {
      expect(view.container.textContent).toMatch(/Compose up failed/);
    });
  });

  it("result.ok=false (non-cancelled IPC error) → failed body", async () => {
    mockCompose.mockReturnValue({
      promise: Promise.resolve({
        ok: false,
        error: {
          code: "internal.error",
          domain: "docker",
          message: "IPC handler crashed.",
          retryable: true,
          userActionable: false,
          redacted: true,
          correlationId: "22222222-3333-4444-9555-666666666666",
        },
      }),
      cancel: mockCancel,
    });
    const view = render(<ComposeBootstrap />);
    await waitFor(() => {
      expect(view.container.textContent).toMatch(/Compose up failed/);
    });
  });
});
