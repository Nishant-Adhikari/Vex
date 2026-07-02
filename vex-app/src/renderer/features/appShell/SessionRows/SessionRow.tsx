/**
 * A single ledger row (56px): mode glyph, two text lines (title + time/
 * activity, subtitle + exception stamps), hairline-separated — no card box,
 * no resting glow. Selection is the landing's workspace beam
 * (`.vex-select-beam`, globals.css): a cobalt gradient sweep with a white
 * ledger bar on the left edge, text lifted to white. Mode/permission badge
 * pairs are gone: the glyph already says mode, and stamps appear only when
 * state deviates from the default (restricted / live / paused — terminal
 * sessions earn silence).
 *
 * The row-select control and the row actions (trash + pin) are SIBLINGS
 * inside a non-interactive wrapper — never nested buttons — so Enter/Space
 * on an action cannot bubble into row selection.
 */

import type { JSX, MouseEvent } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { AiChat01Icon, Target02Icon } from "@hugeicons/core-free-icons";
import type { SessionListItem } from "@shared/schemas/sessions.js";
import { cn } from "../../../lib/utils.js";
import {
  formatSessionTime,
  getMissionActivity,
  getSessionSubtitle,
  getSessionTitle,
} from "../sessionListModel.js";
import { Stamp } from "./Stamp.js";
import { RemoveButton } from "./RemoveButton.js";
import { PinToggle } from "./PinToggle.js";

export function SessionRow({
  row,
  selected,
  sidebarOpen,
  onSelect,
  onTogglePin,
  onRequestRemove,
  pinPending,
}: {
  readonly row: SessionListItem;
  readonly selected: boolean;
  readonly sidebarOpen: boolean;
  readonly onSelect: (id: string) => void;
  readonly onTogglePin: (id: string, nextPinned: boolean) => void;
  readonly onRequestRemove: (row: SessionListItem) => void;
  readonly pinPending: boolean;
}): JSX.Element {
  const startedLabel = formatSessionTime(row.startedAt);
  const title = getSessionTitle(row);
  const subtitle = getSessionSubtitle(row);
  const activity = getMissionActivity(row);
  const Icon = row.mode === "mission" ? Target02Icon : AiChat01Icon;
  const isPinned = row.pinnedAt !== null;

  const handlePinClick = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    event.preventDefault();
    if (pinPending) return;
    onTogglePin(row.id, !isPinned);
  };

  const handleRemoveClick = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    event.preventDefault();
    onRequestRemove(row);
  };

  // Row select control and pin toggle are SIBLINGS inside a non-interactive
  // wrapper. This is the only safe layout: a button inside a button is
  // invalid HTML, and a custom `role="button"` parent would let Enter/Space
  // bubble from the pin into a row-level keydown handler. Container holds
  // the visual styling; both children focus / click independently.
  return (
    <li className="border-b border-[var(--vex-line)] last:border-b-0">
      <div
        className={cn(
          "group relative flex w-full transition-colors",
          // Selection = the landing beam (cobalt gradient + white left bar,
          // globals.css `.vex-select-beam`); hover stays a quiet surface lift.
          selected ? "vex-select-beam text-white" : "hover:bg-white/[0.035]",
          // Fixed height drives the fit-to-height packer; see
          // SIDEBAR_ROW_HEIGHT_PX in sessionListLayout.ts.
          sidebarOpen ? "h-14" : "h-11",
        )}
      >
        <button
          type="button"
          onClick={() => onSelect(row.id)}
          aria-current={selected ? "true" : undefined}
          aria-label={!sidebarOpen ? title : undefined}
          className={cn(
            "flex h-full w-full text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)]",
            // pr-14 (sidebarOpen) reserves room on the right for the
            // absolutely positioned Trash + Pin sibling cluster so the
            // title flex never paints under them. Collapsed sidebar
            // hides both actions, so no reservation.
            sidebarOpen ? "items-center gap-3 px-3 pr-14" : "items-center justify-center px-0",
          )}
          title={sidebarOpen ? undefined : title}
        >
          <span
            className={cn(
              "relative flex h-8 w-8 shrink-0 items-center justify-center",
              selected ? "text-white" : "text-[var(--vex-text-3)]",
            )}
          >
            <HugeiconsIcon icon={Icon} size={15} aria-hidden />
            {!sidebarOpen && activity !== null ? (
              <span
                aria-hidden
                className={cn(
                  "absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-black/60",
                  // On the selected beam the tone dot flips to white — an
                  // accent dot would vanish into the cobalt gradient.
                  selected ? "bg-white" : activity.dotClass,
                )}
              />
            ) : null}
          </span>

          {sidebarOpen ? (
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-[13px] font-medium",
                    selected ? "text-white" : "text-foreground",
                  )}
                >
                  {title}
                </span>
                {activity?.tone === "active" ? (
                  // Unified SIGNAL DOT (open rail): the live signal earns the
                  // landing pulse ring — a running mission is verifiably
                  // in-flight work. Same tone→colour language as the collapsed
                  // badge; the "live" stamp on the line below carries the word.
                  <span
                    role="img"
                    aria-label="Session active"
                    className={cn(
                      "vex-pulse-dot h-2 w-2 shrink-0 rounded-full",
                      selected
                        ? "bg-white [--vex-pulse-color:rgba(255,255,255,0.45)]"
                        : activity?.dotClass,
                    )}
                  />
                ) : (
                  <span
                    className={cn(
                      "shrink-0 font-mono text-[10px] tabular-nums",
                      selected ? "text-white/80" : "text-[var(--vex-text-2)]",
                    )}
                  >
                    {startedLabel}
                  </span>
                )}
              </span>
              <span className="mt-0.5 flex items-center gap-2">
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-[11px]",
                    selected ? "text-white/80" : "text-[var(--vex-text-2)]",
                  )}
                >
                  {subtitle}
                </span>
                {row.permission !== "full" ? (
                  <Stamp tone="warn">restricted</Stamp>
                ) : null}
                {activity?.tone === "active" ? (
                  <Stamp tone="accent">live</Stamp>
                ) : null}
                {activity?.tone === "paused" ? (
                  <Stamp tone="warn">paused</Stamp>
                ) : null}
              </span>
            </span>
          ) : null}
        </button>

        {sidebarOpen ? (
          // Trash + Pin live in a sibling cluster outside the select
          // button. Native buttons inside a non-interactive wrapper —
          // no nested buttons, no role="button" parent, so Enter/Space
          // on either action cannot bubble into a row-select handler.
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
            <RemoveButton onClick={handleRemoveClick} />
            <PinToggle
              pinned={isPinned}
              pending={pinPending}
              onClick={handlePinClick}
            />
          </div>
        ) : null}
      </div>
    </li>
  );
}
