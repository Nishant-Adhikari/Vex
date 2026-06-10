/**
 * KeyButton — the onboarding key in the shared 208×44 slot, resting on a
 * plinth hairline (rule visible left and right of it).
 *
 * The key is DORMANT but present from frame one (the cut between screens
 * is invisible; the user's hand never moves) and ARMS in place when the
 * gate opens: border/text transition to the accent, one `vex-intro-glint`
 * star fires (the same flare that closed the signing), and focus lands on
 * the key so Enter/Space continues immediately.
 *
 * The real `disabled` attribute is a test contract across onboarding
 * screens — never replace it with aria-disabled.
 */

import { useEffect, useRef } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";

import { cn } from "../../lib/utils.js";
import { ONBOARDING_KEY_SLOT_CLASS } from "./geometry.js";

interface KeyButtonProps {
  /** Gate state: armed = clickable, dormant = disabled. */
  readonly armed: boolean;
  readonly onClick: () => void;
  readonly ariaLabel: string;
  /** Visible label; defaults to "Continue". */
  readonly label?: string;
  /** Move focus to the key when it arms (default true — mirrors BEGIN). */
  readonly focusOnArm?: boolean;
}

export function KeyButton({
  armed,
  onClick,
  ariaLabel,
  label = "Continue",
  focusOnArm = true,
}: KeyButtonProps): JSX.Element {
  const keyRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (armed && focusOnArm) {
      keyRef.current?.focus();
    }
  }, [armed, focusOnArm]);

  return (
    <div className="relative flex w-full items-center justify-center">
      <span
        aria-hidden
        className="absolute inset-x-0 top-1/2 h-px bg-white/[0.08]"
      />
      <button
        ref={keyRef}
        type="button"
        disabled={!armed}
        onClick={onClick}
        aria-label={ariaLabel}
        className={cn(
          "group relative inline-flex items-center justify-center gap-2 rounded-xl border",
          ONBOARDING_KEY_SLOT_CLASS,
          "bg-[var(--vex-onboarding-bg)] font-sans text-[13px] font-medium uppercase tracking-[0.18em]",
          "transition-colors duration-200 ease-out",
          armed
            ? cn(
                "border-[color-mix(in_oklab,var(--vex-onboarding-accent)_55%,transparent)] text-[var(--vex-onboarding-accent)]",
                "hover:border-[color-mix(in_oklab,var(--vex-onboarding-accent)_85%,transparent)] hover:bg-[color-mix(in_oklab,var(--vex-onboarding-accent)_8%,transparent)]",
                "active:scale-[0.98]"
              )
            : "cursor-not-allowed border-white/[0.10] text-[var(--color-text-muted)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-onboarding-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--vex-onboarding-bg)]"
        )}
      >
        <span>{label}</span>
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          size={14}
          aria-hidden
          className="transition-transform duration-300 group-hover:translate-x-0.5"
        />
        {armed ? (
          <span
            aria-hidden
            className="vex-intro-glint pointer-events-none absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-white opacity-0 shadow-[0_0_14px_5px_rgba(238,240,255,0.5)]"
          />
        ) : null}
      </button>
    </div>
  );
}
