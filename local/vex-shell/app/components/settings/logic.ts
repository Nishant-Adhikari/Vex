import type {
  KnowledgeHit,
  RecentSession,
  SettingsEditMode,
  SettingsTabId,
  Store,
} from "../../state/store.js";
import { saveConfigPatch } from "../../../../../src/config/store.js";
import { writeAppEnvValue } from "../../../../../src/providers/env-resolution.js";
import { synchronizeTrackedEnv } from "../../../../../src/cli/setup/setup.js";
import {
  stripManagedSecretsFromDotenvFile,
  writeSecretVaultSecrets,
} from "../../../../../src/lib/local-secret-vault.js";
import {
  MASTER_PASSWORD_ENV_KEY,
  isManagedSecretEnvKey,
  isVaultSecretKey,
  type VaultSecretKey,
} from "../../../../../src/lib/secret-keys.js";
import {
  directRunTool,
  switchProviderFlow,
} from "../../../engine-actions.js";
import { listSessionSubagents } from "../../../platform/subagent-monitor.js";
import { listShellSessions } from "../../../platform/session-host.js";
import { CONFIG_FIELDS } from "./constants.js";

export interface InkKey {
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  return?: boolean;
  escape?: boolean;
  backspace?: boolean;
  delete?: boolean;
  tab?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
}

export function setToast(store: Store, kind: "ok" | "error", text: string): void {
  store.setState({ settingsToast: { kind, text } });
}

export function clearToast(store: Store): void {
  store.setState({ settingsToast: null });
}

export function startEdit(store: Store, edit: SettingsEditMode): void {
  store.setState({ settingsEdit: edit, settingsToast: null });
}

export function exitEdit(store: Store): void {
  store.setState({ settingsEdit: null });
}

export function handleEditInput(
  store: Store,
  edit: SettingsEditMode,
  input: string,
  key: InkKey,
): void {
  if (key.escape) {
    exitEdit(store);
    return;
  }
  if (key.return) {
    void submitEdit(store, edit);
    return;
  }
  if (key.backspace || key.delete) {
    store.setState((s) =>
      s.settingsEdit
        ? { settingsEdit: { ...s.settingsEdit, value: s.settingsEdit.value.slice(0, -1) } }
        : {},
    );
    return;
  }
  if (key.tab || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) return;
  if (input && input.length > 0) {
    store.setState((s) =>
      s.settingsEdit
        ? { settingsEdit: { ...s.settingsEdit, value: s.settingsEdit.value + input } }
        : {},
    );
  }
}

async function submitEdit(store: Store, edit: SettingsEditMode): Promise<void> {
  const error = edit.validate?.(edit.value) ?? null;
  if (error) {
    setToast(store, "error", error);
    return;
  }
  try {
    await applyEdit(store, edit);
    exitEdit(store);
  } catch (err) {
    setToast(store, "error", err instanceof Error ? err.message : String(err));
  }
}

export async function applyEdit(store: Store, edit: SettingsEditMode): Promise<void> {
  const value = edit.value.trim();
  if (edit.tab === "env" || edit.tab === "advanced") {
    if (!value) {
      setToast(store, "error", "Empty value rejected. Use Esc to cancel.");
      return;
    }
    if (isManagedSecretEnvKey(edit.field)) {
      if (!isVaultSecretKey(edit.field)) {
        setToast(store, "error", "Master password rotation is handled by setup, not Env settings.");
        return;
      }
      writeSecretFromSettings(edit.field, value);
      synchronizeTrackedEnv();
      setToast(store, "ok", `${edit.field} updated in the encrypted vault.`);
      return;
    }
    writeAppEnvValue(edit.field, value);
    process.env[edit.field] = value;
    synchronizeTrackedEnv();
    setToast(store, "ok", `${edit.field} updated. (restart shell if it requires reload)`);
    return;
  }
  if (edit.tab === "config") {
    const def = CONFIG_FIELDS.find((f) => f.key === edit.field);
    if (!def) {
      setToast(store, "error", `Unknown config field ${edit.field}`);
      return;
    }
    saveConfigPatch(def.patch(value));
    setToast(store, "ok", `${edit.field} saved to config.json`);
    return;
  }
  if (edit.tab === "provider") {
    if (edit.field === "OPENROUTER_API_KEY") {
      writeSecretFromSettings("OPENROUTER_API_KEY", value);
      process.env.OPENROUTER_API_KEY = value;
      synchronizeTrackedEnv();
      setToast(store, "ok", "OPENROUTER_API_KEY updated.");
      return;
    }
    if (edit.field === "AGENT_MODEL") {
      writeAppEnvValue("AGENT_MODEL", value);
      process.env.AGENT_MODEL = value;
      synchronizeTrackedEnv();
      const result = await switchProviderFlow("openrouter");
      if (result.ok) {
        store.setState({
          provider: { name: "openrouter", detail: `model=${value}` },
        });
        setToast(store, "ok", `Switched to OpenRouter (${value})`);
      } else {
        setToast(store, "error", result.error);
      }
      return;
    }
  }
  if (edit.tab === "tools" && edit.field === "args") {
    const sessionId = store.getState().session?.id;
    if (!sessionId) {
      setToast(store, "error", "No active session");
      return;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = value === "" ? {} : (JSON.parse(value) as Record<string, unknown>);
    } catch (err) {
      setToast(store, "error", `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    const toolName = edit.placeholder ?? "";
    const result = await directRunTool(sessionId, toolName, parsed);
    if (result.ok) {
      const out = result.value.output.slice(0, 400);
      setToast(
        store,
        result.value.success ? "ok" : "error",
        `${toolName} → ${result.value.success ? "OK" : "FAIL"}: ${out}`,
      );
    } else {
      setToast(store, "error", result.error);
    }
    return;
  }
  if (edit.tab === "knowledge" && edit.field === "query") {
    const sessionId = store.getState().session?.id;
    if (!sessionId) {
      setToast(store, "error", "No active session");
      return;
    }
    const result = await directRunTool(sessionId, "knowledge_recall", { query: value, k: 8 });
    if (!result.ok) {
      setToast(store, "error", result.error);
      return;
    }
    const hits = parseKnowledgeHits(result.value.output);
    store.setState({ knowledgeResults: hits });
    setToast(store, "ok", `Recalled ${hits.length} entries.`);
    return;
  }
  setToast(store, "error", `No applyEdit handler for ${edit.tab}.${edit.field}`);
}

export function parseKnowledgeHits(rawJson: string): KnowledgeHit[] {
  try {
    const parsed = JSON.parse(rawJson) as { entries?: unknown };
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    return entries.slice(0, 20).map((e) => {
      const entry = e as Record<string, unknown>;
      return {
        id: typeof entry.id === "string" ? entry.id : String(entry.id ?? ""),
        title: typeof entry.title === "string" ? entry.title : "(untitled)",
        preview:
          typeof entry.summary === "string"
            ? entry.summary.slice(0, 160)
            : typeof entry.content_md === "string"
              ? entry.content_md.slice(0, 160)
              : "",
      };
    });
  } catch {
    return [];
  }
}

function writeSecretFromSettings(field: VaultSecretKey, value: string): void {
  const masterPassword = process.env[MASTER_PASSWORD_ENV_KEY]?.trim();
  if (!masterPassword) throw new Error("Vex secret vault is locked.");
  writeSecretVaultSecrets(masterPassword, { [field]: value });
  stripManagedSecretsFromDotenvFile();
  process.env[field] = value;
}

export async function hydrateTabData(store: Store, tab: SettingsTabId): Promise<void> {
  if (tab === "session") {
    try {
      const rows = await listShellSessions(8);
      const recent: RecentSession[] = rows.map((r) => ({
        id: r.id,
        kind: r.mode,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        messageCount: r.messageCount,
      }));
      store.setState({ recentSessions: recent });
    } catch {
      // UI shows an empty list on transient DB failures.
    }
  }
  if (tab === "subagents") {
    const sessionId = store.getState().session?.id;
    if (!sessionId) {
      store.setState({ subagentRows: [] });
      return;
    }
    try {
      store.setState({ subagentRows: await listSessionSubagents(sessionId) });
    } catch (err) {
      store.setState({ subagentRows: [] });
      setToast(store, "error", err instanceof Error ? err.message : String(err));
    }
  }
}

export function moveCursor(store: Store, max: number, key: InkKey): void {
  if (key.upArrow) {
    store.setState((s) => ({ settingsCursor: Math.max(0, s.settingsCursor - 1) }));
  } else if (key.downArrow) {
    store.setState((s) => ({ settingsCursor: Math.min(max - 1, s.settingsCursor + 1) }));
  }
}
