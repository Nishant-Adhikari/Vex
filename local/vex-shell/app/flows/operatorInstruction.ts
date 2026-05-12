import {
  ACTIVE_OR_PAUSED_FULL_AUTONOMOUS_STATUSES,
  ACTIVE_OR_PAUSED_RUN_STATUSES,
  submitOperatorInstruction,
  type FullAutonomousRunStatus,
  type MissionRunStatus,
} from "../../../../src/vex-agent/engine/index.js";
import { recordTurnLatency } from "../../platform/diagnostics.js";
import type { Store } from "../state/store.js";
import { pushLatency } from "../state/store.js";
import { formatError, makeLine, makeMessageId } from "../lib/shellMessages.js";

function isActiveRuntimeStatus(status: string | null): boolean {
  return (
    typeof status === "string"
    && (
      ACTIVE_OR_PAUSED_RUN_STATUSES.has(status as MissionRunStatus)
      || ACTIVE_OR_PAUSED_FULL_AUTONOMOUS_STATUSES.has(status as FullAutonomousRunStatus)
    )
  );
}

export function shouldSendOperatorInstruction(store: Store): boolean {
  const session = store.getState().session;
  return isActiveRuntimeStatus(session?.missionStatus ?? null)
    || isActiveRuntimeStatus(session?.fullAutonomousStatus ?? null);
}

export async function sendOperatorInstruction(store: Store, text: string): Promise<void> {
  const snapshot = store.getState();
  const session = snapshot.session;
  if (!session) {
    store.setState((s) => ({
      messages: [...s.messages, makeLine("system", "No active session.", "error")],
      lastError: "No active session.",
    }));
    return;
  }

  const shouldMarkPending =
    session.missionStatus === "paused_wake"
    || session.fullAutonomousStatus === "paused_wake";
  store.setState((s) => ({
    messages: [
      ...s.messages,
      {
        id: makeMessageId("user"),
        role: "user",
        content: text,
        timestamp: new Date().toISOString(),
      },
    ],
    pendingTurn: shouldMarkPending ? { startedAt: Date.now() } : s.pendingTurn,
    lastError: null,
  }));
  snapshot.reporter?.recordEvent({ kind: "userMessage", text, source: "input" });

  const startedAt = Date.now();
  try {
    const result = await submitOperatorInstruction(session.id, text);
    const latency = Date.now() - startedAt;
    recordTurnLatency(latency);
    const ack = result.text?.trim();
    store.setState((s) => ({
      messages: ack ? [...s.messages, makeLine("system", ack)] : s.messages,
      pendingTurn: shouldMarkPending ? null : s.pendingTurn,
      ...pushLatency(s, latency),
    }));
    store.getState().reporter?.recordEvent({
      kind: "turnCompleted",
      latencyMs: latency,
      toolCallsMade: result.toolCallsMade,
      pendingApprovals: result.pendingApprovals.length,
      textLength: result.text?.length ?? 0,
      stopReason: result.stopReason ?? null,
      missionStatus: result.missionStatus ?? null,
      source: "input",
    });
  } catch (err) {
    const message = formatError(err);
    store.setState({
      pendingTurn: shouldMarkPending ? null : store.getState().pendingTurn,
      lastError: message,
    });
    store.setState((s) => ({
      messages: [...s.messages, makeLine("system", `Operator instruction failed: ${message}`, "error")],
    }));
    store.getState().reporter?.recordEvent({
      kind: "error",
      where: "operator_instruction",
      message,
    });
  }
}
