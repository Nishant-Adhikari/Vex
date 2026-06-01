/**
 * ConfirmDestructiveDialog tests (puzzle 04 phase 7).
 *
 * Lightweight UX checks — the native `<dialog>` primitive (`Dialog`,
 * `DialogContent`) handles focus trap + ESC + restore-focus already
 * (see `vex-app/src/renderer/components/ui/dialog.tsx`), so this
 * suite just pins the wrapper's contract: title/description/buttons,
 * pending state disables buttons + relabels Confirm, callbacks fire.
 *
 * Why `{ hidden: true }` on queries: jsdom does not implement
 * `HTMLDialogElement.showModal()`, so the `<dialog>` stays without
 * the `open` attribute and its descendants land outside the default
 * accessibility tree. Production renders top-layer via showModal;
 * the unit test asserts component output via the hidden tree.
 *
 * Matchers: plain Vitest/Chai (no `@testing-library/jest-dom`) —
 * mirrors the rest of the renderer test suite.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { ConfirmDestructiveDialog } from "../ConfirmDestructiveDialog.js";

interface RenderOpts {
  readonly open?: boolean;
  readonly pending?: boolean;
  readonly tone?: "destructive" | "primary";
  readonly onConfirm?: () => void;
  readonly onCancel?: () => void;
}

function renderDialog(opts: RenderOpts = {}) {
  const onConfirm = opts.onConfirm ?? vi.fn();
  const onCancel = opts.onCancel ?? vi.fn();
  render(
    <ConfirmDestructiveDialog
      open={opts.open ?? true}
      title="Delete 3 items?"
      description="This permanently removes the selected items."
      confirmLabel="Delete"
      tone={opts.tone ?? "destructive"}
      pending={opts.pending ?? false}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  return { onConfirm, onCancel };
}

describe("ConfirmDestructiveDialog", () => {
  it("renders title + description + buttons when open", () => {
    renderDialog();
    expect(screen.queryByText(/Delete 3 items/)).not.toBeNull();
    expect(screen.queryByText(/permanently removes/i)).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: /Cancel/i, hidden: true }),
    ).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: /Delete/i, hidden: true }),
    ).not.toBeNull();
  });

  it("does NOT mark the native dialog as open when open=false", () => {
    // Native `<dialog>` paints its children even when closed, but the
    // `open` attribute is absent. The browser hides the dialog from
    // the accessibility tree when `open` is missing.
    const { container } = render(
      <ConfirmDestructiveDialog
        open={false}
        title="Delete?"
        description="…"
        confirmLabel="Delete"
        tone="destructive"
        pending={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const dialog = container.querySelector("dialog");
    expect(dialog?.hasAttribute("open")).toBe(false);
  });

  it("disables BOTH buttons + flips confirm label to 'Working…' on pending", () => {
    renderDialog({ pending: true });
    const cancel = screen.getByRole("button", {
      name: /Cancel/i,
      hidden: true,
    }) as HTMLButtonElement;
    const confirm = screen.getByRole("button", {
      name: /Working/i,
      hidden: true,
    }) as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
    expect(confirm.disabled).toBe(true);
  });

  it("invokes onCancel when Cancel is clicked", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    renderDialog({ onCancel, onConfirm });
    fireEvent.click(
      screen.getByRole("button", { name: /Cancel/i, hidden: true }),
    );
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("invokes onConfirm when the confirm button is clicked", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    renderDialog({ onCancel, onConfirm });
    fireEvent.click(
      screen.getByRole("button", { name: /Delete/i, hidden: true }),
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("destructive tone applies the danger class to the confirm button", () => {
    renderDialog({ tone: "destructive" });
    const confirm = screen.getByRole("button", {
      name: /Delete/i,
      hidden: true,
    });
    expect(confirm.className).toMatch(/destructive/);
  });

  it("primary tone uses the brand blue class instead", () => {
    renderDialog({ tone: "primary" });
    const confirm = screen.getByRole("button", {
      name: /Delete/i,
      hidden: true,
    });
    expect(confirm.className).toMatch(/3758ff|4668ff/);
    expect(confirm.className).not.toMatch(/destructive/);
  });
});
