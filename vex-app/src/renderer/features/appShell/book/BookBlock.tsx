/**
 * One BOOK panel block — a hairline-separated section with a mono instrument
 * header. Shared chrome for MOVES / RUNTIME / SESSION / POSITION so the panel
 * reads as one register. Quiet at rest; blue is rationed to the content.
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
    <section className="border-b border-[var(--vex-line)] px-4 py-3 last:border-b-0">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--vex-text-3)]">
          {title}
        </h3>
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
