/**
 * One transcript row — presentational only.
 *
 * Switches on the pure `TranscriptRowModel.variant`. Assistant prose renders
 * through `MarkdownContent` (stage 8-2a) — safe React elements, never an HTML
 * string; user/tool/notice rows + the `compaction`/`recall` markers (stage
 * 8-4) render as plain React text nodes. Either way model/tool output cannot
 * inject markup. Vex replies carry the `/vex.jpg` avatar. Surfaces stay ≤8px
 * radius with no card-in-card.
 */

import type { JSX } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { StopCircleIcon } from "@hugeicons/core-free-icons";
import { MarkdownContent } from "../../lib/markdown/MarkdownContent.js";
import { CompactionMarker } from "./CompactionMarker.js";
import { MemoryMarker } from "./MemoryMarker.js";
import { ToolDisclosure } from "./ToolDisclosure.js";
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
          <div className="max-w-[80%] break-words rounded-lg bg-white/[0.04] px-3 py-2 text-sm leading-relaxed text-foreground">
            <MarkdownContent text={row.content} />
          </div>
        </div>
      );
    case "assistant_stopped":
      return (
        <div
          data-vex-message-role="assistant"
          data-vex-stopped=""
          className="flex items-start gap-2"
        >
          <img
            src="/vex.jpg"
            alt="Vex"
            className="mt-0.5 h-7 w-7 shrink-0 rounded-md object-cover"
          />
          <div className="max-w-[80%] break-words rounded-lg bg-white/[0.04] px-3 py-2 text-sm leading-relaxed text-foreground">
            <MarkdownContent text={row.content} />
            <div className="mt-1.5 flex items-center gap-1 text-[11px] text-[var(--color-text-muted)]">
              <HugeiconsIcon icon={StopCircleIcon} size={12} aria-hidden />
              <span>Stopped</span>
            </div>
          </div>
        </div>
      );
    case "tool":
      return (
        <div data-vex-message-role="tool" className="flex justify-start">
          <div className="flex max-w-[80%] flex-col gap-1.5">
            {row.toolKind === "result" ? (
              // Tool output — collapsed by default, labeled `<tool>_output`.
              <ToolDisclosure
                label={row.label ?? "tool_output"}
                body={row.content}
                emptyHint="(no output)"
              />
            ) : (
              <>
                {/* Assistant prose accompanying the tool call (often empty). */}
                {row.content.length > 0 ? (
                  <div className="rounded-lg bg-white/[0.04] px-3 py-2 text-sm leading-relaxed text-foreground">
                    <MarkdownContent text={row.content} />
                  </div>
                ) : null}
                {/* One disclosure per executed tool — params collapsed by default. */}
                {(row.toolCalls ?? []).map((call) => (
                  <ToolDisclosure
                    key={call.toolCallId}
                    label={call.toolName}
                    body={call.toolArgs}
                    emptyHint="(no parameters)"
                  />
                ))}
              </>
            )}
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
    case "compaction":
      return <CompactionMarker content={row.content} />;
    case "recall":
      return <MemoryMarker toolName={row.label} content={row.content} />;
    default: {
      const exhaustive: never = row.variant;
      throw new Error(`Unhandled transcript variant: ${String(exhaustive)}`);
    }
  }
}
