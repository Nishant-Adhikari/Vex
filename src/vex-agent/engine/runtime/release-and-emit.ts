/**
 * `releaseLeaseAndEmitControlState` — post-release emit helper
 * (puzzle 03, codex review acceptance criterion).
 *
 * Every lease-owning runner entry point MUST call this in its
 * `finally` block instead of `handle.release()` directly. The helper:
 *
 *   1. Releases the lease (idempotent, swallowing).
 *   2. Re-reads canonical state from DB (active mission run + lease).
 *   3. Emits `controlStateBus` with the post-release payload so the
 *      renderer observes the lease transition from active → inactive
 *      and the runner's final mission_run status (e.g. `cancelled`
 *      after a `stopped` finalize).
 *
 * The function is fail-closed — any read/emit error is swallowed.
 * Runtime callers must not branch on its outcome; the release itself
 * is the only behavior that must succeed (handled by `handle.release`).
 */

import logger from "@utils/logger.js";
import { getActiveRunBySession, getRun } from "../../db/repos/mission-runs.js";
import { getLease } from "../../db/repos/runner-leases.js";
import {
  CONTROL_STATE_EVENT_TYPE,
  controlStateBus,
} from "./control-bus.js";
import type { LeaseHandle } from "./lease-handle.js";

export interface ReleaseAndEmitOptions {
  /**
   * Mission run id the caller was working on. When provided the helper
   * prefers `getRun(runId)` over `getActiveRunBySession(sessionId)` so
   * the emit references the terminated run even after the active-run
   * lookup window closes (`completed`/`cancelled`/etc. are excluded
   * from active-run filters in some queries).
   */
  readonly missionRunId?: string | null;
  readonly correlationId?: string | null;
}

export async function releaseLeaseAndEmitControlState(
  handle: LeaseHandle,
  sessionId: string,
  options: ReleaseAndEmitOptions = {},
): Promise<void> {
  // Release first — this is the only side effect callers depend on.
  await handle.release();

  try {
    const lease = await getLease(sessionId);
    let run: Awaited<ReturnType<typeof getRun>> | null = null;
    if (options.missionRunId) {
      run = await getRun(options.missionRunId);
    }
    if (run === null) {
      run = await getActiveRunBySession(sessionId);
    }

    controlStateBus.emit({
      type: CONTROL_STATE_EVENT_TYPE,
      sessionId,
      missionRunId: run?.id ?? options.missionRunId ?? null,
      runStatus: run?.status ?? null,
      stopReason: run?.stopReason ?? null,
      pendingControlKind: null,
      leaseActive: lease !== null && lease.expiresAt >= new Date(),
      leaseExpiresAt:
        lease !== null && lease.expiresAt >= new Date()
          ? lease.expiresAt.toISOString()
          : null,
      correlationId: options.correlationId ?? null,
    });
  } catch (err) {
    logger.warn("runtime.release_and_emit.read_failed", {
      sessionId,
      missionRunId: options.missionRunId ?? null,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
