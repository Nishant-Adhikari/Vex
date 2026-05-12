/**
 * Right-side diagnostics panel — toggled by Ctrl+D. Renders cold-start state,
 * latency buffer, and recent-error toast. 2D will add live tool-call history.
 *
 * Data source is the existing `diagnostics.ts` data hooks; sidebar only reads,
 * never records.
 */

import React from "react";
import { Box, Text } from "ink";
import type { Store, ShellViewState } from "../state/store.js";
import { useStore } from "../state/store.js";
import { formatSubagentAge } from "../state/subagents.js";
import { formatContextWindow, formatSessionCost, formatTokenCount } from "../../platform/render.js";

interface SidebarProps {
  store: Store;
  width?: number;
}

function selectSidebar(s: ShellViewState) {
  return {
    open: s.sidebarOpen,
    mode: s.mode,
    session: s.session,
    latencyMs: s.latencyMs,
    lastError: s.lastError,
    subagentRows: s.subagentRows,
  };
}

export function Sidebar({ store, width = 34 }: SidebarProps): React.JSX.Element | null {
  const { open, mode, session, latencyMs, lastError, subagentRows } = useStore(store, selectSidebar);
  if (!open || width <= 0) return null;

  const last = latencyMs.length > 0 ? latencyMs[latencyMs.length - 1] : null;
  const avg =
    latencyMs.length > 0
      ? Math.round(latencyMs.reduce((acc, v) => acc + v, 0) / latencyMs.length)
      : null;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      width={width}
      height="100%"
      flexShrink={0}
      paddingX={1}
      marginLeft={1}
      overflow="hidden"
    >
      <Text bold color="gray">
        Diagnostics (Ctrl+D to close)
      </Text>
      <Box flexDirection="column" marginTop={1}>
        <Text wrap="truncate">
          Mode: <Text bold>{mode}</Text>
        </Text>
        <Text wrap="truncate">
          Context: {session ? formatContextWindow(session.context) : "none"}
        </Text>
        <Text wrap="truncate">
          Tokens: {session ? `${formatTokenCount(session.usage.sessionTokens)} req=${session.usage.requestCount}` : "none"}
        </Text>
        <Text wrap="truncate">
          Cost: {session ? formatSessionCost(session.usage.sessionCost) : "none"}
        </Text>
        <Text wrap="truncate">
          Latency: {last !== null ? `last=${last}ms` : "no samples"}
          {avg !== null ? ` avg=${avg}ms` : ""}
          {latencyMs.length > 0 ? ` samples=${latencyMs.length}` : ""}
        </Text>
        {lastError ? (
          <Box marginTop={1}>
            <Text color="red" wrap="truncate">last error: {lastError}</Text>
          </Box>
        ) : null}
        {subagentRows.length > 0 ? (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Subagents</Text>
            {subagentRows.slice(0, 4).map((row) => (
              <Text key={row.id} color={sidebarSubagentColor(row.attention)} wrap="truncate">
                {`${row.name} ${row.status} ${formatSubagentAge(row.durationSeconds)} ${row.activityLabel}`}
              </Text>
            ))}
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

function sidebarSubagentColor(
  attention: "none" | "running" | "waiting" | "stalled" | "error",
): "gray" | "green" | "yellow" | "red" | "magenta" {
  switch (attention) {
    case "error":
      return "red";
    case "stalled":
      return "yellow";
    case "waiting":
      return "magenta";
    case "running":
      return "green";
    case "none":
      return "gray";
  }
}
