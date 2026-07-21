import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HypervexingTopBar } from "../HypervexingTopBar.js";

describe("HypervexingTopBar exit authority", () => {
  it("keeps the workspace mounted, surfaces failure, and permits retry", async () => {
    const onExit = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    render(<HypervexingTopBar positions={[]} account={null} onExit={onExit} />);
    fireEvent.click(screen.getByRole("button", { name: "Exit Hypervexing" }));
    await screen.findByRole("alert");
    expect(screen.getByText("Exit failed. Retry.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Exit Hypervexing" }));
    await waitFor(() => expect(onExit).toHaveBeenCalledTimes(2));
  });
});

describe("HypervexingTopBar a11y", () => {
  it("carries an accessible name and marks itself busy only while an exit is in flight", async () => {
    // A mutable holder (not a reassigned `let`) — passing the closure that
    // reassigns a bare `let` as a call argument confuses TS's control-flow
    // narrowing into `never` at the later read (a known compiler quirk).
    const pendingExit: { resolve: ((accepted: boolean) => void) | null } = {
      resolve: null,
    };
    const onExit = vi.fn(
      () => new Promise<boolean>((resolve) => { pendingExit.resolve = resolve; }),
    );
    render(<HypervexingTopBar positions={[]} account={null} onExit={onExit} />);
    const header = screen.getByRole("banner", { name: "Hypervexing top bar" });
    expect(header.getAttribute("aria-busy")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Exit Hypervexing" }));
    expect(header.getAttribute("aria-busy")).toBe("true");

    pendingExit.resolve?.(true);
    await waitFor(() => expect(header.getAttribute("aria-busy")).toBe("false"));
  });
});
