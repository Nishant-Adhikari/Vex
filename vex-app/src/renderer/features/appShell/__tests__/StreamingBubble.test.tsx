import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";

import { StreamingBubble } from "../StreamingBubble.js";
import type { StreamPreview } from "../../../stores/streamStore.js";

function preview(overrides: Partial<StreamPreview> = {}): StreamPreview {
  return { streamId: "s1", text: "", phase: "streaming", toolName: null, ...overrides };
}

describe("StreamingBubble", () => {
  it("renders streamed markdown text, the Vex avatar, and a streaming indicator", () => {
    const { container } = render(
      createElement(StreamingBubble, {
        preview: preview({ text: "Hello **world**", phase: "streaming" }),
      }),
    );
    const root = container.querySelector('[data-vex-area="stream-preview"]');
    expect(root).not.toBeNull();
    expect(root?.getAttribute("data-vex-stream-phase")).toBe("streaming");
    expect(root?.getAttribute("data-vex-message-role")).toBe("assistant");
    expect(root?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector('img[src="/vex.jpg"]')).not.toBeNull();
    expect(container.textContent).toContain("Hello");
    expect(container.textContent).toContain("world");
    // sr-only phase status (announced, not the growing text).
    expect(screen.getByText("Vex is responding")).not.toBeNull();
  });

  it("keeps markdown links accessible (not under an aria-hidden ancestor)", () => {
    const { container } = render(
      createElement(StreamingBubble, {
        preview: preview({ text: "see [docs](https://example.com)", phase: "streaming" }),
      }),
    );
    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toContain("example.com");
    expect(link?.closest('[aria-hidden="true"]')).toBeNull();
  });

  it("shows a tool hint when there is no text yet", () => {
    render(
      createElement(StreamingBubble, { preview: preview({ text: "", toolName: "swap" }) }),
    );
    expect(screen.getByText(/Calling swap/)).not.toBeNull();
  });

  it("shows a safe generic error line and never the raw text on error phase", () => {
    const { container } = render(
      createElement(StreamingBubble, {
        preview: preview({ phase: "error", text: "raw-provider-leak" }),
      }),
    );
    expect(
      container.querySelector('[data-vex-stream-phase="error"]'),
    ).not.toBeNull();
    expect(screen.getByText("Stream error")).not.toBeNull();
    expect(container.textContent).not.toContain("raw-provider-leak");
  });

  it("drops the indicator once the stream is done", () => {
    const { container } = render(
      createElement(StreamingBubble, { preview: preview({ text: "final", phase: "done" }) }),
    );
    expect(container.querySelector('[data-vex-stream-phase="done"]')).not.toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.getByText("Vex responded")).not.toBeNull();
  });
});
