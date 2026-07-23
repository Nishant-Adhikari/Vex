/**
 * Deadline force-liquidation hook — the seam between the mission-run bodies and
 * `mission-liquidate.ts`. Called AFTER `runTurnLoop` returns and BEFORE
 * `finalizeMissionRunStatus`, in both the start-run and resume-run paths.
 *
 * Fires when the run stopped on an ENGINE-ENFORCED hard backstop that can cut
 * the agent off mid-position — the hard deadline (`deadline_reached`) or the
 * hard token budget (`token_budget_exhausted`). In either case we sell the
 * tokens THAT MISSION opened back to ETH first, so the run ends flat instead of
 * stranded holding a bag. Agent-driven stops (goal_reached, mission_stop, etc.)
 * are the agent's own decision and are NOT force-liquidated here.
 *
 * The liquidator is itself fully fail-soft; this wrapper adds a second try/catch
 * (defense in depth) plus a dynamic import so the heavy uniswap swap graph is
 * only loaded when a deadline actually fires. It NEVER throws — liquidation must
 * never prevent finalization.
 */

import type { StopReason } from "../../types.js";
import type { EngineContext } from "../../types.js";
import logger from "@utils/logger.js";

export async function forceLiquidateOnDeadline(args: {
  missionId: string;
  runId: string;
  sessionId: string;
  stopReason: StopReason | null;
  context: EngineContext;
}): Promise<void> {
  if (
    args.stopReason !== "deadline_reached" &&
    args.stopReason !== "token_budget_exhausted"
  ) {
    return;
  }
  try {
    const { liquidateMissionPositions } = await import(
      "../../mission/mission-liquidate.js"
    );
    await liquidateMissionPositions({
      missionId: args.missionId,
      runId: args.runId,
      sessionId: args.sessionId,
      context: args.context,
    });
  } catch (err) {
    // Defense in depth — the liquidator is already fail-soft, but a deadline
    // exit must NEVER block finalization on an unexpected throw.
    logger.warn("mission.liquidate.hook_failed", {
      runId: args.runId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
