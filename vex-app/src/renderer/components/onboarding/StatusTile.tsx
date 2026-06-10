/**
 * Status tile primitive — the dominant status element in onboarding
 * branch bodies (docker / compose / migrations), restyled to the NOTARY
 * document language: a 1px color-mix hairline box (stamp chrome, square
 * 3px radius) with the tone token as icon/border color. No glass, no
 * blur, no inset highlight — escalation works through ink weight: only
 * `danger` gets a 10% tint fill, everything else stays transparent.
 *
 * Tone tokens (success / warning / info / danger / muted) are the
 * single source of truth for status colors across the onboarding flow.
 */

import { type ReactNode } from "react";
import { cn } from "../../lib/utils.js";

export type StatusTone = "success" | "warning" | "info" | "danger" | "muted";

interface StatusTileProps {
  readonly tone: StatusTone;
  readonly icon: ReactNode;
  readonly title: string;
  readonly detail?: string | null;
}

const toneChrome: Record<StatusTone, string> = {
  success:
    "border-[color-mix(in_oklab,var(--color-success)_40%,transparent)] text-[var(--color-success)]",
  warning:
    "border-[color-mix(in_oklab,var(--color-warning)_40%,transparent)] text-[var(--color-warning)]",
  info: "border-[color-mix(in_oklab,var(--vex-onboarding-accent)_40%,transparent)] text-[var(--vex-onboarding-accent)]",
  danger:
    "border-[color-mix(in_oklab,var(--color-danger)_40%,transparent)] bg-[color-mix(in_oklab,var(--color-danger)_10%,transparent)] text-[var(--color-danger)]",
  muted: "border-white/[0.10] text-[var(--color-text-secondary)]",
};

export function StatusTile({
  tone,
  icon,
  title,
  detail,
}: StatusTileProps): JSX.Element {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-[3px] border px-4 py-3",
        toneChrome[tone],
      )}
    >
      <span aria-hidden className="mt-0.5 shrink-0">
        {icon}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">
          {title}
        </span>
        {detail ? (
          <span className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
            {detail}
          </span>
        ) : null}
      </div>
    </div>
  );
}
