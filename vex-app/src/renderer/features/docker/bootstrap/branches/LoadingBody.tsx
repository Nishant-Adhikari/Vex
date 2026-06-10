/**
 * Branch: loading — Docker probe hasn't returned data yet, OR engine is
 * missing and the platform health probe is still resolving. The waiting
 * indicator is the brand's DotMatrix (same machine language as the
 * SystemCheck CHECKING… stamps); the orchestrator disables the footer
 * Recheck key while this branch is active.
 */

import { DotmSquare3 } from "../../../../components/ui/dotm-square-3.js";
import { StatusTile } from "../../../../components/onboarding/StatusTile.js";

export function LoadingBody(): JSX.Element {
  return (
    <StatusTile
      tone="muted"
      icon={
        <DotmSquare3
          size={16}
          dotSize={2}
          className="text-[var(--vex-onboarding-accent)]"
          ariaLabel="Checking"
        />
      }
      title="Detecting Docker…"
      detail="Probing the Docker endpoint and platform. This should take a few seconds."
    />
  );
}
