/**
 * Collapsible tool disclosure — one per tool call (its sanitized params) or
 * per tool result (its output). Collapsed by default: the header shows the
 * label + a chevron; expanding reveals the body. Presentational, local state
 * only. CSP-safe — no inline style, no HTML sink (body is a React text node).
 */

import { useId, useState, type JSX } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";

export function ToolDisclosure({
  label,
  body,
  emptyHint,
}: {
  readonly label: string;
  /** Pre-formatted text revealed when expanded; `null`/empty → `emptyHint`. */
  readonly body: string | null;
  readonly emptyHint: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const hasBody = body !== null && body.length > 0;
  return (
    <div className="rounded-md border border-white/[0.08] bg-white/[0.02] font-mono text-[11px] text-[var(--color-text-secondary)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[var(--color-text-muted)] transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3275f8]"
      >
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          size={12}
          aria-hidden
          className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className="truncate">{label}</span>
      </button>
      {open ? (
        <div id={bodyId} className="border-t border-white/[0.06] px-2.5 py-1.5">
          {hasBody ? (
            <pre className="overflow-x-auto whitespace-pre-wrap break-words">
              {body}
            </pre>
          ) : (
            <span className="text-[var(--color-text-muted)]">{emptyHint}</span>
          )}
        </div>
      ) : null}
    </div>
  );
}
