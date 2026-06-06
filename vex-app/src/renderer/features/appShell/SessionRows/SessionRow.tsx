/**
 * A single session list row: icon + activity dot, title/time, subtitle, and
 * mode/permission/activity badges. The row-select control and the row actions
 * (trash + pin) are SIBLINGS inside a non-interactive wrapper — never nested
 * buttons — so Enter/Space on an action cannot bubble into row selection.
 *
 * Extracted verbatim from `SessionRows.tsx`.
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
import { Badge } from "./Badge.js";
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
    <li>
      <div
        className={cn(
          "group relative flex w-full rounded-lg border transition-colors",
          selected
            ? "border-[#3275f8]/42 bg-[#3275f8]/13 shadow-[0_0_24px_rgba(50,117,248,0.12)]"
            : "border-transparent hover:border-white/[0.055] hover:bg-white/[0.035]",
          // Fixed height drives the fit-to-height packer; see
          // SIDEBAR_ROW_HEIGHT_PX in sessionListLayout.ts.
          sidebarOpen ? "h-[88px]" : "h-11",
        )}
      >
        <button
          type="button"
          onClick={() => onSelect(row.id)}
          aria-current={selected ? "true" : undefined}
          aria-label={!sidebarOpen ? title : undefined}
          className={cn(
            "flex h-full w-full rounded-lg text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3275f8]",
            // pr-16 (sidebarOpen) reserves 64px on the right for the
            // absolutely positioned Trash + Pin sibling cluster so the
            // title flex never paints under them. Collapsed sidebar
            // hides both actions, so no reservation.
            sidebarOpen ? "gap-3 px-3 py-3 pr-16" : "items-center justify-center px-0",
          )}
          title={sidebarOpen ? undefined : title}
        >
          <span
            className={cn(
              "relative flex h-9 w-9 shrink-0 items-center justify-center text-[#8da5ff]",
              selected && "text-[#adc0ff]",
            )}
          >
            <HugeiconsIcon icon={Icon} size={17} aria-hidden />
            {activity !== null ? (
              <span
                aria-hidden
                className={cn(
                  "absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-black/60",
                  activity.dotClass,
                )}
              />
            ) : null}
          </span>

          {sidebarOpen ? (
            <span className="min-w-0 flex-1">
              <span className="flex items-start gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {title}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-[var(--color-text-muted)]">
                  {startedLabel}
                </span>
              </span>
              <span className="mt-1 block truncate text-xs text-[var(--color-text-secondary)]">
                {subtitle}
              </span>
              <span className="mt-2 flex items-center gap-2">
                <Badge tone={row.mode === "mission" ? "mission" : "agent"}>
                  {row.mode}
                </Badge>
                <Badge tone={row.permission === "full" ? "full" : "restricted"}>
                  {row.permission}
                </Badge>
                {activity !== null ? (
                  <Badge tone={activity.tone}>{activity.label}</Badge>
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
          <div className="absolute bottom-3 right-3 flex items-center gap-1">
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
