/**
 * Single row in the System Check ledger (NOTARY visual language).
 *
 * Layout (left → right): ledger index · engraved glyph · label + detail ·
 * stamp. While a probe is loading the stamp cell runs a small DotMatrix
 * (the brand's machine language does the waiting — no pulse, no spinner)
 * beside the pinned "CHECKING…" text; once resolved it prints a hairline
 * typography stamp (one-shot `vex-stamp-press`). Only FAIL gets a tinted
 * fill — ink-weight hierarchy, not a chip rainbow.
 *
 * The `data-step-status` attribute remains the stable selector across
 * refactors (e2e + unit tests rely on it). `badgeLabel` decouples the
 * visible stamp text from the semantic `StepStatus` so screens can
 * surface contextual wording (READY / SETUP) without losing the
 * underlying state machine value (codex round 7 SHOULD-FIX #6).
 * Stamp texts are pinned by tests: CHECKING… / OK / WARN / FAIL.
 *
 * Note: the detail line is the only `text-[11px]` element in the row —
 * a test pins that invariant to detect a missing detail span. Index and
 * stamp use `text-[10px]`.
 */

import { type ReactNode } from "react";

import { DotmSquare3 } from "../../components/ui/dotm-square-3.js";
import { cn } from "../../lib/utils.js";

export type StepStatus = "loading" | "ok" | "warn" | "fail";

interface StepRowProps {
  readonly label: string;
  readonly status: StepStatus;
  readonly detail: string | null;
  readonly icon: ReactNode;
  readonly badgeLabel?: string;
  /** Ledger line number (rendered as 01–04); omitted in bare usages. */
  readonly index?: number;
}

const defaultBadgeLabel: Record<StepStatus, string> = {
  loading: "CHECKING…",
  ok: "OK",
  warn: "WARN",
  fail: "FAIL",
};

/**
 * Per-status stamp chrome — a 1px color-mix hairline box with the status
 * token as text color. Transparent fill except FAIL, which alone gets a
 * 10% tint: escalation through ink weight, not through louder color.
 */
const stampChrome: Record<Exclude<StepStatus, "loading">, string> = {
  ok: "border-[color-mix(in_oklab,var(--color-success)_40%,transparent)] text-[var(--color-success)]",
  warn: "border-[color-mix(in_oklab,var(--color-warning)_40%,transparent)] text-[var(--color-warning)]",
  fail: "border-[color-mix(in_oklab,var(--color-danger)_40%,transparent)] bg-[color-mix(in_oklab,var(--color-danger)_10%,transparent)] text-[var(--color-danger)]",
};

export function StepRow({
  label,
  status,
  detail,
  icon,
  badgeLabel,
  index,
}: StepRowProps): JSX.Element {
  const labelText = badgeLabel ?? defaultBadgeLabel[status];
  return (
    <li
      className="motion-cascade-row flex items-center gap-3 border-b border-white/[0.06] py-4"
      data-step-status={status}
    >
      {/* Ledger index — the landing's numbered-spec voice (.prob-card
       * .num): mono digits in the on-dark accent (periwinkle mix). */}
      <span
        aria-hidden
        className="w-7 shrink-0 font-mono text-[10px] tabular-nums tracking-[0.2em] text-[var(--color-accent-secondary)]"
      >
        {index != null ? String(index).padStart(2, "0") : null}
      </span>
      <span
        aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center text-[var(--color-text-secondary)] opacity-70"
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-[var(--color-text-primary)]">
          {label}
        </span>
        {detail ? (
          <span className="truncate font-mono text-[11px] text-[var(--color-text-muted)]">
            {detail}
          </span>
        ) : null}
      </div>
      {status === "loading" ? (
        <span className="flex shrink-0 items-center gap-2">
          <DotmSquare3
            size={16}
            dotSize={2}
            className="shrink-0 text-[var(--systemcheck-accent,var(--vex-onboarding-accent))]"
            ariaLabel="Checking"
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
            {labelText}
          </span>
        </span>
      ) : (
        <span
          className={cn(
            "vex-stamp-press shrink-0 rounded-[3px] border px-2.5 py-1",
            "font-mono text-[10px] font-semibold uppercase tracking-[0.22em]",
            stampChrome[status]
          )}
        >
          {labelText}
        </span>
      )}
    </li>
  );
}
