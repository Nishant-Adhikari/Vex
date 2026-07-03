/**
 * One BOOK panel section — the landing right-workspace-column grammar
 * (.ws-col): a continuous editorial column, NOT a boxed tile. No rounded
 * border, no tile background; separation is a single border-t hairline
 * between sections (the first section carries none). Header row = eyebrow
 * title + optional trailing datum; the body renders directly beneath.
 * Shared chrome for POSITION / MOVES / RUNTIME / SESSION. Prominence comes
 * from content (POSITION's giant total figure), never from competing frames.
 */

import type { JSX, ReactNode } from "react";

export function BookBlock({
  title,
  trailing,
  children,
}: {
  readonly title: string;
  /** Optional right-aligned header datum (e.g. a count or total). */
  readonly trailing?: ReactNode;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <section className="border-t border-[var(--vex-line)] py-4 first:border-t-0 first:pt-1.5">
      <div className="mb-2.5 flex items-baseline justify-between gap-2">
        {/* Landing eyebrow (mono micro-label + leading rule) — the section
         * head grammar for every labeled block. */}
        <h3 className="vex-eyebrow">{title}</h3>
        {trailing !== undefined ? (
          <span className="font-mono text-[10px] tabular-nums text-[var(--vex-text-3)]">
            {trailing}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}
