/**
 * Inline status pill used inside a session row: mode/permission chips render
 * flat (text only), while live run-status chips (active/paused/stopped) keep a
 * subtle fill so activity stays scannable.
 *
 * Extracted verbatim from `SessionRows.tsx`. Purely presentational.
 */

import type { JSX } from "react";
import { cn } from "../../../lib/utils.js";

export function Badge({
  tone,
  children,
}: {
  readonly tone:
    | "agent"
    | "mission"
    | "restricted"
    | "full"
    | "active"
    | "paused"
    | "stopped";
  readonly children: string;
}): JSX.Element {
  const cls = {
    // Chat-type badges (mode + permission) render flat — text only, no fill.
    agent: "text-[#8da5ff]",
    mission: "text-[#b2a3ff]",
    restricted: "text-[var(--color-text-secondary)]",
    full: "text-warning",
    // Run-status badges keep their fill so live activity stays scannable.
    active: "bg-success/12 text-success",
    paused: "bg-warning/14 text-warning",
    stopped: "bg-white/[0.05] text-[var(--color-text-muted)]",
  }[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
        cls,
      )}
    >
      {children}
    </span>
  );
}
