import React from "react";
import { Box, Text } from "ink";
import { directRunTool } from "../../../engine-actions.js";
import type { Store, SubagentRow } from "../../state/store.js";
import { useStore } from "../../state/store.js";
import { formatSubagentAge } from "../../state/subagents.js";
import { Hint, Label } from "./shared.js";
import { hydrateTabData, moveCursor, setToast, type InkKey } from "./logic.js";

export function handleSubagentsInput(store: Store, input: string, key: InkKey): void {
  const rows = store.getState().subagentRows;
  moveCursor(store, rows.length || 1, key);
  const cursor = store.getState().settingsCursor;
  const target = rows[cursor];

  if (input === "k" && target) {
    const session = store.getState().session;
    if (!session) {
      setToast(store, "error", "No active session.");
      return;
    }
    void (async () => {
      const result = await directRunTool(session.id, "subagent_stop", { id: target.id });
      if (result.ok && result.value.success) {
        setToast(store, "ok", `Stopped subagent ${target.id.slice(0, 12)}...`);
        await hydrateTabData(store, "subagents");
      } else {
        setToast(store, "error", result.ok ? result.value.output.slice(0, 200) : result.error);
      }
    })();
  }

  if (input === "r") {
    void hydrateTabData(store, "subagents");
  }
}

export function SubagentsTab({ store }: { store: Store }): React.JSX.Element {
  const rows = useStore(store, (state) => state.subagentRows);
  const cursor = useStore(store, (state) => state.settingsCursor);
  const selected = rows[cursor] ?? null;

  return (
    <Box flexDirection="column">
      <Label>{`Subagents (${rows.length} for this session)`}</Label>
      {rows.length === 0 ? <Text dimColor>(none for this session)</Text> : null}
      {rows.map((row: SubagentRow, index: number) => (
        <Text key={row.id} color={index === cursor ? "cyan" : statusColor(row)}>
          {`${index === cursor ? ">" : " "} ${row.name} ${row.status} ${row.iterations}/${row.maxIterations} ${row.activityLabel}`}
        </Text>
      ))}
      {selected ? <SubagentDetails row={selected} /> : null}
      <Box marginTop={1}>
        <Hint>Up/Down select. k - stop. r - refresh. Ctrl+S opens this tab when a subagent needs attention.</Hint>
      </Box>
    </Box>
  );
}

function SubagentDetails({ row }: { row: SubagentRow }): React.JSX.Element {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text wrap="truncate">{`id=${row.id}`}</Text>
      <Text wrap="truncate">{`childSession=${row.childSessionId}`}</Text>
      <Text wrap="truncate">
        {`age=${formatSubagentAge(row.durationSeconds)} activity=${row.activityLabel}`}
        {row.stalled ? " stalled=true" : ""}
      </Text>
      <Text wrap="truncate">{`task=${row.task}`}</Text>
      {row.activityDetail ? <Text dimColor wrap="truncate">{`detail=${row.activityDetail}`}</Text> : null}
      {row.error ? <Text color="red" wrap="truncate">{`error=${row.error}`}</Text> : null}
      {row.result ? <Text color="green" wrap="truncate">{`result=${row.result}`}</Text> : null}
    </Box>
  );
}

function statusColor(row: SubagentRow): "gray" | "green" | "yellow" | "red" | "magenta" | undefined {
  switch (row.attention) {
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
