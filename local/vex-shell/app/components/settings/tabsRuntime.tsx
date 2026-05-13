import React from "react";
import { Box, Text } from "ink";
import { collectSystemChecks } from "../../../../../src/cli/setup/system.js";
import {
  bootstrapShell,
  type BootstrapResult,
} from "../../../platform/bootstrap.js";
import { recordBootstrapResult } from "../../../platform/diagnostics.js";
import { getRecentTuiLogLines, SHELL_LOG_FILE } from "../../../platform/log.js";
import { startServices, stopServices } from "../../../platform/services.js";
import type { Store } from "../../state/store.js";
import { useStore } from "../../state/store.js";
import { Hint, Label } from "./shared.js";
import { setToast, startEdit } from "./logic.js";

export function handleKnowledgeInput(store: Store, input: string): void {
  if (input === "q") {
    startEdit(store, {
      tab: "knowledge",
      field: "query",
      kind: "text",
      value: "",
      placeholder: "knowledge_recall query (English)",
      validate: (v) => (v.trim() ? null : "Query required"),
    });
  }
  if (input === "x") {
    store.setState({ knowledgeResults: [] });
  }
}

export function KnowledgeTab({ store }: { store: Store }): React.JSX.Element {
  const results = useStore(store, (s) => s.knowledgeResults);
  return (
    <Box flexDirection="column">
      <Label>Knowledge recall</Label>
      {results.length === 0 ? (
        <Text dimColor>No results yet — press q to query.</Text>
      ) : (
        results.map((hit) => (
          <Box key={hit.id} flexDirection="column" marginTop={1}>
            <Text color="cyan" bold>{hit.title}</Text>
            <Text dimColor>{hit.preview}</Text>
          </Box>
        ))
      )}
      <Box marginTop={1}>
        <Hint>q — new query (knowledge_recall via runTool). x — clear results.</Hint>
      </Box>
    </Box>
  );
}

export function DiagnosticsTab({ store }: { store: Store }): React.JSX.Element {
  const latency = useStore(store, (s) => s.latencyMs);
  const lastError = useStore(store, (s) => s.lastError);
  const logLines = getRecentTuiLogLines(4);
  const last = latency.length > 0 ? latency[latency.length - 1] : null;
  const avg =
    latency.length > 0
      ? Math.round(latency.reduce((acc, v) => acc + v, 0) / latency.length)
      : null;
  return (
    <Box flexDirection="column">
      <Label>Diagnostics</Label>
      <Text>
        {`Latency: ${last !== null ? `last=${last}ms` : "no samples"}`}
        {avg !== null ? ` avg=${avg}ms samples=${latency.length}` : ""}
      </Text>
      {lastError ? <Text color="red">{`last error: ${lastError}`}</Text> : <Text dimColor>no errors</Text>}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor wrap="truncate">{`log file: ${SHELL_LOG_FILE}`}</Text>
        {logLines.length > 0 ? (
          logLines.map((line, index) => (
            <Text key={`${index}-${line}`} dimColor wrap="truncate">
              {line}
            </Text>
          ))
        ) : (
          <Text dimColor>no TUI log lines captured yet</Text>
        )}
      </Box>
      <Box marginTop={1}>
        <Hint>Read-only. Latency feeds from chat-turn completion in App.tsx.</Hint>
      </Box>
    </Box>
  );
}

export function handleServicesInput(store: Store, input: string): void {
  if (input === "s") {
    void (async () => {
      try {
        const result = await startServices();
        setToast(store, result.ok ? "ok" : "error", result.message);
      } catch (err) {
        setToast(store, "error", err instanceof Error ? err.message : String(err));
      }
    })();
  }
  if (input === "p") {
    void (async () => {
      try {
        const result = await stopServices();
        setToast(store, result.ok ? "ok" : "error", result.message);
      } catch (err) {
        setToast(store, "error", err instanceof Error ? err.message : String(err));
      }
    })();
  }
  if (input === "r") {
    void (async () => {
      try {
        const result: BootstrapResult = await bootstrapShell();
        recordBootstrapResult(result);
        setToast(
          store,
          result.ok ? "ok" : "error",
          result.ok ? `Bootstrap OK (${result.durationMs}ms)` : `Bootstrap failed at ${result.failure?.stage}`,
        );
      } catch (err) {
        setToast(store, "error", err instanceof Error ? err.message : String(err));
      }
    })();
  }
}

export function ServicesTab(): React.JSX.Element {
  const checks = collectSystemChecks();
  return (
    <Box flexDirection="column">
      <Label>Services</Label>
      {checks.map((c) => (
        <Box key={c.label}>
          <Text color={c.ok ? "green" : "red"}>{c.ok ? "OK     " : "MISSING"}</Text>
          <Text>{` ${c.label} — ${c.detail}`}</Text>
        </Box>
      ))}
      <Box marginTop={1}>
        <Hint>s — docker compose up -d. p — stop. r — rebootstrap (DB migrations + probes).</Hint>
      </Box>
    </Box>
  );
}
