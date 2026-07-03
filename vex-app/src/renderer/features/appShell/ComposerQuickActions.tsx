/**
 * Starter chips — ONE horizontal row of three compact ghost pills under the
 * composer (phase 4: the full-width ledger rows collapsed into chips so the
 * welcome stage stays cinematic instead of stacking a list). Presentational
 * only: the catalog lives in `composer-quick-actions.ts`; picking a chip
 * seeds the draft via the parent's `onPick`. Grammar: numbered 01–03 (the
 * landing .prob-card num), mono 10px uppercase, hairline pill; hover/focus
 * lifts the border to the accent. Real buttons → keyboard focusable.
 *
 * The row only ever renders on the welcome/idle stage (empty conversation),
 * so it carries the stage's one-shot rise choreography at the d3 stagger
 * (status → H1 → instrument → chips).
 */

import type { JSX } from "react";
import { QUICK_ACTIONS } from "./composer-quick-actions.js";

export function ComposerQuickActions({
  onPick,
}: {
  readonly onPick: (prompt: string) => void;
}): JSX.Element {
  return (
    <div className="vex-rise vex-rise-d3 mt-4 flex flex-wrap items-center justify-center gap-2">
      {QUICK_ACTIONS.map((action, index) => (
        <button
          key={action.label}
          type="button"
          onClick={() => onPick(action.prompt)}
          className="inline-flex min-w-0 items-center gap-2.5 rounded-full border border-[var(--vex-line)] px-3.5 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--vex-text-2)] transition-colors hover:border-[var(--vex-accent-border)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)]"
        >
          {/* Numbered-card index — decorative accent mark, not part of the
              accessible name. */}
          <span
            aria-hidden
            className="tabular-nums tracking-[0.2em] text-[var(--vex-accent-text)]"
          >
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="truncate">{action.label}</span>
        </button>
      ))}
    </div>
  );
}
