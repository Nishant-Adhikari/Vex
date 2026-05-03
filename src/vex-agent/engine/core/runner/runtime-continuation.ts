/**
 * Runtime continuation helpers.
 *
 * `iteration_limit` and `timeout` are slice guards, not mission contract
 * outcomes. When an autonomous loop exhausts a runtime slice, schedule a
 * near-future wake so the executor can continue from a clean turn instead of
 * marking the mission as failed.
 */

import * as loopWakeRepo from "@vex-agent/db/repos/loop-wake.js";
import type { LoopWakeKind } from "@vex-agent/db/repos/loop-wake.js";
import * as messagesRepo from "@vex-agent/db/repos/messages.js";
import { currentDate } from "@vex-agent/engine/runtime-clock.js";
import type { RuntimeStopReason, StopReason } from "../../types.js";

const AUTO_CONTINUE_AFTER_MS = 5_000;

export type ContinuableRuntimeStop = Extract<RuntimeStopReason, "iteration_limit" | "timeout">;

export interface RuntimeContinuationInput {
  sessionId: string;
  missionRunId: string | null;
  kind: LoopWakeKind;
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
  if (input.kind === "mission_run" && !input.missionRunId) {
    throw new Error("scheduleRuntimeContinuation: missionRunId is required for mission_run wakes");
  }

  const dueAt = new Date(currentDate().getTime() + AUTO_CONTINUE_AFTER_MS);
  const reason = `${input.trigger}: runtime slice exhausted; continue autonomously`;

  const row = await loopWakeRepo.enqueue({
    sessionId: input.sessionId,
    missionRunId: input.kind === "mission_run" ? input.missionRunId : null,
    kind: input.kind,
    dueAt,
    reason,
    payload: { trigger: input.trigger, automatic: true },
  });

  const pending = row ?? await loopWakeRepo.getPendingForSession(input.sessionId);
  const scheduledAt = pending?.dueAt ?? dueAt.toISOString();
  const action = row ? "scheduled" : "existing pending wake retained";

  await messagesRepo.addEngineMessage(
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
        kind: input.kind,
        missionRunId: input.missionRunId,
      },
    },
  );

  return { dueAt: scheduledAt, enqueued: row !== null };
}
