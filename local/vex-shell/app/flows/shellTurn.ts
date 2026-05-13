import { routeUserMessage } from "../../../../src/vex-agent/engine/index.js";
import {
  abortActiveMission,
  approveById,
  editMissionDraft,
  rejectById,
  retryMission,
  rewindShellSession,
  startMissionFromSetup,
  startReadyMission,
} from "../../engine-actions.js";
import { recordTurnLatency } from "../../platform/diagnostics.js";
import { sessionLog } from "../../platform/log.js";
import type { ChatMessageLine, InitialPromptIntent, Store } from "../state/store.js";
import { pushLatency } from "../state/store.js";
import {
  formatError,
  formatStatus,
  formatTurnResult,
  HELP_TEXT,
  makeLine,
  makeMessageId,
} from "../lib/shellMessages.js";
import { runMissionRecoverCommand } from "./missionRecover.js";

type MissionActivationCommand = "start" | "continue";

const REWIND_DEFAULT = 1;
const REWIND_MAX = 50;

function parseRewindArg(raw: string | undefined): number | null {
  if (raw === undefined) return REWIND_DEFAULT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > REWIND_MAX) return null;
  return n;
}

export function appendSystemLine(
  store: Store,
  content: string,
  tone: ChatMessageLine["tone"] = "info",
): void {
  store.setState((s) => ({
    messages: [...s.messages, makeLine("system", content, tone)],
    ...(tone === "error" ? { lastError: content } : {}),
  }));
}

export async function sendUserMessage(store: Store, text: string): Promise<void> {
  const snapshot = store.getState();
  const session = snapshot.session;
  if (!session) {
    appendSystemLine(
      store,
      "No active session. Open Settings (Ctrl+S) and use the Session tab to create one.",
      "error",
    );
    return;
  }

  const userLine = {
    id: makeMessageId("user"),
    role: "user" as const,
    content: text,
    timestamp: new Date().toISOString(),
  };
  store.setState((s) => ({
    messages: [...s.messages, userLine],
    pendingTurn: { startedAt: Date.now() },
    lastError: null,
  }));
  snapshot.reporter?.recordEvent({ kind: "userMessage", text, source: "input" });

  const startedAt = Date.now();
  try {
    const result = await routeUserMessage(session.id, text);
    const latency = Date.now() - startedAt;
    recordTurnLatency(latency);
    sessionLog.info("session.turn.completed", {
      sessionId: session.id,
      latencyMs: latency,
      toolCallsMade: result.toolCallsMade,
      pendingApprovals: result.pendingApprovals.length,
      textLength: result.text?.length ?? 0,
      stopReason: result.stopReason ?? undefined,
    });

    const assistantLine = {
      id: makeMessageId("assistant"),
      role: "assistant" as const,
      content: result.text ?? `(no text — stopReason: ${result.stopReason ?? "unknown"})`,
      timestamp: new Date().toISOString(),
    };
    store.setState((s) => ({
      messages: [...s.messages, assistantLine],
      pendingTurn: null,
      ...pushLatency(s, latency),
    }));

    const reporter = store.getState().reporter;
    if (reporter) {
      reporter.recordEvent({
        kind: "assistantMessage",
        text: result.text ?? "",
        stopReason: result.stopReason ?? null,
        missionStatus: result.missionStatus ?? null,
      });
      reporter.recordEvent({
        kind: "turnCompleted",
        latencyMs: latency,
        toolCallsMade: result.toolCallsMade,
        pendingApprovals: result.pendingApprovals.length,
        textLength: result.text?.length ?? 0,
        stopReason: result.stopReason ?? null,
        missionStatus: result.missionStatus ?? null,
        source: "input",
      });
      // Best-effort engine-signal derivation. The reporter does not see the
      // engine's actual EngineSignal — `derivedFrom` makes that explicit so
      // the evaluator does not treat this as first-class observation. A
      // non-null `stopReason` always carries information (text-ended turns
      // resolve to `null`).
      if (result.stopReason) {
        reporter.recordEvent({
          kind: "engineSignal",
          derivedFrom: "stopReason",
          signal: result.stopReason,
        });
      }
    }
  } catch (err) {
    const message = formatError(err);
    store.setState({
      pendingTurn: null,
      lastError: message,
    });
    appendSystemLine(store, `Turn failed: ${message}`, "error");
    sessionLog.error("session.turn.failed", {
      sessionId: session.id,
      error: message,
    });
    store.getState().reporter?.recordEvent({
      kind: "error",
      where: "turn",
      message,
    });
  }
}

export async function runSlashCommand(store: Store, raw: string): Promise<void> {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  const command = parts[0]?.toLowerCase() ?? "";
  const args = parts.slice(1);

  if (command === "/help") {
    appendSystemLine(store, HELP_TEXT);
    return;
  }

  if (command === "/clear") {
    store.setState({ messages: [], lastError: null });
    return;
  }

  if (command === "/status") {
    appendSystemLine(store, formatStatus(store.getState()));
    return;
  }

  if (command === "/approve") {
    const approvalId = args[0];
    if (!approvalId) {
      appendSystemLine(store, "Usage: /approve <approval-id>", "error");
      return;
    }

    const startedAt = Date.now();
    store.setState({ pendingTurn: { startedAt }, lastError: null });
    const result = await approveById(approvalId);
    const latency = Date.now() - startedAt;
    recordTurnLatency(latency);
    const reporter = store.getState().reporter;
    reporter?.recordEvent({
      kind: "approval",
      approvalId,
      decision: "approve",
      source: "slash",
      toolName: null,
    });
    if (result.ok) {
      store.setState((s) => ({
        messages: [...s.messages, formatTurnResult(result.value, `Approved ${approvalId}`)],
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
        source: "slash_approve",
      });
    } else {
      store.setState({ pendingTurn: null, lastError: result.error });
      appendSystemLine(store, `Approve failed: ${result.error}`, "error");
      reporter?.recordEvent({ kind: "error", where: "approve", message: result.error });
    }
    return;
  }

  if (command === "/reject") {
    const approvalId = args[0];
    if (!approvalId) {
      appendSystemLine(store, "Usage: /reject <approval-id>", "error");
      return;
    }

    const result = await rejectById(approvalId);
    const reporter = store.getState().reporter;
    reporter?.recordEvent({
      kind: "approval",
      approvalId,
      decision: "reject",
      source: "slash",
      toolName: null,
    });
    if (result.ok) {
      appendSystemLine(
        store,
        result.value.rejected
          ? `Rejected approval ${approvalId}.`
          : `Approval ${approvalId} was already resolved.`,
        result.value.rejected ? "info" : "error",
      );
    } else {
      appendSystemLine(store, `Reject failed: ${result.error}`, "error");
      reporter?.recordEvent({ kind: "error", where: "reject", message: result.error });
    }
    return;
  }

  if (command === "/mission" && args[0]?.toLowerCase() === "start") {
    await runMissionActivationCommand(store, "start");
    return;
  }

  if (command === "/mission" && args[0]?.toLowerCase() === "continue") {
    await runMissionActivationCommand(store, "continue");
    return;
  }

  if (command === "/mission" && args[0]?.toLowerCase() === "recover") {
    await runMissionRecoverCommand(store);
    return;
  }

  if (command === "/mission" && args[0]?.toLowerCase() === "edit") {
    const session = store.getState().session;
    if (!session) {
      appendSystemLine(store, "No active session.", "error");
      return;
    }

    const instruction = args.slice(1).join(" ").trim();
    const startedAt = Date.now();
    store.setState({ pendingTurn: { startedAt }, lastError: null });
    const result = await editMissionDraft(session.id, instruction);
    const latency = Date.now() - startedAt;
    recordTurnLatency(latency);

    if (result.ok) {
      const prefix = result.value.stoppedActiveRun
        ? `Mission stopped for edit; rejectedApprovals=${result.value.rejectedApprovals}.`
        : "Mission edit mode.";
      store.setState((s) => ({
        messages: [...s.messages, formatTurnResult(result.value.setup, prefix)],
        pendingTurn: null,
        ...pushLatency(s, latency),
      }));
      store.getState().reporter?.recordEvent({
        kind: "turnCompleted",
        latencyMs: latency,
        toolCallsMade: result.value.setup.toolCallsMade,
        pendingApprovals: result.value.setup.pendingApprovals.length,
        textLength: result.value.setup.text?.length ?? 0,
        stopReason: result.value.setup.stopReason ?? null,
        missionStatus: result.value.setup.missionStatus ?? null,
        source: "slash_mission_edit",
      });
    } else {
      store.setState({ pendingTurn: null, lastError: result.error });
      appendSystemLine(
        store,
        `Mission edit failed: ${result.error}${result.hint ? ` (${result.hint})` : ""}`,
        "error",
      );
      store.getState().reporter?.recordEvent({ kind: "error", where: "mission_edit", message: result.error });
    }
    return;
  }

  if (command === "/retry") {
    const session = store.getState().session;
    if (!session) {
      appendSystemLine(store, "No active session.", "error");
      return;
    }

    const startedAt = Date.now();
    store.setState({ pendingTurn: { startedAt }, lastError: null });
    const result = await retryMission(session.id);
    const latency = Date.now() - startedAt;
    recordTurnLatency(latency);
    const reporter = store.getState().reporter;

    if (result.ok) {
      store.setState((s) => ({
        messages: [...s.messages, formatTurnResult(result.value, "Mission retried")],
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
        source: "slash_retry",
      });
    } else {
      store.setState({ pendingTurn: null, lastError: result.error });
      appendSystemLine(
        store,
        `Retry failed: ${result.error}${result.hint ? ` (${result.hint})` : ""}`,
        "error",
      );
      reporter?.recordEvent({ kind: "error", where: "retry", message: result.error });
    }
    return;
  }

  if (command === "/rewind") {
    const session = store.getState().session;
    if (!session) {
      appendSystemLine(store, "No active session.", "error");
      return;
    }

    const turns = parseRewindArg(args[0]);
    if (turns === null) {
      appendSystemLine(store, "Usage: /rewind [N] (N integer in [1,50])", "error");
      return;
    }

    const startedAt = Date.now();
    store.setState({ pendingTurn: { startedAt }, lastError: null });
    const result = await rewindShellSession(session.id, turns);
    const latency = Date.now() - startedAt;
    recordTurnLatency(latency);
    const reporter = store.getState().reporter;

    if (result.ok) {
      const v = result.value;
      const noopSuffix = v.noop ? " (no-op: session has no user messages)" : "";
      const summary =
        `Rewound: archived=${v.archivedMessages}, approvals_rejected=${v.rejectedApprovals}, ` +
        `wakes_cancelled=${v.cancelledWakes}, mission=${v.missionRunImpact}${noopSuffix}.`;
      store.setState((s) => ({
        messages: [...s.messages, makeLine("system", summary, "info")],
        pendingTurn: null,
        ...pushLatency(s, latency),
      }));
      reporter?.recordEvent({
        kind: "turnCompleted",
        latencyMs: latency,
        toolCallsMade: 0,
        pendingApprovals: 0,
        textLength: summary.length,
        stopReason: null,
        missionStatus: null,
        source: "slash_rewind",
      });
    } else {
      store.setState({ pendingTurn: null, lastError: result.error });
      appendSystemLine(
        store,
        `Rewind failed: ${result.error}${result.hint ? ` (${result.hint})` : ""}`,
        "error",
      );
      reporter?.recordEvent({ kind: "error", where: "rewind", message: result.error });
    }
    return;
  }

  if (command === "/mission" && (args[0]?.toLowerCase() === "stop" || args[0]?.toLowerCase() === "cancel")) {
    const session = store.getState().session;
    if (!session) {
      appendSystemLine(store, "No active session.", "error");
      return;
    }

    const result = await abortActiveMission(session.id);
    if (result.ok) {
      appendSystemLine(
        store,
        result.value.aborted
          ? `Mission stopped. status=${result.value.status}, rejectedApprovals=${result.value.rejectedApprovals}.`
          : "No active mission run to stop.",
        result.value.aborted ? "info" : "error",
      );
    } else {
      appendSystemLine(store, `Mission stop failed: ${result.error}`, "error");
      store.getState().reporter?.recordEvent({
        kind: "error",
        where: "abort",
        message: result.error,
      });
    }
    return;
  }

  appendSystemLine(
    store,
    `Unknown command: ${raw}. Run /help for available commands.`,
    "error",
  );
}

async function runMissionActivationCommand(
  store: Store,
  action: MissionActivationCommand,
): Promise<void> {
  const session = store.getState().session;
  if (!session) {
    appendSystemLine(store, "No active session.", "error");
    return;
  }

  const permission = store.getState().permission;
  const startedAt = Date.now();
  store.setState({ pendingTurn: { startedAt }, lastError: null });

  const result = await startReadyMission(session.id);
  const latency = Date.now() - startedAt;
  recordTurnLatency(latency);

  const verb = action === "start" ? "started" : "continued";
  const source = action === "start" ? "slash_mission_start" : "slash_mission_continue";
  const failureWhere = action === "start" ? "mission_start" : "mission_continue";

  if (result.ok) {
    const fallback = `Mission ${verb} in ${permission} mode; status=${result.value.missionStatus ?? "running"}`;
    const activationLine = formatTurnResult({ ...result.value, text: null }, fallback);
    const assistantLine = result.value.text ? makeLine("assistant", result.value.text) : null;

    store.setState((s) => ({
      messages: [
        ...s.messages,
        activationLine,
        ...(assistantLine ? [assistantLine] : []),
      ],
      pendingTurn: null,
      ...pushLatency(s, latency),
    }));
    const reporter = store.getState().reporter;
    reporter?.recordEvent({
      kind: "turnCompleted",
      latencyMs: latency,
      toolCallsMade: result.value.toolCallsMade,
      pendingApprovals: result.value.pendingApprovals.length,
      textLength: result.value.text?.length ?? 0,
      stopReason: result.value.stopReason ?? null,
      missionStatus: result.value.missionStatus ?? null,
      source,
    });
    if (result.value.text) {
      reporter?.recordEvent({
        kind: "assistantMessage",
        text: result.value.text,
        stopReason: result.value.stopReason ?? null,
        missionStatus: result.value.missionStatus ?? null,
      });
    }
    return;
  }

  store.setState({ pendingTurn: null, lastError: result.error });
  appendSystemLine(
    store,
    `Mission ${action} failed: ${result.error}${result.hint ? ` (${result.hint})` : ""}`,
    "error",
  );
  store.getState().reporter?.recordEvent({ kind: "error", where: failureWhere, message: result.error });
}

export async function dispatchInitialPromptIntent(
  store: Store,
  sessionId: string,
  initialIntent: InitialPromptIntent,
): Promise<void> {
  if (initialIntent.kind === "user-message") {
    await sendUserMessage(store, initialIntent.text);
    store.setState({ initialPromptIntent: null });
    return;
  }

  const userLine = {
    id: makeMessageId("user"),
    role: "user" as const,
    content: initialIntent.text,
    timestamp: new Date().toISOString(),
  };
  store.setState((s) => ({
    messages: [...s.messages, userLine],
    pendingTurn: { startedAt: Date.now() },
    lastError: null,
  }));
  store.getState().reporter?.recordEvent({
    kind: "userMessage",
    text: initialIntent.text,
    source: "wizard_goal",
  });
  const startedAt = Date.now();
  const result = await startMissionFromSetup(sessionId, initialIntent.text);
  const latency = Date.now() - startedAt;
  recordTurnLatency(latency);
  if (result.ok) {
    const assistantLine = {
      id: makeMessageId("assistant"),
      role: "assistant" as const,
      content:
        result.value.text
        ?? `(no text — missionStatus=${result.value.missionStatus ?? "unknown"})`,
      timestamp: new Date().toISOString(),
    };
    store.setState((s) => ({
      messages: [...s.messages, assistantLine],
      pendingTurn: null,
      initialPromptIntent: null,
      ...pushLatency(s, latency),
    }));
    sessionLog.info("session.turn.completed", {
      sessionId,
      latencyMs: latency,
      toolCallsMade: result.value.toolCallsMade,
      pendingApprovals: result.value.pendingApprovals.length,
      textLength: result.value.text?.length ?? 0,
      missionStatus: result.value.missionStatus ?? undefined,
      source: "wizard_goal",
    });
    const reporter = store.getState().reporter;
    if (reporter) {
      reporter.recordEvent({
        kind: "assistantMessage",
        text: result.value.text ?? "",
        stopReason: result.value.stopReason ?? null,
        missionStatus: result.value.missionStatus ?? null,
      });
      reporter.recordEvent({
        kind: "turnCompleted",
        latencyMs: latency,
        toolCallsMade: result.value.toolCallsMade,
        pendingApprovals: result.value.pendingApprovals.length,
        textLength: result.value.text?.length ?? 0,
        stopReason: result.value.stopReason ?? null,
        missionStatus: result.value.missionStatus ?? null,
        source: "wizard_goal",
      });
    }
  } else {
    store.setState({
      pendingTurn: null,
      initialPromptIntent: null,
      lastError: result.error,
    });
    appendSystemLine(store, `Mission setup failed: ${result.error}`, "error");
    sessionLog.error("session.turn.failed", {
      sessionId,
      error: result.error,
      source: "wizard_goal",
    });
    store.getState().reporter?.recordEvent({
      kind: "error",
      where: "setup",
      message: result.error,
    });
  }
}
