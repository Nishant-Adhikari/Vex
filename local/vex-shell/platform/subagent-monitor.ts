import * as messagesRepo from "../../../src/vex-agent/db/repos/messages.js";
import * as sessionLinksRepo from "../../../src/vex-agent/db/repos/session-links.js";
import * as subagentsRepo from "../../../src/vex-agent/db/repos/subagents.js";
import type { Message } from "../../../src/vex-agent/db/repos/messages.js";
import type { SessionLink } from "../../../src/vex-agent/db/repos/session-links.js";
import type {
  SubagentState,
  SubagentStatus,
} from "../../../src/vex-agent/db/repos/subagents.js";

export type SubagentAttention = "none" | "running" | "waiting" | "stalled" | "error";

export interface SubagentMonitorRow {
  id: string;
  name: string;
  task: string;
  status: SubagentStatus;
  allowTrades: boolean;
  childSessionId: string;
  startedAt: string;
  endedAt: string | null;
  iterations: number;
  maxIterations: number;
  durationSeconds: number;
  lastActivityAt: string | null;
  activityLabel: string;
  activityDetail: string | null;
  lastToolName: string | null;
  result: string | null;
  error: string | null;
  stalled: boolean;
  attention: SubagentAttention;
}

export interface SubagentActivity {
  label: string;
  detail: string | null;
  lastToolName: string | null;
  lastActivityAt: string | null;
}

const DEFAULT_LIMIT = 10;
const STALL_AFTER_MS = 10_000;

interface ToolCallSummary {
  id: string;
  command: string;
}

export async function listSessionSubagents(
  parentSessionId: string,
  options: { nowMs?: number; limit?: number } = {},
): Promise<SubagentMonitorRow[]> {
  const links = await sessionLinksRepo.getChildSessions(parentSessionId, "subagent");
  const nowMs = options.nowMs ?? Date.now();
  const rows = await Promise.all(
    links
      .filter((link) => link.subagentId !== null)
      .map((link) => loadSubagentRow(link, nowMs)),
  );

  return rows
    .filter((row): row is SubagentMonitorRow => row !== null)
    .sort(compareSubagentRows)
    .slice(0, options.limit ?? DEFAULT_LIMIT);
}

async function loadSubagentRow(
  link: SessionLink,
  nowMs: number,
): Promise<SubagentMonitorRow | null> {
  if (!link.subagentId) return null;

  const [state, messages] = await Promise.all([
    subagentsRepo.getById(link.subagentId),
    messagesRepo.getLiveMessages(link.childSessionId),
  ]);
  if (!state) return null;

  return buildSubagentMonitorRow(state, link.childSessionId, messages, nowMs);
}

export function buildSubagentMonitorRow(
  state: SubagentState,
  childSessionId: string,
  messages: readonly Message[],
  nowMs: number,
): SubagentMonitorRow {
  const activity = summarizeSubagentActivity(messages);
  const referenceTime = activity.lastActivityAt ?? state.startedAt;
  const lastActivityMs = Date.parse(referenceTime);
  const noRecentProgress = Number.isFinite(lastActivityMs) && nowMs - lastActivityMs > STALL_AFTER_MS;
  const stalled = state.status === "running" && noRecentProgress && state.iterations === 0;

  return {
    id: state.id,
    name: state.name,
    task: state.task,
    status: state.status,
    allowTrades: state.allowTrades,
    childSessionId,
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    iterations: state.iterations,
    maxIterations: state.maxIterations,
    durationSeconds: secondsBetween(state.startedAt, state.endedAt, nowMs),
    lastActivityAt: activity.lastActivityAt,
    activityLabel: activity.label,
    activityDetail: activity.detail,
    lastToolName: activity.lastToolName,
    result: state.result,
    error: state.error,
    stalled,
    attention: classifyAttention(state.status, stalled),
  };
}

export function summarizeSubagentActivity(messages: readonly Message[]): SubagentActivity {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;

    if (message.role === "tool") {
      const toolName = findToolName(messages, message.toolCallId);
      return {
        label: toolName ? `tool result ${toolName}` : "tool result",
        detail: compactText(message.content),
        lastToolName: toolName,
        lastActivityAt: message.timestamp,
      };
    }

    const calls = normalizeToolCalls(message.toolCalls);
    if (message.role === "assistant" && calls.length > 0) {
      const call = calls[calls.length - 1]!;
      return {
        label: `calling ${call.command}`,
        detail: compactText(message.content),
        lastToolName: call.command,
        lastActivityAt: message.timestamp,
      };
    }

    const content = compactText(message.content);
    if (content) {
      return {
        label: message.role === "assistant" ? "assistant text" : `${message.role} message`,
        detail: content,
        lastToolName: null,
        lastActivityAt: message.timestamp,
      };
    }
  }

  return {
    label: "starting",
    detail: null,
    lastToolName: null,
    lastActivityAt: null,
  };
}

function classifyAttention(status: SubagentStatus, stalled: boolean): SubagentAttention {
  if (status === "error" || status === "timeout" || status === "interrupted") return "error";
  if (status === "waiting_for_parent") return "waiting";
  if (stalled) return "stalled";
  if (status === "running") return "running";
  return "none";
}

function compareSubagentRows(a: SubagentMonitorRow, b: SubagentMonitorRow): number {
  const aRank = attentionRank(a.attention);
  const bRank = attentionRank(b.attention);
  if (aRank !== bRank) return aRank - bRank;
  return Date.parse(b.startedAt) - Date.parse(a.startedAt);
}

function attentionRank(attention: SubagentAttention): number {
  switch (attention) {
    case "error":
      return 0;
    case "stalled":
      return 1;
    case "waiting":
      return 2;
    case "running":
      return 3;
    case "none":
      return 4;
  }
}

function secondsBetween(startedAt: string, endedAt: string | null, nowMs: number): number {
  const startMs = Date.parse(startedAt);
  const endMs = endedAt ? Date.parse(endedAt) : nowMs;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  return Math.max(0, Math.round((endMs - startMs) / 1000));
}

function findToolName(messages: readonly Message[], toolCallId: string | undefined): string | null {
  if (!toolCallId) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const calls = normalizeToolCalls(messages[index]?.toolCalls);
    const match = calls.find((call) => call.id === toolCallId);
    if (match) return match.command;
  }
  return null;
}

function normalizeToolCalls(value: Message["toolCalls"] | undefined): ToolCallSummary[] {
  const raw: unknown = value;
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const id = entry.id;
    const command = entry.command;
    if (typeof id !== "string" || typeof command !== "string") return [];
    return [{ id, command }];
  });
}

function compactText(value: string): string | null {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
