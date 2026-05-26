/**
 * One transcript row (stage 8-1) — presentational only.
 *
 * Switches on the pure `TranscriptRowModel.variant`. Content is rendered as a
 * React text node (`{content}`), never HTML, so tool args / model output can't
 * inject markup — markdown + sanitization land in a later slice. Vex replies
 * carry the `/vex.jpg` avatar. Surfaces stay ≤8px radius with no card-in-card.
 */

import type { JSX } from "react";
import type { TranscriptRowModel } from "./transcriptRowModel.js";

const BUBBLE =
  "max-w-[80%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm leading-relaxed";

export function TranscriptMessage({
  row,
}: {
  readonly row: TranscriptRowModel;
}): JSX.Element {
  switch (row.variant) {
    case "user":
      return (
        <div data-vex-message-role="user" className="flex justify-end">
          <div
            className={`${BUBBLE} border border-[#6f91ff]/20 bg-[#6f91ff]/10 text-foreground`}
          >
            {row.content}
          </div>
        </div>
      );
    case "assistant":
      return (
        <div data-vex-message-role="assistant" className="flex items-start gap-2">
          <img
            src="/vex.jpg"
            alt="Vex"
            className="mt-0.5 h-7 w-7 shrink-0 rounded-md object-cover"
          />
          <div className={`${BUBBLE} bg-white/[0.04] text-foreground`}>
            {row.content}
          </div>
        </div>
      );
    case "tool":
      return (
        <div data-vex-message-role="tool" className="flex justify-start">
          <div className="max-w-[80%] rounded-md border border-white/[0.08] bg-white/[0.02] px-2.5 py-1.5 font-mono text-[11px] text-[var(--color-text-secondary)]">
            <span className="text-[var(--color-text-muted)]">{row.label}</span>
            {row.content.length > 0 ? (
              <span className="ml-2 whitespace-pre-wrap break-words">
                {row.content}
              </span>
            ) : null}
          </div>
        </div>
      );
    case "notice":
      return (
        <div data-vex-message-role="system" className="flex justify-center">
          <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-md bg-white/[0.03] px-2.5 py-1 text-center text-[11px] text-[var(--color-text-muted)]">
            {row.content}
          </div>
        </div>
      );
    default: {
      const exhaustive: never = row.variant;
      throw new Error(`Unhandled transcript variant: ${String(exhaustive)}`);
    }
  }
}
