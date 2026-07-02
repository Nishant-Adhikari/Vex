/**
 * UpdateModal (M13) — presentational two-step surface. Asserts the step-1
 * (download) vs step-2 (restart) buttons appear for the right states and that
 * actions fire. No `window.vex` needed — the modal takes props.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { UpdateStatus } from "@shared/schemas/updater.js";
import { UpdateModal } from "../UpdateModal.js";

function renderModal(status: UpdateStatus) {
  const props = {
    open: true,
    status,
    busy: false,
    onOpenChange: vi.fn(),
    onDownload: vi.fn(),
    onCancel: vi.fn(),
    onRestart: vi.fn(),
    onCheck: vi.fn(),
    onReleaseNotes: vi.fn(),
  };
  render(<UpdateModal {...props} />);
  return props;
}

describe("UpdateModal two-step buttons", () => {
  it("available shows the Download CTA (step 1), not a restart", () => {
    renderModal({
      kind: "available",
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
      severity: "normal",
    });
    expect(screen.getByText("Update now")).toBeTruthy();
    expect(screen.queryByText("Restart and install")).toBeNull();
  });

  it("downloading shows a progressbar at the right value + Cancel", () => {
    renderModal({
      kind: "downloading",
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
      percent: 40,
    });
    // jsdom doesn't implement <dialog>.showModal(), so the dialog stays
    // `hidden`; query the accessibility tree with hidden:true.
    expect(
      screen
        .getByRole("progressbar", { hidden: true })
        .getAttribute("aria-valuenow"),
    ).toBe("40");
    expect(screen.getByText("Cancel")).toBeTruthy();
  });

  it("downloaded shows the explicit Restart CTA (step 2)", () => {
    renderModal({
      kind: "downloaded",
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
    });
    expect(screen.getByText("Restart and install")).toBeTruthy();
  });

  it("blockedByOperation surfaces the reason", () => {
    renderModal({
      kind: "blockedByOperation",
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
      reason: "A database migration is still running.",
    });
    expect(
      screen.getByText("A database migration is still running."),
    ).toBeTruthy();
  });

  it("fires onDownload from the step-1 CTA", () => {
    const props = renderModal({
      kind: "available",
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
      severity: "normal",
    });
    fireEvent.click(screen.getByText("Update now"));
    expect(props.onDownload).toHaveBeenCalledTimes(1);
  });

  it("fires onRestart from the step-2 CTA", () => {
    const props = renderModal({
      kind: "downloaded",
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
    });
    fireEvent.click(screen.getByText("Restart and install"));
    expect(props.onRestart).toHaveBeenCalledTimes(1);
  });
});
