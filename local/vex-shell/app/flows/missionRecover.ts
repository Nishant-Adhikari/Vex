import { recoverMission } from "../../engine-actions.js";
import { recordTurnLatency } from "../../platform/diagnostics.js";
import type { Store } from "../state/store.js";
import { pushLatency } from "../state/store.js";
import { formatTurnResult, makeLine } from "../lib/shellMessages.js";

export async function runMissionRecoverCommand(store: Store): Promise<void> {
  const session = store.getState().session;
  if (!session) {
    store.setState((s) => ({
      messages: [...s.messages, makeLine("system", "No active session.", "error")],
      lastError: "No active session.",
    }));
    return;
  }

  const startedAt = Date.now();
  store.setState({ pendingTurn: { startedAt }, lastError: null });
  const result = await recoverMission(session.id);
  const latency = Date.now() - startedAt;
  recordTurnLatency(latency);
  const reporter = store.getState().reporter;

  if (result.ok) {
    store.setState((s) => ({
      messages: [...s.messages, formatTurnResult(result.value, "Mission recovered")],
      pendingTurn: null,
      ...pushLatency(s, latency),
    }));
    reporter?.recordEvent({
      kind: "turnCompleted",
      latencyMs: latency,
      toolCallsMade: result.value.toolCallsMade,
      pendingApprovals: result.value.pendingApprovals.length,
      textLength: result.value.text?.length ?? 0,
      stopReason: result.value.stopReason ?? null,
      missionStatus: result.value.missionStatus ?? null,
      source: "slash_mission_recover",
    });
    return;
  }

  store.setState({ pendingTurn: null, lastError: result.error });
  store.setState((s) => ({
    messages: [
      ...s.messages,
      makeLine(
        "system",
        `Mission recover failed: ${result.error}${result.hint ? ` (${result.hint})` : ""}`,
        "error",
      ),
    ],
  }));
  reporter?.recordEvent({ kind: "error", where: "mission_recover", message: result.error });
}
