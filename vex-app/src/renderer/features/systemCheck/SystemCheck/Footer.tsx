/**
 * System Check footer — step counter (left) and the Continue action
 * (full-width accent button). Pure presentation: the disabled state and
 * the advance handler stay owned by the parent component and arrive as
 * props, so the state-machine transition lives in one place.
 */

import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";

import { cn } from "../../../lib/utils.js";

interface FooterProps {
  readonly stepNumber: number;
  readonly totalSteps: number;
  readonly disabled: boolean;
  readonly onContinue: () => void;
}

export function Footer({
  stepNumber,
  totalSteps,
  disabled,
  onContinue,
}: FooterProps): JSX.Element {
  return (
    <>
      {/* FOOTER — step counter + Continue */}
      <div className="flex items-center justify-between border-t border-white/[0.06] px-6 py-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--color-text-muted)]">
          Step {stepNumber} of {totalSteps}
        </span>
      </div>
      <div className="px-5 pb-5">
        <button
          type="button"
          disabled={disabled}
          onClick={onContinue}
          aria-label="Continue to Docker bootstrap"
          className={cn(
            "group relative inline-flex w-full items-center justify-center gap-3",
            "rounded-2xl border border-white/[0.16] bg-[var(--systemcheck-accent)]/85 backdrop-blur-xl",
            "px-6 py-3.5 font-mono text-sm uppercase tracking-[0.22em] text-white",
            "shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_40px_rgba(50,117,248,0.28)]",
            "transition-all duration-300 ease-out",
            "hover:bg-[var(--systemcheck-accent)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.26),0_14px_50px_rgba(50,117,248,0.42)]",
            "active:scale-[0.98] active:duration-100",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--systemcheck-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-primary)]",
            "disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          <span>Continue</span>
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            size={16}
            aria-hidden
            className="transition-transform duration-300 group-hover:translate-x-0.5"
          />
        </button>
      </div>
    </>
  );
}
