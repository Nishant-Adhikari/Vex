import type { ProviderSummary, SessionSummary } from "../../platform/render.js";
import type { SessionReporter } from "../../platform/session-report.js";
import type { SubagentMonitorRow } from "../../platform/subagent-monitor.js";
import type { WizardMode, WizardPermission } from "../../wizard/mode-step.js";

export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface ChatMessageLine {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  tone?: "info" | "error";
  toolName?: string;
  toolCallId?: string;
}

export interface PendingTurn {
  startedAt: number;
  currentToolName?: string;
  currentToolCallId?: string;
}

export interface ToolCallEntry {
  id: string;
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
  result: string | null;
  status: "pending" | "done" | "failed";
  startedAt: string;
  endedAt: string | null;
}

export interface ApprovalItem {
  id: string;
  tool: string;
  createdAt: string;
  reasoning?: string;
}

export type InitialPromptIntent =
  | { kind: "user-message"; text: string }
  | { kind: "mission-setup"; text: string; permission: WizardPermission };

export interface ShellViewState {
  provider: ProviderSummary;
  mode: WizardMode;
  permission: WizardPermission;
  session: SessionSummary | null;
  messages: ChatMessageLine[];
  approvals: ApprovalItem[];
  pendingTurn: PendingTurn | null;
  lastError: string | null;
  sidebarOpen: boolean;
  latencyMs: number[];
  initialPromptIntent: InitialPromptIntent | null;
  settingsTab: SettingsTabId | null;
  settingsCursor: number;
  settingsEdit: SettingsEditMode | null;
  settingsToast: { kind: "ok" | "error"; text: string } | null;
  recentSessions: RecentSession[];
  knowledgeResults: KnowledgeHit[];
  subagentRows: SubagentRow[];
  toolCallsOpen: boolean;
  toolCallsCursor: number;
  recentToolCalls: ToolCallEntry[];
  reporter: SessionReporter | null;
}

export const RECENT_TOOL_CALLS_LIMIT = 5;

export interface RecentSession {
  id: string;
  kind: string;
  startedAt: string;
  endedAt: string | null;
  messageCount: number;
}

export interface KnowledgeHit {
  id: string;
  title: string;
  preview: string;
}

export type SubagentRow = SubagentMonitorRow;

export type SettingsFieldKind = "text" | "secret" | "json" | "number";

export interface SettingsEditMode {
  tab: SettingsTabId;
  field: string;
  kind: SettingsFieldKind;
  value: string;
  placeholder?: string;
  validate?: (raw: string) => string | null;
}

export type SettingsTabId =
  | "provider"
  | "session"
  | "mission"
  | "approvals"
  | "tools"
  | "knowledge"
  | "subagents"
  | "diagnostics"
  | "services"
  | "env"
  | "config"
  | "advanced";

export const SETTINGS_TAB_ORDER: readonly SettingsTabId[] = [
  "provider",
  "session",
  "mission",
  "approvals",
  "tools",
  "knowledge",
  "subagents",
  "diagnostics",
  "services",
  "env",
  "config",
  "advanced",
] as const;
