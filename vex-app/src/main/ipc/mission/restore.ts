/**
 * `mission.restore` — LIFO restore of the latest unrestored rewind
 * checkpoint. Idempotent on the client-generated `idempotencyKey`
 * (UNIQUE INDEX on `rewind_checkpoints.restore_idempotency_key`).
 *
 * Codex puzzle-04 phase-6 requirement: `lease_busy` strips the owner
 * id; only the bounded `retryAfterMs` reaches the renderer.
 */

import { CH } from "@shared/ipc/channels.js";
import { ok, err, type Result } from "@shared/ipc/result.js";
import {
  missionRestoreInputSchema,
  missionRestoreResultSchema,
  type MissionRestoreResult,
} from "@shared/schemas/mission.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";
import { controlFailedError } from "../runtime/_errors.js";
import { ensureEngineDbUrl } from "../runtime/_ensure-engine-db-url.js";
import { emitControlStateAfterChange } from "../runtime/_emit-control-state.js";

export function registerMissionRestoreHandler(): () => void {
  return registerHandler({
    channel: CH.mission.restore,
    domain: "mission",
    inputSchema: missionRestoreInputSchema,
    outputSchema: missionRestoreResultSchema,
    handle: async (input, ctx): Promise<Result<MissionRestoreResult>> => {
      const dbUrlOutcome = await ensureEngineDbUrl(ctx.requestId);
      if (!dbUrlOutcome.ok) return dbUrlOutcome;
      try {
        const { restoreLatestCheckpoint } = await import(
          "@vex-agent/engine/mission/restore.js"
        );
        const outcome = await restoreLatestCheckpoint({
          sessionId: input.sessionId,
          idempotencyKey: input.idempotencyKey,
        });
        log.info(
          `[ipc:vex:mission:restore] outcome=${outcome.outcome} ` +
            `correlationId=${ctx.requestId}`,
        );
        await emitControlStateAfterChange(input.sessionId, ctx.requestId);
        // Map engine outcomes to client-safe variants, stripping
        // internal lease ownerId on the `lease_busy` branch.
        switch (outcome.outcome) {
          case "restored":
          case "noop_already_restored":
            return ok({
              outcome: outcome.outcome,
              checkpointId: outcome.checkpointId,
              restoredAt: outcome.restoredAt,
              restoredCount: outcome.restoredCount,
              idempotencyKey: outcome.idempotencyKey,
            });
          case "no_checkpoint":
            return ok({ outcome: "no_checkpoint" });
          case "session_not_found":
            return ok({ outcome: "session_not_found" });
          case "blocked_active_run":
            return ok({
              outcome: "blocked_active_run",
              missionRunId: outcome.missionRunId,
              runStatus: outcome.runStatus,
            });
          case "blocked_pending_approval":
            return ok({
              outcome: "blocked_pending_approval",
              approvalId: outcome.approvalId,
            });
          case "lease_busy": {
            const retryAfterMs = Math.max(
              0,
              outcome.currentLease.expiresAt.getTime() - Date.now(),
            );
            return ok({ outcome: "lease_busy", retryAfterMs });
          }
        }
      } catch (cause) {
        log.warn(
          `[ipc:vex:mission:restore] failed correlationId=${ctx.requestId}`,
          cause,
        );
        return err(controlFailedError(ctx.requestId));
      }
    },
  });
}
