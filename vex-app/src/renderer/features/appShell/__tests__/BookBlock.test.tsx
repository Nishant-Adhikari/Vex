/**
 * BookBlock — the shared BOOK section chrome. Pins the two mechanics added for
 * the MISSION CONTROL accordion/reorder pass:
 *   - persisted collapse: with a `sectionId`, open/collapsed lives in the UI
 *     store (survives unmount), and the disclosure toggle flips it,
 *   - reorder controls: move up/down buttons render, disable at the list ends,
 *     and fire their callbacks.
 * The historic static (non-collapsible) render is also pinned unchanged.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@hugeicons/react", () => ({
  HugeiconsIcon: () => null,
}));

const { BookBlock } = await import("../book/BookBlock.js");
const { useUiStore } = await import("../../../stores/uiStore.js");

beforeEach(() => {
  useUiStore.setState({
    bookSectionCollapsed: {},
    bookSectionOrder: ["moves", "runtime", "session"],
  });
});

describe("BookBlock static render", () => {
  it("renders title + body with no disclosure button when not collapsible", () => {
    render(
      <BookBlock title="Session">
        <p>body</p>
      </BookBlock>,
    );
    expect(screen.getByText("Session")).not.toBeNull();
    expect(screen.getByText("body")).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("BookBlock persisted collapse", () => {
  it("defaults open, and the toggle writes collapse into the store", () => {
    render(
      <BookBlock title="Moves" collapsible sectionId="moves">
        <p>moves-body</p>
      </BookBlock>,
    );
    const toggle = screen.getByRole("button", { name: /Moves/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("moves-body")).not.toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(useUiStore.getState().bookSectionCollapsed.moves).toBe(true);
    // Body is removed from the tree when collapsed (not merely hidden).
    expect(screen.queryByText("moves-body")).toBeNull();
  });

  it("reads its initial open state from the persisted store", () => {
    useUiStore.setState({ bookSectionCollapsed: { session: true } });
    render(
      <BookBlock title="Session" collapsible sectionId="session">
        <p>session-body</p>
      </BookBlock>,
    );
    const toggle = screen.getByRole("button", { name: /Session/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("session-body")).toBeNull();
  });
});

describe("BookBlock reorder controls", () => {
  it("renders enabled up/down and fires callbacks", () => {
    const onUp = vi.fn();
    const onDown = vi.fn();
    render(
      <BookBlock
        title="Runtime & Cost"
        collapsible
        sectionId="runtime"
        reorder={{ onUp, onDown, canUp: true, canDown: true }}
      >
        <p>body</p>
      </BookBlock>,
    );
    const up = screen.getByRole("button", { name: /Move Runtime & Cost up/i });
    const down = screen.getByRole("button", { name: /Move Runtime & Cost down/i });
    expect((up as HTMLButtonElement).disabled).toBe(false);
    expect((down as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(up);
    fireEvent.click(down);
    expect(onUp).toHaveBeenCalledOnce();
    expect(onDown).toHaveBeenCalledOnce();
  });

  it("disables the control at the list edge", () => {
    render(
      <BookBlock
        title="Moves"
        collapsible
        sectionId="moves"
        reorder={{ onUp: () => {}, onDown: () => {}, canUp: false, canDown: true }}
      >
        <p>body</p>
      </BookBlock>,
    );
    const up = screen.getByRole("button", { name: /Move Moves up/i });
    expect((up as HTMLButtonElement).disabled).toBe(true);
  });
});
