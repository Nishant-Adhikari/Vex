/**
 * Tool-calls history panel — Ctrl+O to toggle.
 *
 * Shows the last {@link RECENT_TOOL_CALLS_LIMIT} tool calls from the current
 * session with FULL args + FULL result, one entry per page. Tab/Shift+Tab
 * paginate; Esc closes.
 *
 * Why this panel exists: the main chat shows only `[tool:NAME]` to keep the
 * conversation readable. When debugging, the developer needs to see what the
 * model actually passed in and what came back — this panel surfaces both
 * without cluttering the chat.
 */

import React from "react";
import { Box, Text, useInput } from "ink";
import type { Store } from "../state/store.js";
import { useStore } from "../state/store.js";

interface Props {
  store: Store;
}

const RESULT_TRUNCATE_CHARS = 5000;

function statusColor(status: "pending" | "done" | "failed"): string {
  switch (status) {
    case "done":
      return "green";
    case "failed":
      return "red";
    default:
      return "yellow";
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n… [${text.length - max} more chars]`;
}

export function ToolCallsPanel({ store }: Props): React.JSX.Element | null {
  const open = useStore(store, (s) => s.toolCallsOpen);
  const cursor = useStore(store, (s) => s.toolCallsCursor);
  const calls = useStore(store, (s) => s.recentToolCalls);

  useInput(
    (_input, key) => {
      if (key.escape) {
        store.setState({ toolCallsOpen: false });
        return;
      }
      if (key.tab) {
        const len = calls.length;
        if (len === 0) return;
        const next = key.shift
          ? (cursor - 1 + len) % len
          : (cursor + 1) % len;
        store.setState({ toolCallsCursor: next });
      }
    },
    { isActive: open },
  );

  if (!open) return null;

  if (calls.length === 0) {
    return (
      <Box
        flexDirection="column"
        borderStyle="double"
        borderColor="yellow"
        paddingX={1}
        height="100%"
        overflow="hidden"
      >
        <Text bold color="yellow">
          Tool calls
        </Text>
        <Box marginTop={1}>
          <Text dimColor>No tool calls captured yet in this session.</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Esc — close</Text>
        </Box>
      </Box>
    );
  }

  const idx = Math.min(cursor, calls.length - 1);
  const entry = calls[idx]!;
  const argsJson = JSON.stringify(entry.args, null, 2);
  const resultText = entry.result ?? "(waiting for response…)";
  const resultDisplay = entry.result ? truncate(resultText, RESULT_TRUNCATE_CHARS) : resultText;

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="yellow"
      paddingX={1}
      height="100%"
      overflow="hidden"
    >
      <Box>
        <Text bold color="yellow">
          Tool calls
        </Text>
        <Text dimColor> · </Text>
        <Text>
          {idx + 1}/{calls.length}
        </Text>
        <Text dimColor> · </Text>
        <Text color={statusColor(entry.status)} bold>
          {entry.status}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text>[tool:</Text>
        <Text bold color="cyan">
          {entry.toolName}
        </Text>
        <Text>]</Text>
        <Text dimColor>
          {"  "}
          started {formatTime(entry.startedAt)}
          {entry.endedAt ? ` · ended ${formatTime(entry.endedAt)}` : ""}
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text bold>args:</Text>
      </Box>
      <Box>
        <Text wrap="wrap">{argsJson}</Text>
      </Box>

      <Box marginTop={1}>
        <Text bold>result:</Text>
      </Box>
      <Box>
        <Text wrap="wrap" color={entry.status === "failed" ? "red" : undefined}>
          {resultDisplay}
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Tab/Shift+Tab — paginate · Esc — close</Text>
      </Box>
    </Box>
  );
}
