/**
 * Runtime continuation helpers.
 *
 * `iteration_limit` and `timeout` are slice guards, not mission contract
 * outcomes. When a mission run exhausts a runtime slice, schedule a
 * near-future wake so the executor can continue from a clean turn instead of
 * marking the mission as failed.
 *
 * Post-M12: only mission runs use the wake substrate; agent mode is one-shot
 * and never schedules continuations.
 */

import * as loopWakeRepo from "@vex-agent/db/repos/loop-wake.js";
import { appendEngineMessage } from "@vex-agent/engine/events/index.js";
import { currentDate } from "@vex-agent/engine/runtime-clock.js";
import type { RuntimeStopReason, StopReason } from "../../types.js";

const AUTO_CONTINUE_AFTER_MS = 5_000;

export type ContinuableRuntimeStop = Extract<RuntimeStopReason, "iteration_limit" | "timeout">;

export interface RuntimeContinuationInput {
  sessionId: string;
  missionRunId: string;
  trigger: ContinuableRuntimeStop;
}

export interface RuntimeContinuationResult {
  dueAt: string;
  enqueued: boolean;
}

export function isContinuableRuntimeStop(
  stopReason: StopReason | null,
): stopReason is ContinuableRuntimeStop {
  return stopReason === "iteration_limit" || stopReason === "timeout";
}

export async function scheduleRuntimeContinuation(
  input: RuntimeContinuationInput,
): Promise<RuntimeContinuationResult> {
  const dueAt = new Date(currentDate().getTime() + AUTO_CONTINUE_AFTER_MS);
  const reason = `${input.trigger}: runtime slice exhausted; continue autonomously`;

  const row = await loopWakeRepo.enqueue({
    sessionId: input.sessionId,
    missionRunId: input.missionRunId,
    dueAt,
    reason,
    payload: { trigger: input.trigger, automatic: true },
  });

  const pending = row ?? await loopWakeRepo.getPendingForSession(input.sessionId);
  const scheduledAt = pending?.dueAt ?? dueAt.toISOString();
  const action = row ? "scheduled" : "existing pending wake retained";

  await appendEngineMessage(
    input.sessionId,
    `[Engine: runtime_yield - ${input.trigger}; ${action}; next check: ${scheduledAt}]`,
    {
      source: "engine",
      messageType: "runtime_yield",
      visibility: "internal",
      payload: {
        trigger: input.trigger,
        dueAt: scheduledAt,
        enqueued: row !== null,
        missionRunId: input.missionRunId,
      },
    },
  );

  return { dueAt: scheduledAt, enqueued: row !== null };
}
