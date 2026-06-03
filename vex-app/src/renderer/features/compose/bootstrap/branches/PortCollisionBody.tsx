/**
 * Branch: error.port_collision — Compose detected a port already in use
 * (typical: Postgres :5432 already running on host, or a stale Vex
 * stack from a previous install holding :27432). MVP path: surface the
 * full error message + nudge user to stop the conflicting process and
 * Try again (codex plan v2 SHOULD-FIX #9 — no port input in MVP, the
 * IPC contract only accepts `pgPort` and the conflict may equally be
 * on the embeddings port).
 */

import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { StatusTile } from "../../../../components/onboarding/StatusTile.js";
import { PrimaryButton } from "../../../../components/onboarding/PrimaryButton.js";

interface PortCollisionBodyProps {
  readonly message: string;
  readonly onRetry: () => void;
}

export function PortCollisionBody({
  message,
  onRetry,
}: PortCollisionBodyProps): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <StatusTile
        tone="danger"
        icon={<HugeiconsIcon icon={Cancel01Icon} size={20} aria-hidden />}
        title="Port already in use"
        detail={message}
      />
      <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
        Stop the conflicting process (another Postgres or Vex install
        may be holding the port) and click Try again. Vex needs free
        local ports for the bundled Postgres + embeddings runtime.
      </p>
      <PrimaryButton
        icon={Refresh01Icon}
        label="Try again"
        onClick={onRetry}
      />
    </div>
  );
}
