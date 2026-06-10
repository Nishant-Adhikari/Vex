/**
 * RecheckButton — the quiet footer key for probe-style onboarding
 * screens (currently Docker bootstrap): re-runs detection when the
 * branch isn't ready yet. The armed Continue path is the shared
 * `KeyButton`; the two swap inside the same plinth slot so each state
 * has exactly one CTA in one place.
 */

import { HugeiconsIcon } from "@hugeicons/react";
import { Refresh01Icon } from "@hugeicons/core-free-icons";
import { cn } from "../../lib/utils.js";
import { ONBOARDING_KEY_SLOT_CLASS } from "./geometry.js";

interface RecheckButtonProps {
  readonly onClick: () => void;
  readonly disabled: boolean;
}

/**
 * NOTARY key form: occupies the shared 208×44 slot (same geometry as the
 * Continue key) in quiet white-hairline chrome — one CTA per state, one
 * place for the hand to rest. Background matches the canvas so the slot
 * plinth rule disappears behind it.
 */
export function RecheckButton({
  onClick,
  disabled,
}: RecheckButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "relative inline-flex items-center justify-center gap-2 rounded-xl border",
        ONBOARDING_KEY_SLOT_CLASS,
        "border-white/[0.10] bg-[var(--vex-onboarding-bg)] font-sans text-[13px] font-medium uppercase tracking-[0.18em] text-[var(--color-text-secondary)]",
        "hover:border-white/[0.2] hover:text-[var(--color-text-primary)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-onboarding-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--vex-onboarding-bg)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "transition-colors duration-150",
      )}
    >
      <HugeiconsIcon icon={Refresh01Icon} size={14} aria-hidden />
      Recheck
    </button>
  );
}
