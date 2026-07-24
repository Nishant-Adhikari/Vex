/**
 * One BOOK panel section — the landing right-workspace-column grammar
 * (.ws-col): a continuous editorial column, NOT a boxed tile. No rounded
 * border, no tile background; separation is a single border-t hairline
 * between sections (the first section carries none). Header row = eyebrow
 * title + optional trailing datum; the body renders directly beneath.
 * Shared chrome for POSITION / MOVES / RUNTIME / SESSION. Prominence comes
 * from content (POSITION's giant total figure), never from competing frames.
 *
 * Optional accordion: pass `collapsible` to make the header a disclosure
 * button (chevron + aria-expanded/controls) so the operator can drill into
 * one instrument at a time. Purely additive — the default (non-collapsible)
 * render is byte-for-byte the prior static section, so every existing call
 * site is unchanged.
 */

import { useId, useState, type JSX, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { cn } from "../../../lib/utils.js";

export function BookBlock({
  title,
  trailing,
  children,
  collapsible = false,
  defaultOpen = true,
}: {
  readonly title: string;
  /** Optional right-aligned header datum (e.g. a count or total). */
  readonly trailing?: ReactNode;
  readonly children: ReactNode;
  /**
   * When true the header becomes a disclosure toggle and the body can be
   * collapsed. Default false keeps the historic static section untouched.
   */
  readonly collapsible?: boolean;
  /** Initial open state for a collapsible block (ignored when static). */
  readonly defaultOpen?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const sectionClass =
    "border-t border-[var(--vex-line)] py-4 first:border-t-0 first:pt-1.5";

  if (!collapsible) {
    return (
      <section className={sectionClass}>
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

  return (
    <section className={sectionClass}>
      <h3 className="m-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={bodyId}
          className={cn(
            "flex w-full items-baseline justify-between gap-2 text-left transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)]",
            open ? "mb-2.5" : "mb-0",
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <HugeiconsIcon
              icon={open ? ArrowDown01Icon : ArrowRight01Icon}
              size={12}
              aria-hidden
              className="shrink-0 text-[var(--vex-text-3)]"
            />
            <span className="vex-eyebrow">{title}</span>
          </span>
          {trailing !== undefined ? (
            <span className="font-mono text-[10px] tabular-nums text-[var(--vex-text-3)]">
              {trailing}
            </span>
          ) : null}
        </button>
      </h3>
      <div id={bodyId} hidden={!open}>
        {open ? children : null}
      </div>
    </section>
  );
}
