/**
 * ToolDisclosure tests (batch 3). Collapsed by default; toggles open on click;
 * exposes aria-expanded + aria-controls; falls back to the empty hint when the
 * body is null.
 */

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { ToolDisclosure } from "../ToolDisclosure.js";

describe("ToolDisclosure", () => {
  it("is collapsed by default and reveals the body on click", () => {
    render(
      createElement(ToolDisclosure, {
        label: "wallet:read",
        body: '{"chain":"base"}',
        emptyHint: "(no parameters)",
      }),
    );
    const btn = screen.getByRole("button", { name: /wallet:read/ });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText('{"chain":"base"}')).toBeNull();

    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText('{"chain":"base"}')).not.toBeNull();
  });

  it("points aria-controls at the revealed body element", () => {
    render(
      createElement(ToolDisclosure, { label: "x", body: "B", emptyHint: "-" }),
    );
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    const controls = btn.getAttribute("aria-controls");
    expect(controls).not.toBeNull();
    expect(document.getElementById(controls!)).not.toBeNull();
  });

  it("shows the empty hint when there is no body", () => {
    render(
      createElement(ToolDisclosure, {
        label: "swap_output",
        body: null,
        emptyHint: "(no output)",
      }),
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("(no output)")).not.toBeNull();
  });
});
