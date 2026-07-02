/**
 * PremiumBadge — the mission/plan status key for the MISSION RAIL.
 *
 * Default (`interactive`, the omitted case): a real `<button type="button">`
 * that opens a dialog — it carries `aria-haspopup`, `aria-expanded`, and a
 * descriptive `aria-label` so the keyboard + screen reader flow reads
 * "Mission ready — open details" → Enter → focus moves into the dialog → ESC
 * returns focus.
 *
 * `interactive={false}`: a presentational `<span>` with the SAME visual grammar
 * (icon + label + caption, tone border) but NO button affordances — no
 * `onClick`, no popup/expanded semantics, no focus ring, not in the tab order.
 * Used inside an already-open dialog header as a status marker, where a
 * focusable control that does nothing would be a dead focus target.
 *
 * Larger than `Stamp` (rounded-lg, icon + label + caption) but the same NOTARY
 * token grammar as `MissionContractCardSections.headerMeta`: a hairline tone
 * border with text in the tone, never a filled chip. Color carries meaning;
 * neutrals carry the rest.
 *
 * Shimmer (the opacity pulse defined in globals.css as `.vex-badge--shimmer`)
 * is applied ONLY in the `ready` state, and only when the caller opts in via
 * `shimmer`. The pulse is "awaiting your action" — it stops the moment the
 * badge leaves `ready` (e.g. on accept). Reduced motion collapses it to a
 * static frame (global rule).
 */

import type { JSX } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  InformationCircleIcon,
  Target02Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "../../lib/utils.js";

export type PremiumBadgeState =
  | "preparing"
  | "ready"
  | "accepted"
  | "stale"
  | "error";

interface PremiumBadgeBaseProps {
  /** Primary line (e.g. "Mission", "Plan"). */
  readonly label: string;
  readonly state: PremiumBadgeState;
  /** Optional leading icon — defaults to the per-state icon. */
  readonly icon?: IconSvgElement;
  /** Opt-in to the "ready" opacity pulse. Ignored unless state === "ready". */
  readonly shimmer?: boolean;
}

/**
 * Discriminated on `interactive` so the presentational span variant can omit
 * `onClick`/`expanded` while the default button variant still requires the
 * click handler. `interactive` defaults to `true` (the rail's clickable key).
 */
export type PremiumBadgeProps =
  | (PremiumBadgeBaseProps & {
      readonly interactive?: true;
      readonly onClick: () => void;
      /** Whether the dialog the badge controls is currently open. */
      readonly expanded?: boolean;
    })
  | (PremiumBadgeBaseProps & {
      readonly interactive: false;
    });

interface StateMeta {
  /** Short status caption rendered beneath the label. */
  readonly caption: string;
  /** Border + text tone (the only color the badge carries). */
  readonly toneClass: string;
  readonly iconClass: string;
  /** Default per-state icon (overridable via the `icon` prop). */
  readonly icon: IconSvgElement;
  readonly dataState: string;
}

function stateMeta(state: PremiumBadgeState): StateMeta {
  switch (state) {
    case "preparing":
      return {
        caption: "Preparing",
        toneClass:
          "border-[var(--vex-line-strong)] text-[var(--vex-text-3)] hover:border-[var(--vex-line-strong)]",
        iconClass: "text-[var(--vex-text-3)]",
        icon: Target02Icon,
        dataState: "preparing",
      };
    case "ready":
      return {
        caption: "Ready",
        toneClass:
          "border-[var(--vex-accent-border)] text-[var(--vex-accent-text)] hover:bg-[var(--vex-accent-fill-8)]",
        iconClass: "text-[var(--vex-accent-text)]",
        icon: InformationCircleIcon,
        dataState: "ready",
      };
    case "accepted":
      return {
        caption: "Accepted",
        toneClass:
          "border-[color-mix(in_oklab,var(--color-success)_40%,transparent)] text-success hover:bg-[color-mix(in_oklab,var(--color-success)_8%,transparent)]",
        iconClass: "text-success",
        icon: CheckmarkCircle02Icon,
        dataState: "accepted",
      };
    case "stale":
      return {
        caption: "Review again",
        toneClass:
          "border-[color-mix(in_oklab,var(--color-warning)_40%,transparent)] text-warning hover:bg-[color-mix(in_oklab,var(--color-warning)_8%,transparent)]",
        iconClass: "text-warning",
        icon: InformationCircleIcon,
        dataState: "stale",
      };
    case "error":
      return {
        caption: "Action needed",
        toneClass:
          "border-[color-mix(in_oklab,var(--color-warning)_40%,transparent)] text-warning hover:bg-[color-mix(in_oklab,var(--color-warning)_8%,transparent)]",
        iconClass: "text-warning",
        icon: AlertCircleIcon,
        dataState: "error",
      };
  }
}

/** Shared layout (icon + label + caption) — identical for both variants. */
const BADGE_LAYOUT =
  "group flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left";

export function PremiumBadge(props: PremiumBadgeProps): JSX.Element {
  const { label, state, icon, shimmer = false } = props;
  const meta = stateMeta(state);
  const Icon = icon ?? meta.icon;
  const showShimmer = shimmer && state === "ready";

  const inner = (
    <>
      <HugeiconsIcon
        icon={Icon}
        size={16}
        aria-hidden
        className={cn("shrink-0", meta.iconClass)}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        {/* Landing register: the key's name is a mono micro-label (white),
         * the state caption beneath carries the tone. */}
        <span className="truncate font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-foreground">
          {label}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em]">
          {meta.caption}
        </span>
      </span>
    </>
  );

  // Presentational status marker — a `<span>`, not a focus target. Used inside
  // an already-open dialog header where a clickable control would do nothing.
  if (props.interactive === false) {
    return (
      <span
        data-vex-state={meta.dataState}
        className={cn(
          BADGE_LAYOUT,
          meta.toneClass,
          showShimmer && "vex-badge--shimmer",
        )}
      >
        {inner}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-haspopup="dialog"
      aria-expanded={props.expanded ?? false}
      aria-label={`${label} ${meta.caption.toLowerCase()} — open details`}
      data-vex-state={meta.dataState}
      data-vex-action="open-mission-detail"
      className={cn(
        BADGE_LAYOUT,
        "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)]",
        meta.toneClass,
        showShimmer && "vex-badge--shimmer",
      )}
    >
      {inner}
    </button>
  );
}
