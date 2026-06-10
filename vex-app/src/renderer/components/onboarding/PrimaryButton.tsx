/**
 * Primary CTA button used by branch bodies (Start Docker, Download
 * installer, Try Start Docker Desktop), restyled to the NOTARY key
 * language. Two variants:
 *   - "primary"  — full-width key: 1px accent-mix hairline border,
 *                  accent text, transparent fill (the recommended path —
 *                  same voice as the armed Continue key)
 *   - "ghost"    — subordinate quiet key: white hairline, secondary text
 *
 * Continue + Recheck footer keys live in KeyButton / FooterButtons; this
 * primitive is only for body-level actions.
 */

import type { ComponentProps } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "../../lib/utils.js";

type HugeiconIcon = ComponentProps<typeof HugeiconsIcon>["icon"];

interface PrimaryButtonProps {
  readonly icon: HugeiconIcon;
  readonly label: string;
  readonly disabled?: boolean;
  readonly variant?: "primary" | "ghost";
  readonly onClick: () => void;
}

export function PrimaryButton({
  icon,
  label,
  disabled,
  variant = "primary",
  onClick,
}: PrimaryButtonProps): JSX.Element {
  if (variant === "ghost") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          "inline-flex items-center justify-center gap-2 self-start rounded-xl border border-white/[0.10] bg-transparent px-4 py-2.5 font-mono text-xs uppercase tracking-[0.2em] text-[var(--color-text-secondary)]",
          "hover:border-white/[0.2] hover:text-[var(--color-text-primary)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-onboarding-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--vex-onboarding-bg)]",
          "active:scale-[0.98] transition-colors duration-150",
          "disabled:cursor-not-allowed disabled:opacity-60",
        )}
      >
        <HugeiconsIcon icon={icon} size={14} aria-hidden />
        {label}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border bg-transparent font-mono text-xs uppercase tracking-[0.22em]",
        "border-[color-mix(in_oklab,var(--vex-onboarding-accent)_55%,transparent)] text-[var(--vex-onboarding-accent)]",
        "hover:border-[color-mix(in_oklab,var(--vex-onboarding-accent)_85%,transparent)] hover:bg-[color-mix(in_oklab,var(--vex-onboarding-accent)_8%,transparent)]",
        "active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-onboarding-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--vex-onboarding-bg)]",
        "disabled:cursor-not-allowed disabled:opacity-60",
        "transition-colors duration-200 ease-out",
      )}
    >
      <HugeiconsIcon icon={icon} size={16} aria-hidden />
      {label}
    </button>
  );
}
