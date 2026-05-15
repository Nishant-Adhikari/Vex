/**
 * Branch: error.cancelled — user clicked Cancel and the IPC returned
 * `internal.cancelled`. Calm informational state, not a failure red.
 */

import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { StatusTile } from "../../../../components/onboarding/StatusTile.js";
import { PrimaryButton } from "../../../../components/onboarding/PrimaryButton.js";

interface CancelledBodyProps {
  readonly onRetry: () => void;
}

export function CancelledBody({ onRetry }: CancelledBodyProps): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <StatusTile
        tone="muted"
        icon={<HugeiconsIcon icon={Cancel01Icon} size={20} aria-hidden />}
        title="Startup cancelled."
        detail="Startup was cancelled before onboarding continued. Try again to reconcile the local stack."
      />
      <PrimaryButton icon={Refresh01Icon} label="Retry" onClick={onRetry} />
    </div>
  );
}
