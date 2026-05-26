/**
 * TranscriptMessage marker render tests (stage 8-4).
 *
 * Covers the two inline markers added in 8-4: the static `CompactionMarker`
 * and the static `MemoryMarker`. Asserts accurate memory-vs-knowledge copy,
 * that assistant prose on a recall row is preserved, and that an empty recall
 * row renders the indicator only. Markers are static — no in-flight animation.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { TranscriptMessage } from "../TranscriptMessage.js";
import type {
  TranscriptRowModel,
  TranscriptRowVariant,
} from "../transcriptRowModel.js";

function row(p: {
  readonly variant: TranscriptRowVariant;
  readonly label?: string | null;
  readonly content?: string;
}): TranscriptRowModel {
  return {
    id: 1,
    variant: p.variant,
    label: p.label ?? null,
    content: p.content ?? "",
  };
}

describe("TranscriptMessage markers (8-4)", () => {
  it("renders the compaction marker text", () => {
    const { container } = render(
      createElement(TranscriptMessage, {
        row: row({
          variant: "compaction",
          content: "Conversation compacted into memory · checkpoint 2",
        }),
      }),
    );
    expect(
      screen.getByText(/Conversation compacted into memory · checkpoint 2/),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-vex-marker="compaction"]'),
    ).not.toBeNull();
  });

  it("labels memory_recall as session memory and preserves assistant prose", () => {
    render(
      createElement(TranscriptMessage, {
        row: row({
          variant: "recall",
          label: "memory_recall",
          content: "Let me check what I remember.",
        }),
      }),
    );
    expect(screen.getByText("Recalled session memory")).not.toBeNull();
    expect(screen.getByText("Let me check what I remember.")).not.toBeNull();
  });

  it("labels knowledge_recall as cross-session knowledge", () => {
    render(
      createElement(TranscriptMessage, {
        row: row({ variant: "recall", label: "knowledge_recall", content: "" }),
      }),
    );
    expect(screen.getByText("Recalled cross-session knowledge")).not.toBeNull();
  });

  it("falls back to neutral recall copy for an unknown/null tool name", () => {
    render(
      createElement(TranscriptMessage, {
        row: row({ variant: "recall", label: null, content: "" }),
      }),
    );
    expect(screen.getByText("Recalled context")).not.toBeNull();
  });

  it("renders only the indicator when a recall row has no prose", () => {
    const { container } = render(
      createElement(TranscriptMessage, {
        row: row({ variant: "recall", label: "memory_recall", content: "" }),
      }),
    );
    expect(container.querySelector('[data-vex-marker="recall"]')).not.toBeNull();
    // No prose node when content is empty.
    expect(
      container.querySelector("[data-vex-marker-content]"),
    ).toBeNull();
  });
});
