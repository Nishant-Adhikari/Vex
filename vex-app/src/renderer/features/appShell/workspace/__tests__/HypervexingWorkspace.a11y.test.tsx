/**
 * Focus handoff INTO the room on enter (fix/hypervexing-exit-focus, item b):
 * the root carries an explicit `region` landmark and grabs focus on mount —
 * this component only ever mounts while the mode is active, so "on mount" IS
 * "on enter". Heavy children are stubbed (same rationale as
 * HypervexingWorkspace.selection.test.ts): this is an a11y/focus mount test,
 * not a full room render.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("motion/react", () => ({ motion: { div: "div" }, useReducedMotion: () => true }));
vi.mock("../../../../lib/api/hyperliquid.js", () => ({ useHyperliquidPositions: () => ({ data: undefined }) }));
vi.mock("../../../../stores/uiStore.js", () => ({ useUiStore: () => null }));
vi.mock("../HvZone.js", () => ({ HvZone: () => null }));
vi.mock("../HypervexingBookPane.js", () => ({ HypervexingBookPane: () => null }));
vi.mock("../HypervexingChartPane.js", () => ({ HypervexingChartPane: () => null }));
vi.mock("../HypervexingCopilotDock.js", () => ({ HypervexingCopilotDock: () => null }));
vi.mock("../HypervexingLeftColumn.js", () => ({ HypervexingLeftColumn: () => null }));
vi.mock("../HypervexingTabs.js", () => ({ HypervexingTabs: () => null }));
vi.mock("../HypervexingTopBar.js", () => ({ HypervexingTopBar: () => null }));

const { HypervexingWorkspace } = await import("../HypervexingWorkspace.js");

describe("HypervexingWorkspace focus handoff (enter)", () => {
  it("declares a focusable landmark region and focuses it on mount", () => {
    render(<HypervexingWorkspace onExit={vi.fn().mockResolvedValue(true)} />);
    const region = screen.getByRole("region", { name: "Hypervexing trading room" });
    expect(region.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(region);
  });
});
