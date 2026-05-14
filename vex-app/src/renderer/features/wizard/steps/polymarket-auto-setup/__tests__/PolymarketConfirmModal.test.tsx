/**
 * PolymarketConfirmModal — overwrite confirmation modal tests.
 *
 * Verifies:
 *  - renders title text + Cancel + Replace buttons,
 *  - Replace click → onConfirm,
 *  - Cancel click → onClose,
 *  - closeOnBackdropClick is disabled (cannot dismiss by clicking the
 *    dialog backdrop — required for destructive prompts).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

const mockOnConfirm = vi.fn();
const mockOnClose = vi.fn();

const { PolymarketConfirmModal } = await import("../PolymarketConfirmModal.js");

function renderModal(
  props?: Partial<{ onConfirm: typeof mockOnConfirm; onClose: () => void }>,
): ReturnType<typeof render> {
  return render(
    <PolymarketConfirmModal
      onConfirm={props?.onConfirm ?? mockOnConfirm}
      onClose={props?.onClose ?? mockOnClose}
    />,
  );
}

beforeEach(() => {
  mockOnConfirm.mockReset();
  mockOnClose.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("PolymarketConfirmModal", () => {
  it("renders title, body, Cancel + Replace buttons", () => {
    const view = renderModal();
    expect(
      view.container.querySelector("[data-vex-polymarket-confirm='root']"),
    ).toBeTruthy();
    expect(
      view.container.querySelector("[data-vex-polymarket-confirm-cancel]"),
    ).toBeTruthy();
    expect(
      view.container.querySelector("[data-vex-polymarket-confirm-replace]"),
    ).toBeTruthy();
    expect(view.container.textContent).toMatch(
      /Replace existing Polymarket credentials/,
    );
  });

  it("Replace button click → onConfirm", () => {
    const view = renderModal();
    const replace = view.container.querySelector(
      "[data-vex-polymarket-confirm-replace]",
    ) as HTMLButtonElement;
    fireEvent.click(replace);
    expect(mockOnConfirm).toHaveBeenCalledTimes(1);
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it("Cancel button click → onClose", () => {
    const view = renderModal();
    const cancel = view.container.querySelector(
      "[data-vex-polymarket-confirm-cancel]",
    ) as HTMLButtonElement;
    fireEvent.click(cancel);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
    expect(mockOnConfirm).not.toHaveBeenCalled();
  });

  it("backdrop click does NOT close (closeOnBackdropClick is disabled)", () => {
    const view = renderModal();
    const dialog = view.container.querySelector(
      "dialog[data-vex-polymarket-confirm='root']",
    ) as HTMLDialogElement;
    // Native <dialog> receives a click whose target === currentTarget
    // when the user clicks on the backdrop. Simulate by firing a click
    // with target=== dialog itself.
    fireEvent.click(dialog, { target: dialog });
    expect(mockOnClose).not.toHaveBeenCalled();
    expect(mockOnConfirm).not.toHaveBeenCalled();
  });
});
