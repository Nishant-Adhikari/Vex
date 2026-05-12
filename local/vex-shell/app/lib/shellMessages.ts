import type { TurnResult } from "../../../../src/vex-agent/engine/types.js";
import type { ChatMessageLine, ShellViewState } from "../state/store.js";
import { formatContextWindow, formatSessionCost, formatTokenCount } from "../../platform/render.js";

export const HELP_TEXT = [
  "Commands:",
  "/help - show this help",
  "/clear - clear visible messages only",
  "/status - show current shell state",
  "/approve <id> - approve a pending tool call and resume",
  "/reject <id> - reject a pending tool call",
  "/mission start - start the ready mission draft",
  "/mission continue - start a new run from the ready edited draft",
  "/mission recover - create a new run from the latest failed run snapshot",
  "/mission edit [changes] - stop active run for draft editing",
  "/mission stop - stop/cancel the active mission run",
  "/retry - re-enter the active mission run after a paused_error or paused_wake",
  "/rewind [N] - archive the last N user→assistant exchanges (default 1, blocked while running)",
  "",
  "Hotkeys: Ctrl+D diagnostics, Ctrl+S settings, Ctrl+L clear visible messages.",
].join("\n");

export function makeMessageId(role: string): string {
  return `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function makeLine(
  role: ChatMessageLine["role"],
  content: string,
  tone?: ChatMessageLine["tone"],
): ChatMessageLine {
  return {
    id: makeMessageId(role),
    role,
    content,
    timestamp: new Date().toISOString(),
    tone,
  };
}

export function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isMissionDraftUpdatePayload(value: unknown): value is {
  status?: string;
  ready?: boolean;
  missingFields?: string[];
  nextCommand?: string | null;
} {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.status === undefined || typeof record.status === "string")
    && (record.ready === undefined || typeof record.ready === "boolean")
    && (record.missingFields === undefined || isStringArray(record.missingFields))
    && (
      record.nextCommand === undefined
      || record.nextCommand === null
      || typeof record.nextCommand === "string"
    )
  );
}

export function formatMissionDraftUpdateSummary(output: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch (err: unknown) {
    void err;
    const failurePrefix = "Tool mission_draft_update failed:";
    if (output.startsWith(failurePrefix)) {
      const reason = output.slice(failurePrefix.length).trim();
      return `Mission draft update failed: ${reason || "unknown error"}.`;
    }
    return null;
  }

  if (!isMissionDraftUpdatePayload(parsed)) return null;

  const status = parsed.status ?? "unknown";
  const ready = parsed.ready === true;
  if (ready) {
    const next = parsed.nextCommand ? `, next=${parsed.nextCommand}` : "";
    return `Mission draft saved: status=${status}, ready=true${next}.`;
  }

  const missing = parsed.missingFields?.length
    ? parsed.missingFields.join(", ")
    : "none reported";
  return `Mission draft saved: status=${status}, ready=false, missing=${missing}.`;
}

export function formatTurnResult(result: TurnResult, fallback: string): ChatMessageLine {
  if (result.text) {
    return makeLine("assistant", result.text);
  }
  const detail = result.stopReason ? ` stopReason=${result.stopReason}` : "";
  const approvals =
    result.pendingApprovals.length > 0
      ? ` pendingApprovals=${result.pendingApprovals.join(", ")}`
      : "";
  return makeLine("system", `${fallback}.${detail}${approvals}`.trim());
}

export function formatStatus(snapshot: ShellViewState): string {
  const session = snapshot.session;
  const pending = snapshot.pendingTurn
    ? `yes (${Math.round((Date.now() - snapshot.pendingTurn.startedAt) / 1000)}s)`
    : "no";

  return [
    `Provider: ${snapshot.provider.name}${snapshot.provider.detail ? ` (${snapshot.provider.detail})` : ""}`,
    `Session: ${session ? `${session.id} (${session.kind})` : "none"}`,
    `Mission: ${session?.missionStatus ?? "none"}`,
    `Full autonomous: ${session?.fullAutonomousStatus ?? "none"}`,
    `Mission command: ${session?.missionCommand ? `/mission ${session.missionCommand}` : "none"}`,
    `Mission loop mode: ${snapshot.missionLoopMode}`,
    `Context: ${session ? formatContextWindow(session.context) : "none"}`,
    `Tokens: ${session ? `${formatTokenCount(session.usage.sessionTokens)} total across ${session.usage.requestCount} request(s)` : "none"}`,
    `Cost: ${session ? formatSessionCost(session.usage.sessionCost) : "none"}`,
    `Wake: ${snapshot.wakeEnabled ? "on" : "off"}`,
    `Approvals: ${snapshot.approvals.length}`,
    `Pending turn: ${pending}`,
    `Mode: ${snapshot.mode}`,
  ].join("\n");
}
