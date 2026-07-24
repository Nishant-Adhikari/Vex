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

/**
 * Flatten the open positions of an INTERRUPTED run — a wedged/orphaned run the
 * reconciler is reclaiming, or a leaseless run the operator force-stopped.
 *
 * Unlike `forceLiquidateOnDeadline`, there is no live turn-loop here to hand us
 * an `EngineContext`, so we hydrate the run's session to rebuild it, then reuse
 * the SAME `liquidateMissionPositions` core (the deadline flatten path — NOT a
 * parallel implementation). Sells only the tokens THAT MISSION opened back to
 * ETH so the run ends flat instead of stranding a bag.
 *
 * FULLY fail-soft: a missing session, a hydrate failure, or any liquidator
 * throw is logged and swallowed — flattening must NEVER block the finalize that
 * gets a wedged run out of `running`. Naturally idempotent: a second call
 * re-reads CURRENT holdings and finds the mission tokens already sold.
 */
export async function flattenInterruptedRunPositions(args: {
  missionId: string;
  runId: string;
  sessionId: string;
}): Promise<void> {
  try {
    const { hydrateEngineSession } = await import("../hydrate.js");
    const hydrated = await hydrateEngineSession(args.sessionId);
    if (!hydrated) {
      logger.warn("mission.liquidate.interrupted_no_session", {
        runId: args.runId,
        sessionId: args.sessionId,
      });
      return;
    }
    const { liquidateMissionPositions } = await import(
      "../../mission/mission-liquidate.js"
    );
    await liquidateMissionPositions({
      missionId: args.missionId,
      runId: args.runId,
      sessionId: args.sessionId,
      context: {
        ...hydrated.context,
        missionRunId: args.runId,
        sessionKind: "mission",
      },
    });
  } catch (err) {
    logger.warn("mission.liquidate.interrupted_failed", {
      runId: args.runId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
