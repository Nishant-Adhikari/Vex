/**
 * Branch: ready — Compose came back with kind="running" or "reused".
 * A success StatusTile with the flow's single celebration: one
 * `vex-intro-glint` star on the tile's corner (the same one-shot flare
 * that closes the intro signing and arms the Continue keys — one light
 * doctrine across the whole onboarding). The glint keyframes end
 * transparent and the global reduced-motion rule collapses them to the
 * final (invisible) frame, so no JS gating or teardown timer is needed.
 * The armed Continue key lives in the orchestrator.
 */

import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle01Icon } from "@hugeicons/core-free-icons";
import type { ComposeUpResult } from "@shared/schemas/docker.js";
import { StatusTile } from "../../../../components/onboarding/StatusTile.js";

interface ReadyBodyProps {
  readonly result: ComposeUpResult;
  /** Passed by the orchestrator on the setPhase that flipped to ready. */
  readonly celebrate: boolean;
}

export function ReadyBody({ result, celebrate }: ReadyBodyProps): JSX.Element {
  const detail =
    result.kind === "reused"
      ? "Existing stack reused — services already healthy."
      : (result.message ?? "All services started and answered health checks.");

  return (
    <div className="relative">
      {celebrate ? (
        <span
          aria-hidden
          className="vex-intro-glint pointer-events-none absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-white opacity-0 shadow-[0_0_14px_5px_rgba(238,240,255,0.5)]"
        />
      ) : null}
      <StatusTile
        tone="success"
        icon={
          <HugeiconsIcon icon={CheckmarkCircle01Icon} size={20} aria-hidden />
        }
        title={result.kind === "reused" ? "Stack reused" : "All services ready"}
        detail={detail}
      />
    </div>
  );
}
