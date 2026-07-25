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
 *
 * Persisted collapse: pass a stable `sectionId` and the open/collapsed state
 * is read from + written to the UI store (`bookSectionCollapsed`) instead of
 * local component state, so the operator's drilled-in layout survives relaunch
 * AND survives the panel unmounting between views. Without a `sectionId` the
 * block keeps its historic local-state behaviour.
 *
 * Optional reorder: pass `reorder` and the header grows a pair of move up/down
 * controls (disabled at the ends) so the operator can rearrange the section
 * order. The controls sit as siblings of the disclosure button (never nested
 * inside it — that would be an invalid button-in-button).
 */

import { useId, useState, type JSX, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "../../../lib/utils.js";
import { useUiStore } from "../../../stores/uiStore.js";

export interface BookBlockReorder {
  readonly onUp: () => void;
  readonly onDown: () => void;
  readonly canUp: boolean;
  readonly canDown: boolean;
}

export function BookBlock({
  title,
  trailing,
  children,
  collapsible = false,
  defaultOpen = true,
  sectionId,
  reorder,
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
  /**
   * Stable id for persisted collapse state. When set, open/collapsed lives in
   * the UI store keyed by this id (survives relaunch + unmount). When absent,
   * collapse is local-only (historic behaviour).
   */
  readonly sectionId?: string;
  /** When set, renders move up/down controls in the header. */
  readonly reorder?: BookBlockReorder;
}): JSX.Element {
  // Persisted collapse (when a sectionId is supplied) reads/writes the store;
  // otherwise the block keeps its own local open flag. Hooks run
  // unconditionally to honour the rules of hooks — the persisted branch simply
  // ignores the local state and vice versa.
  const persistedCollapsed = useUiStore((s) =>
    sectionId !== undefined ? s.bookSectionCollapsed[sectionId] : undefined,
  );
  const toggleSection = useUiStore((s) => s.toggleBookSection);
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const persisted = sectionId !== undefined;
  const open = persisted ? !(persistedCollapsed ?? !defaultOpen) : localOpen;
  const handleToggle = persisted
    ? () => toggleSection(sectionId)
    : () => setLocalOpen((v) => !v);
  const bodyId = useId();
  const sectionClass =
    "border-t border-[var(--vex-line)] py-4 first:border-t-0 first:pt-1.5";

  const trailingNode =
    trailing !== undefined ? (
      <span className="font-mono text-[10px] tabular-nums text-[var(--vex-text-3)]">
        {trailing}
      </span>
    ) : null;

  const reorderNode =
    reorder !== undefined ? (
      <span className="flex shrink-0 items-center gap-0.5">
        <ReorderButton
          direction="up"
          onClick={reorder.onUp}
          disabled={!reorder.canUp}
          title={title}
        />
        <ReorderButton
          direction="down"
          onClick={reorder.onDown}
          disabled={!reorder.canDown}
          title={title}
        />
      </span>
    ) : null;

  if (!collapsible) {
    return (
      <section className={sectionClass}>
        <div className="mb-2.5 flex items-baseline justify-between gap-2">
          {/* Landing eyebrow (mono micro-label + leading rule) — the section
           * head grammar for every labeled block. */}
          <h3 className="vex-eyebrow">{title}</h3>
          {trailingNode !== null || reorderNode !== null ? (
            <span className="flex items-center gap-1.5">
              {trailingNode}
              {reorderNode}
            </span>
          ) : null}
        </div>
        {children}
      </section>
    );
  }

  return (
    <section className={sectionClass}>
      <div
        className={cn(
          "flex items-baseline justify-between gap-2",
          open ? "mb-2.5" : "mb-0",
        )}
      >
        <h3 className="m-0 min-w-0 flex-1">
          <button
            type="button"
            onClick={handleToggle}
            aria-expanded={open}
            aria-controls={bodyId}
            className={cn(
              "flex w-full items-center gap-1.5 text-left transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)]",
            )}
          >
            <HugeiconsIcon
              icon={open ? ArrowDown01Icon : ArrowRight01Icon}
              size={12}
              aria-hidden
              className="shrink-0 text-[var(--vex-text-3)]"
            />
            <span className="vex-eyebrow">{title}</span>
          </button>
        </h3>
        {trailingNode !== null || reorderNode !== null ? (
          <span className="flex shrink-0 items-center gap-1.5">
            {trailingNode}
            {reorderNode}
          </span>
        ) : null}
      </div>
      <div id={bodyId} hidden={!open}>
        {open ? children : null}
      </div>
    </section>
  );
}

/** One move control — an unobtrusive icon button, disabled at the list edge. */
function ReorderButton({
  direction,
  onClick,
  disabled,
  title,
}: {
  readonly direction: "up" | "down";
  readonly onClick: () => void;
  readonly disabled: boolean;
  readonly title: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`Move ${title} ${direction}`}
      className={cn(
        "flex h-5 w-5 items-center justify-center rounded-[3px] text-[var(--vex-text-3)] transition-colors",
        "hover:bg-white/[0.06] hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--vex-accent)]",
        "disabled:pointer-events-none disabled:opacity-30",
      )}
    >
      <HugeiconsIcon
        icon={direction === "up" ? ArrowUp01Icon : ArrowDown01Icon}
        size={13}
        aria-hidden
      />
    </button>
  );
}
