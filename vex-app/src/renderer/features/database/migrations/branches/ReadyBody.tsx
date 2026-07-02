/**
 * Branch: ready — `database.migrate()` returned `kind: "applied"`.
 * A success StatusTile with the flow's single celebration: one
 * `vex-intro-glint` star on the tile's corner (the same one-shot flare
 * used across the onboarding — one light doctrine). The glint
 * keyframes end transparent and the global reduced-motion rule
 * collapses them to the final (invisible) frame, so no JS gating or
 * teardown timer is needed. The armed Continue key lives in the
 * orchestrator.
 */

import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle01Icon } from "@hugeicons/core-free-icons";
import { StatusTile } from "../../../../components/onboarding/StatusTile.js";

interface ReadyBodyProps {
  readonly appliedCount: number;
  readonly celebrate: boolean;
}

export function ReadyBody({
  appliedCount,
  celebrate,
}: ReadyBodyProps): JSX.Element {
  const word = appliedCount === 1 ? "migration" : "migrations";
  const detail = `${appliedCount} ${word} applied — schema is up to date.`;

  return (
    <div className="relative">
      {celebrate ? (
        <span
          aria-hidden
          className="vex-intro-glint pointer-events-none absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-white opacity-0 shadow-[0_0_14px_5px_rgba(255,255,255,0.5)]"
        />
      ) : null}
      <StatusTile
        tone="success"
        icon={
          <HugeiconsIcon icon={CheckmarkCircle01Icon} size={20} aria-hidden />
        }
        title="Schema updated"
        detail={detail}
      />
    </div>
  );
}
