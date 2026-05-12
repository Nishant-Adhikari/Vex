import React from "react";
import { Box, Text } from "ink";
import { readAppEnvMap } from "../../../../../src/cli/setup/status.js";
import { loadConfig, type VexConfig } from "../../../../../src/config/store.js";
import type { Store } from "../../state/store.js";
import { useStore } from "../../state/store.js";
import { ADVANCED_FIELDS, CONFIG_FIELDS, ENV_FIELDS } from "./constants.js";
import { Hint, Label, maskSecret } from "./shared.js";
import { moveCursor, setToast, startEdit, type InkKey } from "./logic.js";

export function handleEnvInput(store: Store, _input: string, key: InkKey): void {
  moveCursor(store, ENV_FIELDS.length, key);
  if (key.return) {
    const cursor = store.getState().settingsCursor;
    const field = ENV_FIELDS[cursor];
    if (!field) return;
    const current = readAppEnvMap()[field.key] ?? "";
    startEdit(store, {
      tab: "env",
      field: field.key,
      kind: field.secret ? "secret" : "text",
      value: current,
      placeholder: field.key,
    });
  }
}

export function EnvTab({ store }: { store: Store }): React.JSX.Element {
  const cursor = useStore(store, (s) => s.settingsCursor);
  const env = readAppEnvMap();
  return (
    <Box flexDirection="column">
      <Label>Tracked environment variables</Label>
      {ENV_FIELDS.map((f, idx) => {
        const value = env[f.key] ?? "";
        const display = f.secret ? maskSecret(value) : value || "<unset>";
        return (
          <Text key={f.key} color={idx === cursor ? "cyan" : undefined}>
            {`${idx === cursor ? "›" : " "} ${f.key.padEnd(26)} ${display}`}
          </Text>
        );
      })}
      <Box marginTop={1}>
        <Hint>↑↓ select. Enter — edit. Some keys (DB URL, LOG_*) require shell restart.</Hint>
      </Box>
    </Box>
  );
}

export function handleConfigInput(store: Store, _input: string, key: InkKey): void {
  moveCursor(store, CONFIG_FIELDS.length, key);
  if (key.return) {
    const cursor = store.getState().settingsCursor;
    const field = CONFIG_FIELDS[cursor];
    if (!field) return;
    let cfg: VexConfig;
    try {
      cfg = loadConfig();
    } catch (err) {
      setToast(store, "error", err instanceof Error ? err.message : String(err));
      return;
    }
    startEdit(store, {
      tab: "config",
      field: field.key,
      kind: "text",
      value: field.read(cfg),
      placeholder: field.key,
    });
  }
}

export function ConfigTab({ store }: { store: Store }): React.JSX.Element {
  const cursor = useStore(store, (s) => s.settingsCursor);
  let cfg: VexConfig | null = null;
  let loadErr: string | null = null;
  try {
    cfg = loadConfig();
  } catch (err) {
    loadErr = err instanceof Error ? err.message : String(err);
  }
  if (loadErr || !cfg) {
    return (
      <Box flexDirection="column">
        <Label>~/.vex/config.json</Label>
        <Text color="red">{loadErr ?? "loadConfig returned null"}</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Label>~/.vex/config.json</Label>
      {CONFIG_FIELDS.map((f, idx) => (
        <Text key={f.key} color={idx === cursor ? "cyan" : undefined}>
          {`${idx === cursor ? "›" : " "} ${f.key.padEnd(32)} ${f.read(cfg) || "<empty>"}`}
        </Text>
      ))}
      <Box marginTop={1}>
        <Hint>↑↓ select. Enter — edit (saveConfigPatch). Cached broker may need /provider re-switch.</Hint>
      </Box>
    </Box>
  );
}

export function handleAdvancedInput(store: Store, _input: string, key: InkKey): void {
  moveCursor(store, ADVANCED_FIELDS.length, key);
  if (key.return) {
    const cursor = store.getState().settingsCursor;
    const field = ADVANCED_FIELDS[cursor];
    if (!field) return;
    const env = readAppEnvMap();
    startEdit(store, {
      tab: "advanced",
      field: field.key,
      kind: "number",
      value: env[field.key] ?? "",
      placeholder: field.hint,
    });
  }
}

export function AdvancedTab({ store }: { store: Store }): React.JSX.Element {
  const cursor = useStore(store, (s) => s.settingsCursor);
  const env = readAppEnvMap();
  return (
    <Box flexDirection="column">
      <Label>Advanced tunings</Label>
      {ADVANCED_FIELDS.map((f, idx) => (
        <Text key={f.key} color={idx === cursor ? "cyan" : undefined}>
          {`${idx === cursor ? "›" : " "} ${f.key.padEnd(28)} ${env[f.key] ?? "<default>"}  ${f.hint ? `(${f.hint})` : ""}`}
        </Text>
      ))}
      <Box marginTop={1}>
        <Hint>↑↓ select. Enter — edit. Subagent fields take effect on next subagent_spawn.</Hint>
      </Box>
    </Box>
  );
}
